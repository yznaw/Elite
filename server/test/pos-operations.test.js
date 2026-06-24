const test = require('node:test');
const assert = require('node:assert/strict');
const { PosError } = require('../lib/pos/errors');
const { normalizeCartPayload } = require('../lib/pos/parked-cart-service');
const { parseQzRequest } = require('../lib/pos/qz-service');
const { syncRejectionReason } = require('../lib/pos/sync-service');

test('QZ signing allowlist accepts an approved printer and rejects another printer', () => {
  process.env.POS_PRINTER_ALLOWLIST = 'BIXOLON SRP-350plusIII';
  const request = JSON.stringify({ call: 'print', params: { printer: { name: 'BIXOLON SRP-350plusIII' } } });
  assert.equal(parseQzRequest(request).call, 'print');
  assert.throws(
    () => parseQzRequest(JSON.stringify({ call: 'print', params: { printer: { name: 'Office Laser' } } })),
    (error) => error instanceof PosError && error.code === 'QZ_PRINTER_DENIED',
  );
});

test('QZ signing rejects operations outside the POS allowlist', () => {
  assert.throws(
    () => parseQzRequest(JSON.stringify({ call: 'file.write', params: {} })),
    (error) => error instanceof PosError && error.code === 'QZ_OPERATION_DENIED',
  );
});

test('parked carts require a bounded non-empty item payload', () => {
  assert.equal(normalizeCartPayload({ items: [{ variantId: 'v1', quantity: 1 }] }), '{"items":[{"variantId":"v1","quantity":1}]}');
  assert.throws(
    () => normalizeCartPayload({ items: [] }),
    (error) => error instanceof PosError && error.code === 'INVALID_CART',
  );
});

test('offline sync maps security and receipt failures to stable public reasons', () => {
  assert.equal(syncRejectionReason('REGISTER_DISABLED'), 'UNAUTHORIZED_REGISTER');
  assert.equal(syncRejectionReason('INVALID_RECEIPT_NUMBER'), 'INVALID_RECEIPT_NUMBER');
  assert.equal(syncRejectionReason('INVALID_MONEY'), 'INVALID_PAYLOAD');
});
