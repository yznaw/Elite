const test = require('node:test');
const assert = require('node:assert/strict');

require('dotenv').config();

const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
process.env.DEFAULT_TENANT_SLUG = `locops-e2e-${runId}`;
process.env.DEFAULT_TENANT_NAME = 'Location Ops E2E';
process.env.DEFAULT_ADMIN_EMAIL = `locops-e2e-${runId}@elite.local`;
process.env.DEFAULT_ADMIN_PASSWORD = 'locops-e2e-password';
process.env.DEFAULT_ADMIN_NAME = 'Location Ops Owner';
process.env.SESSION_SECRET = `locops-e2e-session-${runId}`;

const db = require('../db/client');
const { startServer } = require('../index');
const { ensurePaidOrderStock } = require('../lib/order-stock');
const { findLocationDrift } = require('../lib/location-stock');

/**
 * Plan Phase 3 server operations: the stock table, adding stock to a
 * location, transfers, and editing per-location stock from the product page.
 */
test('location stock ops: stock table, receipts, transfers, product editor', { timeout: 90000 }, async (t) => {
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
  const assertNoDrift = async (label) => assert.deepEqual(await findLocationDrift(db.pool, tenantId), [], `no drift: ${label}`);

  try {
    const owner = await api('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: process.env.DEFAULT_ADMIN_EMAIL, password: process.env.DEFAULT_ADMIN_PASSWORD }),
    });
    tenantId = owner.tenantId;

    const product = await db.query(
      `INSERT INTO products (tenant_id, sku, brand, name, slug, status, base_price_cents, stock_quantity)
       VALUES ($1,$2,'Elite','Ops Sandal',$3,'active',1000,6) RETURNING id`,
      [tenantId, `OPS-${runId}`, `ops-${runId}`],
    );
    const productId = product.rows[0].id;
    const makeVariant = async (size, stock) => (await db.query(
      `INSERT INTO product_variants (tenant_id, product_id, sku, barcode, size, color, price_cents, stock_quantity, is_active)
       VALUES ($1,$2,$3,$4,$5,'Black',1000,$6,true) RETURNING id`,
      [tenantId, productId, `OPS-${runId}-${size}`, `OPS${runId}${size}`, size, stock],
    )).rows[0].id;
    const v41 = await makeVariant('41', 4);
    const v42 = await makeVariant('42', 2);

    const branchPayload = (name) => ({
      name, tradeNameEn: 'Elite Collection', tradeNameAr: '', addressEn: 'Doha', addressAr: '',
      phone: '+974 4000 0000', crLicenseNumber: null, returnPolicyEn: null, returnPolicyAr: null,
    });
    const store1 = await api('/admin/pos-branches', { method: 'POST', body: JSON.stringify(branchPayload(`S1-${runId}`)) });

    // Writes need the switch; reads work either way.
    let res = await call('/admin/inventory/receipts', {
      method: 'POST', body: JSON.stringify({ locationId: '00000000-0000-4000-8000-000000000000', lines: [{ variantId: v41, quantity: 1 }] }),
    });
    assert.equal(res.status, 409);
    assert.equal(res.body.code, 'PER_LOCATION_OFF');

    await api('/admin/inventory/per-location/activate', { method: 'POST', body: '{}' });
    const stock0 = await api(`/admin/inventory/stock?search=OPS-${runId}`);
    assert.equal(stock0.enabled, true);
    const warehouse = stock0.locations.find((l) => l.type === 'warehouse').id;
    const shop = stock0.locations.find((l) => l.branchId === store1.id).id;
    assert.equal(stock0.total, 2);
    assert.deepEqual(stock0.items.map((i) => i.size), ['41', '42'], 'sizes in numeric order');
    assert.equal(stock0.items[0].byLocation[warehouse], 4);

    // ── Add stock ──────────────────────────────────────────────────────────
    const receipt = await api('/admin/inventory/receipts', {
      method: 'POST',
      body: JSON.stringify({
        locationId: shop, reason: 'received', note: 'Shipment 12',
        lines: [{ variantId: v41, quantity: 2 }, { variantId: v41, quantity: 1 }, { variantId: v42, quantity: 5 }],
      }),
    });
    assert.equal(receipt.lines.length, 2, 'duplicate lines merge');
    assert.equal(await at(v41, shop), 3);
    assert.equal(await total(v41), 7);
    assert.equal(await total(v42), 7);
    const receiptMoves = await db.query(
      `SELECT location_id, metadata->>'adjustmentReason' AS reason FROM inventory_movements WHERE reference_type = 'stock_receipt' AND reference_id = $1`,
      [receipt.receiptId],
    );
    assert.ok(receiptMoves.rows.every((m) => m.location_id === shop && m.reason === 'received'));
    await assertNoDrift('after receipt');

    res = await call('/admin/inventory/receipts', { method: 'POST', body: JSON.stringify({ locationId: shop, lines: [{ variantId: v41, quantity: 0 }] }) });
    assert.equal(res.status, 422, 'zero quantity refused');

    // ── Stock file for one location ────────────────────────────────────────
    async function uploadStock(csv, locationId) {
      const form = new FormData();
      form.append('csv', new Blob([csv], { type: 'text/csv' }), 'stock.csv');
      if (locationId) form.append('locationId', locationId);
      // Not via call(): that helper forces a JSON content type on any body.
      const response = await fetch(`${base}/admin/bulk-import/stock/preview`, {
        method: 'POST',
        body: form,
        headers: { cookie: `${cookie}; elite.csrf=${csrfToken}`, 'x-csrf-token': csrfToken },
      });
      return { status: response.status, body: await response.json() };
    }
    let file = await uploadStock(`SKU,Stock\nOPS-${runId}-42,1\n`, null);
    assert.equal(file.status, 422, 'a stock file must name its location');
    assert.equal(file.body.code, 'LOCATION_REQUIRED');
    file = await uploadStock(`SKU,Stock\nOPS-${runId}-42,1\n`, shop);
    assert.equal(file.status, 200);
    assert.equal(file.body.data.rows[0].currentStock, 5, 'preview compares against the chosen location');
    assert.equal(file.body.data.location.id, shop);
    await api(`/admin/bulk-import/stock/${file.body.data.jobId}/commit`, { method: 'POST', body: '{}' });
    assert.equal(await at(v42, shop), 1, 'the file set the shop to 1');
    assert.equal(await at(v42, warehouse), 2, 'the warehouse was not touched');
    assert.equal(await total(v42), 3);
    await assertNoDrift('after stock file');

    // ── Transfers ──────────────────────────────────────────────────────────
    const transfer = await api('/admin/inventory/transfers', {
      method: 'POST',
      body: JSON.stringify({ fromLocationId: warehouse, toLocationId: shop, note: 'Restock shop', lines: [{ variantId: v41, quantity: 3 }] }),
    });
    assert.equal(await at(v41, warehouse), 1);
    assert.equal(await at(v41, shop), 6);
    assert.equal(await total(v41), 7, 'a transfer never changes the total');
    await assertNoDrift('after transfer');

    res = await call('/admin/inventory/transfers', {
      method: 'POST', body: JSON.stringify({ fromLocationId: warehouse, toLocationId: shop, lines: [{ variantId: v41, quantity: 5 }] }),
    });
    assert.equal(res.status, 409);
    assert.equal(res.body.code, 'LOCATION_INSUFFICIENT_STOCK');
    assert.equal(await at(v41, warehouse), 1, 'a refused transfer moves nothing');
    res = await call('/admin/inventory/transfers', {
      method: 'POST', body: JSON.stringify({ fromLocationId: shop, toLocationId: shop, lines: [{ variantId: v41, quantity: 1 }] }),
    });
    assert.equal(res.status, 422, 'same location refused');

    const moves = await api('/admin/inventory/movements?type=transfer');
    assert.equal(moves.items.length, 2, 'one out and one in per transferred line');
    assert.deepEqual(moves.items.map((m) => m.delta).sort((a, b) => a - b), [-3, 3]);
    assert.ok(moves.items.every((m) => m.userName === 'Location Ops Owner' && m.locationName));
    const received = await api(`/admin/inventory/movements?type=added&locationId=${shop}`);
    assert.ok(received.items.length >= 2 && received.items.every((m) => m.adjustmentReason === 'received' && m.note === 'Shipment 12'));
    let bad = await call('/admin/inventory/movements?type=nope');
    assert.equal(bad.status, 422);

    const history = await api('/admin/inventory/transfers');
    assert.equal(history.length, 1);
    assert.equal(history[0].transferId, transfer.transferId);
    assert.equal(history[0].unitCount, 3);
    assert.equal(history[0].lines[0].quantity, 3);

    // ── Stock table filters ────────────────────────────────────────────────
    const outAtWarehouse = await api(`/admin/inventory/stock?search=OPS-${runId}&locationId=${warehouse}&state=out`);
    assert.deepEqual(outAtWarehouse.items.map((i) => i.size), [], 'both sizes still have warehouse stock');
    const lowAtWarehouse = await api(`/admin/inventory/stock?search=OPS-${runId}&locationId=${warehouse}&state=low&lowThreshold=2`);
    assert.deepEqual(lowAtWarehouse.items.map((i) => i.size).sort(), ['41', '42']);

    // ── Product editor: absolute numbers per location ─────────────────────
    const loaded = await api(`/admin/products/${productId}`);
    const size41 = loaded.variants.find((v) => v.id === v41);
    assert.equal(size41.locationStock[shop], 6);
    const variantsPayload = (locStock41) => loaded.variants.map((v) => ({
      id: v.id, sku: v.sku, size: v.size, color: v.color, price: v.price, stock: v.stock,
      ...(v.id === v41 ? { locationStock: locStock41 } : {}),
    }));
    await api(`/admin/products/${productId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        variants: variantsPayload({ [shop]: 4, [warehouse]: 3 }),
        expectedLocationStock: { [v41]: { [shop]: 6, [warehouse]: 1 } },
        stockReason: 'damaged',
      }),
    });
    assert.equal(await at(v41, shop), 4);
    assert.equal(await at(v41, warehouse), 3);
    assert.equal(await total(v41), 7, '6+1 became 4+3');
    const editMoves = await db.query(
      `SELECT location_id, delta, metadata->>'adjustmentReason' AS reason FROM inventory_movements
        WHERE reference_type = 'product' AND variant_id = $1 AND reason = 'manual_adjustment' ORDER BY delta`,
      [v41],
    );
    assert.deepEqual(editMoves.rows.map((m) => [m.location_id, m.delta, m.reason]), [[shop, -2, 'damaged'], [warehouse, 2, 'damaged']]);
    await assertNoDrift('after product edit');

    // Stale editor: someone changed the shop since the editor loaded.
    res = await call(`/admin/products/${productId}`, {
      method: 'PATCH',
      body: JSON.stringify({ variants: variantsPayload({ [shop]: 9 }), expectedLocationStock: { [v41]: { [shop]: 6 } } }),
    });
    assert.equal(res.status, 409);
    assert.equal(res.body.code, 'STOCK_CHANGED');
    assert.equal(await at(v41, shop), 4);

    // Saving other fields without locationStock leaves stock alone, even if
    // the client's legacy `stock` total is stale.
    await api(`/admin/products/${productId}`, {
      method: 'PATCH',
      body: JSON.stringify({ variants: loaded.variants.map((v) => ({ id: v.id, sku: v.sku, size: v.size, color: v.color, price: v.price, stock: 999 })) }),
    });
    assert.equal(await total(v41), 7);
    await assertNoDrift('stale legacy total ignored');

    // Held units cannot be edited away.
    const order = await db.query(
      `INSERT INTO orders (tenant_id, public_number, customer_name, status, payment_status, fulfillment_status,
         subtotal_cents, shipping_cents, tax_cents, discount_cents, total_cents, shipping_address, billing_address, paid_at, metadata)
       VALUES ($1,$2,'Web','placed','paid','awaiting',7000,0,0,0,7000,'{}','{}',now(),'{"source":"client-web-checkout"}') RETURNING id`,
      [tenantId, `OPS-WEB-${runId}`],
    );
    await db.query(
      `INSERT INTO order_items (tenant_id, order_id, product_id, variant_id, sku, product_name, quantity, unit_price_cents, total_cents)
       VALUES ($1,$2,$3,$4,'SKU','Ops Sandal',7,1000,7000)`,
      [tenantId, order.rows[0].id, productId, v41],
    );
    await ensurePaidOrderStock(tenantId, order.rows[0].id);
    assert.equal(await total(v41), 0);
    res = await call(`/admin/products/${productId}`, {
      method: 'PATCH', body: JSON.stringify({ variants: variantsPayload({ [shop]: 0 }) }),
    });
    assert.equal(res.status, 409);
    assert.equal(res.body.code, 'STOCK_HELD');

    // A size that still has stock cannot be removed.
    res = await call(`/admin/products/${productId}`, {
      method: 'PATCH',
      body: JSON.stringify({ variants: loaded.variants.filter((v) => v.id !== v42).map((v) => ({ id: v.id, sku: v.sku, size: v.size, color: v.color, price: v.price, stock: v.stock })) }),
    });
    assert.equal(res.status, 409);
    assert.equal(res.body.code, 'SIZE_HAS_STOCK');
    await assertNoDrift('end');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (tenantId) await db.query('DELETE FROM tenants WHERE id = $1', [tenantId]).catch(() => undefined);
    await db.pool.end();
  }
});
