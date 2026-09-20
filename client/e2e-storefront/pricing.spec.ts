import { expect, test, type Page } from '@playwright/test';
import { PRICED_SLUG, card, gotoCollection, pricedProduct, product, useFixture } from './fixture';

/**
 * Per-variant pricing.
 *
 * The storefront printed the product's own price while the bag charged the variant's, so a
 * product whose sizes run 1,000 to 1,250 was advertised at whatever the product row said.
 * The assertion that matters is the last one: the number on the screen is the number in the
 * bag.
 *
 * Fixture: Black 1,000 · Brown 1,200 · Sand 1,150 (40) and 1,250 (41), product row 1,250.
 */
const priceOn = (page: Page, name: string) => card(page, name).locator('.product-price').innerText();
const swatchOf = (page: Page, name: string, color: string) =>
  card(page, name).locator(`.product-color-swatch[title="${color}"]`);

test.describe('prices that differ per variant', () => {
  test.beforeEach(async ({ page }) => {
    await useFixture(page);
    await gotoCollection(page, 1400, 900);
  });

  test('the card prices the colour on show, and a colour whose sizes differ shows a range', async ({ page }) => {
    const name = pricedProduct.name;
    await swatchOf(page, name, 'Black').click();
    await expect.poll(() => priceOn(page, name)).toMatch(/1,000/);

    await swatchOf(page, name, 'Brown').click();
    await expect.poll(() => priceOn(page, name)).toMatch(/1,200/);

    // Sand is 1,150 in one size and 1,250 in the other: two numbers until a size is picked.
    await swatchOf(page, name, 'Sand').click();
    await expect.poll(() => priceOn(page, name)).toMatch(/1,150.*1,250/);

    // A product whose variants agree still shows one number.
    await expect.poll(() => priceOn(page, product.name)).toMatch(/^[^–]*950[^–]*$/);
  });

  test('the product page follows the choice, and the bag charges what it showed', async ({ page }) => {
    const adds = await useFixture(page);
    await page.goto(`/product/${PRICED_SLUG}?color=brown`);
    const headline = page.locator('.price-row span');
    await expect(headline).toHaveText(/1,200/, { timeout: 30_000 });

    // Black is cheaper: the headline and the CTA both follow the colour.
    await page.locator('.color-swatch[title="Black"]').click();
    await expect(headline).toHaveText(/1,000/);
    await page.locator('.size-btn', { hasText: /^\s*41/ }).click();
    await expect(headline).toHaveText(/1,000/);
    await expect(page.locator('.add-cart-btn small').first()).toHaveText(/1,000/);

    // Two of them: the CTA multiplies the variant's price, not the product's.
    await page.locator('.qty-control button').last().click();
    await expect(page.locator('.add-cart-btn small').first()).toHaveText(/2,000/);
    // The sticky bar, which used to show no price at all, agrees with the panel.
    await expect(page.locator('.sticky-atc .sticky-price')).toHaveText(/2,000/);

    await page.locator('.add-cart-btn').first().click();
    await expect.poll(() => adds.length).toBe(1);
    expect(adds[0].color).toBe('Black');
    expect(Number(adds[0].size)).toBe(41);
    // The bag is sent the variant, and the server prices it from the catalog: 1,000.
    expect((adds[0] as { price?: number }).price).toBe(1000);
  });

  test('sorting uses the cheapest variant, not the product row', async ({ page }) => {
    // A uniform product at 1,100 sits between the priced product's cheapest variant (1,000)
    // and its product row (1,250), so the two rules put them in opposite orders.
    const uniform = {
      ...pricedProduct,
      id: '6f1c2a90-1b2c-4d3e-8f40-5a6b7c8d9e04',
      slug: 'selection-test-uniform',
      name: 'Selection Test Uniform',
      price: 1100,
      variants: pricedProduct.variants.map((v, i) => ({ ...v, id: `6f1c2a90-1b2c-4d3e-8f40-d${String(i).padStart(11, '0')}`, price: 1100 })),
    };
    await useFixture(page, [pricedProduct, uniform]);
    await page.goto('/collection/all-products?sort=Price%3A%20Low%E2%80%93High');

    const names = page.locator('.product-cell .product-name');
    await expect(names.first()).toBeVisible({ timeout: 30_000 });
    // Cheapest first: 1,000 before 1,100. On the product row it would have been 1,100 first.
    await expect(names.nth(0)).toHaveText(pricedProduct.name);
    await expect(names.nth(1)).toHaveText(uniform.name);
  });

  test('a product with mixed prices is an AggregateOffer', async ({ page }) => {
    await page.goto(`/product/${PRICED_SLUG}`);
    await expect(page.locator('.price-row span')).toBeVisible({ timeout: 30_000 });
    const offers = await page.evaluate(() => {
      const blocks = [...document.querySelectorAll('script[type="application/ld+json"]')]
        .map((el) => { try { return JSON.parse(el.textContent || '{}'); } catch { return {}; } });
      return blocks.find((b) => b['@type'] === 'Product')?.offers ?? null;
    });
    expect(offers?.['@type']).toBe('AggregateOffer');
    expect(offers?.lowPrice).toBe(1000);
    expect(offers?.highPrice).toBe(1250);
  });
});
