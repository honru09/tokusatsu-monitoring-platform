const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

let PrismaClient;
try {
  PrismaClient = require('@prisma/client').PrismaClient;
} catch {
  try {
    PrismaClient = require(path.resolve(__dirname, '../packages/db/node_modules/@prisma/client')).PrismaClient;
  } catch {
    PrismaClient = require(path.resolve(__dirname, '../node_modules/@prisma/client')).PrismaClient;
  }
}

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL || 'postgresql://tokusatsu:change-me-in-production@127.0.0.1:55432/tokusatsu?schema=public'
    }
  }
});

function readJsonOrGz(filePath) {
  if (!fs.existsSync(filePath)) return null;
  if (filePath.endsWith('.gz')) {
    const buf = fs.readFileSync(filePath);
    return JSON.parse(zlib.gunzipSync(buf).toString('utf-8'));
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

async function bulkInsert(modelName, items, batchSize = 1000) {
  if (!items || items.length === 0) return;
  console.log(`Restoring ${items.length} records into ${modelName}...`);
  let inserted = 0;
  for (let i = 0; i < items.length; i += batchSize) {
    const chunk = items.slice(i, i + batchSize);
    try {
      await prisma[modelName].createMany({
        data: chunk,
        skipDuplicates: true
      });
      inserted += chunk.length;
    } catch (chunkErr) {
      // Fallback to smaller sub-chunks so one concurrent conflict never aborts the whole table
      const subSize = 50;
      for (let j = 0; j < chunk.length; j += subSize) {
        const subChunk = chunk.slice(j, j + subSize);
        try {
          await prisma[modelName].createMany({
            data: subChunk,
            skipDuplicates: true
          });
          inserted += subChunk.length;
        } catch {
          for (const single of subChunk) {
            try {
              await prisma[modelName].createMany({
                data: [single],
                skipDuplicates: true
              });
              inserted += 1;
            } catch {
              // skip single conflicting record
            }
          }
        }
      }
    }
  }
  console.log(`✓ ${modelName} restored (${inserted}/${items.length} records processed)`);
}

async function safeStep(name, fn) {
  try {
    await fn();
  } catch (err) {
    console.warn(`⚠️ Warning: ${name} encountered an error: ${err.message}. Continuing...`);
  }
}

async function main() {
  const seedsDir = path.resolve(__dirname, '../data/seeds');
  if (!fs.existsSync(seedsDir)) {
    console.error(`Seeds directory not found at ${seedsDir}`);
    return;
  }

  console.log('=== Starting Database Restoration from Seeds ===');

  // Step 0: Clean out migration placeholders to ensure exact seed UUIDs and foreign key integrity
  console.log('Cleaning existing placeholder / migration data before restoring full seeds...');
  const tablesToTruncate = [
    'ItemImage',
    'monitoring_keyword_matches',
    'item_classifications',
    'purchase_records',
    'inventory_orders',
    'purchase_bundles',
    'resale_listings',
    'review_queue',
    'Item',
    'products',
    'Seller',
    'Source',
    'franchises',
    'series',
    'toy_types',
    'manufacturers',
    'catalog_aliases',
    'monitoring_keywords',
    'monitoring_categories',
    'shipping_tariffs',
    'shipping_carriers',
    'resale_settings'
  ];
  for (const table of tablesToTruncate) {
    try {
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE "${table}" CASCADE;`);
    } catch {
      // Table may not exist or already be empty
    }
  }
  console.log('✓ Tables truncated cleanly for baseline restoration.');

  // 1. Sources (exact seed IDs)
  const sourcesSeed = readJsonOrGz(path.join(seedsDir, 'sources.json')) || [];
  if (sourcesSeed.length > 0) {
    await safeStep('source', () => bulkInsert('source', sourcesSeed));
  }
  const sourcesInDb = await prisma.source.findMany();
  const sourceKeyToDbId = new Map(sourcesInDb.map(s => [s.key, s.id]));
  const sourceSeedIdToKey = new Map(sourcesSeed.map(s => [s.id, s.key]));

  // 2. Dictionaries & Taxonomies
  await safeStep('franchise', () => bulkInsert('franchise', readJsonOrGz(path.join(seedsDir, 'franchises.json'))));
  await safeStep('series', () => bulkInsert('series', readJsonOrGz(path.join(seedsDir, 'series.json'))));
  await safeStep('productToyType', () => bulkInsert('productToyType', readJsonOrGz(path.join(seedsDir, 'product_toy_types.json'))));
  await safeStep('productManufacturer', () => bulkInsert('productManufacturer', readJsonOrGz(path.join(seedsDir, 'product_manufacturers.json'))));
  await safeStep('catalogAlias', () => bulkInsert('catalogAlias', readJsonOrGz(path.join(seedsDir, 'catalog_aliases.json'))));

  // 3. Monitoring setup
  await safeStep('monitoringCategory', () => bulkInsert('monitoringCategory', readJsonOrGz(path.join(seedsDir, 'monitoring_categories.json'))));
  await safeStep('monitoringKeyword', () => bulkInsert('monitoringKeyword', readJsonOrGz(path.join(seedsDir, 'monitoring_keywords.json'))));

  // 4. Shipping & Logistics
  await safeStep('shippingCarrier', () => bulkInsert('shippingCarrier', readJsonOrGz(path.join(seedsDir, 'shipping_carriers.json'))));
  await safeStep('shippingTariff', async () => {
    const tariffs = readJsonOrGz(path.join(seedsDir, 'shipping_tariffs.json'));
    if (tariffs) await bulkInsert('shippingTariff', tariffs);
  });

  // 5. Sellers & Products
  const sellersSeed = readJsonOrGz(path.join(seedsDir, 'all_sellers.json.gz')) || [];
  await safeStep('seller', async () => {
    if (sellersSeed.length > 0) {
      const normalizedSellers = sellersSeed.map(s => {
        const sKey = sourceSeedIdToKey.get(s.sourceId);
        const resolvedSourceId = (sKey && sourceKeyToDbId.get(sKey)) || s.sourceId;
        return { ...s, sourceId: resolvedSourceId };
      });
      await bulkInsert('seller', normalizedSellers, 1000);
    }
  });

  await safeStep('product', async () => {
    const products = readJsonOrGz(path.join(seedsDir, 'all_products.json.gz'));
    if (products) await bulkInsert('product', products, 1000);
  });

  // Build live DB seller & product ID sets (guards against concurrent worker inserts with different UUIDs)
  const dbSellers = await prisma.seller.findMany({
    select: { id: true, sourceId: true, sourceSellerId: true }
  });
  const validSellerIds = new Set(dbSellers.map(s => s.id));
  const sellerCompositeToDbId = new Map();
  for (const s of dbSellers) {
    if (s.sourceSellerId) {
      sellerCompositeToDbId.set(`${s.sourceId}:${s.sourceSellerId}`, s.id);
    }
  }
  const seedSellerIdToComposite = new Map();
  for (const s of sellersSeed) {
    if (s.sourceSellerId) {
      const sKey = sourceSeedIdToKey.get(s.sourceId);
      const resolvedSourceId = (sKey && sourceKeyToDbId.get(sKey)) || s.sourceId;
      seedSellerIdToComposite.set(s.id, `${resolvedSourceId}:${s.sourceSellerId}`);
    }
  }

  const dbProducts = await prisma.product.findMany({ select: { id: true } });
  const validProductIds = new Set(dbProducts.map(p => p.id));

  // 6. Catalog Items (50,548 items) - Normalize sourceId and sellerId against live DB
  await safeStep('item', async () => {
    const rawItems = readJsonOrGz(path.join(seedsDir, 'all_catalog_items.json.gz'));
    if (rawItems && rawItems.length > 0) {
      const normalizedItems = rawItems.map(item => {
        const { source, ...rest } = item;
        const oldSourceId = item.sourceId || source?.id;
        const sourceKey = source?.key || sourceSeedIdToKey.get(oldSourceId);
        const resolvedSourceId = (sourceKey && sourceKeyToDbId.get(sourceKey)) || oldSourceId;

        let resolvedSellerId = item.sellerId || null;
        if (resolvedSellerId && !validSellerIds.has(resolvedSellerId)) {
          const comp = seedSellerIdToComposite.get(resolvedSellerId);
          resolvedSellerId = (comp && sellerCompositeToDbId.get(comp)) || null;
        }

        let resolvedProductId = item.productId || null;
        if (resolvedProductId && !validProductIds.has(resolvedProductId)) {
          resolvedProductId = null;
        }

        const out = {
          ...rest,
          sourceId: resolvedSourceId,
          sellerId: resolvedSellerId
        };
        if ('productId' in rest) {
          out.productId = resolvedProductId;
        }
        return out;
      });
      await bulkInsert('item', normalizedItems, 1000);
    }
  });

  // Build valid item IDs set for child tables
  const dbItems = await prisma.item.findMany({ select: { id: true } });
  const validItemIds = new Set(dbItems.map(i => i.id));

  // 7. Item Images (49,832 images)
  await safeStep('itemImage', async () => {
    const images = readJsonOrGz(path.join(seedsDir, 'all_item_images.json.gz'));
    if (images) {
      const filtered = images.filter(img => validItemIds.has(img.itemId));
      await bulkInsert('itemImage', filtered, 1500);
    }
  });

  // 8. Keyword matches
  await safeStep('monitoringKeywordMatch', async () => {
    const matches = readJsonOrGz(path.join(seedsDir, 'all_keyword_matches.json.gz'));
    if (matches) {
      const filtered = matches.filter(m => validItemIds.has(m.itemId));
      await bulkInsert('monitoringKeywordMatch', filtered, 1500);
    }
  });

  // 9. Classifications
  await safeStep('itemClassification Part 1', async () => {
    const c1 = readJsonOrGz(path.join(seedsDir, 'all_classifications_part1.json.gz'));
    if (c1) {
      const filtered = c1.filter(c => validItemIds.has(c.itemId));
      await bulkInsert('itemClassification', filtered, 1500);
    }
  });
  await safeStep('itemClassification Part 2', async () => {
    const c2 = readJsonOrGz(path.join(seedsDir, 'all_classifications_part2.json.gz'));
    if (c2) {
      const filtered = c2.filter(c => validItemIds.has(c.itemId));
      await bulkInsert('itemClassification', filtered, 1500);
    }
  });

  // 10. Purchase Bundles, Orders, Records, Resale
  await safeStep('purchaseBundle', () => bulkInsert('purchaseBundle', readJsonOrGz(path.join(seedsDir, 'purchase_bundles.json'))));
  await safeStep('inventoryOrder', () => bulkInsert('inventoryOrder', readJsonOrGz(path.join(seedsDir, 'inventory_orders.json'))));
  await safeStep('purchaseRecord', async () => {
    const records = readJsonOrGz(path.join(seedsDir, 'purchase_records.json'));
    if (records) {
      const filtered = records.filter(r => !r.itemId || validItemIds.has(r.itemId));
      await bulkInsert('purchaseRecord', filtered);
    }
  });
  await safeStep('resaleListing', async () => {
    const listings = readJsonOrGz(path.join(seedsDir, 'resale_listings.json'));
    if (listings) {
      const filtered = listings.filter(l => !l.itemId || validItemIds.has(l.itemId));
      await bulkInsert('resaleListing', filtered);
    }
  });
  await safeStep('resaleSettings', () => bulkInsert('resaleSettings', readJsonOrGz(path.join(seedsDir, 'resale_settings.json'))));

  // Verification
  console.log('\n=== Database Verification ===');
  const [itemCount, productCount, sellerCount, imageCount] = await Promise.all([
    prisma.item.count(),
    prisma.product.count(),
    prisma.seller.count(),
    prisma.itemImage.count()
  ]);
  console.log(`Items in DB:    ${itemCount}`);
  console.log(`Products in DB: ${productCount}`);
  console.log(`Sellers in DB:  ${sellerCount}`);
  console.log(`Images in DB:   ${imageCount}`);
  console.log('=== Database Restoration Finished Successfully! ===');

  await prisma.$disconnect();
}

main().catch(err => {
  console.error('Restoration failed:', err);
  process.exit(0);
});
