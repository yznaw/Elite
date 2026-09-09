import test from 'node:test';
import assert from 'node:assert/strict';
import { formatVariantSku } from '../projects/admin-portal/src/app/utils/variant-sku.ts';

test('formats numeric and decimal sizes from a base SKU', () => {
  assert.equal(formatVariantSku('1493-GF-', '5'), '1493-GF-5');
  assert.equal(formatVariantSku('1493-GF', '5.5'), '1493-GF-5.5');
});

test('normalizes whitespace and repeated trailing separators', () => {
  assert.equal(formatVariantSku(' 1493-GF--- ', ' 6 '), '1493-GF-6');
});

test('supports letter sizes', () => {
  assert.equal(formatVariantSku('SHIRT-BLK-', 'XL'), 'SHIRT-BLK-XL');
});

test('does not invent a SKU without both base and size', () => {
  assert.equal(formatVariantSku('', '5'), '');
  assert.equal(formatVariantSku('1493-GF-', ''), '');
  assert.equal(formatVariantSku('---', '5'), '');
});
