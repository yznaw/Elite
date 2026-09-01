const test = require('node:test');
const assert = require('node:assert/strict');

require('dotenv').config();

const router = require('../routes/admin-bulk-import.route');
const { _test } = router;

test('isPrivateIp blocks loopback, RFC1918, link-local/cloud-metadata, and IPv6 equivalents', () => {
  assert.equal(_test.isPrivateIp('127.0.0.1'), true);
  assert.equal(_test.isPrivateIp('10.0.0.5'), true);
  assert.equal(_test.isPrivateIp('172.16.0.1'), true);
  assert.equal(_test.isPrivateIp('172.31.255.255'), true);
  assert.equal(_test.isPrivateIp('192.168.1.1'), true);
  assert.equal(_test.isPrivateIp('169.254.169.254'), true); // cloud metadata endpoint
  assert.equal(_test.isPrivateIp('0.0.0.0'), true);
  assert.equal(_test.isPrivateIp('::1'), true);
  assert.equal(_test.isPrivateIp('fe80::1'), true);
  assert.equal(_test.isPrivateIp('fd00::1'), true);
  assert.equal(_test.isPrivateIp('::ffff:127.0.0.1'), true);

  assert.equal(_test.isPrivateIp('8.8.8.8'), false);
  assert.equal(_test.isPrivateIp('172.15.0.1'), false); // just outside the 172.16/12 block
  assert.equal(_test.isPrivateIp('172.32.0.1'), false);
});

test('assertPublicHost rejects non-http(s) schemes, localhost, and literal private IPs', async () => {
  await assert.rejects(_test.assertPublicHost('file:///etc/passwd'), /scheme/);
  await assert.rejects(_test.assertPublicHost('http://localhost/'), /not allowed/);
  await assert.rejects(_test.assertPublicHost('http://127.0.0.1/'), /private network/);
  await assert.rejects(_test.assertPublicHost('http://169.254.169.254/latest/meta-data/'), /private network/);
  await assert.rejects(_test.assertPublicHost('not a url'), /not valid/);
  // A public IP literal takes the synchronous no-DNS path and must pass.
  await assert.doesNotReject(_test.assertPublicHost('http://8.8.8.8/robots.txt'));
});

test('buildGroups keys rows by Product SKU, falling back to name, and preserves the key for each group', () => {
  const rows = [
    { name: 'Bag', productSku: 'BAG-01', variantSku: 'BAG-01-S' },
    { name: 'Bag', productSku: 'BAG-01', variantSku: 'BAG-01-M' },
    { name: 'Legacy Shoe', productSku: '', variantSku: 'LEG-1' },
    { name: '', productSku: '', variantSku: 'NO-NAME' },
  ];
  const groups = _test.buildGroups(rows);
  assert.equal(groups.length, 2);
  const [firstKey, firstRows] = groups[0];
  assert.equal(firstKey, 'sku:bag-01');
  assert.equal(firstRows.length, 2);
  const [secondKey, secondRows] = groups[1];
  assert.equal(secondKey, 'name:legacy shoe');
  assert.equal(secondRows.length, 1);
});

test('findStaleGroups flags a matched product whose updated_at moved, and a new/missing match', async () => {
  const rows = { rows: [
    { id: 'p-existing', sku: 'BAG-01', slug: 'bag-01', updated_at: '2026-01-01T00:00:00.000Z' },
    { id: 'p-now-exists', sku: 'NEW-01', slug: 'new-01', updated_at: '2026-01-01T00:00:00.000Z' },
  ] };
  const client = { query: async () => rows };
  const sourceJob = { summary: { catalogSnapshot: [
    // Matched at preview time, but the DB row now has a different updated_at.
    { key: 'sku:bag-01', productId: 'p-existing', updatedAt: '2025-01-01T00:00:00.000Z' },
    // Was a brand-new product at preview time (no match); one now exists.
    { key: 'sku:new-01', productId: null, updatedAt: null },
    // Matched and unchanged — must not be flagged.
    { key: 'sku:unchanged-01', productId: 'p-unchanged', updatedAt: '2025-06-01T00:00:00.000Z' },
  ] } };
  const groupEntries = _test.buildGroups([
    { name: 'Bag', productSku: 'BAG-01', variantSku: 'BAG-01-S' },
    { name: 'New', productSku: 'NEW-01', variantSku: 'NEW-01-S' },
    { name: 'Unchanged', productSku: 'UNCHANGED-01', variantSku: 'UNCHANGED-01-S' },
  ]);
  // The mock client always returns the same two rows regardless of query, so
  // stub the "unchanged" product in directly for that one comparison.
  rows.rows.push({ id: 'p-unchanged', sku: 'UNCHANGED-01', slug: 'unchanged', updated_at: '2025-06-01T00:00:00.000Z' });

  const stale = await _test.findStaleGroups(client, 'tenant-1', sourceJob, groupEntries);
  assert.deepEqual(stale.sort(), ['sku:bag-01', 'sku:new-01']);
});

test('findStaleGroups is a no-op for a job with no stored snapshot (older jobs predating this check)', async () => {
  const client = { query: async () => { throw new Error('should not query'); } };
  const stale = await _test.findStaleGroups(client, 'tenant-1', { summary: {} }, [['sku:x', [{ name: 'X', productSku: 'X', variantSku: 'X-1' }]]]);
  assert.deepEqual(stale, []);
});

test('downloaded Template V2 has aligned UTF-8 headers and example values', () => {
  const layer = router.stack.find(entry => entry.route?.path === '/template');
  const headers = {};
  let body = '';
  layer.route.stack[0].handle({}, {
    setHeader(name, value) { headers[name] = value; },
    send(value) { body = value; },
  });

  const [headerRow, exampleRow] = _test.parseCSV(body);
  assert.equal(body.charCodeAt(0), 0xFEFF);
  assert.equal(headers['Content-Type'], 'text/csv; charset=utf-8');
  assert.equal(headers['Content-Disposition'], 'attachment; filename="elite-products-template-v2.csv"');
  assert.equal(headerRow.length, 33);
  assert.equal(exampleRow.length, headerRow.length);
  assert.equal(headerRow[0].replace(/^\uFEFF/, ''), 'Product SKU');
  assert.equal(headerRow.at(-1), 'Related Product SKUs');
});

test('stock CSV rejects invalid, negative, decimal, blank, and duplicate values without coercing them to zero', () => {
  const parsed = _test.parseStockCSV([
    'SKU,Stock',
    'GOOD-1,0',
    'BAD-TEXT,nope',
    'BAD-NEG,-1',
    'BAD-DEC,1.5',
    ',5',
    'GOOD-1,9',
  ].join('\n'));

  assert.deepEqual(parsed.fileErrors, []);
  assert.equal(parsed.rows[0].stock, 0);
  assert.equal(parsed.rows[0].errors.length, 0);
  assert.equal(parsed.rows[1].stock, null);
  assert.match(parsed.rows[1].errors.join(' '), /whole number/);
  assert.equal(parsed.rows[2].stock, null);
  assert.equal(parsed.rows[3].stock, null);
  assert.match(parsed.rows[4].errors.join(' '), /SKU is required/);
  assert.match(parsed.rows[5].errors.join(' '), /Duplicate SKU/);
});

test('Template V2 separates product and variant SKUs and resets carry between products', () => {
  const csv = [
    '\uFEFFProduct SKU,Variant SKU,English Name,Hook EN,Short Description EN,Material Care EN,Size,English Color,Material,Selling Price,Quantity,Collections,Meta Description',
    'BAG-01,BAG-01-BLK-S,City Bag,Made in Doha,Compact everyday bag,Wipe clean,S,Black,Leather,450,2,Bags|New Arrivals,"A compact, hand-finished bag"',
    ',BAG-01-BLK-M,,,,,M,,,450,0,,,',
    'SHOE-01,SHOE-01-TAN-40,Desert Shoe,Quiet luxury,Hand-finished shoe,Brush gently,40,Tan,Suede,650,4,Footwear,Premium suede shoe',
  ].join('\n');

  const rows = _test.csvToObjects(csv);

  assert.equal(rows.length, 3);
  assert.equal(rows[0].productSku, 'BAG-01');
  assert.equal(rows[1].productSku, 'BAG-01');
  assert.equal(rows[1].name, 'City Bag');
  assert.equal(rows[1].shortEn, 'Made in Doha');
  assert.equal(rows[1].teaserEn, 'Compact everyday bag');
  assert.equal(rows[1].qtyRaw, '0');
  assert.equal(rows[2].productSku, 'SHOE-01');
  assert.equal(rows[2].name, 'Desert Shoe');
  assert.equal(rows[2].shortEn, 'Quiet luxury');
  assert.equal(rows[2].teaserEn, 'Hand-finished shoe');
  assert.equal(rows[2].collection, 'Footwear');
});

test('legacy New SKU template remains readable', () => {
  const csv = [
    'New SKU,English Name,Size,Description,English Color,Arabic Name,Selling Price,quantity',
    'OLD-BLK-5,Legacy Product,5,Legacy description,Black,منتج قديم,100,3',
    'OLD-BLK-6,,6,,Black,,100,0',
  ].join('\n');

  const rows = _test.csvToObjects(csv);

  assert.equal(rows.length, 2);
  assert.equal(rows[0].variantSku, 'OLD-BLK-5');
  assert.equal(rows[1].name, 'Legacy Product');
  assert.equal(rows[1].descEn, 'Legacy description');
  assert.equal(rows[1].qtyRaw, '0');
});

test('CSV parser preserves quoted commas, Arabic, and pipe-separated lists', () => {
  const csv = [
    'Product SKU,Variant SKU,English Name,Arabic Name,Collections,Selling Price,Quantity',
    'SKU-1,SKU-1-ONE,"Bag, Limited Edition",حقيبة محدودة,"Bags|New, Special",1000,1',
  ].join('\r\n');

  const [row] = _test.csvToObjects(csv);

  assert.equal(row.name, 'Bag, Limited Edition');
  assert.equal(row.nameAr, 'حقيبة محدودة');
  assert.deepEqual(_test.splitPipeList(row.collection), ['Bags', 'New, Special']);
});

test('new imports default to hidden and only explicit active is accepted', () => {
  assert.equal(_test.importStatus('', 'hidden'), 'hidden');
  assert.equal(_test.importStatus('ACTIVE', 'hidden'), 'active');
  assert.equal(_test.importStatus('published', 'hidden'), 'hidden');
});

test('extractDriveId reads the id out of every Drive share-link shape', () => {
  assert.equal(_test.extractDriveId('https://drive.google.com/drive/folders/1AbC-XyZ?usp=drive_link'), '1AbC-XyZ');
  assert.equal(_test.extractDriveId('https://drive.google.com/file/d/1AbC-XyZ/view'), '1AbC-XyZ');
  assert.equal(_test.extractDriveId('https://drive.google.com/open?id=1AbC-XyZ&usp=drive_copy'), '1AbC-XyZ');
  assert.equal(_test.extractDriveId('https://example.com/not-drive.jpg'), null);
});

test('isDriveFolder skips the network call and reports false when no API key is configured', async () => {
  // No apiKey → must resolve false without attempting a request at all, so a
  // deployment missing GOOGLE_API_KEY degrades to "treat as a file" instead
  // of hanging or throwing.
  assert.equal(await _test.isDriveFolder('anything', null), false);
  assert.equal(await _test.isDriveFolder('anything', ''), false);
});

test('resolveImageUrls treats a bare URL with no recognizable Drive id as a direct image link', async () => {
  const resolved = await _test.resolveImageUrls('https://example.com/photo.jpg', null);
  assert.deepEqual(resolved, ['https://example.com/photo.jpg']);
});

test('resolveImageUrls falls back to single-file handling for an ambiguous "open?id=" link when no API key is set', async () => {
  // Without an API key there is no way to ask Drive whether the id is a
  // folder, so this must not hang or throw — it degrades to the pre-existing
  // "treat as one file" behavior (see the reported bug: an "open?id="
  // link that is actually a folder needs GOOGLE_API_KEY to be told apart).
  const resolved = await _test.resolveImageUrls('https://drive.google.com/open?id=SOME_ID&usp=drive_copy', null);
  assert.deepEqual(resolved, ['https://drive.google.com/uc?export=download&id=SOME_ID']);
});
