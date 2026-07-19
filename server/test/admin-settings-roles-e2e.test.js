const test = require('node:test');
const assert = require('node:assert/strict');

require('dotenv').config();

const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
process.env.DEFAULT_TENANT_SLUG = `roles-e2e-${runId}`;
process.env.DEFAULT_TENANT_NAME = 'Roles E2E';
process.env.DEFAULT_ADMIN_EMAIL = `roles-e2e-${runId}@elite.local`;
process.env.DEFAULT_ADMIN_PASSWORD = 'roles-e2e-password';
process.env.DEFAULT_ADMIN_NAME = 'Roles Test Owner';
process.env.SESSION_SECRET = `roles-e2e-session-${runId}`;

const db = require('../db/client');
const { startServer } = require('../index');

test('team invitations and direct team-member edits validate role against an allowlist', { timeout: 30000 }, async (t) => {
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

    // Valid role — cashier is a real, assignable role (docs/15 Phase 3).
    const invite = await api('/admin/settings/invitations', {
      method: 'POST',
      body: JSON.stringify({ email: `cashier-${runId}@elite.local`, role: 'cashier' }),
    });
    assert.ok(invite.inviteLink);

    // Invalid/garbage role must be rejected with a clean validation error,
    // not silently inserted (the pre-fix behavior) or a raw DB error.
    await assert.rejects(
      api('/admin/settings/invitations', {
        method: 'POST',
        body: JSON.stringify({ email: `bad-role-${runId}@elite.local`, role: 'superadmin' }),
      }),
      (error) => error.response.status === 422,
    );

    // Owner is not assignable through this endpoint.
    await assert.rejects(
      api('/admin/settings/invitations', {
        method: 'POST',
        body: JSON.stringify({ email: `owner-attempt-${runId}@elite.local`, role: 'owner' }),
      }),
      (error) => error.response.status === 422,
    );

    // Direct team-member add: same validation applies.
    const member = await api('/admin/settings/team', {
      method: 'POST',
      body: JSON.stringify({ name: 'E2E Cashier', email: `cashier2-${runId}@elite.local`, role: 'cashier' }),
    });
    assert.equal(member.role, 'cashier');

    await assert.rejects(
      api('/admin/settings/team', {
        method: 'POST',
        body: JSON.stringify({ name: 'E2E Bad Role', email: `bad2-${runId}@elite.local`, role: 'not-a-role' }),
      }),
      (error) => error.response.status === 422,
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (tenantId) await db.query('DELETE FROM tenants WHERE id = $1', [tenantId]).catch(() => undefined);
    await db.pool.end();
  }
});
