import { expect, test, type Locator, type Page } from '@playwright/test';
import { card, gotoCollection, manyColorProduct, moreLink, swatches, useFixture } from './fixture';

/**
 * Tap-target geometry with a mouse. The touch sizes live in `tap-targets.touch.spec.ts`,
 * which runs in the `phone` project because `(pointer: coarse)` never matches here.
 *
 * WCAG 2.5.8 (AA) asks for 24x24 CSS px. The colour swatch was 14x14 with 6px between the
 * dots, which is why this file exists.
 */
const MIN = 24;

async function boxes(target: Locator): Promise<{ x: number; y: number; width: number; height: number }[]> {
  const count = await target.count();
  const out = [];
  for (let i = 0; i < count; i++) {
    const box = await target.nth(i).boundingBox();
    expect(box, `element ${i} has no box`).not.toBeNull();
    out.push(box!);
  }
  return out;
}

/** Every target is at least `min` on both axes. */
function expectAtLeast(all: { width: number; height: number }[], min: number, what: string) {
  expect(all.length, `${what}: nothing found`).toBeGreaterThan(0);
  for (const [i, box] of all.entries()) {
    expect(Math.round(box.width), `${what} #${i} width`).toBeGreaterThanOrEqual(min);
    expect(Math.round(box.height), `${what} #${i} height`).toBeGreaterThanOrEqual(min);
  }
}

/** Neighbouring targets in a row must not overlap, or a tap lands on the wrong one. */
function expectNoOverlap(all: { x: number; y: number; width: number }[], what: string) {
  const sorted = [...all].sort((a, b) => a.y - b.y || a.x - b.x);
  for (let i = 1; i < sorted.length; i++) {
    if (Math.abs(sorted[i].y - sorted[i - 1].y) > 2) continue; // different row
    expect(sorted[i].x, `${what}: #${i} overlaps its neighbour`).toBeGreaterThanOrEqual(
      sorted[i - 1].x + sorted[i - 1].width,
    );
  }
}

/**
 * The element really receives the pointer across its width. Borrowed from the hero's
 * interaction spec: a target can measure 44px and still be covered by something.
 */
async function expectHittable(page: Page, target: Locator, what: string) {
  const count = await target.count();
  for (let i = 0; i < count; i++) {
    const box = (await target.nth(i).boundingBox())!;
    for (const fraction of [0.15, 0.5, 0.85]) {
      const hit = await page.evaluate(
        ([x, y]) => {
          const el = document.elementFromPoint(x, y);
          return el ? el.closest('.product-color-swatch, .color-swatch, button, a')?.className ?? el.className : null;
        },
        [box.x + box.width * fraction, box.y + box.height / 2],
      );
      expect(String(hit), `${what} #${i} at ${fraction * 100}%`).toContain(
        what === 'swatch' ? 'product-color-swatch' : '',
      );
    }
  }
}

test.describe('tap targets with a mouse', () => {
  test.beforeEach(async ({ page }) => {
    await useFixture(page);
    await gotoCollection(page, 1400, 900);
  });

  test('colour swatches and the +N link are at least 24x24 and do not overlap', async ({ page }) => {
    const loafer = manyColorProduct.name;
    await card(page, loafer).scrollIntoViewIfNeeded();
    const all = await boxes(card(page, loafer).locator('.product-color-swatch'));
    expectAtLeast(all, MIN, 'swatch');
    expectNoOverlap(all, 'swatch row');
    await expectHittable(page, swatches(page, loafer), 'swatch');
    await expectHittable(page, moreLink(page, loafer), 'swatch');
  });

  test('the visible dot stays small while the target grows', async ({ page }) => {
    const dot = (await boxes(swatches(page).first().locator('.product-color-swatch__dot')))[0];
    expect(Math.round(dot.width)).toBeLessThanOrEqual(18);
  });

  test('filter headings and Clear clear 24px', async ({ page }) => {
    expectAtLeast(await boxes(page.locator('.filter-group-toggle')), MIN, 'filter heading');
    expectAtLeast(await boxes(page.locator('.clear-filters')), MIN, 'clear filters');
  });

  test('the product page size guide and breadcrumb clear 24px', async ({ page }) => {
    await page.goto(`/product/${manyColorProduct.slug}`);
    await expect(page.locator('.color-swatch').first()).toBeVisible({ timeout: 30_000 });
    expectAtLeast(await boxes(page.locator('.section-label button')), MIN, 'size guide');
    expectAtLeast(await boxes(page.locator('.breadcrumb button')), MIN, 'breadcrumb');
    expectAtLeast(await boxes(page.locator('.color-swatch')), MIN, 'product page swatch');
  });
});
