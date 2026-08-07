const test = require('node:test');
const assert = require('node:assert/strict');

require('dotenv').config();

const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
process.env.DEFAULT_TENANT_SLUG = `product-save-e2e-${runId}`;
process.env.DEFAULT_TENANT_NAME = 'Product Save E2E';
process.env.DEFAULT_ADMIN_EMAIL = `product-save-e2e-${runId}@elite.local`;
process.env.DEFAULT_ADMIN_PASSWORD = 'product-save-e2e-password';
process.env.DEFAULT_ADMIN_NAME = 'Product Save Test Owner';
process.env.SESSION_SECRET = `product-save-e2e-session-${runId}`;

const db = require('../db/client');
const { startServer } = require('../index');

// migration 029 drops products.has_3d/views_3d (the 3D/GLB feature removal).
// admin-products.route.js's upsertProduct/loadAdminProduct touched those
// columns directly in raw SQL — this proves create + read still round-trip
// cleanly now that the columns are gone, since nothing else in this test
// suite exercises POST /admin/products at all.
test('product create + read still works after the has_3d/views_3d column removal', { timeout: 30000 }, async (t) => {
  if (!process.env.DATABASE_URL) return t.skip('DATABASE_URL is required for this E2E test.');

  const server = await startServer(0);
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}/api`;
  let cookie = '';
  let csrfToken = '';
  let tenantId = '';

  function captureCookies(response) {
    const setCookies = typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : [response.headers.get('set-cookie')].filter(Boolean);
    for (const raw of setCookies) {
      const [pair] = raw.split(';');
      const [name, value] = pair.split('=');
      if (name === 'elite.sid') cookie = pair;
      if (name === 'elite.csrf') csrfToken = decodeURIComponent(value);
    }
  }

  async function api(path, options = {}) {
    const response = await fetch(`${base}${path}`, {
      ...options,
      headers: {
        ...(options.body ? { 'content-type': 'application/json' } : {}),
        ...(cookie ? { cookie: csrfToken ? `${cookie}; elite.csrf=${csrfToken}` : cookie } : {}),
        ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}),
        ...(options.headers || {}),
      },
    });
    captureCookies(response);
    const body = await response.json();
    if (!response.ok) throw Object.assign(new Error(`${response.status}: ${body.message}`), { response, body });
    return body.data;
  }

  try {
    const user = await api('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: process.env.DEFAULT_ADMIN_EMAIL, password: process.env.DEFAULT_ADMIN_PASSWORD }),
    });
    tenantId = user.tenantId;

    const created = await api('/admin/products', {
      method: 'POST',
      body: JSON.stringify({
        name: 'E2E Test Loafer',
        sku: `E2E-${runId}`,
        brand: 'Elite Test',
        price: 450,
        stock: 5,
      }),
    });
    assert.equal(created.name, 'E2E Test Loafer');
    assert.ok(created.id);
    assert.equal('has3d' in created, false, 'has3d should not be part of the response shape anymore');
    assert.equal('views3d' in created, false, 'views3d should not be part of the response shape anymore');

    const fetched = await api(`/admin/products/${created.id}`);
    assert.equal(fetched.id, created.id);
    assert.equal(fetched.sku, `E2E-${runId}`);

    // Update path (PATCH /:id -> same upsertProduct code path with product.id set).
    const updated = await api(`/admin/products/${created.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name: 'E2E Test Loafer', sku: `E2E-${runId}`, brand: 'Elite Test', price: 475, stock: 5, id: created.id }),
    });
    assert.equal(updated.price, 475);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (tenantId) await db.query('DELETE FROM tenants WHERE id = $1', [tenantId]).catch(() => undefined);
    await db.pool.end();
  }
});
