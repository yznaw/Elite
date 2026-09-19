import { expect, test } from '@playwright/test';
import { card, gotoCollection, manyColorProduct, moreLink, swatches, useFixture } from './fixture';

/**
 * Tap-target geometry under a finger. Runs in the `phone` project (Pixel 7), which is what
 * makes `(pointer: coarse)` match: on Desktop Chrome the 44px rules never apply.
 *
 * 44x44 is Apple's floor (WCAG 2.5.8 asks 24). The row also has to stay on one line, which
 * is why the card shows one colour fewer on touch than with a mouse.
 */
const MIN = 44;

test.describe('tap targets under a finger', () => {
  test.beforeEach(async ({ page }) => {
    await useFixture(page);
    await gotoCollection(page);
  });

  test('the coarse-pointer sizing is actually in effect', async ({ page }) => {
    expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);
    // The global guard that stops a double tap zooming the page.
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).touchAction)).toBe('manipulation');
  });

  test('every swatch is at least 44x44 and the row stays on one line', async ({ page }) => {
    const loafer = manyColorProduct.name;
    await card(page, loafer).scrollIntoViewIfNeeded();
    const targets = card(page, loafer).locator('.product-color-swatch');
    const count = await targets.count();
    expect(count).toBeGreaterThan(0);

    const rows = new Set<number>();
    let previousRight = -1;
    for (let i = 0; i < count; i++) {
      const box = (await targets.nth(i).boundingBox())!;
      expect(Math.round(box.width), `swatch #${i} width`).toBeGreaterThanOrEqual(MIN);
      expect(Math.round(box.height), `swatch #${i} height`).toBeGreaterThanOrEqual(MIN);
      expect(box.x, `swatch #${i} overlaps its neighbour`).toBeGreaterThanOrEqual(previousRight);
      previousRight = box.x + box.width;
      rows.add(Math.round(box.y));
    }
    expect(rows.size, 'the swatch row wrapped').toBe(1);
  });

  test('a card shows five colours plus the link on touch', async ({ page }) => {
    await expect(swatches(page, manyColorProduct.name)).toHaveCount(5);
    await expect(moreLink(page, manyColorProduct.name)).toHaveText('+5');
  });

  test('the product page swatches reach 44 without growing the dot', async ({ page }) => {
    await page.goto(`/product/${manyColorProduct.slug}`);
    const swatch = page.locator('.color-swatch').first();
    await expect(swatch).toBeVisible({ timeout: 30_000 });
    // The disc is still 34px; the extra comes from a transparent ::before.
    expect(await swatch.evaluate((el) => Math.round(el.getBoundingClientRect().width))).toBe(34);
    const reach = await swatch.evaluate((el) => {
      const box = el.getBoundingClientRect();
      const before = getComputedStyle(el, '::before');
      return box.width - 2 * parseFloat(before.insetInlineStart || '0');
    });
    expect(Math.round(reach)).toBeGreaterThanOrEqual(MIN);
  });
});
