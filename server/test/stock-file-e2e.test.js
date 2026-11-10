const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');

require('dotenv').config();

const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
process.env.DEFAULT_TENANT_SLUG = `stockfile-e2e-${runId}`;
process.env.DEFAULT_TENANT_NAME = 'Stock File E2E';
process.env.DEFAULT_ADMIN_EMAIL = `stockfile-e2e-${runId}@elite.local`;
process.env.DEFAULT_ADMIN_PASSWORD = 'stockfile-e2e-password';
process.env.DEFAULT_ADMIN_NAME = 'Stock File Owner';
process.env.SESSION_SECRET = `stockfile-e2e-session-${runId}`;

const db = require('../db/client');
const { startServer } = require('../index');
const { ensurePaidOrderStock } = require('../lib/order-stock');
const { findLocationDrift } = require('../lib/location-stock');
const { parseStockCSV } = require('../lib/stock-file-import');

test('stock file parser: empty Stock cells are skipped, one location per file', () => {
  const parsed = parseStockCSV([
    '﻿Location,Product,Color,Size,SKU,Barcode,Current,Stock',
    'The Pearl,Sandal,Black,40,SF-40,,3,5',
    'The Pearl,Sandal,Black,41,SF-41,,2,',
    'The Pearl,Sandal,Black,42,SF-42,,0,',
    "The Pearl,'=cmd,Black,43,SF-43,,1,0",
  ].join('\r\n'));
  assert.deepEqual(parsed.fileErrors, []);
  assert.equal(parsed.fileLocation, 'The Pearl');
  assert.equal(parsed.skipped, 2);
  assert.deepEqual(parsed.rows.map((r) => [r.sku, r.stock, r.fileCurrent]), [['SF-40', 5, 3], ['SF-43', 0, 1]]);

  const mixed = parseStockCSV('Location,SKU,Stock\nThe Pearl,A,1\nWarehouse,B,2');
  assert.match(mixed.fileErrors.join(' '), /mixes locations/);
});

test('stock file: template, preview, commit per location; roles; guards', { timeout: 90000 }, async (t) => {
  if (!process.env.DATABASE_URL) return t.skip('DATABASE_URL is required for this E2E test.');

  const server = await startServer(0);
  const base = `http://127.0.0.1:${server.address().port}/api`;
  let tenantId = '';

  function session() {
    let cookie = '';
    let csrfToken = '';
    async function call(path, options = {}) {
      const response = await fetch(`${base}${path}`, {
        ...options,
        headers: {
          ...(typeof options.body === 'string' ? { 'content-type': 'application/json' } : {}),
          ...(cookie ? { cookie: csrfToken ? `${cookie}; elite.csrf=${csrfToken}` : cookie } : {}),
          ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}),
        },
      });
      const setCookies = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
      for (const raw of setCookies) {
        const [pair] = raw.split(';');
        const [name, value] = pair.split('=');
        if (name === 'elite.sid') cookie = pair;
        if (name === 'elite.csrf') csrfToken = decodeURIComponent(value);
      }
      const type = response.headers.get('content-type') || '';
      return { status: response.status, headers: response.headers, body: type.includes('json') ? await response.json() : await response.text() };
    }
    async function api(path, options) {
      const res = await call(path, options);
      if (res.status >= 400) throw Object.assign(new Error(`${res.status}: ${res.body.message}`), res);
      return typeof res.body === 'string' ? res.body : res.body.data;
    }
    const login = (email, password) => api('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
    return { call, api, login };
  }
  const upload = (csv, locationId) => {
    const form = new FormData();
    form.append('csv', new Blob([csv], { type: 'text/csv' }), 'stock.csv');
    if (locationId) form.append('locationId', locationId);
    return form;
  };
  const total = async (variantId) => Number((await db.query('SELECT stock_quantity FROM product_variants WHERE id = $1', [variantId])).rows[0].stock_quantity);
  const at = async (variantId, locationId) => Number((await db.query(
    'SELECT quantity FROM variant_location_stock WHERE variant_id = $1 AND location_id = $2', [variantId, locationId],
  )).rows[0]?.quantity ?? 0);

  try {
    const owner = session();
    tenantId = (await owner.login(process.env.DEFAULT_ADMIN_EMAIL, process.env.DEFAULT_ADMIN_PASSWORD)).tenantId;

    const product = await db.query(
      `INSERT INTO products (tenant_id, sku, brand, name, slug, status, base_price_cents, stock_quantity)
       VALUES ($1,$2,'Elite','File Sandal',$3,'active',1000,0) RETURNING id`,
      [tenantId, `SF-${runId}`, `sf-${runId}`],
    );
    const productId = product.rows[0].id;
    const makeVariant = async (size, stock) => (await db.query(
      `INSERT INTO product_variants (tenant_id, product_id, sku, barcode, size, color, price_cents, stock_quantity, is_active)
       VALUES ($1,$2,$3,$4,$5,'Black',1000,$6,true) RETURNING id`,
      [tenantId, productId, `SF-${runId}-${size}`, `SF${runId}${size}`, size, stock],
    )).rows[0].id;
    const v40 = await makeVariant('40', 4);
    const v41 = await makeVariant('41', 2);
    const v9 = await makeVariant('9', 1);
    const sku = (size) => `SF-${runId}-${size}`;

    // ── Switch off: one shared figure, like the old Catalog stock import ───
    let sheet = await owner.api('/admin/inventory/stock-file/template');
    let lines = sheet.replace(/^﻿/, '').trim().split('\r\n');
    assert.equal(lines[0], 'Location,Product,Color,Size,SKU,Barcode,Current,Stock');
    const mine = lines.filter((l) => l.includes(`SF-${runId}-`));
    assert.deepEqual(mine.map((l) => l.split(',')[4]), [sku('9'), sku('40'), sku('41')], 'sizes in numeric order');
    assert.ok(mine.every((l) => l.startsWith('All locations,') && l.endsWith(',')), 'Stock column left empty');

    let preview = await owner.api('/admin/inventory/stock-file/preview', {
      method: 'POST', body: upload(`Location,SKU,Current,Stock\nAll locations,${sku('40')},4,6\nAll locations,${sku('41')},2,\n`),
    });
    assert.equal(preview.summary.skipped, 1);
    assert.equal(preview.rows.length, 1);
    assert.equal(preview.rows[0].change, 2);
    await owner.api(`/admin/inventory/stock-file/${preview.jobId}/commit`, { method: 'POST', body: '{}' });
    assert.equal(await total(v40), 6);
    assert.equal(await total(v41), 2, 'empty cell leaves the size alone');

    // ── Switch on ──────────────────────────────────────────────────────────
    const store = await owner.api('/admin/pos-branches', {
      method: 'POST',
      body: JSON.stringify({ name: `Pearl-${runId}`, tradeNameEn: 'Elite Collection', tradeNameAr: '', addressEn: 'Doha', addressAr: '', phone: '+974 4000 0000', crLicenseNumber: null, returnPolicyEn: null, returnPolicyAr: null }),
    });
    await owner.api('/admin/inventory/per-location/activate', { method: 'POST', body: '{}' });
    const locations = (await owner.api('/admin/inventory/per-location')).locations;
    const warehouse = locations.find((l) => l.type === 'warehouse');
    const shop = locations.find((l) => l.branchId === store.id);

    let res = await owner.call('/admin/inventory/stock-file/template');
    assert.equal(res.status, 422);
    assert.equal(res.body.code, 'LOCATION_REQUIRED');

    res = await owner.call(`/admin/inventory/stock-file/template?locationId=${shop.id}`);
    assert.match(res.headers.get('content-disposition'), /stock-pearl-/);
    lines = res.body.replace(/^﻿/, '').trim().split('\r\n').filter((l) => l.includes(`SF-${runId}-40`));
    assert.equal(lines[0], `${shop.name},File Sandal,Black,40,${sku('40')},SF${runId}40,0,`, 'current is the shop balance');

    // A warehouse sheet uploaded as the shop is refused.
    res = await owner.call('/admin/inventory/stock-file/preview', {
      method: 'POST', body: upload(`Location,SKU,Stock\n${warehouse.name},${sku('40')},3\n`, shop.id),
    });
    assert.equal(res.status, 422);
    assert.equal(res.body.code, 'LOCATION_MISMATCH');

    res = await owner.call('/admin/inventory/stock-file/preview', { method: 'POST', body: upload(`SKU,Stock\n${sku('40')},\n`, shop.id) });
    assert.equal(res.body.code, 'NOTHING_FILLED');

    // ── A manager counts the shop; a cashier cannot ─────────────────────────
    const addUser = async (role) => {
      const email = `${role}-${runId}@elite.local`;
      await db.query(
        `INSERT INTO admin_users (tenant_id, email, password_hash, full_name, initials, role, status)
         VALUES ($1,$2,$3,$4,'TU',$5,'active')`,
        [tenantId, email, await bcrypt.hash('stockfile-user-password', 10), `Test ${role}`, role],
      );
      const s = session();
      await s.login(email, 'stockfile-user-password');
      return s;
    };
    const manager = await addUser('manager');
    const cashier = await addUser('cashier');
    res = await cashier.call(`/admin/inventory/stock-file/template?locationId=${shop.id}`);
    assert.equal(res.status, 403, 'cashiers never reach stock files');

    // Sold 1 of size 40 at the warehouse after the sheet said 6.
    preview = await manager.api('/admin/inventory/stock-file/preview', {
      method: 'POST',
      body: upload(`Location,SKU,Current,Stock\n${shop.name},${sku('40')},0,2\n${shop.name},${sku('9')},0,0\n`, shop.id),
    });
    assert.equal(preview.location.id, shop.id);
    assert.deepEqual(preview.rows.map((r) => [r.sku, r.currentStock, r.change]), [[sku('40'), 0, 2], [sku('9'), 0, 0]]);
    assert.equal(preview.summary.changed, 1);
    assert.equal(preview.summary.unchanged, 1);
    await db.query('UPDATE variant_location_stock SET quantity = 1 WHERE variant_id = $1 AND location_id = $2', [v40, shop.id])
      .then(async (r) => {
        if (!r.rowCount) await db.query('INSERT INTO variant_location_stock (tenant_id, variant_id, location_id, quantity) VALUES ($1,$2,$3,1)', [tenantId, v40, shop.id]);
      });
    await db.query('UPDATE product_variants SET stock_quantity = stock_quantity + 1 WHERE id = $1', [v40]);
    await db.query('UPDATE products SET stock_quantity = stock_quantity + 1 WHERE id = $1', [productId]);
    const againPreview = await manager.api('/admin/inventory/stock-file/preview', {
      method: 'POST', body: upload(`Location,SKU,Current,Stock\n${shop.name},${sku('40')},0,2\n`, shop.id),
    });
    assert.deepEqual(againPreview.rows[0].changedSinceDownload, { was: 0, now: 1 });

    const committed = await manager.api(`/admin/inventory/stock-file/${againPreview.jobId}/commit`, { method: 'POST', body: '{}' });
    assert.equal(committed.changed, 1);
    assert.equal(await at(v40, shop.id), 2);
    assert.equal(await at(v40, warehouse.id), 6, 'other locations are not touched');
    assert.equal(await total(v40), 8);
    res = await manager.call(`/admin/inventory/stock-file/${againPreview.jobId}/commit`, { method: 'POST', body: '{}' });
    assert.equal(res.body.code, 'ALREADY_COMMITTED');
    const movement = await db.query(
      "SELECT location_id, delta, created_by_user_id FROM inventory_movements WHERE reference_id = $1 AND reason = 'bulk_import'",
      [againPreview.jobId],
    );
    assert.equal(movement.rowCount, 1);
    assert.equal(movement.rows[0].location_id, shop.id);
    assert.ok(movement.rows[0].created_by_user_id, 'records who uploaded it');
    assert.deepEqual(await findLocationDrift(db.pool, tenantId), []);

    // ── Units held for a paid website order cannot be counted away ─────────
    const order = await db.query(
      `INSERT INTO orders (tenant_id, public_number, customer_name, customer_email, status, payment_status, fulfillment_status,
         subtotal_cents, shipping_cents, tax_cents, discount_cents, total_cents, shipping_address, billing_address, paid_at, metadata)
       VALUES ($1,$2,'Hessa Al-Marri','hessa@example.test','placed','paid','awaiting',2000,0,0,0,2000,'{}','{}',now(),'{"source":"client-web-checkout"}')
       RETURNING id`,
      [tenantId, `SF-WEB-${runId}`],
    );
    await db.query(
      `INSERT INTO order_items (tenant_id, order_id, product_id, variant_id, sku, product_name, size, quantity, unit_price_cents, total_cents)
       VALUES ($1,$2,$3,$4,$5,'File Sandal','41',2,1000,2000)`,
      [tenantId, order.rows[0].id, productId, v41, sku('41')],
    );
    await ensurePaidOrderStock(tenantId, order.rows[0].id);
    assert.equal(await total(v41), 0, 'both units held');
    const held = await owner.api('/admin/inventory/stock-file/preview', {
      method: 'POST', body: upload(`SKU,Stock\n${sku('41')},0\n`, warehouse.id),
    });
    assert.equal(held.canCommit, false);
    assert.match(held.rows[0].errors.join(' '), /held for paid website orders/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (tenantId) await db.query('DELETE FROM tenants WHERE id = $1', [tenantId]).catch(() => undefined);
    await db.pool.end();
  }
});
