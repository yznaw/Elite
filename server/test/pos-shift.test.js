const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../db/client');
const { PosError } = require('../lib/pos/errors');
const { closeShift, loadShiftSummary } = require('../lib/pos/shift-service');

test('shift summary maps gross, voids, refunds, net sales, and expected cash separately', async () => {
  const client = {
    async query(sql) {
      if (/pos_cash_movements/.test(sql)) {
        return { rowCount: 1, rows: [{ cash_in_cents: '0', cash_out_cents: '0' }] };
      }
      return {
        rowCount: 1,
        rows: [{
          id: '11111111-1111-4111-8111-111111111111',
          register_id: '22222222-2222-4222-8222-222222222222',
          cashier_id: '33333333-3333-4333-8333-333333333333',
          state: 'open',
          opened_at: new Date('2026-06-22T08:00:00.000Z'),
          opening_float_cents: '10000',
          gross_sales_cents: '50000',
          cash_sales_cents: '30000',
          card_sales_cents: '20000',
          refund_total_cents: '4000',
          cash_refund_cents: '1500',
          void_total_cents: '6000',
          voided_cash_cents: '2500',
          net_sales_cents: '40000',
          transaction_count: 8,
          refund_count: 2,
          void_count: 1,
        }],
      };
    },
  };

  const summary = await loadShiftSummary(
    client,
    '44444444-4444-4444-8444-444444444444',
    '11111111-1111-4111-8111-111111111111',
  );
  assert.equal(summary.grossSalesCents, 50000);
  assert.equal(summary.voidTotalCents, 6000);
  assert.equal(summary.refundTotalCents, 4000);
  assert.equal(summary.netSalesCents, 40000);
  assert.equal(summary.expectedCashCents, 36000);
});

// ── Self-close (migration 026) ──────────────────────────────────────────────
// Elite's shops run one branch manager, so requiring a *different* manager to
// close made the shift uncloseable whenever they were off-site.

const OWNER_ID = '33333333-3333-4333-8333-333333333333';
const OTHER_ID = '55555555-5555-4555-8555-555555555555';
const closeContext = {
  tenantId: '44444444-4444-4444-8444-444444444444',
  userId: OWNER_ID,
  role: 'manager',
  registerId: '22222222-2222-4222-8222-222222222222',
  ip: '127.0.0.1',
  userAgent: 'test',
};

/**
 * Mocks just enough of the pool for closeShift: one open shift owned by
 * `shiftCashierId`, no pending offline sales, and a tenant whose self-close
 * flag is `selfCloseEnabled`. Captured SQL is returned for assertions.
 */
function mockCloseShiftPool({ selfCloseEnabled, shiftCashierId }) {
  const statements = [];
  const zReportParams = [];
  db.pool.connect = async () => ({
    async query(text, params) {
      const sql = String(text).replace(/\s+/g, ' ').trim();
      statements.push(sql);
      if (sql.startsWith('SELECT * FROM pos_z_reports')) return { rowCount: 0, rows: [] };
      if (sql.startsWith('SELECT * FROM pos_registers')) {
        return { rowCount: 1, rows: [{ id: closeContext.registerId, status: 'active' }] };
      }
      if (sql.startsWith('SELECT * FROM pos_shifts')) {
        return {
          rowCount: 1,
          rows: [{
            id: '11111111-1111-4111-8111-111111111111',
            register_id: closeContext.registerId,
            cashier_id: shiftCashierId,
            state: 'open',
          }],
        };
      }
      if (sql.startsWith('SELECT COALESCE(sum(pending_count)')) {
        return { rowCount: 1, rows: [{ pending_count: 0, rejected_count: 0 }] };
      }
      if (sql.startsWith('SELECT pos_self_close_shift_enabled FROM tenants')) {
        return { rowCount: 1, rows: [{ pos_self_close_shift_enabled: selfCloseEnabled }] };
      }
      if (/pos_cash_movements/.test(sql)) {
        return { rowCount: 1, rows: [{ cash_in_cents: '0', cash_out_cents: '0' }] };
      }
      if (sql.startsWith('WITH tx AS')) {
        return {
          rowCount: 1,
          rows: [{
            id: '11111111-1111-4111-8111-111111111111',
            register_id: closeContext.registerId,
            cashier_id: shiftCashierId,
            state: 'closing',
            opened_at: new Date('2026-06-22T08:00:00.000Z'),
            opening_float_cents: '10000',
            gross_sales_cents: '0',
            cash_sales_cents: '0',
            card_sales_cents: '0',
            refund_total_cents: '0',
            cash_refund_cents: '0',
            void_total_cents: '0',
            voided_cash_cents: '0',
            net_sales_cents: '0',
            transaction_count: 0,
            refund_count: 0,
            void_count: 0,
          }],
        };
      }
      if (sql.startsWith('INSERT INTO pos_z_reports')) {
        zReportParams.push(params);
        return { rowCount: 1, rows: [{ id: 'z-1', shift_id: '11111111-1111-4111-8111-111111111111', register_id: closeContext.registerId }] };
      }
      return { rowCount: 1, rows: [] };
    },
    release() {},
  });
  return { statements, zReportParams };
}

test('the cashier who opened the shift closes it without a manager override', async () => {
  const originalConnect = db.pool.connect;
  const { statements, zReportParams } = mockCloseShiftPool({ selfCloseEnabled: true, shiftCashierId: OWNER_ID });

  try {
    const report = await closeShift(closeContext, {
      shiftId: '11111111-1111-4111-8111-111111111111',
      idempotencyKey: 'close-1',
      physicalCashCents: 10000,
      // No managerOverrideId / managerOverrideToken at all.
    });
    assert.equal(report.zReportId, 'z-1');
    assert.ok(!statements.some((sql) => sql.startsWith('SELECT * FROM pos_manager_overrides')));
    // manager_id is the 4th column of the insert: the operator approved it.
    assert.equal(zReportParams[0][3], OWNER_ID);
    assert.equal(statements.at(-1), 'COMMIT');
  } finally {
    db.pool.connect = originalConnect;
  }
});

test('self-close does not apply to a shift opened by someone else', async () => {
  const originalConnect = db.pool.connect;
  mockCloseShiftPool({ selfCloseEnabled: true, shiftCashierId: OTHER_ID });

  try {
    // Falls through to consumeOverride, which rejects the missing override.
    await assert.rejects(
      closeShift(closeContext, {
        shiftId: '11111111-1111-4111-8111-111111111111',
        idempotencyKey: 'close-2',
        physicalCashCents: 10000,
      }),
      // INVALID_ID: consumeOverride demanded the override id this request
      // does not carry, which is the proof it was not skipped.
      (error) => error instanceof PosError && error.code === 'INVALID_ID',
    );
  } finally {
    db.pool.connect = originalConnect;
  }
});

test('self-close does not apply when the shop turned the setting off', async () => {
  const originalConnect = db.pool.connect;
  mockCloseShiftPool({ selfCloseEnabled: false, shiftCashierId: OWNER_ID });

  try {
    await assert.rejects(
      closeShift(closeContext, {
        shiftId: '11111111-1111-4111-8111-111111111111',
        idempotencyKey: 'close-3',
        physicalCashCents: 10000,
      }),
      (error) => error instanceof PosError && error.code === 'INVALID_ID',
    );
  } finally {
    db.pool.connect = originalConnect;
  }
});

test('shift summary adds cash-in and subtracts cash-out from expected cash', async () => {
  const client = {
    async query(sql) {
      if (/pos_cash_movements/.test(sql)) {
        return { rowCount: 1, rows: [{ cash_in_cents: '2000', cash_out_cents: '500' }] };
      }
      return {
        rowCount: 1,
        rows: [{
          id: '11111111-1111-4111-8111-111111111111',
          register_id: '22222222-2222-4222-8222-222222222222',
          cashier_id: '33333333-3333-4333-8333-333333333333',
          state: 'open',
          opened_at: new Date('2026-06-22T08:00:00.000Z'),
          opening_float_cents: '10000',
          gross_sales_cents: '50000',
          cash_sales_cents: '30000',
          card_sales_cents: '20000',
          refund_total_cents: '4000',
          cash_refund_cents: '1500',
          void_total_cents: '6000',
          voided_cash_cents: '2500',
          net_sales_cents: '40000',
          transaction_count: 8,
          refund_count: 2,
          void_count: 1,
        }],
      };
    },
  };

  const summary = await loadShiftSummary(
    client,
    '44444444-4444-4444-8444-444444444444',
    '11111111-1111-4111-8111-111111111111',
  );
  assert.equal(summary.cashInCents, 2000);
  assert.equal(summary.cashOutCents, 500);
  // 10000 (float) + 30000 (cash sales) - 2500 (voided cash) - 1500 (cash refund) + 2000 (in) - 500 (out)
  assert.equal(summary.expectedCashCents, 37500);
});
