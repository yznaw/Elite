import { expect, test } from '@playwright/test';

test('authenticated online and offline cashier checkout', async ({ page, context }) => {
  page.on('response', (response) => {
    if (response.status() >= 400) console.log(`HTTP ${response.status()} ${response.url()}`);
  });
  await page.goto('/login');
  await page.getByLabel('Email').fill('browser-pos@elite.local');
  await page.getByLabel('Password').fill('browser-pos-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.goto('/pos');
  await page.getByPlaceholder('Main counter').fill('Browser E2E Register');
  await page.getByRole('button', { name: 'Connect register' }).click();
  await expect(page.getByRole('heading', { name: 'Open a cashier shift' })).toBeVisible();
  await page.getByLabel('Opening cash').fill('50.00');
  await page.getByRole('button', { name: 'Open shift' }).click();

  const product = page.getByRole('button', { name: /POS Browser Product/ });
  await expect(product).toBeVisible();
  await product.click();
  await page.getByRole('button', { name: /Take payment/ }).click();
  await page.getByRole('button', { name: 'Complete sale' }).click();
  await expect(page.getByText('SALE COMPLETE')).toBeVisible();
  await expect(page.getByText('Saved in Elite.')).toBeVisible();
  await page.getByRole('button', { name: 'New sale' }).click();

  await context.setOffline(true);
  await product.click();
  await page.getByRole('button', { name: /Take payment/ }).click();
  await page.getByRole('button', { name: 'Complete sale' }).click();
  await expect(page.getByText('Saved offline and waiting to synchronize.')).toBeVisible();

  await context.setOffline(false);
  await page.getByRole('button', { name: 'New sale' }).click();
  await expect(page.getByRole('button', { name: 'Queue 0' })).toBeVisible({ timeout: 15000 });
});
