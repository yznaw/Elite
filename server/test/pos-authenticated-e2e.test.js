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

const bcrypt = require('bcryptjs');
const db = require('../db/client');
const { startServer } = require('../index');

test('authenticated checkout, idempotency, parked cart, void, refund, offline conflict, and Z close', { timeout: 60000 }, async (t) => {
  if (!process.env.DATABASE_URL) return t.skip('DATABASE_URL is required for POS E2E.');

  const server = await startServer(0);
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}/api`;
  let cookie = '';
  let csrfToken = '';
  let tenantId = '';

  function captureCookies(response) {
    // node's fetch collapses multiple Set-Cookie headers into one via
    // getSetCookie(); fall back to the single-header form for older runtimes.
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

    // A distinct approving manager, separate from the logged-in cashier
    // session — the server now rejects a manager approving their own action
    // (docs/15 Phase 3, P0-7), so the PIN checks below must go through this
    // user, not the session's own manager-pin endpoint.
    const approverPin = '9137';
    const approverPinHash = await bcrypt.hash(approverPin, 12);
    await db.query(
      `INSERT INTO admin_users
        (tenant_id, email, password_hash, full_name, initials, role, status, pos_pin_hash)
       VALUES ($1,$2,$3,$4,'AM','manager','active',$5)`,
      [tenantId, `pos-e2e-approver-${runId}@elite.local`, 'unused', 'E2E Approving Manager', approverPinHash],
    );

    const enrollment = await api('/pos/registers/enrollment-tokens', {
      method: 'POST', body: JSON.stringify({ displayName: `E2E Register ${runId}` }),
    });
    const register = await api('/pos/registers/enroll', {
      method: 'POST', body: JSON.stringify({ enrollmentToken: enrollment.token }),
    });
    assert.ok(register.registerCredential);
    const block = await api('/pos/registers/receipt-number-blocks', { method: 'POST', body: '{}' });
    const shift = await api('/pos/shifts/open', { method: 'POST', body: JSON.stringify({ openingFloatCents: 5000 }) });
    const currentRegister = await api('/pos/registers/current');
    assert.equal(currentRegister.shift.id, shift.shiftId);
    assert.equal(currentRegister.shift.cashierId, user.id);
    assert.equal(currentRegister.shift.cashierName, user.name);

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

    const voidOverride = await api('/pos/manager/verify-pin', {
      method: 'POST', body: JSON.stringify({ pin: approverPin, action: 'void' }),
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

    // Inventory ledger: the sale must have written a -1 movement referencing
    // the transaction, and the void must have written a matching +1
    // movement referencing the void itself — two rows, not an update to one.
    const saleMovement = await db.query(
      `SELECT * FROM inventory_movements WHERE tenant_id = $1 AND variant_id = $2 AND reference_type = 'pos_transaction' AND reference_id = $3`,
      [tenantId, variantId, firstSale.transactionId],
    );
    assert.equal(saleMovement.rowCount, 1);
    assert.equal(saleMovement.rows[0].delta, -1);
    assert.equal(saleMovement.rows[0].reason, 'pos_sale');
    const voidMovement = await db.query(
      `SELECT * FROM inventory_movements WHERE tenant_id = $1 AND variant_id = $2 AND reference_type = 'pos_void' AND reference_id = $3`,
      [tenantId, variantId, voidResult.voidId],
    );
    assert.equal(voidMovement.rowCount, 1);
    assert.equal(voidMovement.rows[0].delta, 1);
    assert.equal(voidMovement.rows[0].reason, 'pos_void');

    // Baseline should have been captured exactly once, at the sale's -1
    // movement (the variant's first-ever ledger entry): stock was 5 before
    // the sale decremented it, so baseline = current(4) - delta(-1) = 5.
    const baseline = await db.query(
      `SELECT baseline_stock FROM pos_inventory_baselines WHERE tenant_id = $1 AND variant_id = $2`,
      [tenantId, variantId],
    );
    assert.equal(baseline.rowCount, 1);
    assert.equal(baseline.rows[0].baseline_stock, 5);

    const secondPayload = salePayload(block.start + 1, `sale-${runId}-2`);
    const secondSale = await api('/pos/transactions', { method: 'POST', body: JSON.stringify(secondPayload) });
    const refundOverride = await api('/pos/manager/verify-pin', {
      method: 'POST', body: JSON.stringify({ pin: approverPin, action: 'refund' }),
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

    // Refund restock must write a scaled ledger row (quantity refunded, not
    // the full original sale quantity) referencing the refund itself.
    const refundMovement = await db.query(
      `SELECT * FROM inventory_movements WHERE tenant_id = $1 AND variant_id = $2 AND reference_type = 'pos_refund' AND reference_id = $3`,
      [tenantId, variantId, refund.refundId],
    );
    assert.equal(refundMovement.rowCount, 1);
    assert.equal(refundMovement.rows[0].delta, 1);
    assert.equal(refundMovement.rows[0].reason, 'pos_refund');

    // End-to-end consistency: current stock must equal baseline + sum of
    // every ledger delta so far (sale -1, void +1, sale -1, refund +1 = net
    // 0 against the baseline of 5) — this is exactly what the hourly
    // inventory-consistency job checks in production.
    const consistency = await db.query(
      `SELECT pv.stock_quantity AS current_stock, b.baseline_stock,
              COALESCE(SUM(im.delta), 0)::integer AS ledger_delta_total
       FROM product_variants pv
       JOIN pos_inventory_baselines b ON b.variant_id = pv.id AND b.tenant_id = pv.tenant_id
       LEFT JOIN inventory_movements im ON im.variant_id = pv.id AND im.tenant_id = pv.tenant_id
       WHERE pv.tenant_id = $1 AND pv.id = $2
       GROUP BY pv.stock_quantity, b.baseline_stock`,
      [tenantId, variantId],
    );
    const row = consistency.rows[0];
    assert.equal(row.current_stock, row.baseline_stock + row.ledger_delta_total);

    const cardPayload = {
      ...salePayload(block.start + 4, `sale-${runId}-card`),
      payment: { method: 'card', cashAmountCents: 0, cardAmountCents: 1000, amountTenderedCents: 0, changeGivenCents: 0 },
    };
    await assert.rejects(
      api('/pos/transactions', { method: 'POST', body: JSON.stringify(cardPayload) }),
      (error) => error.body?.code === 'INVALID_FIELD',
    );
    const cardSale = await api('/pos/transactions', {
      method: 'POST',
      body: JSON.stringify({
        ...cardPayload,
        payment: { ...cardPayload.payment, terminalReference: 'APPR-004821' },
      }),
    });
    assert.ok(cardSale.transactionId);

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

    // ── A sale linked to a customer (docs/25 Phase 5) ───────────────────────
    // Every POS sale used to send `customerId: null`, so the backend's customer
    // linkage and LTV code had never actually run for a till sale. This
    // exercises it end to end, including the refund path that reverses LTV.
    // The earlier sales in this test consumed the fixture's stock. Topped up
    // through the real admin endpoint rather than raw SQL, so this restock
    // posts an inventory_movements row like any other stock change and the
    // ledger invariant holds inside the test too.
    await api('/admin/products/bulk-stock', {
      method: 'PATCH',
      body: JSON.stringify({ updates: [{ sku: `POS-E2E-V-${runId}`, stock: 25 }] }),
    });

    const posCustomer = await api('/pos/customers', {
      method: 'POST',
      body: JSON.stringify({ fullName: 'Layla Haddad', phone: `+974 33${runId.slice(-6).replace(/\D/g, '').padEnd(6, '0')}` }),
    });
    assert.ok(posCustomer.customerId);

    // 1200, not 1000: an earlier step in this test raised the catalog price to
    // trigger the offline price-changed conflict, and an online sale at a stale
    // price is correctly rejected with PRICE_CHANGED.
    const linkedSale = await api('/pos/transactions', {
      method: 'POST',
      body: JSON.stringify({
        ...salePayload(block.start + 5, `sale-${runId}-customer`),
        customerId: posCustomer.customerId,
        items: [{ variantId, quantity: 1, unitPriceCents: 1200 }],
        payment: { method: 'cash', cashAmountCents: 1200, cardAmountCents: 0, amountTenderedCents: 1200, changeGivenCents: 0 },
      }),
    });
    assert.equal(linkedSale.customerId, posCustomer.customerId);

    const linkedOrder = await db.query(
      'SELECT customer_id, customer_name, customer_phone FROM orders WHERE id = $1',
      [linkedSale.orderId],
    );
    assert.equal(linkedOrder.rows[0].customer_id, posCustomer.customerId);
    assert.equal(linkedOrder.rows[0].customer_name, 'Layla Haddad', 'no longer "Walk-in customer"');

    const afterSale = await db.query(
      'SELECT ltv_cents, orders_count FROM customers WHERE id = $1',
      [posCustomer.customerId],
    );
    assert.equal(Number(afterSale.rows[0].ltv_cents), 1200, 'the till sale reaches lifetime value');
    assert.equal(Number(afterSale.rows[0].orders_count), 1);

    // Refunding it must give the LTV back, or a customer's lifetime value
    // silently inflates every time something is returned.
    const linkedRefundOverride = await api('/pos/manager/verify-pin', {
      method: 'POST', body: JSON.stringify({ pin: approverPin, action: 'refund' }),
    });
    await api('/pos/refunds', {
      method: 'POST',
      body: JSON.stringify({
        idempotencyKey: `refund-${runId}-customer`,
        originalTransactionId: linkedSale.transactionId,
        shiftId: shift.shiftId,
        receiptNumber: block.start + 6,
        refundMethod: 'cash',
        reason: 'E2E customer refund',
        lines: linkedSale.items.map((item) => ({ transactionItemId: item.id, quantity: 1, restock: true })),
        managerOverrideId: linkedRefundOverride.overrideId,
        managerOverrideToken: linkedRefundOverride.token,
      }),
    });
    const afterRefund = await db.query('SELECT ltv_cents FROM customers WHERE id = $1', [posCustomer.customerId]);
    assert.equal(Number(afterRefund.rows[0].ltv_cents), 0, 'a refund reverses the lifetime value it added');

    await api('/pos/sync-state', {
      method: 'PUT', body: JSON.stringify({ shiftId: shift.shiftId, pendingCount: 0, rejectedCount: 0 }),
    });
    const summary = await api('/pos/shifts/current');
    assert.equal(summary.transactionCount, 5);
    assert.equal(summary.voidCount, 1);
    assert.equal(summary.refundCount, 2, "the original refund plus the customer-linked one");
    assert.equal(summary.cashInCents, 0);
    assert.equal(summary.cashOutCents, 0);

    // Paid-in (petty cash returned, say) needs no manager override.
    const paidIn = await api('/pos/cash-movements', {
      method: 'POST',
      body: JSON.stringify({
        shiftId: shift.shiftId,
        kind: 'paid_in',
        amountCents: 500,
        reason: 'Change fund top-up',
        idempotencyKey: `cash-in-${runId}`,
      }),
    });
    assert.equal(paidIn.managerId, null);

    // Paid-out (petty cash for supplies) requires the same drawer-open
    // manager-override flow as void/refund — a distinct approving manager,
    // not the cashier's own PIN.
    const paidOutOverride = await api('/pos/manager/verify-pin', {
      method: 'POST', body: JSON.stringify({ pin: approverPin, action: 'drawer-open' }),
    });
    const paidOut = await api('/pos/cash-movements', {
      method: 'POST',
      body: JSON.stringify({
        shiftId: shift.shiftId,
        kind: 'paid_out',
        amountCents: 300,
        reason: 'Petty cash for supplies',
        idempotencyKey: `cash-out-${runId}`,
        managerOverrideId: paidOutOverride.overrideId,
        managerOverrideToken: paidOutOverride.token,
      }),
    });
    assert.ok(paidOut.managerId);

    const movements = await api(`/pos/cash-movements?shiftId=${shift.shiftId}`);
    assert.equal(movements.length, 2);

    const summaryAfterCash = await api('/pos/shifts/current');
    assert.equal(summaryAfterCash.cashInCents, 500);
    assert.equal(summaryAfterCash.cashOutCents, 300);
    assert.equal(summaryAfterCash.expectedCashCents, summary.expectedCashCents + 500 - 300);

    const zOverride = await api('/pos/manager/verify-pin', {
      method: 'POST', body: JSON.stringify({ pin: approverPin, action: 'z-report' }),
    });
    const zReport = await api('/pos/shifts/z-report', {
      method: 'POST',
      body: JSON.stringify({
        shiftId: shift.shiftId,
        physicalCashCents: summaryAfterCash.expectedCashCents,
        idempotencyKey: `z-${runId}`,
        managerOverrideId: zOverride.overrideId,
        managerOverrideToken: zOverride.token,
      }),
    });
    assert.equal(zReport.varianceCents, 0);
    assert.equal(zReport.cashInCents, 500);
    assert.equal(zReport.cashOutCents, 300);

    const zHistory = await api('/pos/shifts/z-reports');
    assert.ok(zHistory.some((r) => r.zReportId === zReport.zReportId));
    const zDetail = await api(`/pos/shifts/z-reports/${zReport.zReportId}`);
    assert.equal(zDetail.zReportId, zReport.zReportId);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (tenantId) await db.query('DELETE FROM tenants WHERE id = $1', [tenantId]).catch(() => undefined);
    await db.pool.end();
  }
});
