const test = require('node:test');
const assert = require('node:assert/strict');

require('dotenv').config();

const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
process.env.DEFAULT_TENANT_SLUG = `pos-e2e-${runId}`;
process.env.DEFAULT_TENANT_NAME = 'POS E2E';
process.env.DEFAULT_ADMIN_EMAIL = `pos-e2e-${runId}@elite.local`;
process.env.DEFAULT_ADMIN_PASSWORD = 'pos-e2e-password';
process.env.DEFAULT_ADMIN_NAME = 'POS Test Owner';
process.env.SESSION_SECRET = `pos-e2e-session-${runId}`;

const db = require('../db/client');
const { startServer } = require('../index');

test('authenticated checkout, idempotency, parked cart, void, refund, offline conflict, and Z close', { timeout: 60000 }, async (t) => {
  if (!process.env.DATABASE_URL) return t.skip('DATABASE_URL is required for POS E2E.');

  const server = await startServer(0);
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}/api`;
  let cookie = '';
  let tenantId = '';

  async function api(path, options = {}) {
    const response = await fetch(`${base}${path}`, {
      ...options,
      headers: {
        ...(options.body ? { 'content-type': 'application/json' } : {}),
        ...(cookie ? { cookie } : {}),
        ...(options.headers || {}),
      },
    });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
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

    const product = await db.query(
      `INSERT INTO products
        (tenant_id, sku, brand, name, slug, status, base_price_cents, stock_quantity)
       VALUES ($1,$2,'Elite','POS E2E Product',$3,'active',1000,5)
       RETURNING id`,
      [tenantId, `POS-E2E-${runId}`, `pos-e2e-${runId}`],
    );
    const variant = await db.query(
      `INSERT INTO product_variants
        (tenant_id, product_id, sku, barcode, size, price_cents, stock_quantity, is_active)
       VALUES ($1,$2,$3,$4,'M',1000,5,true)
       RETURNING id`,
      [tenantId, product.rows[0].id, `POS-E2E-V-${runId}`, `E2E${Date.now()}`],
    );
    const variantId = variant.rows[0].id;

    const enrollment = await api('/pos/registers/enrollment-tokens', {
      method: 'POST', body: JSON.stringify({ displayName: `E2E Register ${runId}` }),
    });
    const register = await api('/pos/registers/enroll', {
      method: 'POST', body: JSON.stringify({ enrollmentToken: enrollment.token }),
    });
    assert.ok(register.registerCredential);
    const block = await api('/pos/registers/receipt-number-blocks', { method: 'POST', body: '{}' });
    const shift = await api('/pos/shifts/open', { method: 'POST', body: JSON.stringify({ openingFloatCents: 5000 }) });

    const parked = await api('/pos/parked-carts', {
      method: 'POST',
      body: JSON.stringify({ label: 'E2E hold', payload: { items: [{ variantId, quantity: 1 }] } }),
    });
    assert.equal((await api('/pos/parked-carts')).length, 1);
    await api(`/pos/parked-carts/${parked.parkedCartId}`, { method: 'DELETE' });

    const salePayload = (receiptNumber, idempotencyKey) => ({
      idempotencyKey,
      receiptNumber,
      shiftId: shift.shiftId,
      customerId: null,
      items: [{ variantId, quantity: 1, unitPriceCents: 1000 }],
      payment: { method: 'cash', cashAmountCents: 1000, cardAmountCents: 0, amountTenderedCents: 1000, changeGivenCents: 0 },
      clientCreatedAt: new Date().toISOString(),
    });

    const firstPayload = salePayload(block.start, `sale-${runId}-1`);
    const firstSale = await api('/pos/transactions', { method: 'POST', body: JSON.stringify(firstPayload) });
    const replay = await api('/pos/transactions', { method: 'POST', body: JSON.stringify(firstPayload) });
    assert.equal(replay.transactionId, firstSale.transactionId);

    await api('/pos/manager-pin', { method: 'PUT', body: JSON.stringify({ pin: '2468' }) });
    const voidOverride = await api('/pos/manager/verify-pin', {
      method: 'POST', body: JSON.stringify({ pin: '2468', action: 'void' }),
    });
    const voidResult = await api(`/pos/transactions/${firstSale.transactionId}/void`, {
      method: 'POST',
      body: JSON.stringify({
        idempotencyKey: `void-${runId}`,
        voidReason: 'E2E same-shift void',
        managerOverrideId: voidOverride.overrideId,
        managerOverrideToken: voidOverride.token,
      }),
    });
    assert.equal(voidResult.transactionId, firstSale.transactionId);

    const secondPayload = salePayload(block.start + 1, `sale-${runId}-2`);
    const secondSale = await api('/pos/transactions', { method: 'POST', body: JSON.stringify(secondPayload) });
    const refundOverride = await api('/pos/manager/verify-pin', {
      method: 'POST', body: JSON.stringify({ pin: '2468', action: 'refund' }),
    });
    const loadedSecond = await api(`/pos/transactions/${secondSale.transactionId}`);
    const refund = await api('/pos/refunds', {
      method: 'POST',
      body: JSON.stringify({
        idempotencyKey: `refund-${runId}`,
        receiptNumber: block.start + 2,
        shiftId: shift.shiftId,
        originalTransactionId: secondSale.transactionId,
        lines: [{ transactionItemId: loadedSecond.items[0].id, quantity: 1, restock: true }],
        refundMethod: 'cash',
        reason: 'E2E returned item',
        managerOverrideId: refundOverride.overrideId,
        managerOverrideToken: refundOverride.token,
      }),
    });
    assert.equal(refund.amountCents, 1000);

    await db.query('UPDATE product_variants SET stock_quantity = 0, price_cents = 1200 WHERE id = $1', [variantId]);
    const offlinePayload = salePayload(block.start + 3, `offline-${runId}`);
    const sync = await api('/pos/transactions/sync', {
      method: 'POST',
      body: JSON.stringify({
        transactions: [{
          idempotencyKey: offlinePayload.idempotencyKey,
          receiptNumber: offlinePayload.receiptNumber,
          clientCreatedAt: offlinePayload.clientCreatedAt,
          payload: offlinePayload,
        }],
      }),
    });
    assert.equal(sync.acceptedWithConflicts.length, 1);
    assert.equal(sync.acceptedWithConflicts[0].conflicts.length, 2);

    await api('/pos/sync-state', {
      method: 'PUT', body: JSON.stringify({ shiftId: shift.shiftId, pendingCount: 0, rejectedCount: 0 }),
    });
    const summary = await api('/pos/shifts/current');
    assert.equal(summary.transactionCount, 3);
    assert.equal(summary.voidCount, 1);
    assert.equal(summary.refundCount, 1);

    const zOverride = await api('/pos/manager/verify-pin', {
      method: 'POST', body: JSON.stringify({ pin: '2468', action: 'z-report' }),
    });
    const zReport = await api('/pos/shifts/z-report', {
      method: 'POST',
      body: JSON.stringify({
        shiftId: shift.shiftId,
        physicalCashCents: summary.expectedCashCents,
        idempotencyKey: `z-${runId}`,
        managerOverrideId: zOverride.overrideId,
        managerOverrideToken: zOverride.token,
      }),
    });
    assert.equal(zReport.varianceCents, 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (tenantId) await db.query('DELETE FROM tenants WHERE id = $1', [tenantId]).catch(() => undefined);
    await db.pool.end();
  }
});
