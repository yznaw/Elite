export interface StocktakeCsvContext {
  locationId?: string;
  locationName?: string;
}

export interface StocktakeCsvCount {
  sku: string;
  barcode: string;
  quantity: number;
}

export interface ParsedStocktakeCsv {
  counts: StocktakeCsvCount[];
  skipped: number;
}

/** Parse a count sheet exported from Stocktake, or a simple SKU/Barcode + Counted sheet. */
export function parseStocktakeCountCsv(text: string, context: StocktakeCsvContext = {}): ParsedStocktakeCsv {
  const rows = parseCsv(text.replace(/^\uFEFF/, ''));
  if (rows.length < 2) throw new Error('The file must contain a header and at least one count row.');

  const headers = rows[0].map(normalize);
  const skuIndex = headers.indexOf('sku');
  const barcodeIndex = headers.indexOf('barcode');
  const countIndex = findHeader(headers, ['counted', 'count', 'quantity']);
  const locationIdIndex = findHeader(headers, ['location id', 'locationid']);
  const locationIndex = findHeader(headers, ['location']);
  if ((skuIndex < 0 && barcodeIndex < 0) || countIndex < 0) {
    throw new Error('Use columns SKU or Barcode and Counted (or Count/Quantity).');
  }

  validateLocation(rows.slice(1), locationIdIndex, locationIndex, context);

  const counts: StocktakeCsvCount[] = [];
  let skipped = 0;
  for (const row of rows.slice(1)) {
    const sku = skuIndex >= 0 ? String(row[skuIndex] ?? '').trim() : '';
    const barcode = barcodeIndex >= 0 ? String(row[barcodeIndex] ?? '').trim() : '';
    const rawQuantity = String(row[countIndex] ?? '').trim();
    if ((!sku && !barcode) || !/^\d+$/.test(rawQuantity)) {
      skipped++;
      continue;
    }
    const quantity = Number(rawQuantity);
    if (!Number.isSafeInteger(quantity)) {
      skipped++;
      continue;
    }
    counts.push({ sku, barcode, quantity });
  }
  return { counts, skipped };
}

export function csvCell(value: unknown): string {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

export function csvRows(rows: unknown[][]): string {
  return '\uFEFF' + rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
}

function validateLocation(
  rows: string[][],
  locationIdIndex: number,
  locationIndex: number,
  context: StocktakeCsvContext,
): void {
  const firstDataRow = rows.find((row) => row.some((value) => value.trim()));
  if (!firstDataRow) return;
  const fileLocationId = locationIdIndex >= 0 ? normalize(firstDataRow[locationIdIndex]) : '';
  const fileLocation = locationIndex >= 0 ? normalize(firstDataRow[locationIndex]) : '';
  if (fileLocationId && context.locationId && fileLocationId !== normalize(context.locationId)) {
    throw new Error('This CSV belongs to another stocktake location. Select that location before importing it.');
  }
  if (!fileLocationId && fileLocation && context.locationName && fileLocation !== normalize(context.locationName)) {
    throw new Error('This CSV belongs to another stocktake location. Select that location before importing it.');
  }
}

function findHeader(headers: string[], candidates: string[]): number {
  return candidates.map((name) => headers.indexOf(name)).find((index) => index >= 0) ?? -1;
}

function normalize(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') { cell += '"'; i++; }
      else quoted = !quoted;
    } else if (char === ',' && !quoted) {
      row.push(cell); cell = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
    } else {
      cell += char;
    }
  }
  row.push(cell);
  if (row.some((value) => value.trim())) rows.push(row);
  return rows;
}
