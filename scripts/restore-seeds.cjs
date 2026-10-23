const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const prisma = new PrismaClient();

function readJsonOrGz(filePath) {
  if (!fs.existsSync(filePath)) return null;
  if (filePath.endsWith('.gz')) {
    const buf = fs.readFileSync(filePath);
    return JSON.parse(zlib.gunzipSync(buf).toString('utf-8'));
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

async function bulkInsert(modelName, items, batchSize = 2000) {
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

async function main() {
  const seedsDir = path.resolve(__dirname, '../data/seeds');
  if (!fs.existsSync(seedsDir)) {
    console.error(`Seeds directory not found at ${seedsDir}`);
    return;
  }

  console.log('=== Starting Database Restoration from Seeds ===');

  // 1. Dictionaries & Taxonomies
  await bulkInsert('franchise', readJsonOrGz(path.join(seedsDir, 'franchises.json')));
  await bulkInsert('series', readJsonOrGz(path.join(seedsDir, 'series.json')));
  await bulkInsert('productToyType', readJsonOrGz(path.join(seedsDir, 'product_toy_types.json')));
  await bulkInsert('productManufacturer', readJsonOrGz(path.join(seedsDir, 'product_manufacturers.json')));
  await bulkInsert('catalogAlias', readJsonOrGz(path.join(seedsDir, 'catalog_aliases.json')));

  // 2. Monitoring setup
  await bulkInsert('monitoringCategory', readJsonOrGz(path.join(seedsDir, 'monitoring_categories.json')));
  await bulkInsert('monitoringKeyword', readJsonOrGz(path.join(seedsDir, 'monitoring_keywords.json')));

  // 3. Shipping & Logistics
  await bulkInsert('shippingCarrier', readJsonOrGz(path.join(seedsDir, 'shipping_carriers.json')));
  await bulkInsert('shippingTariff', readJsonOrGz(path.join(seedsDir, 'shipping_tariffs.json')));

  // 4. Sellers & Products
  const sellers = readJsonOrGz(path.join(seedsDir, 'all_sellers.json.gz'));
  if (sellers) await bulkInsert('seller', sellers);

  const products = readJsonOrGz(path.join(seedsDir, 'all_products.json.gz'));
  if (products) await bulkInsert('product', products);

  // 5. Catalog Items
  const items = readJsonOrGz(path.join(seedsDir, 'all_catalog_items.json.gz'));
  if (items) await bulkInsert('item', items);

  // 6. Item Images
  const images = readJsonOrGz(path.join(seedsDir, 'all_item_images.json.gz'));
  if (images) await bulkInsert('itemImage', images);

  // 7. Keyword matches
  const matches = readJsonOrGz(path.join(seedsDir, 'all_keyword_matches.json.gz'));
  if (matches) await bulkInsert('monitoringKeywordMatch', matches);

  // 8. Classifications
  const c1 = readJsonOrGz(path.join(seedsDir, 'all_classifications_part1.json.gz'));
  if (c1) await bulkInsert('itemClassification', c1);
  const c2 = readJsonOrGz(path.join(seedsDir, 'all_classifications_part2.json.gz'));
  if (c2) await bulkInsert('itemClassification', c2);

  // 9. Orders & Resale
  await bulkInsert('inventoryOrder', readJsonOrGz(path.join(seedsDir, 'inventory_orders.json')));
  await bulkInsert('purchaseRecord', readJsonOrGz(path.join(seedsDir, 'purchase_records.json')));
  await bulkInsert('purchaseBundle', readJsonOrGz(path.join(seedsDir, 'purchase_bundles.json')));
  await bulkInsert('resaleListing', readJsonOrGz(path.join(seedsDir, 'resale_listings.json')));
  
  const resaleSettings = readJsonOrGz(path.join(seedsDir, 'resale_settings.json'));
  if (resaleSettings && resaleSettings.length > 0) {
    await bulkInsert('resaleSettings', resaleSettings);
  }

  console.log('=== Database Restoration Finished Successfully! ===');
  await prisma.$disconnect();
}

main().catch(err => {
  console.error('Restoration failed:', err);
  process.exit(1);
});
