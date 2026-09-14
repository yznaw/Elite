import { expect, test, type Page, type Route } from '@playwright/test';

// Product drawer variant lifecycle against a mocked API: deleting and adding
// sizes must keep the save bar honest, including edits made mid-save.

const user = {
  id: 'user-owner', name: 'Test Owner', initials: 'TO', email: 'owner@example.invalid',
  role: 'owner', tenantId: 'tenant-a', tenantSlug: 'test',
};

type Variant = { id: string; sku: string; barcode?: string; size: string; color: string; material: string; price: number; stock: number };

function makeVariants(): Variant[] {
  return ['Black', 'Brown'].flatMap(color => ['40', '41', '42'].map(size => ({
    id: `srv-${color}-${size}`,
    sku: `2775-LM-${color.slice(0, 2).toUpperCase()}-${size}`,
    size, color, material: '', price: 1050, stock: 0,
  })));
}

function product(variants: Variant[]) {
  return {
    id: 'prod-1', name: 'Earthy Classic Matt', sku: '2775-LM', brand: 'Elite', price: 1050,
    stock: variants.reduce((sum, v) => sum + v.stock, 0), hidden: false, posHidden: false,
    image: '', images: [], imageColors: {}, relatedProductIds: [], variants,
  };
}

async function prepare(page: Page) {
  const patches: { variants: Variant[] }[] = [];
  let holdPatch: (() => void) | null = null;
  let pendingRelease: Promise<void> | null = null;

  await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.abort());
  await page.route('**/api/**', async (route: Route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    const ok = (data: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data }) });

    if (pathname === '/api/auth/me') return ok(user);
    if (pathname === '/api/admin/products' && request.method() === 'GET') return ok([product(makeVariants())]);
    if (pathname === '/api/admin/products/prod-1' && request.method() === 'PATCH') {
      const body = request.postDataJSON() as { variants: Variant[] };
      patches.push(body);
      if (pendingRelease) await pendingRelease;
      // Server assigns real ids and defaults barcode to the SKU.
      return ok(product(body.variants.map(v => ({ ...v, id: `srv-${v.sku}`, barcode: v.barcode || v.sku }))));
    }
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

test('an unsaved empty row is removed without a confirm and the bar settles', async ({ page }) => {
  await prepare(page);
  await openDrawer(page);

  await page.locator('.vt-foot').getByRole('button', { name: /add variant/i }).click();
  const newRow = page.locator('.vcg--open .vc').last();
  await expect(newRow).toBeInViewport();
  await expect(saveBar(page)).toHaveClass(/dirty/);

  await newRow.locator('.vt-remove').click();
  await expect(saveBar(page)).not.toHaveClass(/dirty/);
});

test('saving with an incomplete added row points at that row', async ({ page }) => {
  const api = await prepare(page);
  await openDrawer(page);

  await page.locator('.vt-foot').getByRole('button', { name: /add variant/i }).click();
  await saveBar(page).getByRole('button', { name: /save/i }).click();

  await expect(page.locator('.vc--flash')).toBeVisible();
  await expect(page.locator('.vc--flash')).toBeInViewport();
  expect(api.patches).toHaveLength(0);
});
