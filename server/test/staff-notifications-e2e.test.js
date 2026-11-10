const test = require('node:test');
const assert = require('node:assert/strict');

require('dotenv').config();

const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
process.env.DEFAULT_TENANT_SLUG = `notify-e2e-${runId}`;
process.env.DEFAULT_TENANT_NAME = 'Notifications E2E';
process.env.DEFAULT_ADMIN_EMAIL = `notify-e2e-${runId}@elite.local`;
process.env.DEFAULT_ADMIN_PASSWORD = 'notify-e2e-password';
process.env.DEFAULT_ADMIN_NAME = 'Notifications Test Owner';
process.env.SESSION_SECRET = `notify-e2e-session-${runId}`;
// The SMTP-missing path is part of what is under test.
delete process.env.SMTP_HOST;

const db = require('../db/client');
const mailer = require('../lib/mailer');
const { startServer } = require('../index');
const { notifyNewWebOrder } = require('../lib/staff-notify');

/**
 * Staff notifications (plan Phase 1): Settings → Notifications recipients,
 * one bell row + one email per paid website order, never for POS/manual
 * orders, and the recipient list is owner/admin only.
 */
test('staff notifications: settings, idempotent new-order alerts, feed, role gate', { timeout: 60000 }, async (t) => {
  if (!process.env.DATABASE_URL) return t.skip('DATABASE_URL is required for this E2E test.');

  const server = await startServer(0);
  const base = `http://127.0.0.1:${server.address().port}/api`;
  let cookie = '';
  let csrfToken = '';
  let tenantId = '';
  const realSendMail = mailer.sendMail;

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

  async function createOrder(suffix, { source, paid }) {
    const order = await db.query(
      `INSERT INTO orders (
         tenant_id, public_number, customer_name, status, payment_status, fulfillment_status,
         subtotal_cents, shipping_cents, tax_cents, discount_cents, total_cents,
         shipping_address, billing_address, paid_at, metadata
       ) VALUES ($1,$2,'Web Customer','placed',$3::order_payment_status,'awaiting',125000,0,0,0,125000,
         '{}'::jsonb,'{}'::jsonb, CASE WHEN $3::order_payment_status = 'paid' THEN now() END, $4::jsonb)
       RETURNING id`,
      [tenantId, `NTF-${runId}-${suffix}`, paid ? 'paid' : 'pending', JSON.stringify(source ? { source } : {})],
    );
    await db.query(
      `INSERT INTO order_items (tenant_id, order_id, sku, product_name, size, quantity, unit_price_cents, total_cents)
       VALUES ($1,$2,$3,'Notify Sandal','42',2,62500,125000)`,
      [tenantId, order.rows[0].id, `NTF-${runId}-${suffix}-SKU`],
    );
    return order.rows[0].id;
  }

  const sent = [];
  mailer.sendMail = async (message) => { sent.push(message); return { messageId: 'test' }; };

  try {
    const owner = await api('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: process.env.DEFAULT_ADMIN_EMAIL, password: process.env.DEFAULT_ADMIN_PASSWORD }),
    });
    tenantId = owner.tenantId;

    // ── Settings validation ────────────────────────────────────────────────
    const empty = await api('/admin/settings/notifications');
    assert.deepEqual(empty.orderEmails, []);

    let res = await call('/admin/settings/notifications', {
      method: 'PUT', body: JSON.stringify({ orderEmails: ['ok@elite.local', 'bad address'] }),
    });
    assert.equal(res.status, 422);
    res = await call('/admin/settings/notifications', {
      method: 'PUT', body: JSON.stringify({ orderEmails: ['a@x.com\r\nBcc: evil@x.com'] }),
    });
    assert.equal(res.status, 422, 'header injection must be rejected');
    res = await call('/admin/settings/notifications', {
      method: 'PUT', body: JSON.stringify({ orderEmails: Array.from({ length: 11 }, (_, i) => `s${i}@elite.local`) }),
    });
    assert.equal(res.status, 422, 'more than 10 recipients is refused');

    const saved = await api('/admin/settings/notifications', {
      method: 'PUT',
      body: JSON.stringify({ orderEmails: [' Orders@Elite.local ', 'orders@elite.local', 'manager@elite.local'] }),
      headers: { origin: 'http://localhost:4300' },
    });
    assert.deepEqual(saved.orderEmails, ['orders@elite.local', 'manager@elite.local'], 'trimmed, lower-cased, de-duplicated');

    const audit = await db.query(
      `SELECT after_state FROM audit_events WHERE tenant_id = $1 AND action = 'settings.notifications.update'`,
      [tenantId],
    );
    assert.equal(audit.rowCount, 1, 'recipient change is audited');

    const store = await api('/admin/settings/store');
    assert.equal(store.config?.notifications, undefined, 'GET /store (readable by every role) must not expose recipients');

    // ── Test email: SMTP missing is a clear 503, not a 500 ───────────────
    mailer.sendMail = realSendMail;
    res = await call('/admin/settings/notifications/test-email', { method: 'POST', body: JSON.stringify({}) });
    assert.equal(res.status, 424);
    assert.equal(res.body.code, 'SMTP_NOT_CONFIGURED');
    mailer.sendMail = async (message) => { sent.push(message); return { messageId: 'test' }; };
    res = await call('/admin/settings/notifications/test-email', { method: 'POST', body: JSON.stringify({ orderEmails: [] }) });
    assert.equal(res.status, 422, 'testing with no recipients is refused');
    sent.length = 0;
    await api('/admin/settings/notifications/test-email', { method: 'POST', body: JSON.stringify({}) });
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, 'orders@elite.local, manager@elite.local');

    // ── New-order alerts ───────────────────────────────────────────────────
    sent.length = 0;
    const webOrder = await createOrder('web', { source: 'client-web-checkout', paid: true });
    // Sadad webhook and browser callback race; both call notify.
    const results = await Promise.all([
      notifyNewWebOrder(db, tenantId, webOrder),
      notifyNewWebOrder(db, tenantId, webOrder),
    ]);
    assert.equal(results.filter((r) => r.notified).length, 1, 'exactly one caller wins');
    assert.equal(sent.length, 1, 'exactly one email per order');
    assert.equal(sent[0].to, 'orders@elite.local, manager@elite.local');
    assert.match(sent[0].subject, /New order NTF-/);
    assert.ok(sent[0].html.includes('http://localhost:4300/orders?id='), 'link uses the recorded admin origin');
    assert.ok(!sent[0].html.includes('Web Customer'), 'no customer name in staff alerts');

    const posOrder = await createOrder('pos', { source: null, paid: true });
    const posResult = await notifyNewWebOrder(db, tenantId, posOrder);
    assert.equal(posResult.notified, false, 'POS/manual orders do not notify');

    const unpaid = await createOrder('unpaid', { source: 'client-web-checkout', paid: false });
    assert.equal((await notifyNewWebOrder(db, tenantId, unpaid)).notified, false, 'unpaid orders do not notify');

    // Marking a web order paid from the admin goes through the same hook.
    await api(`/admin/orders/${unpaid}/status`, { method: 'PATCH', body: JSON.stringify({ payment: 'paid' }) });
    const hook = await db.query(
      `SELECT count(*)::int AS n FROM admin_notifications WHERE tenant_id = $1 AND entity_id = $2`,
      [tenantId, unpaid],
    );
    assert.equal(hook.rows[0].n, 1, 'admin mark-paid path notifies');

    // ── Feed and read cursor ───────────────────────────────────────────────
    const feed = await api('/admin/notifications');
    assert.equal(feed.items.length, 2);
    assert.equal(feed.lastReadId, 0);
    const newest = feed.items[0].id;
    assert.ok(feed.items.every((item) => item.route.startsWith('/orders?id=')));

    const incremental = await api(`/admin/notifications?after=${newest}`);
    assert.equal(incremental.items.length, 0);

    const read = await api('/admin/notifications/read', { method: 'POST', body: JSON.stringify({ upToId: Number.MAX_SAFE_INTEGER }) });
    assert.equal(read.lastReadId, newest, 'cursor is clamped to what exists');
    res = await call('/admin/notifications/read', { method: 'POST', body: JSON.stringify({ upToId: -1 }) });
    assert.equal(res.status, 422);

    // ── Role gate: a cashier reads the bell, not the recipient list ───────
    const cashierEmail = `cashier-notify-${runId}@elite.local`;
    const invite = await api('/admin/settings/invitations', {
      method: 'POST', body: JSON.stringify({ email: cashierEmail, role: 'cashier' }),
    });
    const token = new URL(invite.inviteLink).searchParams.get('token');
    await api('/invitations/accept', {
      method: 'POST', body: JSON.stringify({ token, password: 'cashier-notify-password-1', name: 'Notify Cashier' }),
    });
    await api('/auth/login', {
      method: 'POST', body: JSON.stringify({ email: cashierEmail, password: 'cashier-notify-password-1' }),
    });
    assert.equal((await call('/admin/settings/notifications')).status, 403);
    assert.equal((await call('/admin/settings/notifications', { method: 'PUT', body: JSON.stringify({ orderEmails: ['x@y.com'] }) })).status, 403);
    assert.equal((await call('/admin/settings/notifications/test-email', { method: 'POST', body: '{}' })).status, 403);
    const cashierFeed = await api('/admin/notifications');
    assert.equal(cashierFeed.items.length, 2);
    assert.equal(cashierFeed.lastReadId, 0, 'read state is per user');
  } finally {
    mailer.sendMail = realSendMail;
    await new Promise((resolve) => server.close(resolve));
    if (tenantId) await db.query('DELETE FROM tenants WHERE id = $1', [tenantId]).catch(() => undefined);
    await db.pool.end();
  }
});
