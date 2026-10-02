import { defineConfig, devices } from '@playwright/test';

// Static storefront with intercepted APIs; never starts a live payment server.
export default defineConfig({
  testDir: './e2e-fulfillment',
  timeout: 30000,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4327',
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node node_modules/@angular/cli/bin/ng.js build client-web --configuration development,csr --output-path dist/fulfillment-web-e2e && node scripts/serve-pos-e2e.mjs',
    env: { E2E_ADMIN_ROOT: 'dist/fulfillment-web-e2e/browser', E2E_ADMIN_PORT: '4327' },
    url: 'http://127.0.0.1:4327/checkout',
    timeout: 60000,
    reuseExistingServer: false,
  },
});
