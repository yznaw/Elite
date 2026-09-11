import { defineConfig, devices } from '@playwright/test';

/**
 * Separate from `playwright.config.ts` on purpose.
 *
 * That suite drives the admin portal on :4300 and boots a throwaway tenant with
 * its own seed script. This one only needs the storefront with the API behind
 * it, and it replaces the hero payload per test, so sharing a config would mean
 * every hero run paid for the POS tenant bootstrap.
 *
 * The storefront runs client-rendered here (`ng serve --configuration csr`),
 * on its own port. These tests swap the hero content by intercepting the
 * browser's `/api/storefront-content` request. With server-side rendering the
 * page arrives already rendered and hydrates from the transfer cache, so the
 * browser never makes that request and every swapped payload is silently
 * ignored: the tests would measure the real catalogue instead. Server
 * rendering itself is covered by `scripts/ssr-smoke.mjs`.
 *
 * The port is deliberately not :4200, so a developer's `npm start` (which does
 * server-render) is never picked up by `reuseExistingServer`. The API server is
 * still reused, so a running `npm run dev` gives an instant start.
 */
const STOREFRONT_PORT = 4210;

export default defineConfig({
  testDir: './e2e-hero',
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
