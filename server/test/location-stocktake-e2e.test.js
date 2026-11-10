const test = require('node:test');
const assert = require('node:assert/strict');

require('dotenv').config();

const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
process.env.DEFAULT_TENANT_SLUG = `locst-e2e-${runId}`;
process.env.DEFAULT_TENANT_NAME = 'Location Stocktake E2E';
process.env.DEFAULT_ADMIN_EMAIL = `locst-e2e-${runId}@elite.local`;
process.env.DEFAULT_ADMIN_PASSWORD = 'locst-e2e-password';
process.env.DEFAULT_ADMIN_NAME = 'Location Stocktake Owner';
process.env.SESSION_SECRET = `locst-e2e-session-${runId}`;

const db = require('../db/client');
const { startServer } = require('../index');
const { findLocationDrift } = require('../lib/location-stock');

/**
 * Stocktakes post per location once stock per location is on:
 *  - a count started with the switch on applies (counted - expected) per
 *    location, so a transfer made during the count is kept;
 *  - a count started before the switch (go-live night) sets each location
 *    to exactly what was counted.
 */
test('stocktake posts per location, including the go-live opening count', { timeout: 90000 }, async (t) => {
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
  async function call(path, options = {}) {
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
    return { status: response.status, body: await response.json() };
  }
  async function api(path, options) {
    const { status, body } = await call(path, options);
    if (status >= 400) throw Object.assign(new Error(`${status}: ${body.message}`), { status, body });
    return body.data;
  }
  const total = async (variantId) => Number((await db.query('SELECT stock_quantity FROM product_variants WHERE id = $1', [variantId])).rows[0].stock_quantity);
  const at = async (variantId, locationId) => Number((await db.query(
    'SELECT quantity FROM variant_location_stock WHERE variant_id = $1 AND location_id = $2', [variantId, locationId],
  )).rows[0]?.quantity ?? 0);

  async function count(stocktakeId, variantId, locationId, quantity) {
    await api(`/admin/inventory/stocktakes/${stocktakeId}/counts`, {
      method: 'POST', body: JSON.stringify({ variantId, locationId, quantity }),
    });
  }
  async function complete(stocktakeId, locationIds) {
    for (const locationId of locationIds) {
      await api(`/admin/inventory/stocktakes/${stocktakeId}/locations/${locationId}/complete`, { method: 'POST', body: '{}' });
    }
  }

  try {
    const owner = await api('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: process.env.DEFAULT_ADMIN_EMAIL, password: process.env.DEFAULT_ADMIN_PASSWORD }),
    });
    tenantId = owner.tenantId;

    const product = await db.query(
      `INSERT INTO products (tenant_id, sku, brand, name, slug, status, base_price_cents, stock_quantity)
       VALUES ($1,$2,'Elite','Count Sandal',$3,'active',1000,10) RETURNING id`,
      [tenantId, `CNT-${runId}`, `cnt-${runId}`],
    );
    const variant = (await db.query(
      `INSERT INTO product_variants (tenant_id, product_id, sku, barcode, size, price_cents, stock_quantity, is_active)
       VALUES ($1,$2,$3,$4,'40',1000,10,true) RETURNING id`,
      [tenantId, product.rows[0].id, `CNT-${runId}-40`, `CNT${runId}40`],
    )).rows[0].id;

    const branchPayload = (name) => ({
      name, tradeNameEn: 'Elite Collection', tradeNameAr: '', addressEn: 'Doha', addressAr: '',
      phone: '+974 4000 0000', crLicenseNumber: null, returnPolicyEn: null, returnPolicyAr: null,
    });
    const store = await api('/admin/pos-branches', { method: 'POST', body: JSON.stringify(branchPayload(`Pearl-${runId}`)) });
    const locations = (await api('/admin/inventory/per-location')).locations;
    const warehouse = locations.find((l) => l.type === 'warehouse').id;
    const shop = locations.find((l) => l.branchId === store.id).id;

    // ── Go-live night: count started before the switch ────────────────────
    const opening = await api('/admin/inventory/stocktakes', {
      method: 'POST',
      body: JSON.stringify({ reference: 'Opening count', blind: true, variantIds: [variant], locationIds: [shop, warehouse] }),
    });
    await count(opening.stocktakeId, variant, shop, 4);
    await count(opening.stocktakeId, variant, warehouse, 5);
    await complete(opening.stocktakeId, [shop, warehouse]);

    await api('/admin/inventory/per-location/activate', { method: 'POST', body: '{}' });
    assert.equal(await at(variant, warehouse), 10, 'activation seeded the warehouse');

    await api(`/admin/inventory/stocktakes/${opening.stocktakeId}/post`, { method: 'POST', body: '{}' });
    assert.equal(await at(variant, shop), 4, 'no snapshot: set to the count');
    assert.equal(await at(variant, warehouse), 5);
    assert.equal(await total(variant), 9, 'one unit was missing overall');
    assert.deepEqual(await findLocationDrift(db.pool, tenantId), []);

    // ── A count started with the switch on needs locations ────────────────
    const noLoc = await call('/admin/inventory/stocktakes', {
      method: 'POST', body: JSON.stringify({ reference: 'No locations', blind: false, variantIds: [variant] }),
    });
    assert.equal(noLoc.status, 422);
    assert.equal(noLoc.body.code, 'NO_LOCATIONS');

    // ── Normal count with a transfer during it ────────────────────────────
    const weekly = await api('/admin/inventory/stocktakes', {
      method: 'POST',
      body: JSON.stringify({ reference: 'Weekly', blind: false, variantIds: [variant], locationIds: [shop, warehouse] }),
    });
    const detail = await api(`/admin/inventory/stocktakes/${weekly.stocktakeId}`);
    assert.deepEqual(detail.lines[0].expectedByLocation, { [shop]: 4, [warehouse]: 5 }, 'expected per location is shown');

    // Staff counted the warehouse (found 5, as expected) and the shop (found
    // 3: one missing), then 2 units were moved warehouse -> shop before posting.
    await count(weekly.stocktakeId, variant, warehouse, 5);
    await count(weekly.stocktakeId, variant, shop, 3);
    await complete(weekly.stocktakeId, [shop, warehouse]);
    await api('/admin/inventory/transfers', {
      method: 'POST', body: JSON.stringify({ fromLocationId: warehouse, toLocationId: shop, lines: [{ variantId: variant, quantity: 2 }] }),
    });
    assert.equal(await at(variant, shop), 6);
    assert.equal(await at(variant, warehouse), 3);

    const posted = await api(`/admin/inventory/stocktakes/${weekly.stocktakeId}/post`, { method: 'POST', body: '{}' });
    assert.equal(await at(variant, shop), 5, 'shop: current 6 + (3 counted - 4 expected)');
    assert.equal(await at(variant, warehouse), 3, 'warehouse: no difference, transfer kept');
    assert.equal(await total(variant), 8);
    assert.equal(posted.adjustedLines, 1);
    const moves = await db.query(
      `SELECT location_id, delta, metadata FROM inventory_movements WHERE reference_type = 'stocktake' AND reference_id = $1`,
      [weekly.stocktakeId],
    );
    assert.equal(moves.rowCount, 1);
    assert.equal(moves.rows[0].location_id, shop);
    assert.equal(moves.rows[0].metadata.soldDuringCount, -2, 'the transfer in during the count is recorded');
    assert.deepEqual(await findLocationDrift(db.pool, tenantId), []);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (tenantId) await db.query('DELETE FROM tenants WHERE id = $1', [tenantId]).catch(() => undefined);
    await db.pool.end();
  }
});
