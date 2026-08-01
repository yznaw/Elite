import { defineConfig, devices } from '@playwright/test';

const e2eEnv = [
  'NODE_ENV=test',
  'DEFAULT_TENANT_SLUG=pos-browser-e2e',
  'DEFAULT_TENANT_NAME=POS-Browser-E2E',
  'DEFAULT_ADMIN_EMAIL=browser-pos@elite.local',
  'DEFAULT_ADMIN_PASSWORD=browser-pos-password',
  'DEFAULT_ADMIN_NAME=Browser-POS-Owner',
  'SESSION_SECRET=browser-pos-session-secret',
  'SESSION_COOKIE_SECURE=false',
  'CORS_ORIGINS=http://127.0.0.1:4300',
].join(' ');
const reuseExistingServer = process.env['E2E_REUSE_EXISTING'] === '1';

export default defineConfig({
  testDir: './e2e',
  timeout: 45000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  globalTeardown: './e2e/global-teardown.ts',
  use: {
    baseURL: 'http://127.0.0.1:4300',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: `${e2eEnv} node scripts/prepare-pos-browser-e2e.js && ${e2eEnv} npm start`,
      cwd: '../server',
      url: 'http://127.0.0.1:3000/api/health',
      timeout: 60000,
      reuseExistingServer,
    },
    {
      command: 'npm run build:admin && node scripts/serve-pos-e2e.mjs',
      cwd: '.',
      url: 'http://127.0.0.1:4300/login',
      timeout: 60000,
      reuseExistingServer,
    },
  ],
});
