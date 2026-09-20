import { expect, type Page, type Route } from '@playwright/test';

/**
 * The catalogue these specs run against. `/api/products` is replaced with it so the
 * assertions can depend on exact stock, and on a product with more colourways than a card
 * shows.
 *
 * Selection Test Sandal (3 colours)
 *   Black  40 41 42 in stock, 43 sold out
 *   Brown  40 42 in stock,    41 sold out
 *   Sand   40 41 sold out (the whole colour)
 *
 * Selection Test Loafer (10 colours, one size each, all in stock) exercises the `+N` link.
 */
export const ID = '6f1c2a90-1b2c-4d3e-8f40-5a6b7c8d9e01';
export const SLUG = 'selection-test-sandal';
export const MANY_ID = '6f1c2a90-1b2c-4d3e-8f40-5a6b7c8d9e02';
export const MANY_SLUG = 'selection-test-loafer';
export const MANY_COLORS = ['Black', 'Brown', 'Sand', 'Olive', 'Navy', 'Camel', 'Grey', 'Milk', 'Rust', 'Slate'];
const art = '/assets/hero-scroll/elite-hero-sandals-cutout.png';

const stock: Record<string, Record<number, number>> = {
  Black: { 40: 3, 41: 2, 42: 4, 43: 0 },
  Brown: { 40: 1, 41: 0, 42: 2 },
  Sand: { 40: 0, 41: 0 },
};
export const variantId = (color: string, size: number) =>
  `6f1c2a90-1b2c-4d3e-8f40-${color === 'Black' ? 'b' : color === 'Brown' ? 'c' : 'd'}${String(size).padStart(11, '0')}`;

const base = {
  nameAr: '',
  brand: 'Elite',
  price: 950,
  tag: '',
  leather: '',
  style: '',
  materials: [],
  image: art,
  images: [art],
  colorImages: {},
  relatedProductIds: [],
};

export const product = {
  ...base,
  id: ID,
  slug: SLUG,
  name: 'Selection Test Sandal',
  sizes: [40, 41, 42, 43],
  colors: ['Black', 'Brown', 'Sand'],
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
};

export const manyColorProduct = {
  ...base,
  id: MANY_ID,
  slug: MANY_SLUG,
  name: 'Selection Test Loafer',
  sizes: [42],
  colors: MANY_COLORS,
  stock: MANY_COLORS.length,
  variants: MANY_COLORS.map((color, i) => ({
    id: `6f1c2a90-1b2c-4d3e-8f40-e${String(i).padStart(11, '0')}`,
    sku: `LOAF-${color}`,
    size: 42,
    color,
    material: '',
    price: 950,
    stock: 1,
    isActive: true,
  })),
};

/**
 * Twenty-five one-size products, enough to exercise the phone grid's "Load more" three
 * windows deep (10, 20, 25).
 */
export const BULK_COUNT = 25;
export const bulkProducts = Array.from({ length: BULK_COUNT }, (_, i) => ({
  ...base,
  id: `6f1c2a90-1b2c-4d3e-8f40-f${String(i).padStart(11, '0')}`,
  slug: `selection-bulk-${i + 1}`,
  name: `Selection Bulk ${String(i + 1).padStart(2, '0')}`,
  sizes: [42],
  colors: ['Black'],
  stock: 1,
  variants: [{
    id: `6f1c2a90-1b2c-4d3e-8f40-a${String(i).padStart(11, '0')}`,
    sku: `BULK-${i + 1}`,
    size: 42,
    color: 'Black',
    material: '',
    price: 950,
    stock: 1,
    isActive: true,
  }],
}));

/**
 * A product priced per variant: Black at 1,000, Brown at 1,200, and Sand split across its
 * own sizes (1,150 / 1,250) — the three shapes real data has.
 */
export const PRICED_ID = '6f1c2a90-1b2c-4d3e-8f40-5a6b7c8d9e03';
export const PRICED_SLUG = 'selection-test-priced';
const pricedStock: Record<string, Record<number, number>> = { Black: { 40: 2, 41: 2 }, Brown: { 40: 2 }, Sand: { 40: 2, 41: 2 } };
const pricedPrice = (color: string, size: number) =>
  (color === 'Black' ? 1000 : color === 'Brown' ? 1200 : size === 40 ? 1150 : 1250);

export const pricedProduct = {
  ...base,
  id: PRICED_ID,
  slug: PRICED_SLUG,
  name: 'Selection Test Priced',
  price: 1250, // deliberately not the cheapest: the old bug advertised this number
  sizes: [40, 41],
  colors: ['Black', 'Brown', 'Sand'],
  stock: 8,
  variants: Object.entries(pricedStock).flatMap(([color, sizes], colorIndex) =>
    Object.entries(sizes).map(([size, qty], sizeIndex) => ({
      id: `6f1c2a90-1b2c-4d3e-8f40-c${String(colorIndex * 10 + sizeIndex).padStart(11, '0')}`,
      sku: `PRICED-${color}-${size}`,
      size: Number(size),
      color,
      material: '',
      price: pricedPrice(color, Number(size)),
      stock: qty,
      isActive: true,
    })),
  ),
};

export type CartAdd = { productId: string; variantId?: string | null; color?: string | null; size?: number | string };

/** Serves the fixture catalogue and collects what the bag was asked to add. */
export async function useFixture(page: Page, catalogue: unknown[] = [product, manyColorProduct, pricedProduct]): Promise<CartAdd[]> {
  const adds: CartAdd[] = [];
  const json = (route: Route, data: unknown) => route.fulfill({ json: { success: true, data } });
  const byPath: Record<string, unknown> = Object.fromEntries([
    [`/api/products/${SLUG}`, product],
    [`/api/products/${ID}`, product],
    [`/api/products/${MANY_SLUG}`, manyColorProduct],
    [`/api/products/${MANY_ID}`, manyColorProduct],
    [`/api/products/${PRICED_SLUG}`, pricedProduct],
    [`/api/products/${PRICED_ID}`, pricedProduct],
    ...bulkProducts.flatMap((p) => [[`/api/products/${p.slug}`, p], [`/api/products/${p.id}`, p]]),
  ]);
  await page.route((url) => url.pathname === '/api/products', (route) => json(route, catalogue));
  await page.route((url) => url.pathname in byPath, (route) => json(route, byPath[new URL(route.request().url()).pathname]));
  await page.route((url) => url.pathname === '/api/carts/current', (route) => json(route, { id: 'cart', subtotal: 0, items: [] }));
  await page.route((url) => url.pathname === '/api/carts/current/items', async (route) => {
    const body = route.request().postDataJSON() as CartAdd;
    adds.push(body);
    await json(route, {
      id: 'cart',
      subtotal: 950,
      items: [{ id: body.productId, variantId: body.variantId, name: product.name, price: 950, color: body.color, size: Number(body.size), qty: 1, image: art }],
    });
  });
  return adds;
}

// ── Collection card helpers ───────────────────────────────────────────────────
export const card = (page: Page, name = product.name) => page.locator('.product-cell').filter({ hasText: name });
/** Colour swatches only: the `+N` link shares the class but is not one. */
export const swatches = (page: Page, name?: string) =>
  card(page, name).locator('.product-color-swatch:not(.product-color-swatch--more)');
export const swatch = (page: Page, color: string) => card(page).locator(`.product-color-swatch[title="${color}"]`);
export const moreLink = (page: Page, name?: string) => card(page, name).locator('.product-color-swatch--more');
export const selectedColor = (page: Page) => card(page).locator('.product-color-swatch.is-selected').getAttribute('title');
export const sizeSelect = (page: Page) => card(page).locator('select.size-select');
export const shownSize = (page: Page) =>
  sizeSelect(page).evaluate((el: HTMLSelectElement) => el.selectedOptions[0]?.textContent?.trim() ?? '');
export const cta = (page: Page) => card(page).locator('.quick-add').first();

export async function gotoCollection(page: Page, width?: number, height?: number) {
  if (width && height) await page.setViewportSize({ width, height });
  await page.goto('/collection/all-products');
  await expect(card(page)).toBeVisible({ timeout: 30_000 });
}

/** Moves the pointer somewhere with no card under it. */
export const pointerAway = (page: Page) => page.mouse.move(2, 2);
