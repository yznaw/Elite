const test = require('node:test');
const assert = require('node:assert/strict');
const { PosError } = require('../lib/pos/errors');
const { normalizeSale, validatePayment } = require('../lib/pos/sale-service');

const variantId = '11111111-1111-4111-8111-111111111111';
const shiftId = '22222222-2222-4222-8222-222222222222';

function validSale() {
  return {
    idempotencyKey: 'sale-test-1',
    receiptNumber: 1001,
    shiftId,
    customerId: null,
    items: [{ variantId, quantity: 2, unitPriceCents: 1500 }],
    payment: {
      method: 'cash',
      cashAmountCents: 3000,
      cardAmountCents: 0,
      amountTenderedCents: 5000,
      changeGivenCents: 2000,
    },
    clientCreatedAt: '2026-06-22T10:00:00.000Z',
  };
}

test('normalizeSale accepts integer-cents input and preserves the client timestamp', () => {
  const sale = normalizeSale(validSale());
  assert.equal(sale.receiptNumber, 1001);
  assert.equal(sale.items[0].unitPriceCents, 1500);
  assert.equal(sale.clientCreatedAt.toISOString(), '2026-06-22T10:00:00.000Z');
});

test('normalizeSale rejects duplicate variant lines', () => {
  const body = validSale();
  body.items.push({ ...body.items[0] });
  assert.throws(() => normalizeSale(body), (error) => {
    assert.ok(error instanceof PosError);
    assert.equal(error.code, 'DUPLICATE_CART_LINE');
    return true;
  });
});

test('normalizeSale rejects malformed client timestamps', () => {
  const body = validSale();
  body.clientCreatedAt = 'not-a-date';
  assert.throws(() => normalizeSale(body), (error) => {
    assert.ok(error instanceof PosError);
    assert.equal(error.code, 'INVALID_TIMESTAMP');
    return true;
  });
});

test('cash payment requires exact cash allocation and correct change', () => {
  const payment = validSale().payment;
  assert.doesNotThrow(() => validatePayment(payment, 3000));
  assert.throws(
    () => validatePayment({ ...payment, changeGivenCents: 1999 }, 3000),
    (error) => error instanceof PosError && error.code === 'CHANGE_MISMATCH',
  );
});

test('card payment cannot carry cash tender fields', () => {
  assert.doesNotThrow(() => validatePayment({
    method: 'card',
    cashAmountCents: 0,
    cardAmountCents: 3000,
    amountTenderedCents: 0,
    changeGivenCents: 0,
  }, 3000));
  assert.throws(() => validatePayment({
    method: 'card',
    cashAmountCents: 0,
    cardAmountCents: 3000,
    amountTenderedCents: 3000,
    changeGivenCents: 0,
  }, 3000), (error) => error instanceof PosError && error.code === 'PAYMENT_TOTAL_MISMATCH');
});
