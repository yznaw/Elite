const test = require('node:test');
const assert = require('node:assert/strict');

require('dotenv').config();

const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
process.env.DEFAULT_TENANT_SLUG = `roles-gate-e2e-${runId}`;
process.env.DEFAULT_TENANT_NAME = 'Roles Gate E2E';
process.env.DEFAULT_ADMIN_EMAIL = `roles-gate-e2e-${runId}@elite.local`;
process.env.DEFAULT_ADMIN_PASSWORD = 'roles-gate-e2e-password';
process.env.DEFAULT_ADMIN_NAME = 'Roles Gate Test Owner';
process.env.SESSION_SECRET = `roles-gate-e2e-session-${runId}`;

const db = require('../db/client');
const { startServer } = require('../index');

// docs/32-permission-enforcement-ux-design.md §1 flagged that the team/
// invitation write routes had no server-side role check of their own — the
// client's roleGuard(['owner','admin']) on /settings was the only thing
// stopping a lower-privilege session from calling them directly. This
// proves the fix: a real cashier session (created through the actual
// invite-accept flow, not a fixture) gets 403 on every write route, while
// reads (documented as intentionally broader — see index.js's /settings
// mount comment) still work.
test('a non-owner/admin session cannot write team/store/invitation settings, but can still read them', { timeout: 30000 }, async (t) => {
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
    const owner = await api('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: process.env.DEFAULT_ADMIN_EMAIL, password: process.env.DEFAULT_ADMIN_PASSWORD }),
    });
    tenantId = owner.tenantId;

    const cashierEmail = `cashier-gate-${runId}@elite.local`;
    const invite = await api('/admin/settings/invitations', {
      method: 'POST',
      body: JSON.stringify({ email: cashierEmail, role: 'cashier' }),
    });
    const token = new URL(invite.inviteLink).searchParams.get('token');
    assert.ok(token, 'invite link must carry a token');

    const cashierPassword = 'cashier-gate-password-1';
    await api('/invitations/accept', {
      method: 'POST',
      body: JSON.stringify({ token, password: cashierPassword, name: 'Gate Test Cashier' }),
    });

    // Switch sessions: logging in as the cashier overwrites cookie/csrfToken
    // with the new session, so every call below runs as the cashier.
    await api('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: cashierEmail, password: cashierPassword }),
    });

    // Reads should still work for a cashier per the documented intent.
    const team = await api('/admin/settings/team');
    assert.ok(Array.isArray(team));

    // Every write route must now 403 for a cashier session.
    const writes = [
      ['/admin/settings/store', { method: 'PATCH', body: JSON.stringify({ name: 'Hijacked' }) }],
      ['/admin/settings/team', { method: 'POST', body: JSON.stringify({ name: 'X', email: `x-${runId}@elite.local`, role: 'viewer' }) }],
      ['/admin/settings/integrations', { method: 'POST', body: JSON.stringify({ key: 'x' }) }],
      ['/admin/settings/invitations', { method: 'POST', body: JSON.stringify({ email: `y-${runId}@elite.local`, role: 'viewer' }) }],
    ];
    for (const [path, options] of writes) {
      await assert.rejects(
        api(path, options),
        (error) => error.response.status === 403,
        `expected 403 for cashier on ${options.method} ${path}`,
      );
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (tenantId) await db.query('DELETE FROM tenants WHERE id = $1', [tenantId]).catch(() => undefined);
    await db.pool.end();
  }
});
