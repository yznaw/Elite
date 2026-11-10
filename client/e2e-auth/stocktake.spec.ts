import { readFileSync } from 'node:fs';
import { expect, test, type Page, type Route } from '@playwright/test';

// Stocktake counting against a mocked API (team feedback 2026-09-24: exported
// Counted column was empty because typed counts were never saved).

const user = {
  id: 'user-owner', name: 'Test Owner', initials: 'TO', email: 'owner@example.invalid',
  role: 'owner', tenantId: 'tenant-a', tenantSlug: 'test',
};
const locations = [
  { locationId: 'loc-r', branchId: 'b1', name: 'Al Rayyan Shop', type: 'store' },
  { locationId: 'loc-p', branchId: 'b2', name: 'The Pearl Shop', type: 'store' },
  { locationId: 'loc-w', branchId: null, name: 'Warehouse', type: 'warehouse' },
];
const sizes = ['5', '5.5', '10'];

type Mock = {
  counts: { variantId: string; quantity: unknown; locationId?: string }[];
  failNext: number;
  holdNext: boolean;
  release?: () => void;
  state: Record<string, Record<string, number>>;
  completed: Set<string>;
};

async function prepare(page: Page, options: { completed?: string[]; blind?: boolean } = {}): Promise<Mock> {
  const mock: Mock = { counts: [], failNext: 0, holdNext: false, state: {}, completed: new Set(options.completed ?? []) };
  const detail = () => ({
    stocktakeId: 'st-1', reference: 'September count', status: 'counting', blind: !!options.blind, note: null,
    startedAt: '2026-09-24T08:00:00Z', postedAt: null, startedByName: 'Test Owner',
    locations: locations.map((l) => ({
      ...l, status: mock.completed.has(l.locationId) ? 'completed' : 'counting',
      countedCount: Object.values(mock.state).filter((c) => c[l.locationId] !== undefined).length,
    })),
    lines: sizes.map((size) => ({
      variantId: `v-${size}`, sku: `CR-GR-${size}`, barcode: `CR-GR-${size}`, productName: 'Croco Simple',
      color: 'Green', size, variant: `Green / ${size}`, expectedQuantity: options.blind ? null : 4,
      countedQuantity: null, recountQuantity: null, currentStock: options.blind ? null : 4, discrepancy: null,
      countedAt: null, note: null, locationCounts: mock.state[`v-${size}`] ?? {},
    })),
  });

  await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, (route) => route.abort());
  await page.route('**/api/**', async (route: Route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const ok = (data: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data }) });

    if (path === '/api/auth/me') return ok(user);
    if (path === '/api/admin/inventory/stocktake-locations') return ok(locations);
    if (path === '/api/admin/inventory/stocktakes' && request.method() === 'GET') {
      return ok([{ stocktakeId: 'st-1', reference: 'September count', status: 'counting', blind: !!options.blind, note: null, startedAt: '2026-09-24T08:00:00Z', postedAt: null, lineCount: 3, countedCount: 0 }]);
    }
    if (path === '/api/admin/inventory/stocktakes/st-1') return ok(detail());
    if (path === '/api/admin/inventory/stocktakes/st-1/counts') {
      const body = request.postDataJSON() as { variantId: string; quantity: number; locationId?: string };
      mock.counts.push(body);
      if (mock.holdNext) {
        mock.holdNext = false;
        await new Promise<void>((resolve) => { mock.release = resolve; });
      }
      if (mock.failNext > 0) {
        mock.failNext--;
        return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ success: false, message: 'boom' }) });
      }
      mock.state[body.variantId] = { ...(mock.state[body.variantId] ?? {}), [body.locationId ?? '']: Number(body.quantity) };
      return ok({ stocktakeId: 'st-1', variantId: body.variantId, quantity: body.quantity, recount: false });
    }
    if (path === '/api/client-logs') return ok({ accepted: 1 });
    return ok({});
  });
  await page.goto('/stocktake');
  await expect(page.locator('input.count-field')).toHaveCount(3);
  return mock;
}

const field = (page: Page, size: string) => page.locator(`input.count-field[data-variant="v-${size}"]`);
const rowState = (page: Page, size: string) => field(page, size).locator('xpath=following-sibling::span[contains(@class,"row-state")]');
const guard = (page: Page) => page.getByRole('dialog');

test('Enter saves the count, shows Saved, and moves to the next row', async ({ page }) => {
  const mock = await prepare(page);
  await field(page, '5').fill('3');
  await field(page, '5').press('Enter');
  await expect(rowState(page, '5')).toContainText('Saved');
  await expect(field(page, '5.5')).toBeFocused();
  expect(mock.counts).toEqual([{ variantId: 'v-5', quantity: 3, locationId: 'loc-r' }]);
  await expect(page.locator('.count-row').first()).toContainText('Counted 3');
});

test('leaving the field saves too, and only once', async ({ page }) => {
  const mock = await prepare(page);
  await field(page, '10').fill('2');
  await field(page, '5').click();
  await expect(rowState(page, '10')).toContainText('Saved');
  expect(mock.counts.map((c) => c.quantity)).toEqual([2]);
});

test('an invalid count is flagged on the row and never sent', async ({ page }) => {
  const mock = await prepare(page);
  for (const bad of ['-1', '1.5', 'abc']) {
    await field(page, '5').fill(bad);
    await field(page, '5').press('Enter');
    await expect(rowState(page, '5')).toContainText('Whole number only');
  }
  await expect(field(page, '5')).toHaveAttribute('aria-invalid', 'true');
  expect(mock.counts).toEqual([]);
});

test('a failed save keeps the number and Retry stores it', async ({ page }) => {
  const mock = await prepare(page);
  mock.failNext = 1;
  await field(page, '5').fill('6');
  await field(page, '5').press('Enter');
  await expect(rowState(page, '5')).toContainText('Not saved');
  await expect(field(page, '5')).toHaveValue('6');
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(rowState(page, '5')).toContainText('Saved');
  expect(mock.counts.map((c) => c.quantity)).toEqual([6, 6]);
});

test('a number typed during a save wins, sent after it in order', async ({ page }) => {
  const mock = await prepare(page);
  mock.holdNext = true;
  await field(page, '5').fill('3');
  await field(page, '5').press('Enter');
  await expect(rowState(page, '5')).toContainText('Saving');
  await field(page, '5').fill('4');
  await field(page, '5').press('Enter');
  mock.release?.();
  await expect(rowState(page, '5')).toContainText('Saved');
  expect(mock.counts.map((c) => c.quantity)).toEqual([3, 4]);
  await expect(page.locator('.count-row').first()).toContainText('Counted 4');
});

test('unsaved counts are listed and Save all stores them', async ({ page }) => {
  const mock = await prepare(page);
  // Typed but never committed (no Enter, no leaving the field).
  await field(page, '5').pressSequentially('1');
  await field(page, '5.5').evaluate((el: HTMLInputElement) => { el.value = '2'; el.dispatchEvent(new Event('input')); });
  await expect(page.locator('.unsaved-bar')).toContainText('2');
  await page.getByRole('button', { name: 'Save all' }).click();
  await expect(page.locator('.unsaved-bar')).toHaveCount(0);
  expect(mock.counts.map((c) => [c.variantId, c.quantity]).sort()).toEqual([['v-5', 1], ['v-5.5', 2]]);
});

test('exporting with an unsaved count asks first; Cancel exports nothing, Save and continue exports the count', async ({ page }) => {
  const mock = await prepare(page);
  await field(page, '5').evaluate((el: HTMLInputElement) => { el.value = '7'; el.dispatchEvent(new Event('input')); });

  await page.getByRole('button', { name: 'Export this location' }).click();
  await expect(guard(page)).toContainText('not saved yet');
  await guard(page).getByRole('button', { name: /cancel/i }).click();
  expect(mock.counts).toEqual([]);

  await page.getByRole('button', { name: 'Export this location' }).click();
  const download = page.waitForEvent('download');
  await guard(page).getByRole('button', { name: 'Save and continue' }).click();
  const csv = readFileSync(await (await download).path(), 'utf8');
  expect(mock.counts).toEqual([{ variantId: 'v-5', quantity: 7, locationId: 'loc-r' }]);
  const lines = csv.replace(/^﻿/, '').split('\r\n');
  expect(lines[0]).toBe('"Location ID","Location","SKU","Barcode","Product","Color","Size","Expected","Counted"');
  expect(lines[1]).toBe('"loc-r","Al Rayyan Shop","CR-GR-5","CR-GR-5","Croco Simple","Green","5","4","7"');
  expect(lines[2].endsWith('"4",""'), 'uncounted stays blank, not zero').toBe(true);
});

test('Export all locations puts every location side by side with the total', async ({ page }) => {
  const mock = await prepare(page);
  mock.state['v-5'] = { 'loc-r': 2, 'loc-p': 1, 'loc-w': 0 };
  await page.reload();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export all locations' }).click();
  const lines = readFileSync(await (await download).path(), 'utf8').replace(/^﻿/, '').split('\r\n');
  expect(lines[0]).toBe('"SKU","Barcode","Product","Color","Size","Al Rayyan Shop","The Pearl Shop","Warehouse","Total counted","Expected","Difference"');
  expect(lines[1]).toBe('"CR-GR-5","CR-GR-5","Croco Simple","Green","5","2","1","0","3","4","-1"');
});

test('a blind count never puts Expected in the file', async ({ page }) => {
  await prepare(page, { blind: true });
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export this location' }).click();
  const header = readFileSync(await (await download).path(), 'utf8').replace(/^﻿/, '').split('\r\n')[0];
  expect(header).not.toContain('Expected');
});

test('switching location with an unsaved count asks first', async ({ page }) => {
  await prepare(page);
  await field(page, '5').evaluate((el: HTMLInputElement) => { el.value = '5'; el.dispatchEvent(new Event('input')); });
  const picker = page.locator('ap-location-selector select');
  await picker.selectOption('loc-p');
  await expect(guard(page)).toContainText('not saved yet');
  await guard(page).getByRole('button', { name: /cancel/i }).click();
  await expect(field(page, '5')).toHaveValue('5');
  await expect(picker, 'the picker goes back to the location still being counted').toHaveValue('loc-r');
});

test('leaving the page with an unsaved count asks first; Cancel stays', async ({ page }) => {
  await prepare(page);
  await field(page, '5').evaluate((el: HTMLInputElement) => { el.value = '9'; el.dispatchEvent(new Event('input')); });
  await page.locator('a[href="/dashboard"], a[href="/"]').first().click();
  await expect(guard(page)).toContainText('not saved yet');
  await guard(page).getByRole('button', { name: /cancel/i }).click();
  await expect(page).toHaveURL(/\/stocktake/);
  await expect(field(page, '5')).toHaveValue('9');
});

test('a completed location is read-only and sends nothing', async ({ page }) => {
  const mock = await prepare(page, { completed: ['loc-r', 'loc-p', 'loc-w'] });
  await expect(field(page, '5')).toBeDisabled();
  expect(mock.counts).toEqual([]);
});

const sheet = (rows: string[][]) => ({
  name: 'counts.csv', mimeType: 'text/csv',
  buffer: Buffer.from('﻿' + rows.map((r) => r.map((c) => `"${c}"`).join(',')).join('\r\n')),
});
const header = ['Location ID', 'Location', 'SKU', 'Barcode', 'Product', 'Color', 'Size', 'Expected', 'Counted'];

test('re-importing an exported sheet sends only the rows that changed', async ({ page }) => {
  const mock = await prepare(page);
  mock.state['v-5'] = { 'loc-r': 2 };
  mock.state['v-5.5'] = { 'loc-r': 1 };
  await page.reload();
  await page.locator('input[type="file"]').setInputFiles(sheet([
    header,
    ['loc-r', 'Al Rayyan Shop', 'CR-GR-5', 'CR-GR-5', 'Croco Simple', 'Green', '5', '4', '2'],
    ['loc-r', 'Al Rayyan Shop', 'CR-GR-5.5', 'CR-GR-5.5', 'Croco Simple', 'Green', '5.5', '4', '3'],
    ['loc-r', 'Al Rayyan Shop', 'CR-GR-10', 'CR-GR-10', 'Croco Simple', 'Green', '10', '4', ''],
  ]));
  await expect(page.locator('.toast')).toContainText('1 updated · 1 unchanged · 1 skipped');
  expect(mock.counts).toEqual([{ variantId: 'v-5.5', quantity: 3, locationId: 'loc-r' }]);
});

test('importing with an unsaved count asks first, and an all-locations sheet is refused', async ({ page }) => {
  const mock = await prepare(page);
  await field(page, '5').evaluate((el: HTMLInputElement) => { el.value = '8'; el.dispatchEvent(new Event('input')); });
  await page.locator('input[type="file"]').setInputFiles(sheet([header, ['loc-r', 'Al Rayyan Shop', 'CR-GR-10', 'CR-GR-10', 'Croco Simple', 'Green', '10', '4', '1']]));
  await expect(guard(page)).toContainText('not saved yet');
  await guard(page).getByRole('button', { name: /cancel/i }).click();
  expect(mock.counts).toEqual([]);

  await field(page, '5').press('Enter');
  await expect(rowState(page, '5')).toContainText('Saved');
  await page.locator('input[type="file"]').setInputFiles(sheet([
    ['SKU', 'Barcode', 'Product', 'Color', 'Size', 'Al Rayyan Shop', 'Warehouse', 'Total counted'],
    ['CR-GR-10', 'CR-GR-10', 'Croco Simple', 'Green', '10', '1', '2', '3'],
  ]));
  await expect(page.locator('.toast')).toContainText('all-locations sheet');
  expect(mock.counts).toEqual([{ variantId: 'v-5', quantity: 8, locationId: 'loc-r' }]);
});
