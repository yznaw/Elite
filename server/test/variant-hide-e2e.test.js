const test = require('node:test');
const assert = require('node:assert/strict');

require('dotenv').config();

const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
process.env.DEFAULT_TENANT_SLUG = `variant-hide-e2e-${runId}`;
process.env.DEFAULT_TENANT_NAME = 'Variant Hide E2E';
process.env.DEFAULT_ADMIN_EMAIL = `variant-hide-e2e-${runId}@elite.local`;
process.env.DEFAULT_ADMIN_PASSWORD = 'variant-hide-e2e-password';
process.env.DEFAULT_ADMIN_NAME = 'Variant Hide Owner';
process.env.SESSION_SECRET = `variant-hide-e2e-session-${runId}`;

const db = require('../db/client');
const { startServer } = require('../index');

test('removing a size counted in a stocktake hides it instead of failing the save', { timeout: 30000 }, async (t) => {
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

  const kept = { sku: `HIDE-KEEP-${runId}`, size: '40', color: 'Black', price: 50, stock: 2 };
  const counted = { sku: `HIDE-COUNTED-${runId}`, size: '41', color: 'Black', price: 50, stock: 3 };

  try {
    const user = await api('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: process.env.DEFAULT_ADMIN_EMAIL, password: process.env.DEFAULT_ADMIN_PASSWORD }),
    });
    tenantId = user.tenantId;

    const product = await db.query(
      `INSERT INTO products (tenant_id, sku, brand, name, slug, status, base_price_cents, stock_quantity)
       VALUES ($1,$2,'Elite','Variant Hide Product',$3,'active',5000,5) RETURNING id`,
      [tenantId, `HIDE-${runId}`, `variant-hide-${runId}`],
    );
    const productId = product.rows[0].id;
    const variants = await db.query(
      `INSERT INTO product_variants (tenant_id, product_id, sku, barcode, size, color, price_cents, stock_quantity, is_active)
       VALUES ($1,$2,$3,$3,$4,'Black',5000,$5,true), ($1,$2,$6,$6,$7,'Black',5000,$8,true)
       RETURNING id, sku`,
      [tenantId, productId, kept.sku, kept.size, kept.stock, counted.sku, counted.size, counted.stock],
    );
    const countedId = variants.rows.find((row) => row.sku === counted.sku).id;
    const stocktake = await db.query(
      `INSERT INTO stocktakes (tenant_id, reference, started_by_user_id) VALUES ($1,$2,$3) RETURNING id`,
      [tenantId, `ST-${runId}`, user.id],
    );
    await db.query(
      `INSERT INTO stocktake_lines (stocktake_id, tenant_id, variant_id, expected_quantity) VALUES ($1,$2,$3,3)`,
      [stocktake.rows[0].id, tenantId, countedId],
    );

    // The editor drops the counted size and saves.
    const saved = await api(`/admin/products/${productId}`, {
      method: 'PATCH',
      body: JSON.stringify({ variants: [kept] }),
    });
    assert.deepEqual(saved.variants.map((v) => v.sku), [kept.sku]);

    const hidden = await db.query('SELECT is_active, stock_quantity FROM product_variants WHERE id = $1', [countedId]);
    assert.equal(hidden.rowCount, 1, 'counted variant must survive for the stocktake history');
    assert.equal(hidden.rows[0].is_active, false);
    assert.equal(hidden.rows[0].stock_quantity, 0);

    const storefront = await api(`/products/${productId}`);
    assert.equal(storefront.variants.some((v) => v.sku === counted.sku), false);
    assert.equal(storefront.sizes.includes(41), false);

    // A later save that does not mention it must not revive it.
    const resaved = await api(`/admin/products/${productId}`, { method: 'PATCH', body: JSON.stringify({ name: 'Variant Hide Product 2' }) });
    assert.deepEqual(resaved.variants.map((v) => v.sku), [kept.sku]);

    // Adding the SKU back brings the same row back.
    const restored = await api(`/admin/products/${productId}`, {
      method: 'PATCH',
      body: JSON.stringify({ variants: [kept, { ...counted, stock: 1 }] }),
    });
    assert.deepEqual(restored.variants.map((v) => v.sku).sort(), [counted.sku, kept.sku].sort());
    const revived = await db.query('SELECT id, is_active, stock_quantity FROM product_variants WHERE sku = $1 AND tenant_id = $2', [counted.sku, tenantId]);
    assert.equal(revived.rows[0].id, countedId);
    assert.equal(revived.rows[0].is_active, true);
    assert.equal(revived.rows[0].stock_quantity, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (tenantId) {
      // Stocktakes hold RESTRICT references to variants and admin users, so
      // clear them before the tenant cascade reaches either.
      await db.query('DELETE FROM stocktakes WHERE tenant_id = $1', [tenantId]).catch(() => undefined);
      await db.query('DELETE FROM tenants WHERE id = $1', [tenantId]).catch(() => undefined);
    }
    await db.pool.end();
  }
});
