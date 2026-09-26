const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');

require('dotenv').config();

const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
process.env.DEFAULT_TENANT_SLUG = `loc-e2e-${runId}`;
process.env.DEFAULT_TENANT_NAME = 'Location Stock E2E';
process.env.DEFAULT_ADMIN_EMAIL = `loc-e2e-${runId}@elite.local`;
process.env.DEFAULT_ADMIN_PASSWORD = 'loc-e2e-password';
process.env.DEFAULT_ADMIN_NAME = 'Location Test Owner';
process.env.SESSION_SECRET = `loc-e2e-session-${runId}`;

const db = require('../db/client');
const { startServer } = require('../index');
const { ensurePaidOrderStock, reversePaidOrderStock } = require('../lib/order-stock');
const { findLocationDrift } = require('../lib/location-stock');

/**
 * Plan Phase 2: per-location stock foundation.
 *
 * Invariant under test after every step while the switch is on:
 *   stock_quantity = SUM(location balances) - SUM(unallocated web holds)
 * and, with the switch off, nothing writes a location balance at all.
 */
test('location stock: switch off is a no-op, activation, branch sales, holds, reversal, guards', { timeout: 90000 }, async (t) => {
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
  const held = async (variantId) => Number((await db.query(
    `SELECT COALESCE(sum(quantity), 0)::int AS n FROM order_stock_holds WHERE variant_id = $1 AND status = 'held'`, [variantId],
  )).rows[0].n);
  const assertNoDrift = async (label) => assert.deepEqual(await findLocationDrift(db.pool, tenantId), [], `no drift: ${label}`);

  try {
    const owner = await api('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: process.env.DEFAULT_ADMIN_EMAIL, password: process.env.DEFAULT_ADMIN_PASSWORD }),
    });
    tenantId = owner.tenantId;

    // ── Catalog: A (5 units), B (3 units) ──────────────────────────────────
    const product = await db.query(
      `INSERT INTO products (tenant_id, sku, brand, name, slug, status, base_price_cents, stock_quantity)
       VALUES ($1,$2,'Elite','Location Product',$3,'active',1000,8) RETURNING id`,
      [tenantId, `LOC-${runId}`, `loc-${runId}`],
    );
    const productId = product.rows[0].id;
    const makeVariant = async (suffix, stock) => (await db.query(
      `INSERT INTO product_variants (tenant_id, product_id, sku, barcode, size, price_cents, stock_quantity, is_active)
       VALUES ($1,$2,$3,$4,$5,1000,$6,true) RETURNING id`,
      [tenantId, productId, `LOC-${runId}-${suffix}`, `LOC${Date.now()}${suffix}`, suffix, stock],
    )).rows[0].id;
    const variantA = await makeVariant('A', 5);
    const variantB = await makeVariant('B', 3);

    // ── Branches and a register at Store 1 ─────────────────────────────────
    const branchPayload = (name) => ({
      name, tradeNameEn: 'Elite Collection', tradeNameAr: '', addressEn: 'Doha', addressAr: '',
      phone: '+974 4000 0000', crLicenseNumber: null, returnPolicyEn: null, returnPolicyAr: null,
    });
    const store1 = await api('/admin/pos-branches', { method: 'POST', body: JSON.stringify(branchPayload(`Store1-${runId}`)) });
    await api('/admin/pos-branches', { method: 'POST', body: JSON.stringify(branchPayload(`Store2-${runId}`)) });

    const enrollment = await api('/pos/registers/enrollment-tokens', { method: 'POST', body: JSON.stringify({ displayName: `Loc ${runId}` }) });
    const register = await api('/pos/registers/enroll', { method: 'POST', body: JSON.stringify({ enrollmentToken: enrollment.token }) });
    await api(`/admin/pos-security/registers/${register.registerId}/branch`, { method: 'PUT', body: JSON.stringify({ branchId: store1.id }) });
    const block = await api('/pos/registers/receipt-number-blocks', { method: 'POST', body: '{}' });
    const shift = await api('/pos/shifts/open', { method: 'POST', body: JSON.stringify({ openingFloatCents: 0 }) });
    let receipt = block.start;
    const sell = (variantId, quantity = 1) => call('/pos/transactions', {
      method: 'POST',
      body: JSON.stringify({
        idempotencyKey: `loc-sale-${runId}-${receipt}`,
        receiptNumber: receipt++,
        shiftId: shift.shiftId,
        customerId: null,
        items: [{ variantId, quantity, unitPriceCents: 1000 }],
        payment: { method: 'cash', cashAmountCents: 1000 * quantity, cardAmountCents: 0, amountTenderedCents: 1000 * quantity, changeGivenCents: 0 },
        clientCreatedAt: new Date().toISOString(),
      }),
    });

    async function paidWebOrder(variantId, quantity, suffix) {
      const order = await db.query(
        `INSERT INTO orders (tenant_id, public_number, customer_name, status, payment_status, fulfillment_status,
           subtotal_cents, shipping_cents, tax_cents, discount_cents, total_cents, shipping_address, billing_address, paid_at, metadata)
         VALUES ($1,$2,'Web','placed','paid','awaiting',$3,0,0,0,$3,'{}','{}',now(),'{"source":"client-web-checkout"}')
         RETURNING id`,
        [tenantId, `LOC-WEB-${runId}-${suffix}`, 1000 * quantity],
      );
      await db.query(
        `INSERT INTO order_items (tenant_id, order_id, product_id, variant_id, sku, product_name, quantity, unit_price_cents, total_cents)
         VALUES ($1,$2,$3,$4,'SKU','Location Product',$5,1000,$6)`,
        [tenantId, order.rows[0].id, productId, variantId, quantity, 1000 * quantity],
      );
      return order.rows[0].id;
    }

    // ── Switch off: behaves exactly as before ─────────────────────────────
    const status0 = await api('/admin/inventory/per-location');
    assert.equal(status0.enabled, false);
    assert.ok(status0.locations.some((l) => l.type === 'warehouse'));
    const store1Location = status0.locations.find((l) => l.branchId === store1.id).id;
    const warehouse = status0.locations.find((l) => l.type === 'warehouse').id;

    assert.equal((await sell(variantA)).status, 201);
    assert.equal(await total(variantA), 4);
    const preOrder = await paidWebOrder(variantB, 1, 'pre');
    assert.equal((await ensurePaidOrderStock(tenantId, preOrder)).applied, true);
    assert.equal(await total(variantB), 2);
    const balances0 = await db.query('SELECT count(*)::int AS n FROM variant_location_stock WHERE tenant_id = $1', [tenantId]);
    assert.equal(balances0.rows[0].n, 0, 'switch off writes no location balances');
    const holds0 = await db.query('SELECT count(*)::int AS n FROM order_stock_holds WHERE tenant_id = $1', [tenantId]);
    assert.equal(holds0.rows[0].n, 0, 'switch off writes no holds');
    await api('/admin/products/bulk-stock', { method: 'PATCH', body: JSON.stringify({ updates: [{ sku: `LOC-${runId}-A`, stock: 4 }] }) });

    // ── Activation seeds the warehouse with every total ───────────────────
    const activated = await api('/admin/inventory/per-location/activate', { method: 'POST', body: '{}' });
    assert.equal(activated.alreadyOn, false);
    assert.equal(await at(variantA, warehouse), 4);
    assert.equal(await at(variantB, warehouse), 2);
    assert.equal(await at(variantA, store1Location), 0);
    await assertNoDrift('after activation');
    assert.equal((await api('/admin/inventory/per-location/activate', { method: 'POST', body: '{}' })).alreadyOn, true, 'idempotent');
    const audit = await db.query(`SELECT count(*)::int AS n FROM audit_events WHERE tenant_id = $1 AND action = 'inventory.per_location.activate'`, [tenantId]);
    assert.equal(audit.rows[0].n, 1);

    // ── The till sells from its own branch only ───────────────────────────
    const refused = await sell(variantA);
    assert.equal(refused.status, 409, 'Store 1 holds none of A, even though the warehouse has 4');
    assert.equal(await total(variantA), 4, 'a refused sale changes nothing');

    await api('/admin/inventory/adjustments', {
      method: 'POST', body: JSON.stringify({ variantId: variantA, delta: 2, reason: 'found', locationId: store1Location }),
    });
    assert.equal(await at(variantA, store1Location), 2);
    assert.equal(await total(variantA), 6);
    await assertNoDrift('after adjustment');

    const sale = await sell(variantA);
    assert.equal(sale.status, 201);
    assert.equal(await at(variantA, store1Location), 1, 'sale deducted Store 1');
    assert.equal(await at(variantA, warehouse), 4, 'warehouse untouched');
    assert.equal(await total(variantA), 5);
    const saleMovement = await db.query(
      `SELECT location_id FROM inventory_movements WHERE reference_type = 'pos_transaction' AND reference_id = $1`,
      [sale.body.data.transactionId],
    );
    assert.equal(saleMovement.rows[0].location_id, store1Location, 'the ledger names the location');
    await assertNoDrift('after sale');

    // Void returns the unit to the branch that sold it.
    const approverPin = '7391';
    await db.query(
      `INSERT INTO admin_users (tenant_id, email, password_hash, full_name, initials, role, status, pos_pin_hash)
       VALUES ($1,$2,'unused','Loc Approver','LA','manager','active',$3)`,
      [tenantId, `loc-approver-${runId}@elite.local`, await bcrypt.hash(approverPin, 12)],
    );
    const override = await api('/pos/manager/verify-pin', { method: 'POST', body: JSON.stringify({ pin: approverPin, action: 'void' }) });
    await api(`/pos/transactions/${sale.body.data.transactionId}/void`, {
      method: 'POST',
      body: JSON.stringify({
        idempotencyKey: `loc-void-${runId}`, voidReason: 'test', managerOverrideId: override.overrideId, managerOverrideToken: override.token,
      }),
    });
    assert.equal(await at(variantA, store1Location), 2);
    await assertNoDrift('after void');

    // Refund with restock: back to the branch that sold it.
    const refundSale = await sell(variantA);
    assert.equal(refundSale.status, 201);
    assert.equal(await at(variantA, store1Location), 1);
    const loaded = await api(`/pos/transactions/${refundSale.body.data.transactionId}`);
    const refundOverride = await api('/pos/manager/verify-pin', { method: 'POST', body: JSON.stringify({ pin: approverPin, action: 'refund' }) });
    await api('/pos/refunds', {
      method: 'POST',
      body: JSON.stringify({
        idempotencyKey: `loc-refund-${runId}`,
        receiptNumber: receipt++,
        shiftId: shift.shiftId,
        originalTransactionId: refundSale.body.data.transactionId,
        lines: [{ transactionItemId: loaded.items[0].id, quantity: 1, restock: true }],
        refundMethod: 'cash',
        reason: 'test return',
        managerOverrideId: refundOverride.overrideId,
        managerOverrideToken: refundOverride.token,
      }),
    });
    assert.equal(await at(variantA, store1Location), 2, 'refund restocked the selling branch');
    assert.equal(await at(variantA, warehouse), 4, 'warehouse untouched by the refund');
    await assertNoDrift('after refund');

    // Offline sale that sold more than the branch had on record: the branch
    // floors at zero, the total only loses what the branch covered, the
    // shortfall is a sync conflict, and nothing drifts.
    const totalBefore = await total(variantA);
    const offlinePayload = {
      idempotencyKey: `loc-offline-${runId}`,
      receiptNumber: receipt++,
      shiftId: shift.shiftId,
      customerId: null,
      items: [{ variantId: variantA, quantity: 5, unitPriceCents: 1000 }],
      payment: { method: 'cash', cashAmountCents: 5000, cardAmountCents: 0, amountTenderedCents: 5000, changeGivenCents: 0 },
      clientCreatedAt: new Date().toISOString(),
    };
    const synced = await api('/pos/transactions/sync', {
      method: 'POST',
      body: JSON.stringify({ transactions: [{
        idempotencyKey: offlinePayload.idempotencyKey, receiptNumber: offlinePayload.receiptNumber,
        clientCreatedAt: offlinePayload.clientCreatedAt, payload: offlinePayload,
      }] }),
    });
    assert.equal(synced.acceptedWithConflicts.length, 1, 'the oversell is recorded as a conflict');
    assert.equal(await at(variantA, store1Location), 0);
    assert.equal(await at(variantA, warehouse), 4, 'the warehouse keeps its units');
    assert.equal(await total(variantA), totalBefore - 2, 'the total loses only what the branch covered');
    await assertNoDrift('after offline oversell');
    // Put the branch back to 2 for the rest of the test.
    await api('/admin/inventory/adjustments', {
      method: 'POST', body: JSON.stringify({ variantId: variantA, delta: 2, reason: 'found', locationId: store1Location }),
    });

    // ── Website orders are held against the total, not a location ─────────
    const webOrder = await paidWebOrder(variantA, 2, 'hold');
    await ensurePaidOrderStock(tenantId, webOrder);
    assert.equal(await total(variantA), 4, 'total drops at payment');
    assert.equal(await held(variantA), 2);
    assert.equal(await at(variantA, store1Location), 2, 'no location is touched before approval');
    assert.equal(await at(variantA, warehouse), 4);
    await assertNoDrift('after hold');

    // A held unit cannot be sold at the till: B has 2 in the warehouse and 1
    // at Store 1 (total 3), and a website order holds all 3.
    await api('/admin/inventory/adjustments', {
      method: 'POST', body: JSON.stringify({ variantId: variantB, delta: 1, reason: 'found', locationId: store1Location }),
    });
    const bOrder = await paidWebOrder(variantB, 3, 'b-all');
    await ensurePaidOrderStock(tenantId, bOrder);
    assert.equal(await total(variantB), 0);
    assert.equal((await sell(variantB)).status, 409, 'Store 1 still shows 1, but it is held for a paid website order');
    await assertNoDrift('held units protected');

    // Cancelling before approval releases the hold.
    assert.equal((await reversePaidOrderStock(tenantId, webOrder)).reversed, true);
    assert.equal(await total(variantA), 6);
    assert.equal(await held(variantA), 0);
    await assertNoDrift('after release');

    // Paid before activation, cancelled after: no hold exists, so the units
    // go to the warehouse and the totals still add up.
    const whBefore = await at(variantB, warehouse);
    assert.equal((await reversePaidOrderStock(tenantId, preOrder)).reversed, true);
    assert.equal(await at(variantB, warehouse), whBefore + 1);
    await assertNoDrift('pre-activation order reversed');

    // ── Writers not yet location-aware refuse instead of drifting ─────────
    let res = await call('/admin/products/bulk-stock', { method: 'PATCH', body: JSON.stringify({ updates: [{ sku: `LOC-${runId}-A`, stock: 9 }] }) });
    assert.equal(res.status, 409);
    assert.equal(res.body.code, 'LOCATION_REQUIRED');
    assert.equal(await total(variantA), 6, 'refused bulk update changed nothing');

    // An adjustment that the location cannot cover is refused.
    res = await call('/admin/inventory/adjustments', {
      method: 'POST', body: JSON.stringify({ variantId: variantA, delta: -3, reason: 'damaged', locationId: store1Location }),
    });
    assert.equal(res.status, 409);
    assert.equal(res.body.code, 'LOCATION_INSUFFICIENT_STOCK');
    await assertNoDrift('end');

    // ── Switch back off ────────────────────────────────────────────────────
    await api('/admin/inventory/per-location/deactivate', { method: 'POST', body: '{}' });
    assert.equal((await api('/admin/inventory/per-location')).enabled, false);
    assert.equal((await sell(variantA)).status, 201, 'with the switch off the till sells from the total again');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (tenantId) await db.query('DELETE FROM tenants WHERE id = $1', [tenantId]).catch(() => undefined);
    await db.pool.end();
  }
});
