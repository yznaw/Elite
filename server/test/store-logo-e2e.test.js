const test = require('node:test');
const assert = require('node:assert/strict');

require('dotenv').config();

const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
process.env.DEFAULT_TENANT_SLUG = `store-logo-e2e-${runId}`;
process.env.DEFAULT_TENANT_NAME = 'Store Logo E2E';
process.env.DEFAULT_ADMIN_EMAIL = `store-logo-e2e-${runId}@elite.local`;
process.env.DEFAULT_ADMIN_PASSWORD = 'store-logo-e2e-password';
process.env.DEFAULT_ADMIN_NAME = 'Logo Test Owner';
process.env.SESSION_SECRET = `store-logo-e2e-session-${runId}`;

const db = require('../db/client');
const { startServer } = require('../index');

// docs/30-admin-and-storefront-open-items.md §1.4 flagged the Settings →
// General → Logo "Edit" button as a stub with no click handler. This proves
// the wired-up version actually persists: brand_profiles.logo_url already
// existed as a column (migration 001) but PATCH /admin/settings/store never
// wrote to it and GET never exposed it meaningfully client-side — both are
// now fixed. Covers set, update, and clear (explicit null).
test('store logo: PATCH /admin/settings/store persists and clears logoUrl', { timeout: 30000 }, async (t) => {
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

    const before = await api('/admin/settings/store');
    assert.equal(before.logo_url ?? null, null, 'a fresh tenant has no logo set');

    const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    await api('/admin/settings/store', { method: 'PATCH', body: JSON.stringify({ logoUrl: dataUrl }) });

    const afterSet = await api('/admin/settings/store');
    assert.equal(afterSet.logo_url, dataUrl, 'logo_url round-trips through GET after being set');

    // A save with logoUrl omitted must not clobber it (COALESCE-style
    // behavior for every other field on this route).
    await api('/admin/settings/store', { method: 'PATCH', body: JSON.stringify({ name: 'Store Logo E2E Renamed' }) });
    const afterUnrelatedSave = await api('/admin/settings/store');
    assert.equal(afterUnrelatedSave.logo_url, dataUrl, 'logo survives a save that does not mention logoUrl');

    // Explicit null clears it — this is the "Remove" button path.
    await api('/admin/settings/store', { method: 'PATCH', body: JSON.stringify({ logoUrl: null }) });
    const afterClear = await api('/admin/settings/store');
    assert.equal(afterClear.logo_url, null, 'explicit null clears the logo');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (tenantId) await db.query('DELETE FROM tenants WHERE id = $1', [tenantId]).catch(() => undefined);
    await db.pool.end();
  }
});
