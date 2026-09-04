const test = require('node:test');
const assert = require('node:assert/strict');

require('dotenv').config();

const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
process.env.DEFAULT_TENANT_SLUG = `cust-e2e-${runId}`;
process.env.DEFAULT_TENANT_NAME = 'Customer Link E2E';
process.env.DEFAULT_ADMIN_EMAIL = `cust-e2e-${runId}@elite.local`;
process.env.DEFAULT_ADMIN_PASSWORD = 'cust-e2e-password';
process.env.DEFAULT_ADMIN_NAME = 'Customer Link Owner';
process.env.SESSION_SECRET = `cust-e2e-session-${runId}`;

const db = require('../db/client');
const { startServer } = require('../index');
const { resolveCustomer, normalizePhone } = require('../lib/customer-identity');
const { ensurePaidOrderStock } = require('../lib/order-stock');

/**
 * docs/25 Phase 5 — one customer identity across the till and the website,
 * plus the race that decides who gets the last unit.
 *
 * The two questions this answers directly:
 *   1. Is a customer created at the till the *same* customer when that person
 *      later buys online, or a second row with half the history?
 *   2. When two sales go for the same last unit at the same moment, can both
 *      succeed?
 */
test('customer identity is shared between POS and website', { timeout: 60000 }, async (t) => {
  if (!process.env.DATABASE_URL) return t.skip('DATABASE_URL is required.');

  const server = await startServer(0);
  const base = `http://127.0.0.1:${server.address().port}/api`;
  let cookie = '';
  let csrfToken = '';
  let tenantId = '';

  function captureCookies(response) {
    const setCookies = typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : [response.headers.get('set-cookie')].filter(Boolean);
    for (const rawCookie of setCookies) {
      const [pair] = rawCookie.split(';');
      const [name, value] = pair.split('=');
      if (name === 'elite.sid') cookie = pair;
      if (name === 'elite.csrf') csrfToken = decodeURIComponent(value);
    }
  }

  async function api(path, options = {}) {
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
    const body = await response.json();
    if (!response.ok) throw Object.assign(new Error(`${response.status}: ${body.message}`), { response, body });
    return body.data;
  }

  try {
    const user = await api('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: process.env.DEFAULT_ADMIN_EMAIL, password: process.env.DEFAULT_ADMIN_PASSWORD }),
    });
    tenantId = user.tenantId;

    // Customer work is a register-bound POS operation. Pair this test session
    // exactly as a production till would be paired before using that API.
    const enrollment = await api('/pos/registers/enrollment-tokens', {
      method: 'POST',
      body: JSON.stringify({ displayName: `Customer Test Register ${runId}` }),
    });
    await api('/pos/registers/enroll', {
      method: 'POST',
      body: JSON.stringify({ enrollmentToken: enrollment.token }),
    });

    const phone = `+974 5${runId.slice(-7).replace(/\D/g, '').padEnd(7, '0')}`;
    const digits = normalizePhone(phone);

    // ── The till meets a walk-in with a phone and no email ──────────────────
    // Before Phase 5 this was impossible: customers.email was NOT NULL, so the
    // only way to record this person was to invent a fake address.
    const atTill = await api('/pos/customers', {
      method: 'POST',
      body: JSON.stringify({ fullName: 'Noora Al-Mansouri', phone }),
    });
    assert.equal(atTill.linkedExisting, false);
    assert.ok(atTill.customerId);

    const created = await db.query('SELECT email, phone_key, notes FROM customers WHERE id = $1', [atTill.customerId]);
    assert.equal(created.rows[0].email, null, 'a phone-only customer needs no invented email');
    assert.equal(created.rows[0].phone_key, digits, 'the phone is normalized to digits for matching');

    // ── Same person, same phone, entered again at the till ──────────────────
    const again = await api('/pos/customers', {
      method: 'POST',
      body: JSON.stringify({ fullName: 'Noora Al-Mansouri', phone: digits }),
    });
    assert.equal(again.customerId, atTill.customerId, 'a differently-formatted phone must not create a twin');
    assert.equal(again.linkedExisting, true);
    assert.equal(again.matchedOn, 'phone');

    // ── The same person now orders on the website, with an email ────────────
    // This is the case that used to split the record in two: the storefront
    // matched on email only, found nothing, and inserted a new customer.
    const webClient = await db.pool.connect();
    let webCustomerId;
    try {
      await webClient.query('BEGIN');
      const resolved = await resolveCustomer(webClient, tenantId, {
        email: `noora-${runId}@example.test`,
        phone,
        fullName: 'Noora Al Mansouri',
        city: 'Doha',
      }, { source: 'web' });
      await webClient.query('COMMIT');
      webCustomerId = resolved.customerId;
      assert.equal(resolved.created, false, 'the website must adopt the till-created customer');
      assert.equal(resolved.matchedOn, 'phone');
    } finally {
      webClient.release();
    }
    assert.equal(webCustomerId, atTill.customerId, 'one person, one customer row');

    const adopted = await db.query('SELECT email, city FROM customers WHERE id = $1', [atTill.customerId]);
    assert.equal(adopted.rows[0].email, `noora-${runId}@example.test`, 'the email fills in on the existing row');
    assert.equal(adopted.rows[0].city, 'Doha');

    // Exactly one row exists for this person, across both channels.
    const rows = await db.query(
      'SELECT count(*)::int AS total FROM customers WHERE tenant_id = $1 AND phone_key = $2 AND deleted_at IS NULL',
      [tenantId, digits],
    );
    assert.equal(rows.rows[0].total, 1);

    // ── The till finds them by phone, by name, and by email ─────────────────
    const byPhone = await api(`/pos/customers/search?q=${encodeURIComponent(digits.slice(-6))}`);
    assert.ok(byPhone.some((c) => c.customerId === atTill.customerId), 'partial phone must find them');
    const byName = await api('/pos/customers/search?q=Noora');
    assert.ok(byName.some((c) => c.customerId === atTill.customerId), 'a remembered name must find them');
    const byEmail = await api(`/pos/customers/search?q=${encodeURIComponent(`noora-${runId}@example.test`)}`);
    assert.ok(byEmail.some((c) => c.customerId === atTill.customerId));

    // ── Quick-create by email alone links to the same person too ────────────
    const byEmailCreate = await api('/pos/customers', {
      method: 'POST',
      body: JSON.stringify({ fullName: 'Noora', email: `noora-${runId}@example.test` }),
    });
    assert.equal(byEmailCreate.customerId, atTill.customerId);
    assert.equal(byEmailCreate.matchedOn, 'email');

    // ── Identity-free input is a walk-in, not an empty customer row ─────────
    const anonClient = await db.pool.connect();
    try {
      await anonClient.query('BEGIN');
      const anon = await resolveCustomer(anonClient, tenantId, { fullName: 'Someone' }, { source: 'pos' });
      await anonClient.query('ROLLBACK');
      assert.equal(anon.customerId, null, 'no phone and no email means walk-in, never a blank record');
    } finally {
      anonClient.release();
    }

    // ── Validation at the till ──────────────────────────────────────────────
    await assert.rejects(
      () => api('/pos/customers', { method: 'POST', body: JSON.stringify({ fullName: 'No Contact' }) }),
      (error) => error.body.code === 'INVALID_FIELD',
    );
    await assert.rejects(
      () => api('/pos/customers', { method: 'POST', body: JSON.stringify({ fullName: 'Bad Phone', phone: 'abc' }) }),
      (error) => error.body.code === 'INVALID_FIELD',
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (tenantId) await db.query('DELETE FROM tenants WHERE id = $1', [tenantId]).catch(() => undefined);
    // Deliberately NOT ending db.pool here: the race test below calls
    // ensurePaidOrderStock, which uses this same shared pool. Closing it here
    // made that call fail with `no_connection` and the race test report a
    // false negative.
  }
});

/**
 * The race. Both halves are checked against a real database with real
 * concurrent transactions, not by reading the code and assuming the locks work.
 */
test('two sales cannot both take the last unit', { timeout: 60000 }, async (t) => {
  if (!process.env.DATABASE_URL) return t.skip('DATABASE_URL is required.');

  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  const tenant = await pool.query(
    `INSERT INTO tenants (slug, name, currency) VALUES ($1, 'Race Test', 'QAR') RETURNING id`,
    [`race-e2e-${runId}`],
  );
  const tenantId = tenant.rows[0].id;

  try {
    const product = await pool.query(
      `INSERT INTO products (tenant_id, sku, brand, name, slug, status, base_price_cents, stock_quantity)
       VALUES ($1,$2,'Elite','Race Product',$3,'active',5000,1) RETURNING id`,
      [tenantId, `RACE-${runId}`, `race-${runId}`],
    );
    const productId = product.rows[0].id;
    const variant = await pool.query(
      `INSERT INTO product_variants (tenant_id, product_id, sku, barcode, size, price_cents, stock_quantity, is_active)
       VALUES ($1,$2,$3,$4,'M',5000,1,true) RETURNING id`,
      [tenantId, productId, `RACE-V-${runId}`, `RACE-B-${runId}`],
    );
    const variantId = variant.rows[0].id;

    /**
     * Mirrors the POS's own decrement: lock the variant row, re-read stock
     * under the lock, refuse when it is not enough. `sale-service.js` does
     * exactly this with `FOR UPDATE OF pv` plus a `>= quantity` guard.
     */
    async function attemptSale(holdMs) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const locked = await client.query(
          'SELECT stock_quantity FROM product_variants WHERE tenant_id = $1 AND id = $2 FOR UPDATE',
          [tenantId, variantId],
        );
        const available = Number(locked.rows[0].stock_quantity);
        // Held open on purpose so the second transaction is guaranteed to be
        // waiting on the lock: without this the test could pass by luck of
        // timing rather than because the lock works.
        if (holdMs) await new Promise((resolve) => setTimeout(resolve, holdMs));
        if (available < 1) {
          await client.query('ROLLBACK');
          return { sold: false };
        }
        await client.query(
          'UPDATE product_variants SET stock_quantity = stock_quantity - 1 WHERE tenant_id = $1 AND id = $2',
          [tenantId, variantId],
        );
        await client.query('COMMIT');
        return { sold: true };
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        return { sold: false, error: error.message };
      } finally {
        client.release();
      }
    }

    // Two tills, one unit, at the same instant.
    const [first, second] = await Promise.all([attemptSale(250), attemptSale(0)]);
    const winners = [first, second].filter((r) => r.sold).length;
    assert.equal(winners, 1, 'exactly one sale may take the last unit');

    const afterRace = await pool.query('SELECT stock_quantity FROM product_variants WHERE id = $1', [variantId]);
    assert.equal(Number(afterRace.rows[0].stock_quantity), 0, 'stock must never go negative');

    // ── A web order racing the till ─────────────────────────────────────────
    // The web decrement is not the same code path as the POS one, so the fact
    // that each is individually correct does not prove they are correct
    // *against each other*. Both take FOR UPDATE on the same variant row.
    await pool.query('UPDATE product_variants SET stock_quantity = 1 WHERE id = $1', [variantId]);

    const order = await pool.query(
      `INSERT INTO orders (
         tenant_id, public_number, customer_name, status, payment_status, fulfillment_status,
         subtotal_cents, shipping_cents, tax_cents, discount_cents, total_cents,
         shipping_address, billing_address, paid_at, metadata
       ) VALUES ($1,$2,'Web Racer','completed','paid','processing',5000,0,0,0,5000,
         '{}'::jsonb,'{}'::jsonb, now(), '{}'::jsonb) RETURNING id`,
      [tenantId, `RACE-WEB-${runId}`],
    );
    await pool.query(
      `INSERT INTO order_items (tenant_id, order_id, product_id, variant_id, sku, product_name, quantity, unit_price_cents, total_cents)
       VALUES ($1,$2,$3,$4,$5,'Race Product',1,5000,5000)`,
      [tenantId, order.rows[0].id, productId, variantId, `RACE-V-${runId}`],
    );

    const [webResult, tillResult] = await Promise.all([
      ensurePaidOrderStock(tenantId, order.rows[0].id, { source: 'race-test' }),
      attemptSale(150),
    ]);

    const finalStock = await pool.query('SELECT stock_quantity FROM product_variants WHERE id = $1', [variantId]);
    assert.equal(Number(finalStock.rows[0].stock_quantity), 0, 'stock must never go negative across channels');

    // Both "succeed" as financial facts — that is intended, because the web
    // order's money was already taken and is never discarded. What must be
    // true is that the shortage is surfaced rather than silently absorbed.
    assert.equal(webResult.applied, true);
    const oversold = webResult.shortages.length > 0;
    assert.equal(
      oversold || tillResult.sold === false,
      true,
      'either the till was refused, or the web order recorded a shortage — never both silently succeeding',
    );

    if (oversold) {
      const note = await pool.query(
        `SELECT metadata FROM order_timeline_entries WHERE order_id = $1 AND kind = 'note'`,
        [order.rows[0].id],
      );
      assert.equal(note.rowCount, 1, 'an oversold web order must be flagged for whoever fulfils it');
    }
  } finally {
    await pool.query('DELETE FROM tenants WHERE id = $1', [tenantId]).catch(() => undefined);
    await pool.end();
    await db.pool.end().catch(() => undefined);
  }
});
