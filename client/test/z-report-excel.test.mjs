import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import ExcelJS from 'exceljs';

// The builder is bundled on its own (Angular stays external and unused at
// runtime by fillZReportWorkbook), then run against the real exceljs.
const bundle = await build({
  stdin: {
    contents: "export { fillZReportWorkbook, zReportFileName } from './projects/admin-portal/src/app/services/z-report-excel.service';",
    resolveDir: fileURLToPath(new URL('..', import.meta.url)),
    loader: 'ts',
  },
  bundle: true, write: false, format: 'esm', platform: 'node', target: 'node20',
  external: ['@angular/*', 'rxjs', 'rxjs/*', 'exceljs'],
  tsconfig: fileURLToPath(new URL('../tsconfig.json', import.meta.url)),
});
// Written inside client/ so its bare imports resolve against node_modules.
const bundlePath = fileURLToPath(new URL('./.z-report-excel.bundle.mjs', import.meta.url));
writeFileSync(bundlePath, bundle.outputFiles[0].text);
let fillZReportWorkbook;
let zReportFileName;
try {
  ({ fillZReportWorkbook, zReportFileName } = await import(bundlePath));
} finally {
  rmSync(bundlePath, { force: true });
}

const report = {
  header: {
    zReportId: '3f1e2d3c-0000-4000-8000-000000000001', zNumber: 'Z-2109-2026-001', businessDate: '2026-09-21',
    branchName: 'Elite Collection AL Rayyan', registerName: 'Rayyan Till', staffNames: ['Marc', 'Salim'],
    closedAt: '2026-09-21T19:05:00.000Z', generatedAt: '2026-09-21T19:06:00.000Z',
  },
  items: [
    { sku: '3293-GNCCROC-CY-11.5', description: 'Croco Simple', color: 'Green', size: '11.5', soldQty: 2, returnQty: 1, netQty: 1, unitPriceCents: 180000, paymentMethod: 'card', totalCents: 180000 },
    { sku: '8824-BRWN-11', description: 'Mosaic Weave', color: 'Brown', size: '11', soldQty: 2, returnQty: 0, netQty: 2, unitPriceCents: 125000, paymentMethod: 'sadad', totalCents: 250000 },
  ],
  totals: { soldQty: 4, returnQty: 1, netQty: 3, totalCents: 430000 },
  byMethod: [{ method: 'card', totalCents: 180000 }, { method: 'sadad', totalCents: 250000 }],
};

test('Z-report workbook follows the shop layout and round-trips through xlsx', async () => {
  const workbook = new ExcelJS.Workbook();
  fillZReportWorkbook(workbook, report);
  const reread = new ExcelJS.Workbook();
  await reread.xlsx.load(await workbook.xlsx.writeBuffer());
  const sheet = reread.getWorksheet('Z-Report');
  const value = (ref) => sheet.getCell(ref).value;

  assert.equal(value('A2'), 'DAILY SALES REPORT (Z-REPORT)');
  assert.ok(sheet.getCell('J2').isMerged);
  assert.equal(value('B4'), 'Elite Collection AL Rayyan');
  assert.equal(value('B5'), 'Monday, September 21, 2026');
  assert.equal(value('B6'), 'Z-2109-2026-001');
  assert.equal(value('B7'), 'Marc, Salim');
  assert.match(String(value('B8')), /21 Sept? 2026, 22:06/);
  assert.deepEqual(sheet.getRow(10).values.slice(1), [
    'Item Code / SKU', 'Item Description', 'Color', 'Size', 'Sold Qty', 'Return Qty', 'Net Qty', 'Unit Price', 'Payment Method', 'Total',
  ]);
  assert.deepEqual(sheet.getRow(11).values.slice(1), ['3293-GNCCROC-CY-11.5', 'Croco Simple', 'Green', '11.5', 2, 1, 1, 1800, 'Card', 1800]);
  assert.deepEqual(sheet.getRow(12).values.slice(1), ['8824-BRWN-11', 'Mosaic Weave', 'Brown', '11', 2, 0, 2, 1250, 'Sadad', 2500]);
  assert.equal(sheet.getCell('H11').numFmt, '"QAR" #,##0.00');
  assert.equal(value('B13'), 'TOTALS');
  assert.deepEqual([value('E13'), value('F13'), value('G13'), value('J13')], [4, 1, 3, 4300]);
  assert.equal(value('I15'), 'By payment method');
  assert.deepEqual([value('I16'), value('J16'), value('I17'), value('J17')], ['Card', 1800, 'Sadad', 2500]);
});

test('an empty closing says so instead of an empty table', () => {
  const workbook = new ExcelJS.Workbook();
  fillZReportWorkbook(workbook, { ...report, items: [], byMethod: [], totals: { soldQty: 0, returnQty: 0, netQty: 0, totalCents: 0 } });
  const sheet = workbook.getWorksheet('Z-Report');
  assert.equal(sheet.getCell('A11').value, 'No sales or returns in this closing.');
  assert.equal(sheet.getCell('B12').value, 'TOTALS');
});

test('file name is the closing number, falling back to the id', () => {
  assert.equal(zReportFileName(report), 'Z-2109-2026-001.xlsx');
  assert.equal(zReportFileName({ ...report, header: { ...report.header, zNumber: null } }), 'z-report-3f1e2d3c.xlsx');
});
