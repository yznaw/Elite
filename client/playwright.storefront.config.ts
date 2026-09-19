import { defineConfig, devices } from '@playwright/test';

/**
 * Storefront colour/size selection, overlays and scroll locking on the collection
 * and product pages, at desktop and phone widths.
 *
 * Same set-up as `playwright.hero.config.ts` and for the same reason: the storefront
 * runs client-rendered so the tests can replace `/api/products` with a fixture whose
 * stock they control. See `e2e-storefront/selection.spec.ts`.
 */
const STOREFRONT_PORT = 4210;

export default defineConfig({
  testDir: './e2e-storefront',
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${STOREFRONT_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'npm run dev',
      cwd: '../server',
      url: 'http://127.0.0.1:3000/api/health',
      timeout: 90_000,
      reuseExistingServer: true,
    },
    {
      command: `npx ng serve client-web --configuration csr --host 127.0.0.1 --port ${STOREFRONT_PORT}`,
      cwd: '.',
      url: `http://127.0.0.1:${STOREFRONT_PORT}`,
      timeout: 180_000,
      reuseExistingServer: true,
    },
  ],
});
