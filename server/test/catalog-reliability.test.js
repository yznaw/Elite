const test = require('node:test');
const assert = require('node:assert/strict');

const adminProducts = require('../routes/admin-products.route');
const publicProducts = require('../routes/products.route');
const { publishCatalogEvent } = require('../lib/inventory-ledger');

test('product validation requires at least one variant', () => {
  const base = { name: 'Test', sku: 'TEST-1', brand: 'Elite', price: 10, stock: 0 };
  assert.match(adminProducts._test.validateProduct({ ...base, variants: [] }).join(' '), /variant is required/i);
  assert.deepEqual(adminProducts._test.validateProduct({
    ...base,
    variants: [{ sku: 'TEST-1-ONE', price: 10, stock: 0 }],
  }), []);
});

test('public product mapping exposes the Arabic product name', () => {
  const mapped = publicProducts._test.mapRow({
    id: 'p1',
    name: 'English Name',
    name_ar: 'الاسم العربي',
    description: {},
    care_instructions: {},
    variants: [],
    sizes: [], colors: [], materials: [], images: [], image_variants: [], color_images: {},
    base_price_cents: 1000,
    stock_quantity: 0,
  });
  assert.equal(mapped.nameAr, 'الاسم العربي');
});

test('catalog.changed is persisted as a tenant-wide POS event', async () => {
  const calls = [];
  const client = { query: async (sql, params) => calls.push({ sql, params }) };
  await publishCatalogEvent(client, 'tenant-1', 'product-1', 'updated');
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /catalog\.changed/);
  assert.deepEqual(JSON.parse(calls[0].params[1]), { productId: 'product-1', action: 'updated' });
});
