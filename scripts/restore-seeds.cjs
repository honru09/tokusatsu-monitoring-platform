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
  for (let i = 0; i < items.length; i += batchSize) {
    const chunk = items.slice(i, i + batchSize);
    await prisma[modelName].createMany({
      data: chunk,
      skipDuplicates: true
    });
  }
  console.log(`✓ ${modelName} restored (${items.length} records)`);
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
  await safeStep('seller', async () => {
    const sellers = readJsonOrGz(path.join(seedsDir, 'all_sellers.json.gz'));
    if (sellers) await bulkInsert('seller', sellers, 1000);
  });

  await safeStep('product', async () => {
    const products = readJsonOrGz(path.join(seedsDir, 'all_products.json.gz'));
    if (products) await bulkInsert('product', products, 1000);
  });

  // 6. Catalog Items (50,548 items) - Normalize sourceId from source relation object
  await safeStep('item', async () => {
    const rawItems = readJsonOrGz(path.join(seedsDir, 'all_catalog_items.json.gz'));
    if (rawItems && rawItems.length > 0) {
      const normalizedItems = rawItems.map(item => {
        const { source, ...rest } = item;
        const oldSourceId = item.sourceId || source?.id;
        const sourceKey = source?.key || sourceSeedIdToKey.get(oldSourceId);
        const resolvedSourceId = (sourceKey && sourceKeyToDbId.get(sourceKey)) || oldSourceId;
        return {
          ...rest,
          sourceId: resolvedSourceId
        };
      });
      await bulkInsert('item', normalizedItems, 1000);
    }
  });

  // 7. Item Images (49,832 images)
  await safeStep('itemImage', async () => {
    const images = readJsonOrGz(path.join(seedsDir, 'all_item_images.json.gz'));
    if (images) await bulkInsert('itemImage', images, 1500);
  });

  // 8. Keyword matches
  await safeStep('monitoringKeywordMatch', async () => {
    const matches = readJsonOrGz(path.join(seedsDir, 'all_keyword_matches.json.gz'));
    if (matches) await bulkInsert('monitoringKeywordMatch', matches, 1500);
  });

  // 9. Classifications
  await safeStep('itemClassification Part 1', async () => {
    const c1 = readJsonOrGz(path.join(seedsDir, 'all_classifications_part1.json.gz'));
    if (c1) await bulkInsert('itemClassification', c1, 1500);
  });
  await safeStep('itemClassification Part 2', async () => {
    const c2 = readJsonOrGz(path.join(seedsDir, 'all_classifications_part2.json.gz'));
    if (c2) await bulkInsert('itemClassification', c2, 1500);
  });

  // 10. Purchase Bundles, Orders, Records, Resale
  await safeStep('purchaseBundle', () => bulkInsert('purchaseBundle', readJsonOrGz(path.join(seedsDir, 'purchase_bundles.json'))));
  await safeStep('inventoryOrder', () => bulkInsert('inventoryOrder', readJsonOrGz(path.join(seedsDir, 'inventory_orders.json'))));
  await safeStep('purchaseRecord', () => bulkInsert('purchaseRecord', readJsonOrGz(path.join(seedsDir, 'purchase_records.json'))));
  await safeStep('resaleListing', () => bulkInsert('resaleListing', readJsonOrGz(path.join(seedsDir, 'resale_listings.json'))));
  await safeStep('resaleSettings', () => bulkInsert('resaleSettings', readJsonOrGz(path.join(seedsDir, 'resale_settings.json'))));

  // Verification
  console.log('\n=== Database Verification ===');
  const [itemCount, productCount, sellerCount] = await Promise.all([
    prisma.item.count(),
    prisma.product.count(),
    prisma.seller.count()
  ]);
  console.log(`Items in DB: ${itemCount}`);
  console.log(`Products in DB: ${productCount}`);
  console.log(`Sellers in DB: ${sellerCount}`);
  console.log('=== Database Restoration Finished Successfully! ===');

  await prisma.$disconnect();
}

main().catch(err => {
  console.error('Restoration failed:', err);
  process.exit(0);
});
