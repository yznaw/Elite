const test = require('node:test');
const assert = require('node:assert/strict');
const { PosError } = require('../lib/pos/errors');
const { normalizeCartPayload } = require('../lib/pos/parked-cart-service');
const { parseQzRequest } = require('../lib/pos/qz-service');
const { syncRejectionReason } = require('../lib/pos/sync-service');

// QZ Tray's real client library only ever sends a SHA-256 hash digest to be
// signed (see qz-service.js's parseQzRequest doc comment) — never the
// original call/printer/params JSON, so the server cannot allowlist by
// printer or call type here. These tests cover the real contract: any
// non-empty, size-bounded string is accepted and returned as-is for signing.
test('QZ signing accepts an opaque hash payload for signing', () => {
  const hashLikeRequest = 'f4b46a4c9d8f9e0c0b2a1e3d5c7f9a1b3d5f7e9c1b3d5f7e9c1b3d5f7e9c1b3d';
  assert.equal(parseQzRequest(hashLikeRequest).request, hashLikeRequest);
});

test('QZ signing rejects an empty request', () => {
  assert.throws(
    () => parseQzRequest(''),
    (error) => error instanceof PosError && error.code === 'INVALID_FIELD',
  );
});

test('QZ signing rejects an oversized request', () => {
  const oversized = 'a'.repeat(200 * 1024);
  assert.throws(
    () => parseQzRequest(oversized),
    (error) => error instanceof PosError && (error.code === 'QZ_REQUEST_TOO_LARGE' || error.code === 'INVALID_FIELD'),
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
