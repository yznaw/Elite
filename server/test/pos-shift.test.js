const test = require('node:test');
const assert = require('node:assert/strict');
const { loadShiftSummary } = require('../lib/pos/shift-service');

test('shift summary maps gross, voids, refunds, net sales, and expected cash separately', async () => {
  const client = {
    async query() {
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
          expected_cash_cents: '36000',
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
