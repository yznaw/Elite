import test from 'node:test';
import assert from 'node:assert/strict';
import { csvRows, parseStocktakeCountCsv } from '../projects/admin-portal/src/app/utils/stocktake-csv.ts';

test('round-trips an exported location count sheet', () => {
  const csv = csvRows([
    ['Location ID', 'Location', 'SKU', 'Barcode', 'Product', 'Color', 'Size', 'Counted'],
    ['loc-1', 'Downtown', 'SKU-5', '', 'Sandal', 'Tan', '5', 3],
  ]);
  assert.deepEqual(parseStocktakeCountCsv(csv, { locationId: 'loc-1', locationName: 'Downtown' }), {
    counts: [{ sku: 'SKU-5', barcode: '', quantity: 3 }],
    skipped: 0,
  });
});

test('uses SKU when the Barcode cell is blank', () => {
  const csv = 'SKU,Barcode,Counted\nSKU-6,,4';
  assert.deepEqual(parseStocktakeCountCsv(csv).counts[0], { sku: 'SKU-6', barcode: '', quantity: 4 });
});

test('rejects decimal, negative and partly numeric counts', () => {
  const csv = 'SKU,Counted\nA,1.5\nB,-1\nC,5pcs\nD,0';
  const parsed = parseStocktakeCountCsv(csv);
  assert.deepEqual(parsed.counts, [{ sku: 'D', barcode: '', quantity: 0 }]);
  assert.equal(parsed.skipped, 3);
});

test('blocks importing a sheet into another location', () => {
  const csv = 'Location ID,Location,SKU,Counted\nloc-2,Uptown,A,1';
  assert.throws(
    () => parseStocktakeCountCsv(csv, { locationId: 'loc-1', locationName: 'Downtown' }),
    /another stocktake location/,
  );
});

test('accepts a simple Barcode and Quantity sheet', () => {
  const csv = 'Barcode,Quantity\n123456,2';
  assert.deepEqual(parseStocktakeCountCsv(csv).counts, [{ sku: '', barcode: '123456', quantity: 2 }]);
});
