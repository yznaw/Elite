const test = require('node:test');
const assert = require('node:assert/strict');

require('dotenv').config();

const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
process.env.DEFAULT_TENANT_SLUG = `pos-reports-e2e-${runId}`;
process.env.DEFAULT_TENANT_NAME = 'POS Reports E2E';
process.env.DEFAULT_ADMIN_EMAIL = `pos-reports-e2e-${runId}@elite.local`;
process.env.DEFAULT_ADMIN_PASSWORD = 'pos-reports-e2e-password';
process.env.DEFAULT_ADMIN_NAME = 'POS Reports Test Owner';
process.env.SESSION_SECRET = `pos-reports-e2e-session-${runId}`;

const bcrypt = require('bcryptjs');
const db = require('../db/client');
const { startServer } = require('../index');

test('core reporting: daily sales, cash movements, card exceptions, inventory, refund/void, Z-history', { timeout: 60000 }, async (t) => {
  if (!process.env.DATABASE_URL) return t.skip('DATABASE_URL is required for POS reports E2E.');

  const server = await startServer(0);
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}/api`;
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

    const product = await db.query(
      `INSERT INTO products
        (tenant_id, sku, brand, name, slug, status, base_price_cents, stock_quantity)
       VALUES ($1,$2,'Elite','POS Reports E2E Product',$3,'active',2000,10)
       RETURNING id`,
      [tenantId, `POS-REPORTS-E2E-${runId}`, `pos-reports-e2e-${runId}`],
    );
    const variant = await db.query(
      `INSERT INTO product_variants
        (tenant_id, product_id, sku, barcode, size, price_cents, stock_quantity, is_active)
       VALUES ($1,$2,$3,$4,'M',2000,10,true)
       RETURNING id`,
      [tenantId, product.rows[0].id, `POS-REPORTS-E2E-V-${runId}`, `E2EREPORTS${Date.now()}`],
    );
    const variantId = variant.rows[0].id;

    const approverPin = '4471';
    const approverPinHash = await bcrypt.hash(approverPin, 12);
    await db.query(
      `INSERT INTO admin_users
        (tenant_id, email, password_hash, full_name, initials, role, status, pos_pin_hash)
       VALUES ($1,$2,$3,$4,'AM','manager','active',$5)`,
      [tenantId, `pos-reports-e2e-approver-${runId}@elite.local`, 'unused', 'E2E Reports Approving Manager', approverPinHash],
    );

    const enrollment = await api('/pos/registers/enrollment-tokens', {
      method: 'POST', body: JSON.stringify({ displayName: `E2E Reports Register ${runId}` }),
    });
    const register = await api('/pos/registers/enroll', {
      method: 'POST', body: JSON.stringify({ enrollmentToken: enrollment.token }),
    });
    const registerId = register.registerId;
    const block = await api('/pos/registers/receipt-number-blocks', { method: 'POST', body: '{}' });
    const shift = await api('/pos/shifts/open', { method: 'POST', body: JSON.stringify({ openingFloatCents: 0 }) });

    // Sale 1: cash, will be voided.
    const sale1 = await api('/pos/transactions', {
      method: 'POST',
      body: JSON.stringify({
        idempotencyKey: `reports-sale1-${runId}`,
        receiptNumber: block.start,
        shiftId: shift.shiftId,
        customerId: null,
        items: [{ variantId, quantity: 1, unitPriceCents: 2000 }],
        payment: { method: 'cash', cashAmountCents: 2000, cardAmountCents: 0, amountTenderedCents: 2000, changeGivenCents: 0 },
        clientCreatedAt: new Date().toISOString(),
      }),
    });
    const voidOverride = await api('/pos/manager/verify-pin', { method: 'POST', body: JSON.stringify({ pin: approverPin, action: 'void' }) });
    await api(`/pos/transactions/${sale1.transactionId}/void`, {
      method: 'POST',
      body: JSON.stringify({
        idempotencyKey: `reports-void1-${runId}`,
        voidReason: 'E2E reports test void',
        managerOverrideId: voidOverride.overrideId,
        managerOverrideToken: voidOverride.token,
      }),
    });

    // Sale 2: card, will be partially refunded.
    const sale2 = await api('/pos/transactions', {
      method: 'POST',
      body: JSON.stringify({
        idempotencyKey: `reports-sale2-${runId}`,
        receiptNumber: block.start + 1,
        shiftId: shift.shiftId,
        customerId: null,
        items: [{ variantId, quantity: 2, unitPriceCents: 2000 }],
        payment: { method: 'card', cashAmountCents: 0, cardAmountCents: 4000, amountTenderedCents: 0, changeGivenCents: 0, terminalReference: 'TERM-REPORTS-1' },
        clientCreatedAt: new Date().toISOString(),
      }),
    });
    const refundOverride = await api('/pos/manager/verify-pin', { method: 'POST', body: JSON.stringify({ pin: approverPin, action: 'refund' }) });
    await api('/pos/refunds', {
      method: 'POST',
      body: JSON.stringify({
        idempotencyKey: `reports-refund1-${runId}`,
        receiptNumber: block.start + 2,
        shiftId: shift.shiftId,
        originalTransactionId: sale2.transactionId,
        lines: [{ transactionItemId: sale2.items?.[0]?.id, quantity: 1, restock: true }],
        refundMethod: 'card',
        reason: 'E2E reports test refund',
        managerOverrideId: refundOverride.overrideId,
        managerOverrideToken: refundOverride.token,
      }),
    });

    // Cash movements: paid-in (no override) + paid-out (override).
    await api('/pos/cash-movements', {
      method: 'POST',
      body: JSON.stringify({ shiftId: shift.shiftId, kind: 'paid_in', amountCents: 500, reason: 'E2E reports paid-in', idempotencyKey: `reports-cashin-${runId}` }),
    });
    const drawerOverride = await api('/pos/manager/verify-pin', { method: 'POST', body: JSON.stringify({ pin: approverPin, action: 'drawer-open' }) });
    await api('/pos/cash-movements', {
      method: 'POST',
      body: JSON.stringify({
        shiftId: shift.shiftId, kind: 'paid_out', amountCents: 300, reason: 'E2E reports paid-out', idempotencyKey: `reports-cashout-${runId}`,
        managerOverrideId: drawerOverride.overrideId, managerOverrideToken: drawerOverride.token,
      }),
    });

    // Card settlement: submit an exception.
    const businessDate = new Date().toISOString().slice(0, 10);
    await api('/admin/pos-reconciliation/settlement', {
      method: 'POST',
      body: JSON.stringify({ registerId, businessDate, settlementTotalCents: 2500 }),
    });

    // Close the shift to generate a Z-report.
    const summary = await api('/pos/shifts/current');
    const zOverride = await api('/pos/manager/verify-pin', { method: 'POST', body: JSON.stringify({ pin: approverPin, action: 'z-report' }) });
    await api('/pos/shifts/z-report', {
      method: 'POST',
      body: JSON.stringify({
        shiftId: shift.shiftId, physicalCashCents: summary.expectedCashCents, idempotencyKey: `reports-z-${runId}`,
        managerOverrideId: zOverride.overrideId, managerOverrideToken: zOverride.token,
      }),
    });

    // --- Report 1: daily sales ---
    const daily = await api(`/admin/pos-reports/daily-sales?registerId=${registerId}&from=${businessDate}&to=${businessDate}`);
    // sale1 (voided, excluded) + sale2 (completed, 4000) = 4000 total from 'completed' transactions.
    assert.equal(daily.totalCents, 4000);
    assert.equal(daily.transactionCount, 1);
    assert.ok(daily.byPaymentMethod.some((r) => r.paymentMethod === 'card' && r.totalCents === 4000));
    assert.ok(daily.byItem.some((r) => r.sku === `POS-REPORTS-E2E-V-${runId}`));
    assert.ok(daily.byHour.length > 0);

    // --- Report 2: cash movements ---
    const cashReport = await api(`/admin/pos-reports/cash-movements?registerId=${registerId}&from=${businessDate}&to=${businessDate}`);
    assert.equal(cashReport.movements.length, 2);
    assert.ok(cashReport.movements.some((m) => m.kind === 'paid_in' && m.amountCents === 500));
    assert.ok(cashReport.movements.some((m) => m.kind === 'paid_out' && m.amountCents === 300 && m.managerName));
    assert.equal(cashReport.zReportVariances.length, 1);
    assert.equal(cashReport.zReportVariances[0].varianceCents, 0);

    // --- Report 3: card settlement exceptions ---
    // posTotalCents is net card total (sales - refunds): 4000 sale - 2000
    // refund (1 of 2 units, card) = 2000, computed by card-reconciliation-
    // service.js's posCardTotal() at settlement-submit time.
    const cardExceptions = await api(`/admin/pos-reports/card-settlement-exceptions?registerId=${registerId}&from=${businessDate}&to=${businessDate}`);
    assert.equal(cardExceptions.length, 1);
    assert.equal(cardExceptions[0].status, 'exception');
    assert.equal(cardExceptions[0].posTotalCents, 2000);
    assert.equal(cardExceptions[0].settlementTotalCents, 2500);
    assert.equal(cardExceptions[0].varianceCents, 500);

    // --- Report 4: inventory movements ---
    const inventory = await api(`/admin/pos-reports/inventory-movements?from=${businessDate}&to=${businessDate}`);
    assert.ok(inventory.byReason.some((r) => r.reason === 'pos_sale'));
    assert.ok(inventory.byReason.some((r) => r.reason === 'pos_void'));
    assert.ok(inventory.byReason.some((r) => r.reason === 'pos_refund'));
    assert.ok(inventory.movements.some((m) => m.sku === `POS-REPORTS-E2E-V-${runId}`));

    // --- Report 5: refund/void exceptions ---
    const exceptions = await api(`/admin/pos-reports/refund-void-exceptions?registerId=${registerId}&from=${businessDate}&to=${businessDate}`);
    assert.equal(exceptions.voids.length, 1);
    assert.equal(exceptions.voids[0].reason, 'E2E reports test void');
    assert.ok(exceptions.voids[0].managerName);
    assert.equal(exceptions.refunds.length, 1);
    assert.equal(exceptions.refunds[0].reason, 'E2E reports test refund');
    assert.equal(exceptions.refunds[0].amountCents, 2000);

    // --- Report 6: Z-report history ---
    const zHistory = await api(`/admin/pos-reports/z-reports?registerId=${registerId}&from=${businessDate}&to=${businessDate}`);
    assert.equal(zHistory.length, 1);
    assert.equal(zHistory[0].cashInCents, 500);
    assert.equal(zHistory[0].cashOutCents, 300);
    assert.equal(zHistory[0].varianceCents, 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (tenantId) await db.query('DELETE FROM tenants WHERE id = $1', [tenantId]).catch(() => undefined);
    await db.pool.end();
  }
});
