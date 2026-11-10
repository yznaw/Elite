// Regression tests for the admin Orders and Customers surfaces.
//
// Each case here covers a bug that shipped silently: the cleanup job threw on
// every run, the list endpoint returned an empty timeline that the drawer then
// replaced with invented history, and a customer save round-tripped twice.
const test = require('node:test');
const assert = require('node:assert/strict');
require('dotenv').config();

const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
Object.assign(process.env, {
  DEFAULT_TENANT_SLUG: `admin-oc-e2e-${runId}`,
  DEFAULT_TENANT_NAME: 'Admin Orders/Customers Test',
  DEFAULT_ADMIN_EMAIL: `admin-oc-${runId}@elite.local`,
  DEFAULT_ADMIN_PASSWORD: 'admin-oc-test-password',
  SESSION_SECRET: `admin-oc-test-${runId}`,
  PENDING_ORDER_ABANDON_HOURS: '6',
});

const db = require('../db/client');
const { startServer } = require('../index');
const { abandonStalePendingOrders } = require('../lib/pending-order-cleanup');

test('admin orders + customers', { timeout: 120000 }, async (t) => {
  if (!process.env.DATABASE_URL) return t.skip('DATABASE_URL required');

  const server = await startServer(0);
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const cookies = new Map();
  let tenantId;
  let counter = 0;

  async function request(path, method = 'GET', body) {
    const res = await fetch(base + path, {
      method,
      headers: {
        cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join('; '),
        ...(cookies.has('elite.csrf') ? { 'x-csrf-token': decodeURIComponent(cookies.get('elite.csrf')) } : {}),
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    for (const raw of res.headers.getSetCookie()) {
      const pair = raw.split(';')[0];
      const i = pair.indexOf('=');
      cookies.set(pair.slice(0, i), pair.slice(i + 1));
    }
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, body: data };
  }

  async function api(path, method, body) {
    const res = await request(path, method, body);
    assert.ok(res.status < 400, `${method || 'GET'} ${path} -> ${JSON.stringify(res)}`);
    return res.body.data;
  }

  // Inserts an order directly so we control placed_at / created_at precisely.
  async function seedOrder({ paymentStatus = 'pending', ageHours = 0, status = 'placed' } = {}) {
    const number = `T-${runId.slice(-6)}-${++counter}`;
    const { rows } = await db.query(
      `INSERT INTO orders (tenant_id, public_number, customer_name, customer_email,
                           status, payment_status, fulfillment_status,
                           subtotal_cents, total_cents, placed_at, created_at)
       VALUES ($1, $2, 'Nadia Al-Mansoori', $3, $4, $5, 'awaiting', 25000, 25000,
               NOW() - ($6 || ' hours')::interval, NOW() - ($6 || ' hours')::interval)
       RETURNING id, public_number`,
      [tenantId, number, `nadia-${counter}-${runId}@example.test`, status, paymentStatus, String(ageHours)],
    );
    return rows[0];
  }

  try {
    const user = await api('/auth/login', 'POST', {
      email: process.env.DEFAULT_ADMIN_EMAIL,
      password: process.env.DEFAULT_ADMIN_PASSWORD,
    });
    tenantId = user.tenantId;

    await t.test('the abandoned-order cleanup job runs without throwing and cancels only stale unpaid orders', async () => {
      const stale  = await seedOrder({ paymentStatus: 'pending', ageHours: 48 });
      const fresh  = await seedOrder({ paymentStatus: 'pending', ageHours: 1 });
      const paid   = await seedOrder({ paymentStatus: 'paid',    ageHours: 48 });

      // Previously this threw on every run: 'cancelled' is not a member of the
      // order_payment_status enum, and the error was swallowed into a console.warn.
      await abandonStalePendingOrders();

      const read = async (id) =>
        (await db.query('SELECT payment_status, status, cancelled_at FROM orders WHERE id = $1', [id])).rows[0];

      const staleRow = await read(stale.id);
      assert.equal(staleRow.payment_status, 'failed');
      assert.equal(staleRow.status, 'cancelled');
      assert.ok(staleRow.cancelled_at, 'cancelled_at should be stamped');

      const freshRow = await read(fresh.id);
      assert.equal(freshRow.payment_status, 'pending', 'an order inside the window must be left alone');

      const paidRow = await read(paid.id);
      assert.equal(paidRow.payment_status, 'paid', 'a paid order must never be cancelled');

      // The cancellation must be explainable after the fact.
      const tl = await db.query(
        "SELECT kind, detail FROM order_timeline_entries WHERE order_id = $1 AND kind = 'cancelled'",
        [stale.id],
      );
      assert.equal(tl.rowCount, 1, 'cleanup should leave an audit trail');
      assert.match(tl.rows[0].detail, /payment never completed/i);
    });

    await t.test('the list endpoint omits timeline and notes; the detail endpoint provides them', async () => {
      const order = await seedOrder({ paymentStatus: 'paid' });

      const list = await api(`/admin/orders?q=${encodeURIComponent(order.public_number)}`);
      const listRow = list.orders.find((o) => o.id === order.public_number);
      assert.ok(listRow, 'seeded order should appear in the list');

      // Undefined, not []. The drawer relies on this to distinguish "still
      // loading" from "no history", instead of fabricating entries.
      assert.equal('timeline' in listRow, false, 'list row must not carry a timeline key');
      assert.equal('notes' in listRow, false, 'list row must not carry a notes key');

      const detail = await api(`/admin/orders/${order.public_number}`);
      assert.ok(Array.isArray(detail.timeline), 'detail must carry a timeline array');
      assert.ok(Array.isArray(detail.notes), 'detail must carry a notes array');
    });

    await t.test('list rows are not duplicated when an order has more than one shipment', async () => {
      const order = await seedOrder({ paymentStatus: 'paid' });
      for (const carrier of ['manual', 'nbox']) {
        await db.query(
          `INSERT INTO shipments (tenant_id, order_id, carrier, tracking_number)
           VALUES ($1, $2, $3, $4)`,
          [tenantId, order.id, carrier, `TRK-${carrier}-${counter}`],
        );
      }

      const list = await api(`/admin/orders?q=${encodeURIComponent(order.public_number)}`);
      const matches = list.orders.filter((o) => o.id === order.public_number);
      assert.equal(matches.length, 1, 'two shipments must not yield two list rows');
      assert.equal(list.total, 1, 'the total must agree with the rows returned');
    });

    await t.test('creating a customer twice with the same email upserts rather than duplicating', async () => {
      const email = `layla-${runId}@example.test`;
      const first = await api('/admin/customers', 'POST', { name: 'Layla Haddad', email, city: 'Doha' });
      const second = await api('/admin/customers', 'POST', { name: 'Layla Haddad', email, city: 'Doha' });
      assert.equal(first.id, second.id, 'a repeat save must not create a second customer');

      const list = await api('/admin/customers');
      const rows = (list.customers ?? list).filter((c) => c.email === email);
      assert.equal(rows.length, 1);
    });

    await t.test('a deleted customer can be restored', async () => {
      const email = `omar-${runId}@example.test`;
      const c = await api('/admin/customers', 'POST', { name: 'Omar Benali', email });

      await api(`/admin/customers/${c.id}`, 'DELETE');
      let list = await api('/admin/customers');
      assert.equal((list.customers ?? list).some((x) => x.id === c.id), false, 'deleted customer should be hidden');

      await api(`/admin/customers/${c.id}/restore`, 'PATCH', {});
      list = await api('/admin/customers');
      assert.equal((list.customers ?? list).some((x) => x.id === c.id), true, 'restore should bring the customer back');
    });

    await t.test('the order payload carries carrier delivery details, and omits them when nothing is booked', async () => {
      const shipped = await seedOrder({ paymentStatus: 'paid' });
      await db.query(
        `INSERT INTO shipments (tenant_id, order_id, carrier, service, tracking_number, tracking_url, shipped_at)
         VALUES ($1, $2, 'nbox', 'Same-day Doha', 'NBX-TEST-001', 'https://nbox.example/track/NBX-TEST-001', NOW())`,
        [tenantId, shipped.id],
      );
      await db.query(
        `UPDATE orders SET metadata = metadata || $2::jsonb WHERE id = $1`,
        [shipped.id, JSON.stringify({ nbox: { quote: { serviceName: 'Same-day Doha', eta: '2026-09-13' } } })],
      );

      const detail = await api(`/admin/orders/${shipped.public_number}`);
      assert.ok(detail.delivery, 'a booked shipment must surface a delivery object');
      assert.equal(detail.delivery.carrier, 'nbox');
      assert.equal(detail.delivery.trackingNumber, 'NBX-TEST-001');
      assert.equal(detail.delivery.eta, '2026-09-13');
      assert.ok(detail.delivery.shippedAt, 'shippedAt should be present');

      const bare = await seedOrder({ paymentStatus: 'paid' });
      const bareDetail = await api(`/admin/orders/${bare.public_number}`);
      assert.equal(bareDetail.delivery, undefined, 'no shipment means no delivery block on the invoice');
    });

    await t.test('an invalid status enum is a 422 naming the field, not a 500', async () => {
      const order = await seedOrder();
      const res = await request(`/admin/orders/${order.public_number}/status`, 'PATCH', { payment: 'definitely-not-a-status' });
      assert.equal(res.status, 422, JSON.stringify(res.body));
      assert.match(JSON.stringify(res.body), /payment must be one of/);
    });

    await t.test('cancelling an order stamps cancelled_at and attributes the actor', async () => {
      const order = await seedOrder({ paymentStatus: 'paid', status: 'confirmed' });
      await api(`/admin/orders/${order.public_number}/status`, 'PATCH', {
        status: 'cancelled', fulfillment: 'cancelled', timelineKind: 'cancelled', detail: 'Customer changed their mind',
      });

      const row = (await db.query('SELECT cancelled_at FROM orders WHERE id = $1', [order.id])).rows[0];
      assert.ok(row.cancelled_at, 'cancelled_at must be stamped');

      const tl = (await db.query(
        "SELECT actor_user_id FROM order_timeline_entries WHERE order_id = $1 AND kind = 'cancelled'",
        [order.id],
      )).rows[0];
      assert.ok(tl && tl.actor_user_id, 'the acting user must be recorded');
    });

    await t.test('a note records its real author and reads back under that name', async () => {
      const order = await seedOrder();
      await api(`/admin/orders/${order.public_number}/notes`, 'POST', { body: 'Customer asked for gift wrapping.' });

      const stored = (await db.query('SELECT author_user_id FROM order_notes WHERE order_id = $1', [order.id])).rows[0];
      assert.ok(stored.author_user_id, 'author_user_id must be written');

      const detail = await api(`/admin/orders/${order.public_number}`);
      assert.equal(detail.notes.length, 1);
      assert.notEqual(detail.notes[0].author, 'Admin', 'the note should carry the real user name, not a hardcoded label');
    });

    await t.test('a customer field can be cleared, and required fields cannot be blanked', async () => {
      const email = `hana-${runId}@example.test`;
      const c = await api('/admin/customers', 'POST', { name: 'Hana Sultan', email, city: 'Al Wakrah' });

      // Previously COALESCE turned this into a no-op and the old city stuck.
      const cleared = await api(`/admin/customers/${c.id}`, 'PATCH', { city: '' });
      assert.ok(!cleared.city, `city should be cleared, got ${JSON.stringify(cleared.city)}`);

      const bad = await request(`/admin/customers/${c.id}`, 'PATCH', { name: '' });
      assert.equal(bad.status, 422, 'blanking a required field must be rejected');
    });

    await t.test('customers are paginated, searchable and sortable server-side', async () => {
      const tag = `sortcase-${runId}`;
      // LTV ascending: Basma < Karim < Yusra.
      for (const [name, ltv] of [['Basma Idrissi', 1000], ['Karim Toumi', 9000], ['Yusra Kanaan', 5000]]) {
        const c = await api('/admin/customers', 'POST', { name, email: `${name.split(' ')[0].toLowerCase()}-${tag}@example.test`, city: tag });
        await db.query('UPDATE customers SET ltv_cents = $2 WHERE id = $1', [c.id, ltv]);
      }

      const first = await api(`/admin/customers?q=${encodeURIComponent(tag)}&limit=2&page=0`);
      assert.equal(first.total, 3, 'total must count every match, not just the page');
      assert.equal(first.customers.length, 2, 'the page window must be honoured');
      assert.equal(first.pages, 2);

      const second = await api(`/admin/customers?q=${encodeURIComponent(tag)}&limit=2&page=1`);
      assert.equal(second.customers.length, 1);

      // Sorting must span the whole result set, not the current page.
      const asc = await api(`/admin/customers?q=${encodeURIComponent(tag)}&sort=ltv&dir=asc&limit=2`);
      assert.equal(asc.customers[0].name, 'Basma Idrissi', 'lowest LTV must come first across all pages');

      const desc = await api(`/admin/customers?q=${encodeURIComponent(tag)}&sort=ltv&dir=desc&limit=2`);
      assert.equal(desc.customers[0].name, 'Karim Toumi', 'highest LTV must come first across all pages');

      // An unknown sort key must fall back, never reach SQL.
      const injected = await api(`/admin/customers?q=${encodeURIComponent(tag)}&sort=${encodeURIComponent('ltv_cents; DROP TABLE customers')}&dir=asc`);
      assert.equal(injected.total, 3, 'an unwhitelisted sort key must fall back safely');
    });

    await t.test('orders sort server-side across the whole result set', async () => {
      const tag = `Ordersort ${runId.slice(-6)}`;
      const totals = [10000, 90000, 50000];
      for (const cents of totals) {
        const number = `S-${runId.slice(-6)}-${++counter}`;
        await db.query(
          `INSERT INTO orders (tenant_id, public_number, customer_name, customer_email,
                               status, payment_status, fulfillment_status,
                               subtotal_cents, total_cents, placed_at)
           VALUES ($1, $2, $3, $4, 'placed', 'paid', 'awaiting', $5, $5, NOW())`,
          [tenantId, number, tag, `${number}@example.test`.toLowerCase(), cents],
        );
      }

      const asc = await api(`/admin/orders?q=${encodeURIComponent(tag)}&sort=total&dir=asc&limit=2`);
      assert.equal(asc.total, 3);
      assert.equal(asc.orders[0].total, 100, 'cheapest order must lead an ascending total sort');

      const desc = await api(`/admin/orders?q=${encodeURIComponent(tag)}&sort=total&dir=desc&limit=2`);
      assert.equal(desc.orders[0].total, 900, 'most expensive order must lead a descending total sort');

      const injected = await api(`/admin/orders?q=${encodeURIComponent(tag)}&sort=${encodeURIComponent('total_cents; DROP TABLE orders')}`);
      assert.equal(injected.total, 3, 'an unwhitelisted sort key must fall back safely');
    });

    await t.test('a viewer can read orders and customers but cannot change them', async () => {
      const viewerEmail = `viewer-${runId}@elite.local`;
      await db.query(
        `INSERT INTO admin_users (tenant_id, email, full_name, initials, role, status, password_hash)
         VALUES ($1, $2, 'Read Only', 'RO', 'viewer', 'active', $3)`,
        [tenantId, viewerEmail, require('bcryptjs').hashSync('viewer-test-password', 10)],
      );

      const order = await seedOrder({ paymentStatus: 'paid' });
      const customer = await api('/admin/customers', 'POST', { name: 'Zaid Farouk', email: `zaid-${runId}@example.test` });

      // Swap the session over to the viewer.
      cookies.clear();
      await api('/auth/login', 'POST', { email: viewerEmail, password: 'viewer-test-password' });

      assert.equal((await request('/admin/orders')).status, 200, 'a viewer may still read orders');
      assert.equal((await request('/admin/customers')).status, 200, 'a viewer may still read customers');

      assert.equal(
        (await request(`/admin/orders/${order.public_number}/status`, 'PATCH', { payment: 'refunded' })).status,
        403, 'a viewer must not be able to refund an order');
      assert.equal(
        (await request(`/admin/customers/${customer.id}`, 'DELETE')).status,
        403, 'a viewer must not be able to delete a customer');
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await db.pool.end().catch(() => {});
  }
});
