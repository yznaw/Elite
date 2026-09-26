const test = require('node:test');
const assert = require('node:assert/strict');

require('dotenv').config();

const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
process.env.DEFAULT_TENANT_SLUG = `approve-e2e-${runId}`;
process.env.DEFAULT_TENANT_NAME = 'Approval E2E';
process.env.DEFAULT_ADMIN_EMAIL = `approve-e2e-${runId}@elite.local`;
process.env.DEFAULT_ADMIN_PASSWORD = 'approve-e2e-password';
process.env.DEFAULT_ADMIN_NAME = 'Approval Owner';
process.env.SESSION_SECRET = `approve-e2e-session-${runId}`;

const db = require('../db/client');
const mailer = require('../lib/mailer');
const { startServer } = require('../index');
const { ensurePaidOrderStock } = require('../lib/order-stock');
const { findLocationDrift } = require('../lib/location-stock');
const { sendApprovalReminders } = require('../lib/staff-notify');

/**
 * Plan Phase 5: a paid website order is held until staff approve it and pick
 * one pickup location; approval deducts that location, confirms the order and
 * emails the customer once; fulfilment is blocked before approval; unapproved
 * orders get one reminder.
 */
test('website order approval: allocation, approve, guards, cancel, reminder', { timeout: 90000 }, async (t) => {
  if (!process.env.DATABASE_URL) return t.skip('DATABASE_URL is required for this E2E test.');

  const server = await startServer(0);
  const base = `http://127.0.0.1:${server.address().port}/api`;
  let cookie = '';
  let csrfToken = '';
  let tenantId = '';
  const realSendMail = mailer.sendMail;
  const sent = [];
  mailer.sendMail = async (message) => { sent.push(message); return { messageId: 'test' }; };

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

  try {
    const owner = await api('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: process.env.DEFAULT_ADMIN_EMAIL, password: process.env.DEFAULT_ADMIN_PASSWORD }),
    });
    tenantId = owner.tenantId;

    const product = await db.query(
      `INSERT INTO products (tenant_id, sku, brand, name, slug, status, base_price_cents, stock_quantity)
       VALUES ($1,$2,'Elite','Approval Sandal',$3,'active',1000,0) RETURNING id`,
      [tenantId, `APR-${runId}`, `apr-${runId}`],
    );
    const productId = product.rows[0].id;
    const makeVariant = async (size) => (await db.query(
      `INSERT INTO product_variants (tenant_id, product_id, sku, barcode, size, price_cents, stock_quantity, is_active)
       VALUES ($1,$2,$3,$4,$5,1000,0,true) RETURNING id`,
      [tenantId, productId, `APR-${runId}-${size}`, `APR${runId}${size}`, size],
    )).rows[0].id;
    const v40 = await makeVariant('40');
    const v41 = await makeVariant('41');

    const store = await api('/admin/pos-branches', {
      method: 'POST',
      body: JSON.stringify({ name: `Lusail-${runId}`, tradeNameEn: 'Elite Collection', tradeNameAr: '', addressEn: 'Doha', addressAr: '', phone: '+974 4000 0000', crLicenseNumber: null, returnPolicyEn: null, returnPolicyAr: null }),
    });
    await api('/admin/inventory/per-location/activate', { method: 'POST', body: '{}' });
    const locations = (await api('/admin/inventory/per-location')).locations;
    const warehouse = locations.find((l) => l.type === 'warehouse').id;
    const shop = locations.find((l) => l.branchId === store.id).id;
    await api('/admin/inventory/receipts', { method: 'POST', body: JSON.stringify({ locationId: warehouse, lines: [{ variantId: v40, quantity: 3 }, { variantId: v41, quantity: 2 }] }) });
    await api('/admin/inventory/receipts', { method: 'POST', body: JSON.stringify({ locationId: shop, lines: [{ variantId: v40, quantity: 1 }] }) });

    async function paidOrder(suffix, lines, paidMinutesAgo = 0) {
      const order = await db.query(
        `INSERT INTO orders (tenant_id, public_number, customer_name, customer_email, status, payment_status, fulfillment_status,
           subtotal_cents, shipping_cents, tax_cents, discount_cents, total_cents, shipping_address, billing_address, paid_at, metadata)
         VALUES ($1,$2,'Mariam Al-Kuwari','mariam@example.test','placed','paid','awaiting',3000,0,0,0,3000,'{}','{}',
                 now() - ($3::int * interval '1 minute'),'{"source":"client-web-checkout"}') RETURNING id, public_number`,
        [tenantId, `APR-WEB-${runId}-${suffix}`, paidMinutesAgo],
      );
      for (const [variantId, quantity] of lines) {
        await db.query(
          `INSERT INTO order_items (tenant_id, order_id, product_id, variant_id, sku, product_name, size, quantity, unit_price_cents, total_cents)
           VALUES ($1,$2,$3,$4,'SKU','Approval Sandal','40',$5,1000,$6)`,
          [tenantId, order.rows[0].id, productId, variantId, quantity, quantity * 1000],
        );
      }
      await ensurePaidOrderStock(tenantId, order.rows[0].id);
      return order.rows[0];
    }

    const order = await paidOrder('a', [[v40, 2], [v41, 1]]);
    assert.equal(await total(v40), 2, 'held at payment');

    // ── Listing ────────────────────────────────────────────────────────────
    const list = await api('/admin/orders?needsApproval=true');
    assert.equal(list.needsApprovalCount, 1);
    assert.equal(list.orders[0].needsApproval, true);

    // ── Fulfilment is blocked until approval ───────────────────────────────
    let res = await call(`/admin/orders/${order.id}/status`, { method: 'PATCH', body: JSON.stringify({ fulfillment: 'shipped', trackingNumber: 'X1' }) });
    assert.equal(res.status, 409);
    assert.equal(res.body.code, 'NEEDS_APPROVAL');

    // ── Allocation: the warehouse has everything, the shop does not ────────
    const allocation = await api(`/admin/orders/${order.id}/allocation`);
    assert.equal(allocation.needsApproval, true);
    assert.equal(allocation.locations[0].id, warehouse, 'a location that can ship everything comes first');
    assert.equal(allocation.locations[0].allAvailable, true);
    const shopOption = allocation.locations.find((l) => l.id === shop);
    assert.equal(shopOption.allAvailable, false);
    assert.deepEqual(shopOption.missing.map((m) => [m.sku, m.available]).sort(), [[`APR-${runId}-40`, 1], [`APR-${runId}-41`, 0]]);
    assert.equal(shopOption.missing.find((m) => m.variantId === v41).elsewhere[0].locationId, warehouse);

    res = await call(`/admin/orders/${order.id}/approve`, { method: 'POST', body: JSON.stringify({ locationId: shop }) });
    assert.equal(res.status, 409);
    assert.equal(res.body.code, 'LOCATION_SHORT');
    assert.equal(await at(v40, shop), 1, 'a refused approval moves nothing');

    // ── Approve from the warehouse ─────────────────────────────────────────
    sent.length = 0;
    const approved = await api(`/admin/orders/${order.id}/approve`, { method: 'POST', body: JSON.stringify({ locationId: warehouse }) });
    assert.equal(approved.pickupLocation, locations.find((l) => l.id === warehouse).name);
    assert.equal(approved.needsApproval, false);
    assert.equal(approved.fulfillment, 'processing');
    assert.equal(await at(v40, warehouse), 1);
    assert.equal(await at(v41, warehouse), 1);
    assert.equal(await total(v40), 2, 'approval does not change the sellable total');
    assert.deepEqual(await findLocationDrift(db.pool, tenantId), []);
    const confirmations = sent.filter((m) => /is confirmed/.test(m.subject));
    assert.equal(confirmations.length, 1, 'customer gets one confirmation email');
    assert.equal(confirmations[0].to, 'mariam@example.test');
    assert.ok(!/Warehouse|Lusail/i.test(confirmations[0].html), 'no branch or warehouse name in the customer email');

    res = await call(`/admin/orders/${order.id}/approve`, { method: 'POST', body: JSON.stringify({ locationId: warehouse }) });
    assert.equal(res.body.code, 'ALREADY_APPROVED');
    const history = await api('/admin/inventory/movements?type=sale');
    assert.ok(history.items.some((m) => m.reason === 'web_order_allocated' && m.locationName && m.delta < 0));
    assert.ok(!history.items.some((m) => m.reason === 'web_order_allocated' && !m.locationName), 'balancing rows are hidden');

    // Now it can move on.
    await api(`/admin/orders/${order.id}/status`, { method: 'PATCH', body: JSON.stringify({ fulfillment: 'shipped', trackingNumber: 'TRK-1' }) });

    // ── Cancelling after approval returns units to the pickup location ─────
    await api(`/admin/orders/${order.id}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'cancelled' }) });
    assert.equal(await at(v40, warehouse), 3);
    assert.equal(await at(v41, warehouse), 2);
    assert.equal(await total(v40), 4);
    assert.deepEqual(await findLocationDrift(db.pool, tenantId), []);

    // ── Reminder: once, after the delay ────────────────────────────────────
    await api('/admin/settings/notifications', {
      method: 'PUT', body: JSON.stringify({ orderEmails: ['orders@example.test'], reminderAfterMinutes: 30 }),
    });
    res = await call('/admin/settings/notifications', { method: 'PUT', body: JSON.stringify({ orderEmails: [], reminderAfterMinutes: 5 }) });
    assert.equal(res.status, 422, 'reminder delay has a minimum');
    const late = await paidOrder('late', [[v40, 1]], 45);
    await paidOrder('fresh', [[v40, 1]], 5);
    sent.length = 0;
    await sendApprovalReminders(db.pool);
    const reminders = await db.query(`SELECT entity_id FROM admin_notifications WHERE tenant_id = $1 AND kind = 'order_reminder'`, [tenantId]);
    assert.deepEqual(reminders.rows.map((r) => r.entity_id), [late.id], 'only the order past the delay');
    assert.equal(sent.filter((m) => /waiting for approval/.test(m.subject)).length, 1);
    await sendApprovalReminders(db.pool);
    assert.equal((await db.query(`SELECT count(*)::int AS n FROM admin_notifications WHERE tenant_id = $1 AND kind = 'order_reminder'`, [tenantId])).rows[0].n, 1, 'never twice');
  } finally {
    mailer.sendMail = realSendMail;
    await new Promise((resolve) => server.close(resolve));
    if (tenantId) await db.query('DELETE FROM tenants WHERE id = $1', [tenantId]).catch(() => undefined);
    await db.pool.end();
  }
});
