const test = require('node:test');
const assert = require('node:assert/strict');

require('dotenv').config();

const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
process.env.DEFAULT_TENANT_SLUG = `products-audit-e2e-${runId}`;
process.env.DEFAULT_TENANT_NAME = 'Products Audit E2E';
process.env.DEFAULT_ADMIN_EMAIL = `products-audit-e2e-${runId}@elite.local`;
process.env.DEFAULT_ADMIN_PASSWORD = 'products-audit-e2e-password';
process.env.DEFAULT_ADMIN_NAME = 'Products Audit Owner';
process.env.SESSION_SECRET = `products-audit-e2e-session-${runId}`;

const db = require('../db/client');
const { startServer } = require('../index');

test('admin products: create, save, duplicate and delete never touch the wrong data', { timeout: 60000 }, async (t) => {
  if (!process.env.DATABASE_URL) return t.skip('DATABASE_URL is required for this E2E test.');

  const server = await startServer(0);
  const base = `http://127.0.0.1:${server.address().port}/api`;
  let cookie = '';
  let csrfToken = '';
  let tenantId = '';

  function captureCookies(response) {
    const setCookies = typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : [response.headers.get('set-cookie')].filter(Boolean);
    for (const raw of setCookies) {
      const [pair] = raw.split(';');
      const [name, value] = pair.split('=');
      if (name === 'elite.sid') cookie = pair;
      if (name === 'elite.csrf') csrfToken = decodeURIComponent(value);
    }
  }

  async function raw(path, options = {}) {
    const response = await fetch(`${base}${path}`, {
      ...options,
      headers: {
        ...(options.body ? { 'content-type': 'application/json' } : {}),
        ...(cookie ? { cookie: csrfToken ? `${cookie}; elite.csrf=${csrfToken}` : cookie } : {}),
        ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}),
        ...(options.headers || {}),
      },
    });
    captureCookies(response);
    return { response, body: await response.json() };
  }

  async function api(path, options = {}) {
    const result = await raw(path, options);
    if (!result.response.ok) {
      throw Object.assign(new Error(`${result.response.status}: ${result.body.message}`), result);
    }
    return result.body.data;
  }

  const post = (body) => raw('/admin/products', { method: 'POST', body: JSON.stringify(body) });
  const patch = (id, body) => raw(`/admin/products/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
  const variantRow = async (sku) => (await db.query(
    'SELECT id, product_id, stock_quantity, price_cents, barcode FROM product_variants WHERE tenant_id = $1 AND sku = $2',
    [tenantId, sku],
  )).rows[0];

  const skuA = `AUD-A-${runId}`;
  const variantA = { sku: `${skuA}-40`, size: '40', color: 'Black', price: 100, stock: 2 };
  const productA = { name: `Audit Shoe ${runId}`, brand: 'Elite', sku: skuA, price: 100, hidden: false, variants: [variantA] };

  try {
    const user = await api('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: process.env.DEFAULT_ADMIN_EMAIL, password: process.env.DEFAULT_ADMIN_PASSWORD }),
    });
    tenantId = user.tenantId;

    const created = await post(productA);
    assert.equal(created.response.status, 201);
    const idA = created.body.data.id;

    // Create with an existing product SKU must not overwrite that product.
    const sameSku = await post({ ...productA, name: 'Should not replace A', variants: [{ ...variantA, sku: `${skuA}-OTHER` }] });
    assert.equal(sameSku.response.status, 409);
    const nameA = await db.query('SELECT name FROM products WHERE id = $1', [idA]);
    assert.equal(nameA.rows[0].name, productA.name);

    // A variant SKU owned by another product is refused instead of moved.
    const stolen = await post({ ...productA, sku: `AUD-B-${runId}`, name: `Audit B ${runId}` });
    assert.equal(stolen.response.status, 409);
    assert.equal((await variantRow(variantA.sku)).product_id, idA);

    // Whole QAR only.
    const fractional = await post({ ...productA, sku: `AUD-F-${runId}`, price: 99.5, variants: [{ ...variantA, sku: `AUD-F-${runId}-40`, price: 99.5 }] });
    assert.equal(fractional.response.status, 422);

    // Every variant needs a size.
    const sizeless = await post({ ...productA, sku: `AUD-S-${runId}`, variants: [{ ...variantA, sku: `AUD-S-${runId}-X`, size: '' }] });
    assert.equal(sizeless.response.status, 422);

    // Same name gets a suffixed slug instead of a constraint error.
    const twin = await post({ ...productA, sku: `AUD-T-${runId}`, variants: [{ ...variantA, sku: `AUD-T-${runId}-40` }] });
    assert.equal(twin.response.status, 201);
    const slugs = await db.query('SELECT slug FROM products WHERE id = ANY($1::uuid[]) ORDER BY created_at', [[idA, twin.body.data.id]]);
    assert.notEqual(slugs.rows[0].slug, slugs.rows[1].slug);

    // A PATCH without variants (hide toggle) does not rewrite stock a sale changed.
    await db.query('UPDATE product_variants SET stock_quantity = 1 WHERE tenant_id = $1 AND sku = $2', [tenantId, variantA.sku]);
    assert.equal((await patch(idA, { hidden: true })).response.status, 200);
    assert.equal((await variantRow(variantA.sku)).stock_quantity, 1);

    // The editor loaded stock 2; the database now holds 1. Saving 2 is refused.
    const stale = await patch(idA, { variants: [variantA], expectedStock: { [variantA.sku]: 2 } });
    assert.equal(stale.response.status, 409);
    assert.equal(stale.body.code, 'STOCK_CHANGED');
    assert.equal((await variantRow(variantA.sku)).stock_quantity, 1);
    // With the current stock as baseline the edit goes through.
    const fresh = await patch(idA, { variants: [{ ...variantA, stock: 5 }], expectedStock: { [variantA.sku]: 1 } });
    assert.equal(fresh.response.status, 200);
    assert.equal((await variantRow(variantA.sku)).stock_quantity, 5);

    // Duplicate succeeds, starts empty, and never shares barcodes or SKUs.
    const copy = await api(`/admin/products/${idA}/duplicate`, { method: 'POST' });
    assert.equal(copy.variants.length, 1);
    assert.equal(copy.variants[0].stock, 0);
    assert.notEqual(copy.variants[0].sku, variantA.sku);
    const copyVariant = await variantRow(copy.variants[0].sku);
    assert.notEqual(copyVariant.barcode, (await variantRow(variantA.sku)).barcode);
    assert.equal((await variantRow(variantA.sku)).product_id, idA);

    // Re-keying a duplicate updates the same variant row (stock/history keep
    // their UUID), moves its automatic barcode, and applies product defaults
    // without requiring cost entry on every size.
    const copyOldSku = copy.variants[0].sku;
    const copyNewBase = `AUD-C-${runId}`;
    const copyNewVariantSku = copyOldSku.replace(copy.sku, copyNewBase);
    const rekeyed = await patch(copy.id, {
      sku: copyNewBase,
      defaultCostPrice: 125.5,
      defaultShippingCost: 9.25,
      variants: copy.variants.map((variant) => ({
        ...variant,
        sku: variant.sku.replace(copy.sku, copyNewBase),
        barcode: variant.barcode,
        barcodeSource: 'auto',
      })),
      expectedStock: { [copy.variants[0].id]: 0 },
    });
    assert.equal(rekeyed.response.status, 200);
    assert.equal(rekeyed.body.data.variants[0].id, copy.variants[0].id);
    assert.equal(rekeyed.body.data.variants[0].sku, copyNewVariantSku);
    assert.equal(rekeyed.body.data.variants[0].barcode, copyNewVariantSku);
    assert.equal(rekeyed.body.data.variants[0].costPrice, 125.5);
    assert.equal(rekeyed.body.data.variants[0].shippingCost, 9.25);
    const alias = await db.query(
      `SELECT 1 FROM catalog_identifier_aliases
        WHERE tenant_id=$1 AND variant_id=$2 AND identifier_type='variant_sku' AND value=$3`,
      [tenantId, copy.variants[0].id, copyOldSku],
    );
    assert.equal(alias.rowCount, 1);

    // Bulk delete archives (history kept), ignores unknown ids, and can be undone.
    const bulk = await api('/admin/products/bulk-delete', {
      method: 'POST',
      body: JSON.stringify({ ids: [idA, '00000000-0000-4000-8000-000000000000', 'P-NEW-ABCDE'] }),
    });
    assert.equal(bulk.deleted, 1);
    const archived = await db.query('SELECT status FROM products WHERE id = $1', [idA]);
    assert.equal(archived.rows[0].status, 'archived');
    assert.ok(await variantRow(variantA.sku), 'variants survive an archive');

    // Editing an archived product is a 404, not a silent un-archive.
    assert.equal((await patch(idA, { name: 'Ghost edit' })).response.status, 404);

    const restored = await api(`/admin/products/${idA}/restore`, { method: 'POST', body: JSON.stringify({ hidden: false }) });
    assert.equal(restored.id, idA);
    const active = await db.query('SELECT status, name FROM products WHERE id = $1', [idA]);
    assert.equal(active.rows[0].status, 'active');
    assert.equal(active.rows[0].name, productA.name);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (tenantId) await db.query('DELETE FROM tenants WHERE id = $1', [tenantId]).catch(() => undefined);
    await db.pool.end();
  }
});
