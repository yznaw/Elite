import { test, expect, type Page } from '@playwright/test';

const items = [
  { id: 'p1', variantId: 'v1', name: 'Leather sandal', size: 40, qty: 2, price: 10, available: 8, image: '' },
  { id: 'p2', variantId: 'v2', name: 'Suede sandal', size: 41, qty: 1, price: 10, available: 8, image: '' },
];

async function prepare(page: Page, lang: 'en' | 'ar') {
  const requests = { quotes: 0, orders: 0, payments: 0 };
  await page.addInitScript(lang => localStorage.setItem('elite-web:locale', lang), lang);
  await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, r => r.abort());
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    const ok = (data: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data }) });
    if (path === '/api/carts/current') return ok({ id: 'cart', subtotal: 30, items });
    if (path === '/api/carts/current/items') return ok({ id: 'cart', subtotal: 0, items: [] });
    if (path === '/api/carts/shipping-quote') {
      requests.quotes++;
      return ok({
        available: true, id: 'quote', amount: requests.orders ? 35 : 30, currency: 'QAR',
        expiresAt: new Date(Date.now() + 900000).toISOString(), shipmentCount: 2,
        shipments: items.map((item, i) => ({ number: i + 1, amount: i ? (requests.orders ? 25 : 20) : 10, items: [item] })),
      });
    }
    if (path === '/api/carts/checkout') {
      requests.orders++;
      return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ success: false, code: 'QUOTE_CHANGED' }) });
    }
    if (path === '/api/payments/sadad/initiate') { requests.payments++; return ok({}); }
    if (path === '/api/payments/delivery-status/EC-TEST') return ok({ deliveries: items.map((item, i) => ({
      id: `s${i}`, status: i ? 'shipped' : 'delivered', trackingNumber: `TRACK${i}`, trackingUrl: `https://example.test/track/${i}`,
      items: [{ ...item, quantity: item.qty }],
    })) });
    return ok([]);
  });
  return requests;
}

for (const lang of ['en', 'ar'] as const) {
  test(`separate fees and changed quote require review before payment (${lang})`, async ({ page }, testInfo) => {
    const requests = await prepare(page, lang);
    await page.goto('/checkout');
    for (const [field, value] of Object.entries({ 'first-name': 'Test', 'last-name': 'Buyer', email: 'buyer@example.test', phone: '55555555' })) {
      await page.locator(`#checkout-${field}`).fill(value);
    }
    await page.locator('[data-track="checkout-continue"]').click();
    for (const [field, value] of Object.entries({ zone: '53', street: '989', building: '20', city: 'Doha' })) {
      await page.locator(`#checkout-${field}`).fill(value);
    }
    await expect.poll(() => requests.quotes).toBeGreaterThan(0);
    await expect(page.getByRole('status')).toContainText(lang === 'en' ? 'separate deliveries' : 'شحنات منفصلة');
    await page.locator('.delivery-breakdown').screenshot({path:testInfo.outputPath('checkout-deliveries.png')});
    await page.setViewportSize({width:390,height:844});
    await page.locator('.delivery-breakdown').screenshot({path:testInfo.outputPath('checkout-deliveries-mobile.png')});
    await page.locator('[data-track="checkout-continue"]').click();
    await page.locator('[data-track="checkout-place-order"]').click();
    await expect.poll(() => requests.orders).toBe(1);
    await expect.poll(() => requests.quotes).toBeGreaterThan(1);
    await expect(page.locator('cw-checkout')).toContainText(lang === 'en' ? 'Review' : 'راجع');
    expect(requests.payments).toBe(0);
  });

  test(`customer can track both deliveries separately (${lang})`, async ({ page }, testInfo) => {
    await prepare(page, lang);
    await page.goto('/thank-you?order=EC-TEST');
    const shipments = page.locator('cw-thank-you article');
    await expect(shipments).toHaveCount(2);
    await expect(shipments.nth(0)).toContainText('TRACK0');
    await expect(shipments.nth(1)).toContainText('TRACK1');
    await expect(shipments.nth(0).locator('a')).toHaveAttribute('href', 'https://example.test/track/0');
    await expect(shipments.nth(1).locator('a')).toHaveAttribute('href', 'https://example.test/track/1');
    await page.locator('.customer-deliveries').screenshot({path:testInfo.outputPath('tracking.png')});
    await page.setViewportSize({width:390,height:844});
    const panel = page.locator('.customer-deliveries');
    expect(await panel.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    await panel.screenshot({path:testInfo.outputPath('tracking-mobile.png')});
  });
}
