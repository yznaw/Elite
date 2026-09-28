const test = require('node:test');
const assert = require('node:assert/strict');
const { PosError } = require('../lib/pos/errors');
const { normalizeSale, validatePayment } = require('../lib/pos/sale-service');
const { mapRefund } = require('../lib/pos/correction-service');

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

test('normalizeSale requires a terminal reference for card payments', () => {
  const body = validSale();
  body.payment = {
    method: 'card',
    cashAmountCents: 0,
    cardAmountCents: 3000,
    amountTenderedCents: 0,
    changeGivenCents: 0,
  };
  assert.throws(() => normalizeSale(body), (error) => {
    assert.ok(error instanceof PosError);
    assert.equal(error.code, 'INVALID_FIELD');
    return true;
  });

  body.payment.terminalReference = 'APPR-004821';
  const sale = normalizeSale(body);
  assert.equal(sale.payment.terminalReference, 'APPR-004821');
});

test('normalizeSale ignores a terminal reference on cash payments', () => {
  const body = validSale();
  body.payment.terminalReference = 'should-be-ignored';
  const sale = normalizeSale(body);
  assert.equal(sale.payment.terminalReference, null);
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

function sadadSale(overrides = {}) {
  const body = validSale();
  body.payment = {
    method: 'sadad',
    cashAmountCents: 0,
    cardAmountCents: 0,
    sadadAmountCents: 3000,
    amountTenderedCents: 0,
    changeGivenCents: 0,
    terminalReference: ' sd-20260922-7731 ',
    ...overrides,
  };
  return body;
}

function rejectsWith(fn, code) {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof PosError);
    assert.equal(error.code, code);
    return true;
  });
}

test('normalizeSale accepts a Sadad sale and normalizes its transaction ID', () => {
  const sale = normalizeSale(sadadSale());
  assert.equal(sale.payment.method, 'sadad');
  assert.equal(sale.payment.sadadAmountCents, 3000);
  assert.equal(sale.payment.terminalReference, 'SD-20260922-7731');
  assert.doesNotThrow(() => validatePayment(sale.payment, 3000));
});

test('normalizeSale requires a well-formed Sadad transaction ID', () => {
  rejectsWith(() => normalizeSale(sadadSale({ terminalReference: undefined })), 'INVALID_FIELD');
  rejectsWith(() => normalizeSale(sadadSale({ terminalReference: '   ' })), 'INVALID_FIELD');
  rejectsWith(() => normalizeSale(sadadSale({ terminalReference: 'AB1' })), 'PAYMENT_REFERENCE_INVALID');
  rejectsWith(() => normalizeSale(sadadSale({ terminalReference: 'ID with spaces' })), 'PAYMENT_REFERENCE_INVALID');
  rejectsWith(() => normalizeSale(sadadSale({ terminalReference: '<script>1</script>' })), 'PAYMENT_REFERENCE_INVALID');
  rejectsWith(() => normalizeSale(sadadSale({ terminalReference: 'A'.repeat(41) })), 'FIELD_TOO_LONG');
});

test('normalizeSale rejects unknown payment methods', () => {
  rejectsWith(() => normalizeSale(sadadSale({ method: 'SADAD' })), 'PAYMENT_METHOD_INVALID');
  rejectsWith(() => normalizeSale(sadadSale({ method: 'wallet' })), 'PAYMENT_METHOD_INVALID');
});

test('normalizeSale defaults sadadAmountCents to 0 for sales queued before Sadad existed', () => {
  const sale = normalizeSale(validSale());
  assert.equal(sale.payment.sadadAmountCents, 0);
  rejectsWith(() => normalizeSale(sadadSale({ sadadAmountCents: -1 })), 'INVALID_MONEY');
});

test('Sadad payment must cover the total and carry no cash or card amounts', () => {
  const base = normalizeSale(sadadSale()).payment;
  rejectsWith(() => validatePayment({ ...base, sadadAmountCents: 2999 }, 3000), 'PAYMENT_TOTAL_MISMATCH');
  rejectsWith(() => validatePayment({ ...base, cardAmountCents: 3000 }, 3000), 'PAYMENT_TOTAL_MISMATCH');
  rejectsWith(() => validatePayment({ ...base, cashAmountCents: 3000 }, 3000), 'PAYMENT_TOTAL_MISMATCH');
  rejectsWith(() => validatePayment({ ...base, amountTenderedCents: 3000 }, 3000), 'PAYMENT_TOTAL_MISMATCH');
});

test('cash and card payments cannot carry a Sadad amount', () => {
  const cash = { ...validSale().payment, sadadAmountCents: 3000 };
  rejectsWith(() => validatePayment(cash, 3000), 'PAYMENT_TOTAL_MISMATCH');
  const card = { method: 'card', cashAmountCents: 0, cardAmountCents: 3000, sadadAmountCents: 1, amountTenderedCents: 0, changeGivenCents: 0 };
  rejectsWith(() => validatePayment(card, 3000), 'PAYMENT_TOTAL_MISMATCH');
});

test('refund receipts preserve bilingual product, colour and size snapshots', () => {
  const result = mapRefund({
    id: 'refund-1',
    original_transaction_id: 'transaction-1',
    receipt_number: 1002,
    amount_cents: 2500,
    method: 'cash',
    reason: 'Return',
    order_payment_status: 'refunded',
    created_at: '2026-09-11T10:00:00.000Z',
  }, {
    items: [{
      product_name: 'Leather shoes',
      product_name_ar: 'حذاء جلد',
      variant_title: 'Beige / 42',
      color: 'Beige',
      color_ar: 'بيج',
      size: '42',
      sku: 'SHOE-42',
      quantity: 1,
      unit_price_cents: 2500,
      refund_amount_cents: 2500,
    }],
  });

  assert.deepEqual(result.receipt.receiptData.items[0], {
    name: 'Leather shoes',
    nameAr: 'حذاء جلد',
    variant: 'Beige / 42',
    color: 'Beige',
    colorAr: 'بيج',
    size: '42',
    sku: 'SHOE-42',
    quantity: 1,
    unitPriceCents: 2500,
    lineTotalCents: 2500,
  });
});
