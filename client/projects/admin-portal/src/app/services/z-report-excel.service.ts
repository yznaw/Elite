import { Injectable } from '@angular/core';
import type { Workbook } from 'exceljs';
import { POS_PAYMENT_LABELS } from './pos-payment';
import type { PosZReportItems } from './pos.service';

const MONEY = '"QAR" #,##0.00';
const COLUMNS = [
  { header: 'Item Code / SKU', width: 24 },
  { header: 'Item Description', width: 30 },
  { header: 'Color', width: 14 },
  { header: 'Size', width: 8 },
  { header: 'Sold Qty', width: 10 },
  { header: 'Return Qty', width: 11 },
  { header: 'Net Qty', width: 9 },
  { header: 'Unit Price', width: 15 },
  { header: 'Payment Method', width: 16 },
  { header: 'Total', width: 17 },
];

function longDate(isoDate: string | null): string {
  if (!isoDate) return '';
  const [y, m, d] = isoDate.split('-').map(Number);
  // Built and formatted in UTC so the calendar day never shifts with the
  // viewer's timezone.
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

function qatarDateTime(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Qatar',
  }).format(new Date(iso));
}

/**
 * Lays out one closing as the shop's "Daily Sales Report (Z-Report)" sheet:
 * title, header block, one row per item line, totals, then the split by
 * payment method so the file reconciles with the printed Z. Kept free of
 * Angular so it can be tested under plain Node with the same exceljs.
 */
export function fillZReportWorkbook(workbook: Workbook, report: PosZReportItems): void {
  const sheet = workbook.addWorksheet('Z-Report', {
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  sheet.columns = COLUMNS.map((c) => ({ width: c.width }));

  sheet.mergeCells('A2:J2');
  const title = sheet.getCell('A2');
  title.value = 'DAILY SALES REPORT (Z-REPORT)';
  title.font = { bold: true, size: 16 };
  title.alignment = { horizontal: 'center' };

  const { header } = report;
  const headerRows: Array<[string, string]> = [
    ['Branch Name:', header.branchName || header.registerName || ''],
    ['Daily Sales Date:', longDate(header.businessDate)],
    ['Z-Report / Closing Number:', header.zNumber || header.zReportId],
    ['Cashier / Staff:', header.staffNames.join(', ')],
    ['Report Generated:', qatarDateTime(header.generatedAt)],
  ];
  headerRows.forEach(([label, value], index) => {
    const row = 4 + index;
    sheet.getCell(`A${row}`).value = label;
    sheet.getCell(`A${row}`).font = { bold: true };
    sheet.mergeCells(`B${row}:F${row}`);
    sheet.getCell(`B${row}`).value = value;
  });

  const tableHeader = sheet.getRow(10);
  tableHeader.values = COLUMNS.map((c) => c.header);
  tableHeader.font = { bold: true };
  tableHeader.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EFEC' } };
    cell.border = { bottom: { style: 'thin' } };
    cell.alignment = { vertical: 'middle', wrapText: true };
  });

  let rowNumber = 11;
  if (!report.items.length) {
    sheet.mergeCells(`A${rowNumber}:J${rowNumber}`);
    sheet.getCell(`A${rowNumber}`).value = 'No sales or returns in this closing.';
    sheet.getCell(`A${rowNumber}`).font = { italic: true };
    rowNumber++;
  }
  for (const item of report.items) {
    const row = sheet.getRow(rowNumber++);
    row.values = [
      item.sku, item.description, item.color || '', item.size || '',
      item.soldQty, item.returnQty, item.netQty,
      item.unitPriceCents / 100, POS_PAYMENT_LABELS[item.paymentMethod] ?? item.paymentMethod,
      item.totalCents / 100,
    ];
    row.getCell(8).numFmt = MONEY;
    row.getCell(10).numFmt = MONEY;
  }

  const totals = sheet.getRow(rowNumber);
  totals.values = [
    '', 'TOTALS', '', '', report.totals.soldQty, report.totals.returnQty, report.totals.netQty, '', '',
    report.totals.totalCents / 100,
  ];
  totals.font = { bold: true };
  totals.getCell(10).numFmt = MONEY;
  totals.eachCell({ includeEmpty: true }, (cell) => { cell.border = { top: { style: 'thin' } }; });

  rowNumber += 2;
  sheet.getCell(`I${rowNumber}`).value = 'By payment method';
  sheet.getCell(`I${rowNumber}`).font = { bold: true };
  for (const entry of report.byMethod) {
    rowNumber++;
    sheet.getCell(`I${rowNumber}`).value = POS_PAYMENT_LABELS[entry.method] ?? entry.method;
    const cell = sheet.getCell(`J${rowNumber}`);
    cell.value = entry.totalCents / 100;
    cell.numFmt = MONEY;
  }
}

export function zReportFileName(report: PosZReportItems): string {
  const name = report.header.zNumber || `z-report-${report.header.zReportId.slice(0, 8)}`;
  return `${name.replace(/[^A-Za-z0-9-]/g, '')}.xlsx`;
}

@Injectable({ providedIn: 'root' })
export class ZReportExcelService {
  /** exceljs is loaded only when a download is asked for, so it never weighs
      on the POS bundle or its offline precache. */
  async download(report: PosZReportItems): Promise<void> {
    const { default: ExcelJS } = await import('exceljs');
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Elite Collection';
    workbook.created = new Date(report.header.generatedAt);
    fillZReportWorkbook(workbook, report);
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = zReportFileName(report);
    link.click();
    // Revoked on the next tick: some browsers start the save asynchronously.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}
