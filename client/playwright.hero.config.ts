import { defineConfig, devices } from '@playwright/test';

/**
 * Separate from `playwright.config.ts` on purpose.
 *
 * That suite drives the admin portal on :4300 and boots a throwaway tenant with
 * its own seed script. This one only needs the storefront on :4200 with the API
 * behind it, and it replaces the hero payload per test, so sharing a config
 * would mean every hero run paid for the POS tenant bootstrap.
 *
 * `reuseExistingServer` is true so a developer who already has `npm run dev`
 * running gets an instant run.
 */
export default defineConfig({
  testDir: './e2e-hero',
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4200',
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
      command: 'npm start -- --host 127.0.0.1',
      cwd: '.',
      url: 'http://127.0.0.1:4200',
      timeout: 180_000,
      reuseExistingServer: true,
    },
  ],
});
