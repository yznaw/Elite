import { expect, test, type Page } from '@playwright/test';
import { BULK_COUNT, bulkProducts, useFixture } from './fixture';

/**
 * The phone grid's "Load more".
 *
 * It replaced a pager whose arrows sat under ten full-width cards: changing page left the
 * customer at the bottom of the document with ten unseen products above them. The assertion
 * that matters here is the one about `scrollY` — everything else is bookkeeping.
 *
 * Runs in the `phone` project, because the grid only windows itself under 768px.
 */
const PAGE_SIZE = 10;

const cards = (page: Page) => page.locator('.product-cell');
const loadMore = (page: Page) => page.getByRole('button', { name: /load more/i });
const count = (page: Page) => page.locator('.load-more-count');

async function gotoBulk(page: Page) {
  await useFixture(page, bulkProducts);
  await page.goto('/collection/all-products');
  await expect(cards(page).first()).toBeVisible({ timeout: 30_000 });
}

test.describe('load more, phone', () => {
  test.beforeEach(async ({ page }) => gotoBulk(page));

  test('grows the list in place and never moves the page', async ({ page }) => {
    await expect(cards(page)).toHaveCount(PAGE_SIZE);
    await expect(count(page)).toHaveText(new RegExp(`${PAGE_SIZE}.*${BULK_COUNT}`));

    await loadMore(page).scrollIntoViewIfNeeded();
    const before = await page.evaluate(() => window.scrollY);
    await loadMore(page).click();

    await expect(cards(page)).toHaveCount(PAGE_SIZE * 2);
    expect(await page.evaluate(() => window.scrollY), 'the page moved under the customer').toBe(before);
    await expect(count(page)).toHaveText(new RegExp(`${PAGE_SIZE * 2}.*${BULK_COUNT}`));

    // Last window: everything is shown and the button goes away, the count stays.
    await loadMore(page).click();
    await expect(cards(page)).toHaveCount(BULK_COUNT);
    await expect(loadMore(page)).toHaveCount(0);
    await expect(count(page)).toHaveText(new RegExp(`${BULK_COUNT}.*${BULK_COUNT}`));
  });

  test('focus lands on the first new product', async ({ page }) => {
    await loadMore(page).click();
    await expect(cards(page)).toHaveCount(PAGE_SIZE * 2);
    const focused = await page.evaluate(() => {
      const cell = document.activeElement?.closest('.product-cell');
      return cell ? [...document.querySelectorAll('.product-cell')].indexOf(cell) : -1;
    });
    expect(focused, 'focus should be on card 11').toBe(PAGE_SIZE);
  });

  test('the count is announced', async ({ page }) => {
    await expect(count(page)).toHaveAttribute('aria-live', 'polite');
  });

  test('changing the view starts the list again', async ({ page }) => {
    await loadMore(page).click();
    await expect(cards(page)).toHaveCount(PAGE_SIZE * 2);

    // Sorting is one of the six paths that reset the window, and the one a route can reach
    // without driving the filter sheet. They all call `resetMobileWindow()`.
    await page.goto('/collection/all-products?sort=Newest');
    await expect(cards(page)).toHaveCount(PAGE_SIZE);

    // …and the remembered window is per view: going back to the unsorted list restores it.
    await page.goto('/collection/all-products');
    await expect(cards(page)).toHaveCount(PAGE_SIZE * 2);
  });

  test('coming back from a product keeps the list where it was', async ({ page }) => {
    await loadMore(page).click();
    await expect(cards(page)).toHaveCount(PAGE_SIZE * 2);

    await page.goto(`/product/${bulkProducts[0].slug}`);
    // A phone shows the size sheet trigger rather than the size chips.
    await expect(page.getByRole('heading', { name: bulkProducts[0].name })).toBeVisible({ timeout: 30_000 });
    await page.goBack();

    await expect(cards(page)).toHaveCount(PAGE_SIZE * 2);
  });
});
