const test = require('node:test');
const assert = require('node:assert/strict');

require('dotenv').config();

const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
process.env.DEFAULT_TENANT_SLUG = `pos-zitems-e2e-${runId}`;
process.env.DEFAULT_TENANT_NAME = 'POS Z Items E2E';
process.env.DEFAULT_ADMIN_EMAIL = `pos-zitems-e2e-${runId}@elite.local`;
process.env.DEFAULT_ADMIN_PASSWORD = 'pos-zitems-e2e-password';
process.env.DEFAULT_ADMIN_NAME = 'POS Z Items Owner';
process.env.SESSION_SECRET = `pos-zitems-e2e-session-${runId}`;

const fs = require('node:fs');
const path = require('node:path');
const bcrypt = require('bcryptjs');
const db = require('../db/client');
const { startServer } = require('../index');

test('Z-report closing number and item breakdown', { timeout: 60000 }, async (t) => {
  if (!process.env.DATABASE_URL) return t.skip('DATABASE_URL is required for POS Z items E2E.');

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

    async function variant(name, color, size, priceCents) {
      const product = await db.query(
        `INSERT INTO products (tenant_id, sku, brand, name, slug, status, base_price_cents, stock_quantity)
         VALUES ($1,$2,'Elite',$3,$4,'active',$5,20) RETURNING id`,
        [tenantId, `ZI-${name}-${runId}`, name, `zi-${name}-${runId}`.toLowerCase(), priceCents],
      );
      const v = await db.query(
        `INSERT INTO product_variants (tenant_id, product_id, sku, barcode, size, price_cents, stock_quantity, is_active, color)
         VALUES ($1,$2,$3,$4,$5,$6,20,true,$7) RETURNING id, sku`,
        [tenantId, product.rows[0].id, `ZI-${name}-${size}-${runId}`, `ZI${name}${Date.now()}`, size, priceCents, color],
      );
      return { id: v.rows[0].id, sku: v.rows[0].sku };
    }
    const shoe = await variant('Croco', 'Green', '11.5', 180000);
    const belt = await variant('Weave', 'Brown', '11', 125000);
    const other = await variant('Aviator', 'Gray', '12', 300000);

    const approverPin = '5173';
    const approver = await db.query(
      `INSERT INTO admin_users (tenant_id, email, password_hash, full_name, initials, role, status, pos_pin_hash)
       VALUES ($1,$2,'unused','Salim Approver','SA','manager','active',$3) RETURNING id`,
      [tenantId, `pos-zitems-approver-${runId}@elite.local`, await bcrypt.hash(approverPin, 12)],
    );
    const pin = (action) => api('/pos/manager/verify-pin', { method: 'POST', body: JSON.stringify({ pin: approverPin, action }) });

    const enrollment = await api('/pos/registers/enrollment-tokens', {
      method: 'POST', body: JSON.stringify({ displayName: `E2E Z Register ${runId}` }),
    });
    await api('/pos/registers/enroll', { method: 'POST', body: JSON.stringify({ enrollmentToken: enrollment.token }) });
    const block = await api('/pos/registers/receipt-number-blocks', { method: 'POST', body: '{}' });
    const shift = await api('/pos/shifts/open', { method: 'POST', body: JSON.stringify({ openingFloatCents: 0 }) });

    let receipt = block.start;
    const payments = {
      cash: (total) => ({ method: 'cash', cashAmountCents: total, cardAmountCents: 0, amountTenderedCents: total, changeGivenCents: 0 }),
      card: (total) => ({ method: 'card', cashAmountCents: 0, cardAmountCents: total, amountTenderedCents: 0, changeGivenCents: 0, terminalReference: `T-${receipt}` }),
      sadad: (total) => ({ method: 'sadad', cashAmountCents: 0, cardAmountCents: 0, sadadAmountCents: total, amountTenderedCents: 0, changeGivenCents: 0, terminalReference: `SD-${runId.replace(/[^0-9a-z]/gi, '').slice(-8)}-${receipt}` }),
    };
    async function sell(v, quantity, unit, method) {
      const number = receipt++;
      return api('/pos/transactions', {
        method: 'POST',
        body: JSON.stringify({
          idempotencyKey: `zi-${runId}-${number}`, receiptNumber: number, shiftId: shift.shiftId, customerId: null,
          items: [{ variantId: v.id, quantity, unitPriceCents: unit }],
          payment: payments[method](unit * quantity),
          clientCreatedAt: new Date().toISOString(),
        }),
      });
    }

    await sell(shoe, 1, 180000, 'cash');
    const shoeByCard = await sell(shoe, 2, 180000, 'card');
    await sell(belt, 2, 125000, 'sadad');
    const voided = await sell(other, 1, 300000, 'cash');

    let o = await pin('void');
    await api(`/pos/transactions/${voided.transactionId}/void`, {
      method: 'POST',
      body: JSON.stringify({ idempotencyKey: `zi-void-${runId}`, voidReason: 'E2E void', managerOverrideId: o.overrideId, managerOverrideToken: o.token }),
    });

    o = await pin('refund');
    await api('/pos/refunds', {
      method: 'POST',
      body: JSON.stringify({
        idempotencyKey: `zi-refund-${runId}`, receiptNumber: receipt++, shiftId: shift.shiftId,
        originalTransactionId: shoeByCard.transactionId,
        lines: [{ transactionItemId: shoeByCard.items[0].id, quantity: 1, restock: true }],
        refundMethod: 'card', terminalReference: 'R-1', reason: 'E2E partial return',
        managerOverrideId: o.overrideId, managerOverrideToken: o.token,
      }),
    });

    // A till takeover mid-shift: the belt sale was rung by the other person.
    await db.query(
      `UPDATE pos_transactions t SET cashier_id = $2
         FROM pos_transaction_items i
        WHERE i.transaction_id = t.id AND t.shift_id = $1 AND i.variant_id = $3`,
      [shift.shiftId, approver.rows[0].id, belt.id],
    );

    const summary = await api('/pos/shifts/current');
    o = await pin('z-report');
    const z = await api('/pos/shifts/z-report', {
      method: 'POST',
      body: JSON.stringify({
        shiftId: shift.shiftId, physicalCashCents: summary.expectedCashCents, idempotencyKey: `zi-z-${runId}`,
        managerOverrideId: o.overrideId, managerOverrideToken: o.token,
      }),
    });
    assert.match(z.zNumber, /^Z-\d{4}-\d{4}-001$/);
    assert.match(z.businessDate, /^\d{4}-\d{2}-\d{2}$/);
    const [y, m, d] = z.businessDate.split('-');
    assert.equal(z.zNumber, `Z-${d}${m}-${y}-001`);

    const report = await api(`/pos/shifts/z-reports/${z.zReportId}/items`);
    assert.equal(report.header.zNumber, z.zNumber);
    assert.equal(report.header.businessDate, z.businessDate);
    assert.deepEqual(new Set(report.header.staffNames), new Set([user.name, 'Salim Approver']));

    const rows = report.items.map((r) => `${r.sku}|${r.color}|${r.size}|${r.paymentMethod}|${r.soldQty}|${r.returnQty}|${r.netQty}|${r.unitPriceCents}|${r.totalCents}`);
    assert.deepEqual(rows.sort(), [
      `${shoe.sku}|Green|11.5|card|2|1|1|180000|180000`,
      `${shoe.sku}|Green|11.5|cash|1|0|1|180000|180000`,
      `${belt.sku}|Brown|11|sadad|2|0|2|125000|250000`,
    ].sort());
    assert.ok(!report.items.some((r) => r.sku === other.sku), 'voided sale is not listed');
    assert.deepEqual(report.totals, { soldQty: 5, returnQty: 1, netQty: 4, totalCents: 610000 });
    assert.equal(report.totals.totalCents, z.netSalesCents);
    assert.deepEqual(report.byMethod, [
      { method: 'cash', totalCents: 180000 },
      { method: 'card', totalCents: 180000 },
      { method: 'sadad', totalCents: 250000 },
    ]);

    const adminReport = await api(`/admin/pos-reports/z-reports/${z.zReportId}/items`);
    assert.deepEqual(adminReport.items, report.items);
    const history = await api('/admin/pos-reports/z-reports');
    assert.equal(history.find((r) => r.zReportId === z.zReportId).zNumber, z.zNumber);

    // A second closing of the same branch on the same business day is 002.
    const shift2 = await api('/pos/shifts/open', { method: 'POST', body: JSON.stringify({ openingFloatCents: 0 }) });
    await db.query('UPDATE pos_shifts SET opened_at = $2 WHERE id = $1', [shift2.shiftId, (await db.query('SELECT opened_at FROM pos_shifts WHERE id = $1', [shift.shiftId])).rows[0].opened_at]);
    o = await pin('z-report');
    const z2 = await api('/pos/shifts/z-report', {
      method: 'POST',
      body: JSON.stringify({ shiftId: shift2.shiftId, physicalCashCents: 0, idempotencyKey: `zi-z2-${runId}`, managerOverrideId: o.overrideId, managerOverrideToken: o.token }),
    });
    assert.equal(z2.zNumber, z.zNumber.replace(/-001$/, '-002'));

    // Migration 044's backfill numbers closings written before it the same way.
    await db.query('UPDATE pos_z_reports SET z_number = NULL, business_date = NULL WHERE tenant_id = $1', [tenantId]);
    await db.query(fs.readFileSync(path.join(__dirname, '..', 'db', 'migrations', '044_pos_z_report_number.sql'), 'utf8'));
    const backfilled = await db.query(
      `SELECT id, z_number, to_char(business_date, 'YYYY-MM-DD') AS business_date FROM pos_z_reports WHERE tenant_id = $1`,
      [tenantId],
    );
    const byId = new Map(backfilled.rows.map((r) => [r.id, r]));
    assert.equal(byId.get(z.zReportId).z_number, z.zNumber);
    assert.equal(byId.get(z.zReportId).business_date, z.businessDate);
    assert.equal(byId.get(z2.zReportId).z_number, z2.zNumber);

    await assert.rejects(api('/pos/shifts/z-reports/not-a-uuid/items'), /422/);
    await assert.rejects(api('/pos/shifts/z-reports/00000000-0000-4000-8000-000000000000/items'), /404/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (tenantId) await db.query('DELETE FROM tenants WHERE id = $1', [tenantId]).catch(() => undefined);
    await db.pool.end();
  }
});
