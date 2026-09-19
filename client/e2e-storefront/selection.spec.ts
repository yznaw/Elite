import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * Colour and size selection on the collection card and the product page, and the overlays
 * that sit on top of them. Written against the scenario matrix in the storefront selection
 * plan: each test names the scenarios it covers (D = collection desktop, M = collection
 * phone, P = product page).
 *
 * `/api/products` is replaced with one fixture product whose stock the assertions depend on:
 *
 *   Black  40 41 42 in stock, 43 sold out
 *   Brown  40 42 in stock,    41 sold out
 *   Sand   40 41 sold out (the whole colour)
 */
const ID = '6f1c2a90-1b2c-4d3e-8f40-5a6b7c8d9e01';
const SLUG = 'selection-test-sandal';
const art = '/assets/hero-scroll/elite-hero-sandals-cutout.png';

const stock: Record<string, Record<number, number>> = {
  Black: { 40: 3, 41: 2, 42: 4, 43: 0 },
  Brown: { 40: 1, 41: 0, 42: 2 },
  Sand: { 40: 0, 41: 0 },
};
const variantId = (color: string, size: number) =>
  `6f1c2a90-1b2c-4d3e-8f40-${color === 'Black' ? 'b' : color === 'Brown' ? 'c' : 'd'}${String(size).padStart(11, '0')}`;

const product = {
  id: ID,
  slug: SLUG,
  name: 'Selection Test Sandal',
  nameAr: '',
  brand: 'Elite',
  price: 950,
  tag: '',
  leather: '',
  style: '',
  sizes: [40, 41, 42, 43],
  colors: ['Black', 'Brown', 'Sand'],
  materials: [],
  image: art,
  images: [art],
  colorImages: {},
  stock: 12,
  variants: Object.entries(stock).flatMap(([color, sizes]) =>
    Object.entries(sizes).map(([size, qty]) => ({
      id: variantId(color, Number(size)),
      sku: `SEL-${color}-${size}`,
      size: Number(size),
      color,
      material: '',
      price: 950,
      stock: qty,
      isActive: true,
    })),
  ),
  relatedProductIds: [],
};

type CartAdd = { productId: string; variantId?: string | null; color?: string | null; size?: number | string };

async function useFixture(page: Page): Promise<CartAdd[]> {
  const adds: CartAdd[] = [];
  const json = (route: Route, data: unknown) => route.fulfill({ json: { success: true, data } });
  await page.route((url) => url.pathname === '/api/products', (route) => json(route, [product]));
  await page.route(
    (url) => url.pathname === `/api/products/${SLUG}` || url.pathname === `/api/products/${ID}`,
    (route) => json(route, product),
  );
  await page.route((url) => url.pathname === '/api/carts/current', (route) => json(route, { id: 'cart', subtotal: 0, items: [] }));
  await page.route((url) => url.pathname === '/api/carts/current/items', async (route) => {
    const body = route.request().postDataJSON() as CartAdd;
    adds.push(body);
    await json(route, {
      id: 'cart',
      subtotal: 950,
      items: [{ id: ID, variantId: body.variantId, name: product.name, price: 950, color: body.color, size: Number(body.size), qty: 1, image: art }],
    });
  });
  return adds;
}

// ── Collection card helpers ───────────────────────────────────────────────────
const card = (page: Page) => page.locator('.product-cell').filter({ hasText: product.name });
const swatch = (page: Page, color: string) => card(page).locator(`.product-color-swatch[title="${color}"]`);
const selectedColor = (page: Page) => card(page).locator('.product-color-swatch.is-selected').getAttribute('title');
const sizeSelect = (page: Page) => card(page).locator('select.size-select');
const shownSize = (page: Page) => sizeSelect(page).evaluate((el: HTMLSelectElement) => el.selectedOptions[0]?.textContent?.trim() ?? '');
const cta = (page: Page) => card(page).locator('.quick-add').first();

async function gotoCollection(page: Page, width: number, height: number) {
  await page.setViewportSize({ width, height });
  await page.goto('/collection/all-products');
  await expect(card(page)).toBeVisible({ timeout: 30_000 });
}

/** Moves the pointer somewhere with no card under it. */
const pointerAway = (page: Page) => page.mouse.move(2, 2);

test.describe('collection card, desktop', () => {
  test.beforeEach(async ({ page }) => {
    await useFixture(page);
    await gotoCollection(page, 1400, 900);
  });

  test('D1 D3 D4 D14: clicked colour and in-stock size survive leaving the card, previews and a sold-out colour', async ({ page }) => {
    await swatch(page, 'Black').click();
    await sizeSelect(page).selectOption('42');
    await pointerAway(page);
    expect(await selectedColor(page)).toBe('Black');
    await expect.poll(() => shownSize(page)).toBe('42');

    // D4: a hover previews another colour and leaving puts the clicked one back.
    await swatch(page, 'Brown').hover();
    expect(await selectedColor(page)).toBe('Brown');
    await pointerAway(page);
    expect(await selectedColor(page)).toBe('Black');

    // D14: Sand does not offer 42 at all.
    await swatch(page, 'Sand').click();
    await expect.poll(() => shownSize(page)).toMatch(/choose/i);
    await expect(cta(page)).toHaveText(/notify/i);

    // D3: back to Black, the size is still theirs.
    await swatch(page, 'Black').click();
    await expect.poll(() => shownSize(page)).toBe('42');
  });

  test('size follows to a colour where it is in stock, not to one where it is sold out', async ({ page }) => {
    await swatch(page, 'Brown').click();
    await sizeSelect(page).selectOption('42');
    await swatch(page, 'Black').click();
    await expect.poll(() => shownSize(page)).toBe('42');

    await sizeSelect(page).selectOption('41');
    await swatch(page, 'Brown').click(); // Brown 41 is sold out
    await expect.poll(() => shownSize(page)).toMatch(/choose/i);
  });

  test('D5 D6 D7: notify keeps the colour and the sold-out size, and never moves the page', async ({ page }) => {
    await card(page).scrollIntoViewIfNeeded();
    await swatch(page, 'Black').click();
    await sizeSelect(page).selectOption('43');
    await expect(cta(page)).toHaveText(/43/);
    // The select and the button name the same size (they used to disagree).
    await expect.poll(() => shownSize(page)).toMatch(/^43/);

    await cta(page).scrollIntoViewIfNeeded();
    const before = await page.evaluate(() => window.scrollY);
    await cta(page).click();
    const panel = page.locator('.ovl-panel');
    await expect(panel).toBeVisible();
    await expect(panel.locator('#rf-size')).toHaveValue('43');
    // The panel is fully on screen and clear of the fixed nav.
    const box = await panel.boundingBox();
    expect(box!.y).toBeGreaterThanOrEqual(84);
    expect(box!.y + box!.height).toBeLessThanOrEqual(900);

    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    expect(await page.evaluate(() => window.scrollY)).toBe(before);
    expect(await selectedColor(page)).toBe('Black');
    await expect.poll(() => shownSize(page)).toMatch(/^43/);
    // Focus goes back to the button that opened it.
    await expect(cta(page)).toBeFocused();

    // A click on the dimmed nav closes the overlay rather than navigating.
    await cta(page).click();
    await expect(panel).toBeVisible();
    await page.mouse.click(700, 50);
    await expect(panel).toBeHidden();
    await expect(page).toHaveURL(/all-products/);
  });

  test('D8: buying without a size asks for one', async ({ page }) => {
    await swatch(page, 'Black').click();
    await card(page).locator('.quick-add').first().click();
    await expect(card(page).locator('.size-required-message')).toBeVisible();
    await expect(sizeSelect(page)).toBeFocused();
  });

  test('D9 D10: the bag and the product link get the colour and size on the card', async ({ page }) => {
    const adds = await useFixture(page);
    await swatch(page, 'Brown').click();
    await sizeSelect(page).selectOption('42');
    await pointerAway(page);
    await expect(card(page).locator('a[href*="/product/"]').first()).toHaveAttribute('href', /color=brown.*size=42|size=42.*color=brown/);

    await cta(page).click();
    await expect.poll(() => adds.length).toBe(1);
    expect(adds[0]).toMatchObject({ productId: ID, variantId: variantId('Brown', 42), color: 'Brown' });
    expect(Number(adds[0].size)).toBe(42);
  });

  test('D13: keyboard previews on focus and selects on Enter', async ({ page }) => {
    await swatch(page, 'Black').click();
    await swatch(page, 'Brown').focus();
    expect(await selectedColor(page)).toBe('Brown');
    await page.keyboard.press('Enter');
    await sizeSelect(page).focus(); // focus leaves the swatch row
    expect(await selectedColor(page)).toBe('Brown');
  });
});

test.describe('collection card, phone', () => {
  test('M1 M2 M3: size sheet choices follow the colour, and notify returns to the same place', async ({ page }) => {
    await useFixture(page);
    await gotoCollection(page, 390, 844);
    await card(page).scrollIntoViewIfNeeded();

    await swatch(page, 'Black').click();
    await card(page).locator('.size-trigger').click();
    await page.locator('.ovl .size-row', { hasText: /^\s*42/ }).click();
    await expect(card(page).locator('.size-trigger strong')).toHaveText('42');

    await swatch(page, 'Sand').click();
    await expect(card(page).locator('.size-trigger strong')).toHaveText('—');
    await swatch(page, 'Black').click();
    await expect(card(page).locator('.size-trigger strong')).toHaveText('42');

    await swatch(page, 'Sand').click();
    const notify = card(page).getByRole('button', { name: /notify/i });
    await notify.scrollIntoViewIfNeeded();
    const before = await page.evaluate(() => window.scrollY);
    await notify.click();
    const panel = page.locator('.ovl-panel');
    await expect(panel).toBeVisible();
    const box = await panel.boundingBox();
    expect(Math.round(box!.y + box!.height)).toBe(844); // a bottom sheet
    await page.locator('.ovl-close').click();
    await expect(panel).toBeHidden();
    expect(await page.evaluate(() => window.scrollY)).toBe(before);
    expect(await page.evaluate(() => document.body.style.position)).toBe('');
  });
});

test.describe('product page', () => {
  const pdpSwatch = (page: Page, color: string) => page.locator(`.color-swatch[title="${color}"]`);
  const pdpSize = (page: Page, size: number) => page.locator('.size-btn', { hasText: new RegExp(`^\\s*${size}\\b`) });

  test('P1 P2 P3 P5: an in-stock size carries across colours, a sold-out one does not', async ({ page }) => {
    await useFixture(page);
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto(`/product/${SLUG}?color=black&size=40`);
    await expect(pdpSize(page, 40)).toHaveClass(/active/, { timeout: 30_000 }); // P3

    await pdpSwatch(page, 'Brown').click(); // Brown 40 in stock
    await expect(pdpSize(page, 40)).toHaveClass(/active/);
    await expect(page).toHaveURL(/color=brown/);
    await expect(page).toHaveURL(/size=40/);

    await pdpSwatch(page, 'Sand').click(); // Sand 40 sold out
    await expect(page.locator('.size-btn.active')).toHaveCount(0);
    await expect(page).not.toHaveURL(/size=/);

    // P5: the fully sold-out colour is marked, the others are not.
    await expect(pdpSwatch(page, 'Sand')).toHaveClass(/is-sold-out/);
    await expect(pdpSwatch(page, 'Black')).not.toHaveClass(/is-sold-out/);
    await expect(pdpSwatch(page, 'Sand')).toHaveAttribute('aria-label', /sold out/i);
  });
});
