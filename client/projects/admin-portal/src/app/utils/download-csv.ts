import { csvRows } from './stocktake-csv';

/**
 * Downloads rows as a CSV that opens correctly in Excel: UTF-8 BOM (Arabic
 * names) and every cell escaped and guarded against formula injection
 * (csvRows / csvCell).
 */
export function downloadCsv(filename: string, rows: unknown[][]): void {
  const blob = new Blob([csvRows(rows)], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function todayStamp(): string {
  return new Date().toISOString().slice(0, 10);
}
