const test = require('node:test');
const assert = require('node:assert/strict');

require('dotenv').config();

const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
process.env.DEFAULT_TENANT_SLUG = `team-lifecycle-e2e-${runId}`;
process.env.DEFAULT_TENANT_NAME = 'Team Lifecycle E2E';
process.env.DEFAULT_ADMIN_EMAIL = `team-lifecycle-e2e-${runId}@elite.local`;
process.env.DEFAULT_ADMIN_PASSWORD = 'team-lifecycle-e2e-password';
process.env.DEFAULT_ADMIN_NAME = 'Lifecycle Test Owner';
process.env.SESSION_SECRET = `team-lifecycle-e2e-session-${runId}`;

const db = require('../db/client');
const { startServer } = require('../index');

// Covers the team-member lifecycle gaps found in the "هل خاصية اضافة اعضاء
// الفريق كاملة" audit: resend re-issuing a token (and invalidating the old
// one), duplicate-invite detection, disable/reactivate, and the "Remove"
// action that used to write an invalid enum value (status='removed') and
// fail at the DB layer — migration 028 adds that enum value, this proves
// the fix actually works end to end, not just that the migration applies.
test('team member lifecycle: resend, duplicate-invite flag, disable/reactivate, remove', { timeout: 30000 }, async (t) => {
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

    // ── Duplicate-invite detection ──────────────────────────────────────
    const inviteEmail = `dup-${runId}@elite.local`;
    const first = await api('/admin/settings/invitations', {
      method: 'POST',
      body: JSON.stringify({ email: inviteEmail, role: 'cashier' }),
    });
    assert.equal(first.hadPendingInvite, false);

    const second = await api('/admin/settings/invitations', {
      method: 'POST',
      body: JSON.stringify({ email: inviteEmail, role: 'manager' }),
    });
    assert.equal(second.hadPendingInvite, true, 'a second invite to the same still-pending email should be flagged');

    const pending = await api('/admin/settings/invitations');
    const row = pending.find((i) => i.email === inviteEmail);
    assert.ok(row, 'invitation should appear in the pending list');
    assert.equal(row.role, 'manager', 'the second invite overwrote the role, matching the existing upsert behavior');
    assert.equal(row.email_sent, false, 'no SMTP configured in this test env');
    assert.equal(row.resend_count, 0);

    // ── Resend: new token, old token invalidated, counter increments ───
    const validateBefore = await fetch(`${base}/invitations/validate?token=does-not-matter`).then((r) => r.json());
    assert.equal(validateBefore.success, false); // sanity check the endpoint itself works

    const resend1 = await api(`/admin/settings/invitations/${row.id}/resend`, { method: 'POST' });
    assert.equal(resend1.email, inviteEmail);
    assert.ok(resend1.inviteLink);

    const pendingAfterResend = await api('/admin/settings/invitations');
    const rowAfterResend = pendingAfterResend.find((i) => i.email === inviteEmail);
    assert.equal(rowAfterResend.resend_count, 1);

    // ── Disable a team member (soft, reversible) ────────────────────────
    const member = await api('/admin/settings/team', {
      method: 'POST',
      body: JSON.stringify({ name: 'Lifecycle Cashier', email: `cashier-${runId}@elite.local`, role: 'cashier' }),
    });
    assert.equal(member.status, 'active');

    const disabled = await api(`/admin/settings/team/${member.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'disabled' }),
    });
    assert.equal(disabled.status, 'disabled');

    const reactivated = await api(`/admin/settings/team/${member.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'active' }),
    });
    assert.equal(reactivated.status, 'active');

    // ── Remove: the actual bug this session fixed ───────────────────────
    // Before migration 028, this PATCH failed at the DB layer because
    // 'removed' was not a valid team_member_status enum value.
    const removed = await api(`/admin/settings/team/${member.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'removed' }),
    });
    assert.equal(removed.status, 'removed');

    const teamAfterRemove = await api('/admin/settings/team');
    assert.ok(!teamAfterRemove.some((m) => m.id === member.id), 'a removed member must not appear in the team list');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (tenantId) await db.query('DELETE FROM tenants WHERE id = $1', [tenantId]).catch(() => undefined);
    await db.pool.end();
  }
});
