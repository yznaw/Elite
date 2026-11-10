const test = require('node:test');
const assert = require('node:assert/strict');

require('dotenv').config();

const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
process.env.DEFAULT_TENANT_SLUG = `pos-card-e2e-${runId}`;
process.env.DEFAULT_TENANT_NAME = 'POS Card Terminal E2E';
process.env.DEFAULT_ADMIN_EMAIL = `pos-card-e2e-${runId}@elite.local`;
process.env.DEFAULT_ADMIN_PASSWORD = 'pos-card-e2e-password';
process.env.DEFAULT_ADMIN_NAME = 'POS Card Test Owner';
process.env.SESSION_SECRET = `pos-card-e2e-session-${runId}`;

const bcrypt = require('bcryptjs');
const db = require('../db/client');
const { startServer } = require('../index');
const { maskedPan, normalizeResult } = require('../lib/pos/card-terminal-service');

test('card data guard: masked PAN normalized, full PAN refused', () => {
  assert.equal(maskedPan('452338XXXXXX7969FFFFF'), '452338XXXXXX7969');
  assert.equal(maskedPan('452338******7969'), '452338XXXXXX7969');
  assert.equal(maskedPan(''), null);
  assert.throws(() => maskedPan('4523381234567969'), (e) => e.code === 'CARD_DATA_REJECTED');
  assert.throws(() => maskedPan('4523XX7969'), (e) => e.code === 'CARD_RESULT_INVALID');
  assert.throws(() => normalizeResult({ status: 'approved' }), (e) => e.code === 'CARD_RESULT_INVALID');
  assert.throws(
    () => normalizeResult({ status: 'approved', authCode: '114857', receiptText: 'CARD 4111111111111111' }),
    (e) => e.code === 'CARD_DATA_REJECTED',
  );
  assert.throws(() => normalizeResult({ status: 'declined', message: 'card 4111 1111 1111 1111' }), (e) => e.code === 'CARD_DATA_REJECTED');
  const ok = normalizeResult({ status: 'approved', authCode: '114857', maskedPan: '521234XXXXXX0293', cardExpiry: '0625', issuer: 'MASTERCARD' });
  assert.equal(ok.maskedPan, '521234XXXXXX0293');
  assert.equal(ok.cardExpiry, '0625');
});

test('integrated card terminal: attempts, sale, manual fallback, void, refund, Z batch, resolve', { timeout: 90000 }, async (t) => {
  if (!process.env.DATABASE_URL) return t.skip('DATABASE_URL is required for POS card terminal E2E.');

  const server = await startServer(0);
  const base = `http://127.0.0.1:${server.address().port}/api`;
  let cookie = '';
  let csrfToken = '';
  let deviceCookie = '';
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
      if (name === 'elite.pos_device') deviceCookie = pair;
    }
  }

  async function api(path, options = {}) {
    const cookies = [cookie, deviceCookie, csrfToken ? `elite.csrf=${csrfToken}` : ''].filter(Boolean).join('; ');
    const response = await fetch(`${base}${path}`, {
      ...options,
      headers: {
        ...(options.body ? { 'content-type': 'application/json' } : {}),
        ...(cookies ? { cookie: cookies } : {}),
        ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}),
        ...(options.headers || {}),
      },
    });
    captureCookies(response);
    const body = await response.json();
    if (!response.ok) throw Object.assign(new Error(`${response.status}: ${body.code} ${body.message}`), { response, body });
    return body.data;
  }
  const post = (path, body) => api(path, { method: 'POST', body: JSON.stringify(body) });
  const rejectsWith = (promise, code, status) => assert.rejects(promise, (error) => {
    assert.equal(error.body?.code, code, error.message);
    if (status) assert.equal(error.response.status, status);
    return true;
  });

  try {
    const user = await post('/auth/login', { email: process.env.DEFAULT_ADMIN_EMAIL, password: process.env.DEFAULT_ADMIN_PASSWORD });
    tenantId = user.tenantId;

    const product = await db.query(
      `INSERT INTO products (tenant_id, sku, brand, name, slug, status, base_price_cents, stock_quantity)
       VALUES ($1,$2,'Elite','POS Card E2E Product',$3,'active',5000,20) RETURNING id`,
      [tenantId, `POS-CARD-E2E-${runId}`, `pos-card-e2e-${runId}`],
    );
    const variant = await db.query(
      `INSERT INTO product_variants (tenant_id, product_id, sku, barcode, size, price_cents, stock_quantity, is_active)
       VALUES ($1,$2,$3,$4,'M',5000,20,true) RETURNING id`,
      [tenantId, product.rows[0].id, `POS-CARD-E2E-V-${runId}`, `E2ECARD${Date.now()}`],
    );
    const variantId = variant.rows[0].id;
    const approverPin = '7391';
    await db.query(
      `INSERT INTO admin_users (tenant_id, email, password_hash, full_name, initials, role, status, pos_pin_hash)
       VALUES ($1,$2,'unused','E2E Card Approver','CA','manager','active',$3)`,
      [tenantId, `pos-card-approver-${runId}@elite.local`, await bcrypt.hash(approverPin, 12)],
    );
    const override = (action) => post('/pos/manager/verify-pin', { pin: approverPin, action });

    const enrollment = await post('/pos/registers/enrollment-tokens', { displayName: `E2E Card Register ${runId}` });
    const register = await post('/pos/registers/enroll', { enrollmentToken: enrollment.token });
    const registerId = register.registerId;
    const block = await post('/pos/registers/receipt-number-blocks', {});
    const shift = await post('/pos/shifts/open', { openingFloatCents: 0 });
    let receipt = block.start;

    const utn = (n) => `E${runId.replace(/[^0-9]/g, '').slice(-10)}${String(n).padStart(4, '0')}0`;
    const approved = (extra = {}) => ({
      status: 'approved', authCode: '114857', maskedPan: '521234XXXXXX0293FFFFF', cardExpiry: '0625',
      issuer: 'MASTERCARD', tid: '23323344', mid: '712902260600600', seqNo: '001001005', invoiceNo: '000005',
      entryMethod: 'CHIP', pinVerified: true, receiptText: '\x1eMASTERCARD\n************0293\nAUTH NO :114857\nApproved\n', ...extra,
    });
    const cardSale = (key, payment, unitPriceCents = 5000) => ({
      idempotencyKey: `card-${runId}-${key}`,
      receiptNumber: receipt++,
      shiftId: shift.shiftId,
      customerId: null,
      items: [{ variantId, quantity: 1, unitPriceCents }],
      payment: {
        method: 'card', cashAmountCents: 0, cardAmountCents: unitPriceCents, sadadAmountCents: 0,
        amountTenderedCents: 0, changeGivenCents: 0, ...payment,
      },
      clientCreatedAt: new Date().toISOString(),
    });

    // A manual-mode till cannot record terminal attempts.
    await rejectsWith(post('/pos/card-attempts', { utn: utn(1), kind: 'sale', amountCents: 5000 }), 'CARD_TERMINAL_NOT_ENABLED', 409);
    const current0 = await api('/pos/registers/current');
    assert.equal(current0.cardMode, 'manual');

    // Owner links this till to the terminal.
    const settings = await api(`/admin/pos-security/registers/${registerId}/card`, {
      method: 'PUT', body: JSON.stringify({ cardMode: 'integrated' }),
    });
    assert.equal(settings.cardMode, 'integrated');
    assert.equal(settings.cardManualFallback, true);
    assert.equal((await api('/pos/registers/current')).cardMode, 'integrated');
    await rejectsWith(api(`/admin/pos-security/registers/${registerId}/card`, { method: 'PUT', body: JSON.stringify({ cardMode: 'auto' }) }), 'CARD_MODE_INVALID', 422);

    // Attempt is recorded before the terminal runs; repeat is idempotent, a mismatch is refused.
    const a1 = await post('/pos/card-attempts', { utn: utn(1), kind: 'sale', amountCents: 5000, shiftId: shift.shiftId });
    assert.equal(a1.status, 'pending');
    const a1again = await post('/pos/card-attempts', { utn: utn(1), kind: 'sale', amountCents: 5000 });
    assert.equal(a1again.attemptId, a1.attemptId);
    await rejectsWith(post('/pos/card-attempts', { utn: utn(1), kind: 'sale', amountCents: 4999 }), 'CARD_ATTEMPT_CONFLICT', 409);
    await rejectsWith(post('/pos/card-attempts', { utn: 'bad utn!', kind: 'sale', amountCents: 5000 }), 'CARD_UTN_INVALID', 422);

    // Results: a full PAN is never stored; approved needs an auth code.
    await rejectsWith(api(`/pos/card-attempts/${utn(1)}`, { method: 'PATCH', body: JSON.stringify(approved({ maskedPan: '5212341234560293' })) }), 'CARD_DATA_REJECTED', 422);
    await rejectsWith(api(`/pos/card-attempts/${utn(1)}`, { method: 'PATCH', body: JSON.stringify({ status: 'approved' }) }), 'CARD_RESULT_INVALID', 422);
    const r1 = await api(`/pos/card-attempts/${utn(1)}`, { method: 'PATCH', body: JSON.stringify(approved()) });
    assert.equal(r1.status, 'approved');
    assert.equal(r1.maskedPan, '521234XXXXXX0293');
    // Same approval replayed is fine; a different auth code under one UTN is not.
    await api(`/pos/card-attempts/${utn(1)}`, { method: 'PATCH', body: JSON.stringify(approved()) });
    await rejectsWith(api(`/pos/card-attempts/${utn(1)}`, { method: 'PATCH', body: JSON.stringify(approved({ authCode: '999999' })) }), 'CARD_RESULT_CONFLICT', 409);

    // Integrated till: a typed card reference needs the explicit manual fallback flag.
    await rejectsWith(post('/pos/transactions', cardSale('noflag', { terminalReference: '123456' })), 'CARD_TERMINAL_REQUIRED', 422);
    receipt -= 1;

    // Amount on the terminal must equal the sale total.
    await rejectsWith(post('/pos/transactions', cardSale('mismatch', { cardAttempt: { utn: utn(1), amountCents: 4000 } })), 'CARD_AMOUNT_MISMATCH', 422);
    receipt -= 1;

    // The approved attempt pays the sale; auth code becomes the reference.
    const sale1 = await post('/pos/transactions', cardSale('s1', { cardAttempt: { utn: utn(1), amountCents: 5000 } }));
    assert.equal(sale1.paymentMethod, 'card');
    assert.equal(sale1.terminalReference, '114857');
    assert.equal(sale1.card.utn, utn(1));
    assert.equal(sale1.card.maskedPan, '521234XXXXXX0293');
    assert.equal(sale1.receipt.receiptData.card.issuer, 'MASTERCARD');
    const pay1 = await db.query(
      `SELECT p.provider, p.provider_payment_id, p.terminal_reference FROM payments p
         JOIN pos_transactions t ON t.order_id = p.order_id WHERE t.id = $1`,
      [sale1.transactionId],
    );
    assert.deepEqual(pay1.rows[0], { provider: 'qnb-ecr', provider_payment_id: utn(1), terminal_reference: '114857' });

    // The same approval cannot pay a second sale.
    await rejectsWith(post('/pos/transactions', cardSale('reuse', { cardAttempt: { utn: utn(1), amountCents: 5000 } })), 'CARD_ATTEMPT_USED', 409);
    receipt -= 1;

    // Approved on the terminal but the price changed meanwhile: the charge is a
    // completed fact, so the sale is kept at the charged price with a conflict.
    await db.query('UPDATE product_variants SET price_cents = 5500 WHERE id = $1', [variantId]);
    const sale2 = await post('/pos/transactions', cardSale('s2', {
      cardAttempt: { utn: utn(2), amountCents: 5000, shiftId: shift.shiftId, result: approved({ authCode: '220001' }) },
    }));
    // ^ also the offline/late path: the attempt row is created from the snapshot.
    assert.equal(sale2.totalCents, 5000);
    assert.ok(sale2.syncConflicts.some((c) => c.type === 'price_changed'));
    await db.query('UPDATE product_variants SET price_cents = 5000 WHERE id = $1', [variantId]);

    // Manual fallback (terminal down) is allowed, flagged and audited.
    const sale3 = await post('/pos/transactions', cardSale('manual', { terminalReference: '330001', manualOverride: true }));
    const pay3 = await db.query(
      `SELECT p.provider, p.raw_payload FROM payments p JOIN pos_transactions t ON t.order_id = p.order_id WHERE t.id = $1`,
      [sale3.transactionId],
    );
    assert.equal(pay3.rows[0].provider, 'pos-manual');
    assert.equal(pay3.rows[0].raw_payload.manualOverride, true);
    const flagged = await db.query(
      `SELECT 1 FROM audit_events WHERE tenant_id = $1 AND action = 'pos.card.manual_override' AND entity_id = $2`,
      [tenantId, sale3.transactionId],
    );
    assert.equal(flagged.rowCount, 1);

    // Void of an integrated sale: pre-check, then the terminal void approval is required.
    const voidCheck = await post(`/pos/transactions/${sale1.transactionId}/void/check`, { idempotencyKey: `void-${runId}`, voidReason: 'wrong item' });
    assert.equal(voidCheck.cardUtn, utn(1));
    assert.equal(voidCheck.amountCents, 5000);
    let o = await override('void');
    await rejectsWith(post(`/pos/transactions/${sale1.transactionId}/void`, {
      idempotencyKey: `void-${runId}`, voidReason: 'wrong item', managerOverrideId: o.overrideId, managerOverrideToken: o.token,
    }), 'CARD_TERMINAL_REQUIRED', 422);
    await post('/pos/card-attempts', { utn: utn(3), kind: 'void', amountCents: 5000, originalUtn: utn(1) });
    await api(`/pos/card-attempts/${utn(3)}`, { method: 'PATCH', body: JSON.stringify(approved({ authCode: '330003' })) });
    o = await override('void');
    const voided = await post(`/pos/transactions/${sale1.transactionId}/void`, {
      idempotencyKey: `void-${runId}-2`, voidReason: 'wrong item', managerOverrideId: o.overrideId, managerOverrideToken: o.token,
      cardAttempt: { utn: utn(3), amountCents: 5000, originalUtn: utn(1) },
    });
    const voidLink = await db.query('SELECT pos_void_id FROM pos_card_attempts WHERE tenant_id = $1 AND utn = $2', [tenantId, utn(3)]);
    assert.equal(voidLink.rows[0].pos_void_id, voided.voidId);

    // Refund (card-present on the terminal) of sale2.
    const loaded2 = await api(`/pos/transactions/${sale2.transactionId}`);
    const refundBody = (extra) => ({
      idempotencyKey: `refund-${runId}`, receiptNumber: receipt, shiftId: shift.shiftId,
      originalTransactionId: sale2.transactionId,
      lines: [{ transactionItemId: loaded2.items[0].id, quantity: 1, restock: true }],
      refundMethod: 'card', reason: 'E2E card return', ...extra,
    });
    const refundCheck = await post('/pos/refunds/check', refundBody({}));
    assert.equal(refundCheck.amountCents, 5000);
    assert.equal(refundCheck.cardUtn, utn(2));
    o = await override('refund');
    await rejectsWith(post('/pos/refunds', refundBody({ terminalReference: 'X1', managerOverrideId: o.overrideId, managerOverrideToken: o.token })), 'CARD_TERMINAL_REQUIRED', 422);
    o = await override('refund');
    const refund = await post('/pos/refunds', refundBody({
      managerOverrideId: o.overrideId, managerOverrideToken: o.token,
      cardAttempt: { utn: utn(4), amountCents: 5000, originalUtn: utn(2), result: approved({ authCode: '440004' }) },
    }));
    receipt += 1;
    assert.equal(refund.terminalReference, '440004');

    // Unresolved: an approved charge that never became a sale, and an unknown one.
    await post('/pos/card-attempts', { utn: utn(5), kind: 'sale', amountCents: 5000 });
    await api(`/pos/card-attempts/${utn(5)}`, { method: 'PATCH', body: JSON.stringify(approved({ authCode: '550005' })) });
    await post('/pos/card-attempts', { utn: utn(6), kind: 'sale', amountCents: 7000 });
    await api(`/pos/card-attempts/${utn(6)}`, { method: 'PATCH', body: JSON.stringify({ status: 'unknown', errorCode: 'ERROR_DLL_TIME_OUT' }) });
    await db.query(
      `UPDATE pos_card_attempts SET created_at = now() - interval '10 minutes' WHERE tenant_id = $1 AND utn = ANY($2)`,
      [tenantId, [utn(5), utn(6)]],
    );
    const unresolved = await api('/pos/card-attempts/unresolved');
    assert.deepEqual(unresolved.map((a) => a.utn).sort(), [utn(5), utn(6)].sort());

    // unknown -> settled by a manager who read the terminal; final states are final.
    o = await override('card-resolve');
    const resolved = await post(`/pos/card-attempts/${utn(6)}/resolve`, {
      outcome: 'reversed', note: 'Terminal audit report shows the charge reversed', managerOverrideId: o.overrideId, managerOverrideToken: o.token,
    });
    assert.equal(resolved.status, 'reversed');
    await rejectsWith(api(`/pos/card-attempts/${utn(6)}`, { method: 'PATCH', body: JSON.stringify(approved()) }), 'CARD_RESULT_CONFLICT', 409);

    // Admin list for reconciliation.
    const listed = await api(`/admin/pos-reconciliation/card-attempts?registerId=${registerId}`);
    assert.ok(listed.length >= 6);
    assert.ok(listed.every((a) => !a.maskedPan || /^[0-9]{6}X+[0-9]{4}$/.test(a.maskedPan)));

    // DB backstop: a full PAN cannot be written by any code path.
    await assert.rejects(
      db.query(`UPDATE pos_card_attempts SET masked_pan = '5212341234560293' WHERE tenant_id = $1 AND utn = $2`, [tenantId, utn(5)]),
      (error) => error.constraint === 'pos_card_attempts_masked_pan_format',
    );

    // Z close carries the terminal CloseBatch result; a closed batch cannot be replaced.
    const z = await post('/pos/shifts/z-report', {
      shiftId: shift.shiftId, idempotencyKey: `z-${runId}`, physicalCashCents: 0,
      cardBatch: { status: 'failed' },
      ...(await override('z-report').then((zo) => ({ managerOverrideId: zo.overrideId, managerOverrideToken: zo.token }))),
    });
    assert.equal(z.cardBatchStatus, 'failed');
    const retried = await api(`/pos/shifts/z-reports/${z.zReportId}/card-batch`, {
      method: 'PUT', body: JSON.stringify({ status: 'closed', receiptText: 'CLOSE BATCH REPORT' }),
    });
    assert.equal(retried.cardBatchStatus, 'closed');
    assert.ok(retried.cardBatchClosedAt);
    await rejectsWith(api(`/pos/shifts/z-reports/${z.zReportId}/card-batch`, { method: 'PUT', body: JSON.stringify({ status: 'closed' }) }), 'CARD_BATCH_ALREADY_CLOSED', 409);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (tenantId) await db.query('DELETE FROM tenants WHERE id = $1', [tenantId]).catch(() => undefined);
    await db.pool.end();
  }
});
