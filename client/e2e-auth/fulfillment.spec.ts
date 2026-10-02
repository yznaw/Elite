import { test, expect, type Page } from '@playwright/test';
const user = { id: 'owner', name: 'Owner', initials: 'OW', email: 'owner@example.test', role: 'owner', tenantId: 'tenant', tenantSlug: 'test' };
const origins = [{ id: 'a', name: 'The Pearl' }, { id: 'b', name: 'Warehouse' }, { id: 'w', name: 'Al Rayyan' }];
const settings = { enabled: false, perLocation: true, fallbackId: 'w', stockLocations: origins, locations: origins.filter(o => o.id !== 'b').map((o, i) => ({ id: o.id, priority: i, origin: { address: o.name, city: 'Doha', state: 'Doha', countryCode: 'QA', zip: '0000', contactName: 'Staff', phone: '97411111111' } })) };
const order = { id: 'EC-TEST', date: '2026-10-01', customer: 'Test Buyer', customerEmail: 'buyer@example.test', itemsCount: 2, total: 60, payment: 'paid', fulfillment: 'processing', items: [], address: 'Doha', automaticFulfillment: true, needsApproval: false, allocationState: 'allocated', timeline: [], notes: [], deliveryProgress: { label: 'partially_delivered', delivered: 1, total: 2 }, deliveries: [{ id: 's1', reference: 'EC-TEST-S1', location: 'The Pearl', status: 'delivered', bookingState: 'booked', amount: 10, trackingNumber: 'TRACK1', items: [{ name: 'Sandal', size: '40', quantity: 1 }] }, { id: 's2', reference: 'EC-TEST-S2', location: 'Al Rayyan', status: 'processing', bookingState: 'failed', bookingError: 'Carrier unavailable', amount: 20, items: [{ name: 'Sandal', size: '41', quantity: 1 }] }] };
async function prepare(page: Page, lang: 'en' | 'ar', empty = false) {
    await page.setViewportSize({ width: 1280, height: 1200 });
    let saved: any = null;
    const actions: any[] = [];
    await page.addInitScript(lang => localStorage.setItem('elite-admin:locale', lang), lang);
    await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, r => r.abort());
    await page.route('**/api/**', async (route) => {
        const path = new URL(route.request().url()).pathname;
        const ok = (data: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data }) });
        if (path === '/api/auth/me')
            return ok(user);
        if (path === '/api/admin/inventory/automatic-fulfillment') {
            if (route.request().method() === 'PUT') {
                saved = route.request().postDataJSON();
                return ok(saved);
            }
            return ok(empty ? { ...settings, locations: [], fallbackId: null } : settings);
        }
        if (path === '/api/admin/orders')
            return ok({ orders: [order], total: 1, page: 1, limit: 20, pages: 1 });
        if (path === '/api/admin/orders/EC-TEST')
            return ok(order);
        if (path.endsWith('/deliveries/s2/action')) {
            actions.push(route.request().postDataJSON());
            return ok({ ...order, deliveries: order.deliveries.map(s => ({ ...s, bookingState: 'pending' })) });
        }
        if (path.includes('/notifications'))
            return ok({ items: [], lastReadId: 0 });
        if (path.includes('store-config'))
            return ok({ storeName: 'Elite', currency: 'QAR', timezone: 'Asia/Qatar', language: lang });
        if (path.includes('/settings'))
            return ok({ storeName: 'Elite', currency: 'QAR', timezone: 'Asia/Qatar', language: lang, orderEmails: [] });
        return ok([]);
    });
    return { saved: () => saved, actions };
}
for (const lang of ['en', 'ar'] as const) {
    test(`empty pickup setup and mobile editing (${lang})`, async ({page}, testInfo) => {
        await prepare(page, lang, true);
        await page.goto('/settings');
        await page.getByRole('button', {name:lang === 'en' ? 'Integrations' : 'التكاملات الخارجية',exact:true}).click();
        const panel = page.locator('ap-fulfillment-settings');
        await expect(panel.locator('.delivery-empty')).toBeVisible();
        await panel.screenshot({path:testInfo.outputPath('settings-empty.png')});
        await page.setViewportSize({width:390,height:2200});
        await panel.screenshot({path:testInfo.outputPath('settings-empty-mobile.png')});
        await panel.getByRole('button',{name:lang === 'en' ? 'Add pickup location' : 'إضافة موقع استلام',exact:true}).click();
        await panel.locator('.origin-fields select').selectOption('a');
        await expect(panel.locator('.origin-fields input').first()).toBeVisible();
        await panel.getByRole('switch').focus();
        await page.keyboard.press('Space');
        await expect(panel.getByRole('switch')).toBeChecked();
        expect(await panel.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
        await panel.screenshot({path:testInfo.outputPath('settings-edit-mobile.png')});
    });
    test(`pickup configuration and fallback save (${lang})`, async ({ page }, testInfo) => {
        const mock = await prepare(page, lang);
        await page.goto('/settings');
        await page.getByRole('button', { name: lang === 'en' ? 'Integrations' : 'التكاملات الخارجية', exact: true }).click();
        const panel = page.locator('ap-fulfillment-settings');
        await expect(panel).toContainText('Al Rayyan');
        await expect(panel.locator('fieldset')).toHaveCount(2);
        await panel.screenshot({path: testInfo.outputPath('settings.png')});
        await panel.getByRole('button', { name: lang === 'en' ? 'Save delivery settings' : 'حفظ إعدادات التوصيل', exact: true }).click();
        await expect.poll(() => mock.saved()?.fallbackId).toBe('w');
        expect(mock.saved().locations).toHaveLength(2);
    });
    test(`split delivery tracking without approval (${lang})`, async ({ page }, testInfo) => {
        const mock = await prepare(page, lang);
        await page.goto('/orders?id=EC-TEST');
        const panel = page.locator('ap-order-deliveries');
        await expect(panel).toContainText('EC-TEST-S1');
        await expect(panel).toContainText('EC-TEST-S2');
        await expect(panel).toContainText(lang === 'en' ? 'Partially delivered' : 'تم التوصيل جزئياً');
        await expect(page.getByRole('button', { name: lang === 'en' ? 'Approve order' : 'الموافقة على الطلب', exact: true })).toHaveCount(0);
        await panel.screenshot({path: testInfo.outputPath('deliveries.png')});
        await page.setViewportSize({width:390,height:2200});
        expect(await panel.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
        await panel.screenshot({path: testInfo.outputPath('deliveries-mobile.png')});
        await panel.getByRole('button', { name: lang === 'en' ? 'Retry failed booking' : 'إعادة محاولة الحجز الفاشل', exact: true }).click();
        await expect.poll(() => mock.actions.length).toBe(1);
        expect(mock.actions[0].action).toBe('retry');
    });
}
