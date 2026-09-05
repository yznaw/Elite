import { defineConfig, devices } from '@playwright/test';

// Browser regression tests with intercepted API responses: no database,
// credentials, or live API server are needed. Keep checkout E2E separate.
export default defineConfig({
  testDir: './e2e-auth',
  timeout: 20000,
  // Auth and register GETs each finish their network retry backoff before
  // the cached POS can resume, which exceeds Playwright's default 5 seconds.
  expect: { timeout: 10000 },
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4317',
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node node_modules/@angular/cli/bin/ng.js build admin-portal --configuration development --output-path dist/admin-auth-e2e && node scripts/serve-pos-e2e.mjs',
    env: {
      E2E_ADMIN_ROOT: 'dist/admin-auth-e2e/browser',
      E2E_ADMIN_PORT: '4317',
    },
    url: 'http://127.0.0.1:4317/login',
    timeout: 60000,
    reuseExistingServer: false,
  },
});
