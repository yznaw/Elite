const test = require('node:test');
const assert = require('node:assert/strict');

require('dotenv').config();

const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
process.env.DEFAULT_TENANT_SLUG = `pos-sadad-e2e-${runId}`;
process.env.DEFAULT_TENANT_NAME = 'POS Sadad E2E';
process.env.DEFAULT_ADMIN_EMAIL = `pos-sadad-e2e-${runId}@elite.local`;
process.env.DEFAULT_ADMIN_PASSWORD = 'pos-sadad-e2e-password';
process.env.DEFAULT_ADMIN_NAME = 'POS Sadad Test Owner';
process.env.SESSION_SECRET = `pos-sadad-e2e-session-${runId}`;

const bcrypt = require('bcryptjs');
const db = require('../db/client');
const { startServer } = require('../index');

test('Sadad sale: reference required and single-use, refund, shift split, reports, reconciliation', { timeout: 60000 }, async (t) => {
  if (!process.env.DATABASE_URL) return t.skip('DATABASE_URL is required for POS Sadad E2E.');

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
       VALUES ($1,$2,'Elite','POS Sadad E2E Product',$3,'active',4000,10)
       RETURNING id`,
      [tenantId, `POS-SADAD-E2E-${runId}`, `pos-sadad-e2e-${runId}`],
    );
    const variant = await db.query(
      `INSERT INTO product_variants
        (tenant_id, product_id, sku, barcode, size, price_cents, stock_quantity, is_active)
       VALUES ($1,$2,$3,$4,'M',4000,10,true)
       RETURNING id`,
      [tenantId, product.rows[0].id, `POS-SADAD-E2E-V-${runId}`, `E2ESADAD${Date.now()}`],
    );
    const variantId = variant.rows[0].id;

    const approverPin = '6284';
    await db.query(
      `INSERT INTO admin_users
        (tenant_id, email, password_hash, full_name, initials, role, status, pos_pin_hash)
       VALUES ($1,$2,'unused','E2E Sadad Approver','SA','manager','active',$3)`,
      [tenantId, `pos-sadad-approver-${runId}@elite.local`, await bcrypt.hash(approverPin, 12)],
    );

    const enrollment = await api('/pos/registers/enrollment-tokens', {
      method: 'POST', body: JSON.stringify({ displayName: `E2E Sadad Register ${runId}` }),
    });
    const register = await api('/pos/registers/enroll', {
      method: 'POST', body: JSON.stringify({ enrollmentToken: enrollment.token }),
    });
    const registerId = register.registerId;
    const block = await api('/pos/registers/receipt-number-blocks', { method: 'POST', body: '{}' });
    const shift = await api('/pos/shifts/open', { method: 'POST', body: JSON.stringify({ openingFloatCents: 0 }) });

    const sadadId = `SD${runId.replace(/[^0-9a-z]/gi, '').slice(-12).toUpperCase()}`;
    const salePayload = (receiptNumber, idempotencyKey, terminalReference) => ({
      idempotencyKey,
      receiptNumber,
      shiftId: shift.shiftId,
      customerId: null,
      items: [{ variantId, quantity: 1, unitPriceCents: 4000 }],
      payment: {
        method: 'sadad', cashAmountCents: 0, cardAmountCents: 0, sadadAmountCents: 4000,
        amountTenderedCents: 0, changeGivenCents: 0,
        ...(terminalReference === undefined ? {} : { terminalReference }),
      },
      clientCreatedAt: new Date().toISOString(),
    });

    // No transaction ID -> rejected before anything is written.
    await assert.rejects(
      api('/pos/transactions', { method: 'POST', body: JSON.stringify(salePayload(block.start, `sadad-${runId}-noref`)) }),
      (error) => error.body?.code === 'INVALID_FIELD',
    );

    // Typed in lowercase with spaces: stored trimmed and uppercased.
    const sale = await api('/pos/transactions', {
      method: 'POST',
      body: JSON.stringify(salePayload(block.start, `sadad-${runId}-1`, `  ${sadadId.toLowerCase()} `)),
    });
    assert.equal(sale.paymentMethod, 'sadad');
    assert.equal(sale.terminalReference, sadadId);
    const stored = await db.query(
      `SELECT t.sadad_amount_cents, t.card_amount_cents, p.method, p.terminal_reference
         FROM pos_transactions t JOIN payments p ON p.order_id = t.order_id
        WHERE t.id = $1`,
      [sale.transactionId],
    );
    assert.equal(Number(stored.rows[0].sadad_amount_cents), 4000);
    assert.equal(Number(stored.rows[0].card_amount_cents), 0);
    assert.equal(stored.rows[0].method, 'sadad');
    assert.equal(stored.rows[0].terminal_reference, sadadId);

    // The same Sadad confirmation cannot pay for a second sale.
    await assert.rejects(
      api('/pos/transactions', {
        method: 'POST',
        body: JSON.stringify(salePayload(block.start + 1, `sadad-${runId}-reuse`, sadadId)),
      }),
      (error) => error.body?.code === 'PAYMENT_REFERENCE_USED' && error.response.status === 409,
    );

    // The DB refuses a Sadad row that also claims card money, whatever the API does.
    await assert.rejects(
      db.query('UPDATE pos_transactions SET card_amount_cents = 1 WHERE id = $1', [sale.transactionId]),
      (error) => error.constraint === 'pos_transactions_payment_shape_check',
    );

    // A second, distinct Sadad sale to refund.
    const second = await api('/pos/transactions', {
      method: 'POST',
      body: JSON.stringify(salePayload(block.start + 1, `sadad-${runId}-2`, `${sadadId}-2`)),
    });
    const loaded = await api(`/pos/transactions/${second.transactionId}`);
    const refundBody = (overrides) => ({
      idempotencyKey: `sadad-refund-${runId}`,
      receiptNumber: block.start + 2,
      shiftId: shift.shiftId,
      originalTransactionId: second.transactionId,
      lines: [{ transactionItemId: loaded.items[0].id, quantity: 1, restock: true }],
      refundMethod: 'sadad',
      reason: 'E2E Sadad return',
      ...overrides,
    });
    const override = () => api('/pos/manager/verify-pin', {
      method: 'POST', body: JSON.stringify({ pin: approverPin, action: 'refund' }),
    });

    let o = await override();
    await assert.rejects(
      api('/pos/refunds', { method: 'POST', body: JSON.stringify(refundBody({ managerOverrideId: o.overrideId, managerOverrideToken: o.token })) }),
      (error) => error.body?.code === 'INVALID_FIELD',
    );
    o = await override();
    await assert.rejects(
      api('/pos/refunds', {
        method: 'POST',
        body: JSON.stringify(refundBody({ refundMethod: 'cash', managerOverrideId: o.overrideId, managerOverrideToken: o.token })),
      }),
      (error) => error.body?.code === 'REFUND_METHOD_MISMATCH',
    );
    o = await override();
    const refund = await api('/pos/refunds', {
      method: 'POST',
      body: JSON.stringify(refundBody({ terminalReference: 'sdr-5521', managerOverrideId: o.overrideId, managerOverrideToken: o.token })),
    });
    assert.equal(refund.method, 'sadad');
    assert.equal(refund.amountCents, 4000);
    assert.equal(refund.terminalReference, 'SDR-5521');

    // Shift: Sadad is its own line and never touches expected cash.
    const summary = await api('/pos/shifts/current');
    assert.equal(summary.sadadSalesCents, 8000);
    assert.equal(summary.cardSalesCents, 0);
    assert.equal(summary.cashSalesCents, 0);
    assert.equal(summary.expectedCashCents, 0);

    // Reports group the new method under its own name.
    const today = new Date().toISOString().slice(0, 10);
    const daily = await api(`/admin/pos-reports/daily-sales?from=${today}&to=${today}&registerId=${registerId}`);
    assert.ok(daily.byPaymentMethod.some((r) => r.paymentMethod === 'sadad' && r.totalCents === 8000));

    // Reconciliation: Sadad net (8000 sold - 4000 refunded) is separate from card (0).
    const sadadDay = await api('/admin/pos-reconciliation/refresh', {
      method: 'POST', body: JSON.stringify({ registerId, businessDate: today, method: 'sadad' }),
    });
    assert.equal(sadadDay.method, 'sadad');
    assert.equal(sadadDay.posTotalCents, 4000);
    const cardDay = await api('/admin/pos-reconciliation/refresh', {
      method: 'POST', body: JSON.stringify({ registerId, businessDate: today }),
    });
    assert.equal(cardDay.method, 'card');
    assert.equal(cardDay.posTotalCents, 0);
    assert.notEqual(cardDay.reconciliationId, sadadDay.reconciliationId);
    const matched = await api('/admin/pos-reconciliation/settlement', {
      method: 'POST', body: JSON.stringify({ registerId, businessDate: today, settlementTotalCents: 4000, method: 'sadad' }),
    });
    assert.equal(matched.status, 'matched');
    const sadadOnly = await api(`/admin/pos-reconciliation?registerId=${registerId}&method=sadad`);
    assert.deepEqual(sadadOnly.map((r) => r.method), ['sadad']);
    await assert.rejects(
      api('/admin/pos-reconciliation/refresh', {
        method: 'POST', body: JSON.stringify({ registerId, businessDate: today, method: 'cash' }),
      }),
      /422/,
    );
    const exceptions = await api(`/admin/pos-reports/card-settlement-exceptions?from=${today}&to=${today}&registerId=${registerId}&method=sadad`);
    assert.deepEqual(exceptions.map((r) => r.method), ['sadad']);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (tenantId) await db.query('DELETE FROM tenants WHERE id = $1', [tenantId]).catch(() => undefined);
    await db.pool.end();
  }
});
