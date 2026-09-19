import { expect, test, type Page, type Route } from '@playwright/test';

// Product drawer variant lifecycle against a mocked API: deleting and adding
// sizes must keep the save bar honest, including edits made mid-save.

const user = {
  id: 'user-owner', name: 'Test Owner', initials: 'TO', email: 'owner@example.invalid',
  role: 'owner', tenantId: 'tenant-a', tenantSlug: 'test',
};

type Variant = {
  id: string; sku: string; barcode?: string; barcodeSource?: 'auto' | 'manual';
  size: string; color: string; material: string; price: number; stock: number;
  costPrice?: number; shippingCost?: number;
};

function makeVariants(): Variant[] {
  return ['Black', 'Brown'].flatMap(color => ['40', '41', '42'].map(size => ({
    id: `srv-${color}-${size}`,
    sku: `2775-LM-${color.slice(0, 2).toUpperCase()}-${size}`,
    size, color, material: '', price: 1050, stock: 0,
  })));
}

function product(variants: Variant[], overrides: Record<string, unknown> = {}) {
  return {
    id: 'prod-1', name: 'Earthy Classic Matt', sku: '2775-LM', brand: 'Elite', price: 1050,
    stock: variants.reduce((sum, v) => sum + v.stock, 0), hidden: false, posHidden: false,
    image: '', images: [], imageColors: {}, relatedProductIds: [], variants,
    ...overrides,
  };
}

/** Enough products to need a second page (24 per page), priced so a new
    product (price 0) sorts last under "price high to low". */
function manyProducts() {
  return Array.from({ length: 30 }, (_, i) => product(makeVariants(), {
    id: `prod-${i + 1}`, name: `Catalog Product ${i + 1}`, sku: `CAT-${i + 1}`, price: 2000 - i,
  }));
}

async function prepare(page: Page, options: { products?: unknown[]; patchOverrides?: Record<string, unknown>; refs?: boolean } = {}) {
  const patches: { variants: Variant[] }[] = [];
  let holdPatch: (() => void) | null = null;
  let pendingRelease: Promise<void> | null = null;

  await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.abort());
  await page.route('**/api/**', async (route: Route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    const ok = (data: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data }) });

    if (pathname === '/api/auth/me') return ok(user);
    if (pathname === '/api/admin/products' && request.method() === 'GET') return ok(options.products ?? [product(makeVariants())]);
    if (pathname === '/api/admin/products/prod-1' && request.method() === 'PATCH') {
      const body = request.postDataJSON() as { variants: Variant[] };
      patches.push(body);
      if (pendingRelease) await pendingRelease;
      // Server assigns real ids and defaults barcode to the SKU.
      return ok(product(body.variants.map(v => ({ ...v, id: `srv-${v.sku}`, barcode: v.barcode || v.sku })), options.patchOverrides));
    }
    if (options.refs && pathname === '/api/admin/ref/colors') return ok([
      { id: 'c1', name_en: 'Black', name_ar: '', hex: '#1A1A1A', sort_order: 1 },
      { id: 'c2', name_en: 'Brown', name_ar: '', hex: '#8B4513', sort_order: 2 },
      { id: 'c3', name_en: 'Almond', name_ar: '', hex: '#EFDECD', sort_order: 3 },
    ]);
    if (options.refs && pathname === '/api/admin/ref/size-sets') return ok([{ id: 's1', name: 'Kids', sizes: ['13', '14', '15'] }]);
    if (pathname.startsWith('/api/admin/ref/') || pathname === '/api/admin/collections' || pathname.startsWith('/api/admin/restock-requests')) return ok([]);
    if (pathname === '/api/client-logs') return ok({ accepted: 1 });
    return ok({});
  });

  return {
    patches,
    holdNextPatch() { pendingRelease = new Promise<void>(resolve => { holdPatch = resolve; }); },
    releasePatch() { holdPatch?.(); pendingRelease = null; },
  };
}

async function openDrawer(page: Page) {
  await page.goto('/catalog');
  await page.locator('.prod-card').first().click();
  await expect(page.locator('.product-drawer')).toBeVisible();
}

const saveBar = (page: Page) => page.locator('ap-save-bar');

async function openGroup(page: Page, index: number) {
  const group = page.locator('.vcg').nth(index);
  if (!(await group.evaluate(el => el.classList.contains('vcg--open')))) await group.locator('.vcg-head').click();
  return group;
}

async function confirmDialog(page: Page) {
  // Scoped to the dialog: the row trash buttons are also labelled "Remove".
  const dialog = page.getByRole('dialog', { name: /remove this variant/i });
  await dialog.getByRole('button', { name: /^remove$/i }).click();
  await expect(dialog).toBeHidden();
}

test('deleting a saved size inside an open colour group keeps the save bar up', async ({ page }) => {
  await prepare(page);
  await openDrawer(page);
  const group = await openGroup(page, 0);

  await group.locator('.vt-remove').first().click();
  await confirmDialog(page);

  await expect(group.locator('.vc')).toHaveCount(2);
  await expect(saveBar(page)).toHaveClass(/dirty/);
});

test('a size deleted while a save is in flight stays unsaved', async ({ page }) => {
  const api = await prepare(page);
  await openDrawer(page);
  const group = await openGroup(page, 0);

  await group.locator('.vt-remove').first().click();
  await confirmDialog(page);
  api.holdNextPatch();
  await saveBar(page).getByRole('button', { name: /save/i }).click();
  await expect.poll(() => api.patches.length).toBe(1);

  // Delete another size before the first save returns.
  await group.locator('.vt-remove').first().click();
  await confirmDialog(page);
  api.releasePatch();

  await expect(saveBar(page)).toHaveClass(/dirty/);
  expect(api.patches[0].variants).toHaveLength(5);

  await saveBar(page).getByRole('button', { name: /save/i }).click();
  await expect.poll(() => api.patches.length).toBe(2);
  expect(api.patches[1].variants).toHaveLength(4);
  await expect(saveBar(page)).not.toHaveClass(/dirty/);
});

test('Add variant starts its own group, and cancelling it settles the bar without a confirm', async ({ page }) => {
  await prepare(page);
  await openDrawer(page);

  const addVariant = page.locator('.vt-foot').getByRole('button', { name: /add variant/i });
  await addVariant.click();
  const newGroup = page.locator('.vcg--new');
  await expect(newGroup).toHaveCount(1);
  await expect(page.locator('.vcg').first()).toHaveClass(/vcg--new/);
  await expect(newGroup.locator('.vcg-color-sel')).toBeFocused();
  await expect(saveBar(page)).toHaveClass(/dirty/);

  // A second click does not stack another blank variant.
  await addVariant.click();
  await expect(newGroup).toHaveCount(1);

  await newGroup.locator('.vt-remove').click();
  await expect(page.locator('.vcg--new')).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(saveBar(page)).not.toHaveClass(/dirty/);
});

test('saving a new variant without a colour points at it and sends nothing', async ({ page }) => {
  const api = await prepare(page);
  await openDrawer(page);

  await page.locator('.vt-foot').getByRole('button', { name: /add variant/i }).click();
  await saveBar(page).getByRole('button', { name: /save/i }).click();

  await expect(page.locator('.vcg--new')).toBeInViewport();
  await expect(page.locator('.vcg--new .vcg-color-sel')).toBeFocused();
  expect(api.patches).toHaveLength(0);
});

test('New product while sorted by price opens an empty product, not an existing one', async ({ page }) => {
  const api = await prepare(page, { products: manyProducts() });
  await page.goto('/catalog');
  await page.locator('select.ctrl-inp').first().selectOption('price-desc');
  await page.getByRole('button', { name: /new product/i }).first().click();

  const drawer = page.locator('.product-drawer');
  await expect(drawer).toBeVisible();
  await expect(drawer.locator('.card-title').first()).not.toHaveText(/Catalog Product/);
  expect(api.patches).toHaveLength(0);
});

test('saving a product that leaves the Active filter keeps the drawer on that product', async ({ page }) => {
  // The server answers the save with the product now hidden, so it no longer
  // matches the Active filter the catalog is showing.
  await prepare(page, { patchOverrides: { hidden: true } });
  await page.goto('/catalog');
  await page.locator('.status-pill').filter({ hasText: /^\s*active\s*$/i }).click();
  await page.locator('.prod-card').first().click();
  const drawer = page.locator('.product-drawer');
  const group = await openGroup(page, 0);
  await group.locator('.vt-remove').first().click();
  await confirmDialog(page);
  await saveBar(page).getByRole('button', { name: /save/i }).click();

  await expect(saveBar(page)).not.toHaveClass(/dirty/);
  await expect(drawer.locator('.card-title').first()).toHaveText('Earthy Classic Matt');
  await expect(drawer.locator('.vcg').first().locator('.vc')).toHaveCount(2);
});

test('the save bar follows the form on the very first change and on every delete', async ({ page }) => {
  await prepare(page);
  await openDrawer(page);
  // Read once, no auto-retry: a bar that only catches up on a later render is the bug.
  const barNow = async () => {
    await page.waitForTimeout(150);
    return saveBar(page).evaluate(el => el.classList.contains('dirty'));
  };

  await page.locator('.vt-foot').getByRole('button', { name: /add variant/i }).click();
  expect(await barNow()).toBe(true);

  const group = await openGroup(page, 1);
  await group.locator('.vt-remove').first().click();
  await confirmDialog(page);
  expect(await barNow()).toBe(true);

  await page.locator('.vcg--new .vt-remove').click();
  expect(await barNow()).toBe(true);
  await saveBar(page).getByRole('button', { name: /discard/i }).click();
  expect(await barNow()).toBe(false);
});

test('Add variant keeps older colourless rows out of the new variant', async ({ page }) => {
  const legacy = [
    { id: 'srv-old-13', sku: '2775-LM-AL-13', size: '13', color: '', material: '', price: 1050, stock: 0 },
    { id: 'srv-old-new', sku: '2775-LM-NEW', size: '9', color: '', material: '', price: 1050, stock: 0 },
  ];
  await prepare(page, { products: [product([...makeVariants(), ...legacy])] });
  await openDrawer(page);

  await page.locator('.vt-foot').getByRole('button', { name: /add variant/i }).click();
  const newGroup = page.locator('.vcg--new');
  await expect(newGroup).toHaveCount(1);
  await expect(newGroup.locator('.vc')).toHaveCount(0);
  await expect(newGroup).not.toContainText('2775-LM-AL-13');
  // The existing "no colour" group is still there, still closed, with its own rows.
  const noColour = page.locator('.vcg[data-group-key="__none__"]');
  await expect(noColour).toHaveCount(1);
  await expect(noColour).not.toHaveClass(/vcg--open/);
});

test('colour first, then sizes one at a time, and no blank row is saved', async ({ page }) => {
  const api = await prepare(page, { refs: true });
  await openDrawer(page);

  await page.locator('.vt-foot').getByRole('button', { name: /add variant/i }).click();
  await page.locator('.vcg--new .vcg-color-sel').selectOption('Almond');
  await expect(page.locator('.vcg--new')).toHaveCount(0);

  const almond = page.locator('.vcg[data-group-key="almond"]');
  await expect(almond).toHaveClass(/vcg--open/);
  await expect(almond.locator('.vc.vc--grouped')).toHaveCount(1);
  await almond.locator('.vc.vc--grouped').first().locator('.vc-cell--size select').selectOption('13');

  await almond.getByRole('button', { name: /^\s*size\s*$/i }).click();
  await expect(almond.locator('.vc.vc--grouped')).toHaveCount(2);
  await almond.locator('.vc.vc--grouped').last().locator('.vc-cell--size select').selectOption('14');
  await almond.locator('.vcg-sku-field input').fill('2775-LM-AL');

  await saveBar(page).getByRole('button', { name: /save/i }).click();
  await expect.poll(() => api.patches.length).toBe(1);
  const added = api.patches[0].variants.filter(v => v.color === 'Almond');
  expect(added.map(v => [v.size, v.sku])).toEqual([['13', '2775-LM-AL-13'], ['14', '2775-LM-AL-14']]);
  expect(api.patches[0].variants.every(v => String(v.size).trim())).toBe(true);
});

test('a row without a size blocks saving and is pointed at', async ({ page }) => {
  const sizeless = { id: 'srv-new', sku: '2775-LM-NEW', size: '', color: 'Black', material: '', price: 1050, stock: 0 };
  const api = await prepare(page, { products: [product([...makeVariants(), sizeless])] });
  await openDrawer(page);

  // Make an unrelated change so there is something to save.
  const brown = await openGroup(page, 1);
  await brown.locator('.vt-remove').first().click();
  await confirmDialog(page);
  await saveBar(page).getByRole('button', { name: /save/i }).click();

  await expect(page.locator('[data-variant-id="srv-new"]')).toHaveClass(/vc--flash/);
  expect(api.patches).toHaveLength(0);
});

test('changing product SKU rekeys prefixed variants and their automatic barcodes', async ({ page }) => {
  const variants = makeVariants().map(v => ({ ...v, barcode: v.sku, barcodeSource: 'auto' as const }));
  const api = await prepare(page, { products: [product(variants, { duplicatedFromProductId: 'source-product' })] });
  await openDrawer(page);

  const skuField = page.locator('label.lbl').filter({ hasText: /^SKU$/ }).locator('..').locator('input');
  await skuField.fill('3336');
  await saveBar(page).getByRole('button', { name: /save/i }).click();

  await expect.poll(() => api.patches.length).toBe(1);
  expect(api.patches[0].variants.map(v => v.sku)).toEqual([
    '3336-BL-40', '3336-BL-41', '3336-BL-42',
    '3336-BR-40', '3336-BR-41', '3336-BR-42',
  ]);
  expect(api.patches[0].variants.every(v => v.barcode === v.sku && v.barcodeSource === 'auto')).toBe(true);
});

test('product cost defaults fill blank variants in one edit', async ({ page }) => {
  const api = await prepare(page);
  await openDrawer(page);

  await page.getByText('Default product cost (QAR)', { exact: true }).locator('..').locator('input').fill('120.5');
  await page.getByText('Default shipping cost (QAR)', { exact: true }).locator('..').locator('input').fill('15');
  await saveBar(page).getByRole('button', { name: /save/i }).click();

  await expect.poll(() => api.patches.length).toBe(1);
  expect(api.patches[0].variants.every(v => v.costPrice === 120.5 && v.shippingCost === 15)).toBe(true);
});
