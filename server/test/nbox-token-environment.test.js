const test = require('node:test');
const assert = require('node:assert/strict');

test('login tokens stay scoped to the API environment and seller across restarts', async () => {
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;
  const dbPath = require.resolve('../db/client');
  const adapterPath = require.resolve('../lib/nbox');
  const originalDb = require.cache[dbPath];
  const originalAdapter = require.cache[adapterPath];
  // No real database or network access: begin with an unscoped legacy token.
  let config = { nboxToken: 'legacy-production-token', nboxTokenFetchedAt: Date.now() };
  let loginCount = 0;
  let expectedToken;
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: {
    query: async (sql, params) => {
      if (sql.includes('SELECT config')) return { rows: [{ config }] };
      if (sql.includes('config ||')) Object.assign(config, JSON.parse(params[0]));
      else throw new Error('Unexpected database operation');
      return { rows: [] };
    },
  } };
  const reload = () => {
    delete require.cache[adapterPath];
    return require('../lib/nbox');
  };
  try {
    Object.assign(process.env, {
      NBOX_API_BASE_URL: 'https://staging.nbox.now/api',
      NBOX_LOGIN_EMAIL: 'seller@example.test',
      NBOX_LOGIN_PASSWORD: 'test-only-password',
      NBOX_SHOP_DOMAIN: 'shop.example.test',
      NBOX_AUTH_HEADER: 'x-nbox-token',
      NBOX_RATE_ENDPOINT: '/rates',
    });
    delete process.env.NBOX_AUTH_SCHEME;
    global.fetch = async (url, options) => {
      assert.ok(url.startsWith(process.env.NBOX_API_BASE_URL + '/'));
      if (url.endsWith('/login')) {
        loginCount++;
        expectedToken = `test-token-${loginCount}`;
        return { ok: true, json: async () => ({ token: expectedToken }) };
      }
      assert.equal(options.headers['x-nbox-token'], expectedToken);
      assert.equal(options.headers['x-nbox-shop-domain'], process.env.NBOX_SHOP_DOMAIN);
      return { ok: true, status: 200, text: async () => JSON.stringify({
        rates: [{ service_code: 'NBOX', displayRate: 12, currency: 'QAR' }],
      }) };
    };
    const quote = (adapter) => adapter.getDeliveryQuote({
      origin: { address: 'Warehouse', city: 'Doha', countryCode: 'QA' },
      shippingAddress: { line1: 'Test destination', city: 'Doha', country: 'Qatar' },
      items: [{ name: 'Test item', quantity: 1, price: 10 }],
    });
    let adapter = reload();
    await quote(adapter);
    assert.equal(loginCount, 1, 'legacy token must be ignored');
    await quote(adapter);
    assert.equal(loginCount, 1, 'same environment reuses memory token');
    adapter = reload();
    await quote(adapter);
    assert.equal(loginCount, 1, 'same environment reuses database token after restart');

    process.env.NBOX_API_BASE_URL = 'https://nbox.now/api';
    await quote(adapter);
    assert.equal(loginCount, 2, 'environment change must ignore memory and database tokens');
    process.env.NBOX_API_BASE_URL = 'https://staging.nbox.now/api';
    adapter = reload();
    await quote(adapter);
    assert.equal(loginCount, 3, 'restart on staging must ignore persisted production token');
    process.env.NBOX_SHOP_DOMAIN = 'other-shop.example.test';
    await quote(adapter);
    assert.equal(loginCount, 4, 'shop change requires a new token');
    process.env.NBOX_LOGIN_EMAIL = 'other-seller@example.test';
    await quote(adapter);
    assert.equal(loginCount, 5, 'seller change requires a new token');
  } finally {
    global.fetch = originalFetch;
    for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
    Object.assign(process.env, originalEnv);
    if (originalDb) require.cache[dbPath] = originalDb;
    else delete require.cache[dbPath];
    if (originalAdapter) require.cache[adapterPath] = originalAdapter;
    else delete require.cache[adapterPath];
  }
});
