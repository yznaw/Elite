import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAllLocationsSheet, buildLocationSheet, csvCell, csvRows, parseStocktakeCountCsv,
} from '../projects/admin-portal/src/app/utils/stocktake-csv.ts';

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

// ── Export sheets (team feedback 2026-09-24: Counted was empty) ─────────────

const rayyan = { locationId: 'loc-r', name: 'Al Rayyan Shop' };
const pearl = { locationId: 'loc-p', name: 'The Pearl Shop' };
const warehouse = { locationId: 'loc-w', name: 'Warehouse' };
const line = (sku: string, size: string, counts: Record<string, number>, expected: number | null = 4) => ({
  sku, barcode: sku, productName: 'Croco Simple', color: 'Green', size,
  expectedQuantity: expected, countedQuantity: null, locationCounts: counts,
});

test('a location sheet carries the saved counts: blank = not counted, 0 = counted as zero', () => {
  const rows = buildLocationSheet([
    line('A-5', '5', { 'loc-r': 3 }), line('A-6', '6', {}), line('A-7', '7', { 'loc-r': 0 }),
  ], rayyan, false);
  assert.deepEqual(rows[0], ['Location ID', 'Location', 'SKU', 'Barcode', 'Product', 'Color', 'Size', 'Counted']);
  assert.deepEqual(rows.slice(1).map((r) => r[r.length - 1]), [3, '', 0]);
});

test('a location sheet shows only that location, never another location\'s count', () => {
  const rows = buildLocationSheet([line('A-5', '5', { 'loc-p': 9 })], rayyan, false);
  assert.equal(rows[1][rows[1].length - 1], '');
});

test('Expected is included when the count is not blind, and left out when it is', () => {
  const open = buildLocationSheet([line('A-5', '5', { 'loc-r': 3 }, 4)], rayyan, true);
  assert.deepEqual(open[0].slice(-2), ['Expected', 'Counted']);
  assert.deepEqual(open[1].slice(-2), [4, 3]);
  const blind = buildLocationSheet([line('A-5', '5', { 'loc-r': 3 }, null)], rayyan, false);
  assert.ok(!blind[0].includes('Expected'));
});

test('a stocktake without locations exports its saved counted quantity', () => {
  const rows = buildLocationSheet([{ ...line('A-5', '5', {}), countedQuantity: 6 }], null, false);
  assert.deepEqual(rows[0], ['SKU', 'Barcode', 'Product', 'Color', 'Size', 'Counted']);
  assert.equal(rows[1][5], 6);
});

test('an exported location sheet round-trips through import with the same counts', () => {
  const csv = csvRows(buildLocationSheet([line('A-5', '5', { 'loc-r': 3 }), line('A-6', '6', {})], rayyan, true));
  const parsed = parseStocktakeCountCsv(csv, { locationId: 'loc-r', locationName: 'Al Rayyan Shop' });
  assert.deepEqual(parsed.counts, [{ sku: 'A-5', barcode: 'A-5', quantity: 3 }]);
  assert.equal(parsed.skipped, 1, 'the uncounted row is skipped, not imported as zero');
});

test('the all-locations sheet has a column per location, the total and the difference', () => {
  const rows = buildAllLocationsSheet([
    line('A-5', '5', { 'loc-r': 2, 'loc-p': 1, 'loc-w': 0 }, 4),
    line('A-6', '6', { 'loc-w': 5 }, 5),
    line('A-7', '7', {}, 2),
  ], [rayyan, pearl, warehouse], true);
  assert.deepEqual(rows[0], ['SKU', 'Barcode', 'Product', 'Color', 'Size',
    'Al Rayyan Shop', 'The Pearl Shop', 'Warehouse', 'Total counted', 'Expected', 'Difference']);
  assert.deepEqual(rows[1].slice(5), [2, 1, 0, 3, 4, -1]);
  assert.deepEqual(rows[2].slice(5), ['', '', 5, 5, 5, 0]);
  assert.deepEqual(rows[3].slice(5), ['', '', '', '', 2, ''], 'no count yet: no total, no difference');
});

test('a blind all-locations sheet has no Expected or Difference', () => {
  const rows = buildAllLocationsSheet([line('A-5', '5', { 'loc-r': 2 }, null)], [rayyan], false);
  assert.deepEqual(rows[0].slice(-2), ['Al Rayyan Shop', 'Total counted']);
});

test('an all-locations sheet cannot be imported by mistake', () => {
  const csv = csvRows(buildAllLocationsSheet([line('A-5', '5', { 'loc-r': 2 })], [rayyan, pearl], true));
  assert.throws(() => parseStocktakeCountCsv(csv, { locationId: 'loc-r', locationName: 'Al Rayyan Shop' }), /all-locations sheet/);
});

test('text that a spreadsheet would run as a formula is neutralised', () => {
  for (const evil of ['=HYPERLINK("http://x","click")', '+1+1', '-2+3', '@SUM(A1)', '\tTAB']) {
    assert.ok(csvCell(evil).startsWith(`"'`), `guards ${JSON.stringify(evil)}`);
  }
  assert.equal(csvCell('Croco = Green'), '"Croco = Green"', 'only a leading character is dangerous');
  assert.equal(csvCell(-1), '"-1"', 'numbers such as a negative difference stay numbers');
});

test('a guarded SKU or barcode still matches on import', () => {
  const csv = csvRows([['SKU', 'Barcode', 'Counted'], ['=A-5', '+974', 2]]);
  assert.deepEqual(parseStocktakeCountCsv(csv).counts, [{ sku: '=A-5', barcode: '+974', quantity: 2 }]);
});

test('a file with only a header is rejected', () => {
  assert.throws(() => parseStocktakeCountCsv('SKU,Counted\n'), /header and at least one count row/);
});

test('a file without SKU/Barcode or Counted columns is rejected', () => {
  assert.throws(() => parseStocktakeCountCsv('Name,Qty\nA,1'), /SKU or Barcode and Counted/);
});
