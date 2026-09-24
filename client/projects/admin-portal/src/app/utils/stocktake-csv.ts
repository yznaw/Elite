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

/** The parts of a stocktake the sheets need. Structural, so this file stays
    free of Angular and can be unit-tested under plain Node. */
export interface SheetLine {
  sku: string;
  barcode: string;
  productName: string;
  color: string;
  size: string;
  /** null while a blind count is open: the sheet must not reveal it. */
  expectedQuantity: number | null;
  /** The saved count of a stocktake without location runs (older stocktakes). */
  countedQuantity: number | null;
  locationCounts: Record<string, number>;
}

export interface SheetLocation {
  locationId: string;
  name: string;
}

export const ALL_LOCATIONS_TOTAL_HEADER = 'Total counted';

/**
 * One location's count sheet. Counted holds the SAVED count for that location
 * (blank = not counted yet, 0 = counted as zero), so exporting mid-count and
 * re-importing never loses or doubles a count. Expected is included only when
 * the stocktake is not blind.
 */
export function buildLocationSheet(lines: SheetLine[], location: SheetLocation | null, showExpected: boolean): unknown[][] {
  const expected = (line: SheetLine) => (showExpected ? [line.expectedQuantity ?? ''] : []);
  const expectedHeader = showExpected ? ['Expected'] : [];
  if (!location) {
    return [
      ['SKU', 'Barcode', 'Product', 'Color', 'Size', ...expectedHeader, 'Counted'],
      ...lines.map((line) => [line.sku, line.barcode, line.productName, line.color, line.size, ...expected(line), line.countedQuantity ?? '']),
    ];
  }
  return [
    ['Location ID', 'Location', 'SKU', 'Barcode', 'Product', 'Color', 'Size', ...expectedHeader, 'Counted'],
    ...lines.map((line) => [
      location.locationId, location.name, line.sku, line.barcode, line.productName, line.color, line.size,
      ...expected(line), line.locationCounts[location.locationId] ?? '',
    ]),
  ];
}

/**
 * Every location side by side, for review (not for import): one column per
 * location, the total, and Expected + Difference when the count is not blind.
 * Difference is left blank until at least one location has counted the item.
 */
export function buildAllLocationsSheet(lines: SheetLine[], locations: SheetLocation[], showExpected: boolean): unknown[][] {
  return [
    ['SKU', 'Barcode', 'Product', 'Color', 'Size', ...locations.map((l) => l.name), ALL_LOCATIONS_TOTAL_HEADER,
      ...(showExpected ? ['Expected', 'Difference'] : [])],
    ...lines.map((line) => {
      const counts = locations.map((l) => line.locationCounts[l.locationId]);
      const counted = counts.filter((c): c is number => typeof c === 'number');
      const total = counted.length ? counted.reduce((sum, c) => sum + c, 0) : '';
      const expected = line.expectedQuantity;
      return [
        line.sku, line.barcode, line.productName, line.color, line.size,
        ...counts.map((c) => c ?? ''), total,
        ...(showExpected ? [expected ?? '', total === '' || expected === null ? '' : total - expected] : []),
      ];
    }),
  ];
}

/** Parse a count sheet exported from Stocktake, or a simple SKU/Barcode + Counted sheet. */
export function parseStocktakeCountCsv(text: string, context: StocktakeCsvContext = {}): ParsedStocktakeCsv {
  const rows = parseCsv(text.replace(/^\uFEFF/, ''));
  if (rows.length < 2) throw new Error('The file must contain a header and at least one count row.');

  const headers = rows[0].map(normalize);
  if (headers.includes(normalize(ALL_LOCATIONS_TOTAL_HEADER))) {
    throw new Error('This is an all-locations sheet. Export a single location to import counts.');
  }
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
    const sku = skuIndex >= 0 ? unguard(String(row[skuIndex] ?? '').trim()) : '';
    const barcode = barcodeIndex >= 0 ? unguard(String(row[barcodeIndex] ?? '').trim()) : '';
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

/**
 * A text cell starting with = + - @ (or a tab / carriage return) is run as a
 * formula by Excel and Sheets. Product names are typed by staff, so text cells
 * get a leading apostrophe; numbers (counts, a negative difference) stay numbers.
 */
const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value: unknown): string {
  const text = typeof value === 'number' ? String(value) : String(value ?? '');
  const safe = typeof value !== 'number' && FORMULA_START.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

/** Reverse csvCell's guard so an exported SKU or barcode matches on import. */
function unguard(value: string): string {
  return value.startsWith("'") && FORMULA_START.test(value.slice(1)) ? value.slice(1) : value;
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
