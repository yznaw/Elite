const test = require('node:test');
const assert = require('node:assert/strict');

require('dotenv').config();

const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
process.env.DEFAULT_TENANT_SLUG = `multi-owner-e2e-${runId}`;
process.env.DEFAULT_TENANT_NAME = 'Multi Owner E2E';
process.env.DEFAULT_ADMIN_EMAIL = `multi-owner-e2e-${runId}@elite.local`;
process.env.DEFAULT_ADMIN_PASSWORD = 'multi-owner-e2e-password';
process.env.DEFAULT_ADMIN_NAME = 'Multi Owner Test Owner';
process.env.SESSION_SECRET = `multi-owner-e2e-session-${runId}`;

const db = require('../db/client');
const { startServer } = require('../index');

// docs/33-user-roles-guide.pdf's "add an owner level" plan, implemented as:
// owner is just another assignable role (no separate promote/confirm flow),
// but only an existing owner can hand it out — an admin must not be able to
// grant owner to themselves or anyone else. Covers: admin blocked, owner
// allowed via direct team-add, owner allowed via invite+accept, and the
// resulting second owner actually has owner-only access (canEditPosPolicy-
// equivalent server check).
test('owner role is assignable only by an existing owner, via both direct add and invite', { timeout: 30000 }, async (t) => {
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

    // Create a real admin (via invite+accept) to prove an admin session,
    // not just a fixture, gets blocked from granting owner.
    const adminEmail = `admin-${runId}@elite.local`;
    const adminInvite = await api('/admin/settings/invitations', {
      method: 'POST',
      body: JSON.stringify({ email: adminEmail, role: 'admin' }),
    });
    const adminToken = new URL(adminInvite.inviteLink).searchParams.get('token');
    const adminPassword = 'admin-e2e-password-1';
    await api('/invitations/accept', { method: 'POST', body: JSON.stringify({ token: adminToken, password: adminPassword, name: 'Gate Test Admin' }) });

    // Switch to the admin session.
    await api('/auth/login', { method: 'POST', body: JSON.stringify({ email: adminEmail, password: adminPassword }) });

    // An admin must not be able to grant owner, via any of the three write paths.
    await assert.rejects(
      api('/admin/settings/team', { method: 'POST', body: JSON.stringify({ name: 'X', email: `x-${runId}@elite.local`, role: 'owner' }) }),
      (error) => error.response.status === 422,
      'admin direct-add of an owner must be rejected',
    );
    await assert.rejects(
      api('/admin/settings/invitations', { method: 'POST', body: JSON.stringify({ email: `y-${runId}@elite.local`, role: 'owner' }) }),
      (error) => error.response.status === 422,
      'admin inviting an owner must be rejected',
    );

    // Switch back to the real owner.
    await api('/auth/login', { method: 'POST', body: JSON.stringify({ email: process.env.DEFAULT_ADMIN_EMAIL, password: process.env.DEFAULT_ADMIN_PASSWORD }) });

    // An admin promoted to owner by the admin themself must be rejected —
    // re-check PATCH /team/:id from the admin's own session.
    await api('/auth/login', { method: 'POST', body: JSON.stringify({ email: adminEmail, password: adminPassword }) });
    const team = await api('/admin/settings/team');
    const selfRow = team.find((m) => m.email === adminEmail);
    await assert.rejects(
      api(`/admin/settings/team/${selfRow.id}`, { method: 'PATCH', body: JSON.stringify({ role: 'owner' }) }),
      (error) => error.response.status === 422,
      'admin self-promoting to owner via PATCH must be rejected',
    );

    // Owner CAN grant owner — direct add.
    await api('/auth/login', { method: 'POST', body: JSON.stringify({ email: process.env.DEFAULT_ADMIN_EMAIL, password: process.env.DEFAULT_ADMIN_PASSWORD }) });
    const secondOwner = await api('/admin/settings/team', {
      method: 'POST',
      body: JSON.stringify({ name: 'Second Owner', email: `owner2-${runId}@elite.local`, role: 'owner' }),
    });
    assert.equal(secondOwner.role, 'owner');

    // Owner CAN grant owner — via invite+accept, and the resulting account
    // really does get owner-level access (proved via the store-settings
    // write path, which is owner/admin-gated but a good proxy — check
    // instead a genuinely owner-only action: PATCH /team/:id granting a
    // THIRD owner, which only an owner session can do).
    const ownerInvite = await api('/admin/settings/invitations', {
      method: 'POST',
      body: JSON.stringify({ email: `owner3-${runId}@elite.local`, role: 'owner' }),
    });
    const ownerToken = new URL(ownerInvite.inviteLink).searchParams.get('token');
    const owner3Password = 'owner3-e2e-password-1';
    const accepted = await api('/invitations/accept', { method: 'POST', body: JSON.stringify({ token: ownerToken, password: owner3Password, name: 'Third Owner' }) });
    assert.equal(accepted.role, 'owner');

    await api('/auth/login', { method: 'POST', body: JSON.stringify({ email: `owner3-${runId}@elite.local`, password: owner3Password }) });
    const fourthOwner = await api('/admin/settings/team', {
      method: 'POST',
      body: JSON.stringify({ name: 'Fourth Owner', email: `owner4-${runId}@elite.local`, role: 'owner' }),
    });
    assert.equal(fourthOwner.role, 'owner', 'a real owner created via invite must itself be able to grant owner');

    const finalTeam = await api('/admin/settings/team');
    const ownerCount = finalTeam.filter((m) => m.role === 'owner').length;
    assert.equal(ownerCount, 4, 'tenant now has 4 owners: bootstrap + 3 granted');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (tenantId) await db.query('DELETE FROM tenants WHERE id = $1', [tenantId]).catch(() => undefined);
    await db.pool.end();
  }
});
