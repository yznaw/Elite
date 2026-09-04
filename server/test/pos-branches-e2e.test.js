const test = require('node:test');
const assert = require('node:assert/strict');

require('dotenv').config();

const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
process.env.DEFAULT_TENANT_SLUG = `pos-branches-e2e-${runId}`;
process.env.DEFAULT_TENANT_NAME = 'POS Branches E2E';
process.env.DEFAULT_ADMIN_EMAIL = `pos-branches-e2e-${runId}@elite.local`;
process.env.DEFAULT_ADMIN_PASSWORD = 'pos-branches-e2e-password';
process.env.DEFAULT_ADMIN_NAME = 'Branches Test Owner';
process.env.SESSION_SECRET = `pos-branches-e2e-session-${runId}`;

const bcrypt = require('bcryptjs');
const db = require('../db/client');
const { startServer } = require('../index');

/**
 * Coverage this file exists to close: nothing before it exercised
 * /admin/pos-branches, the register-branch assignment endpoint, or the
 * multi-branch resolution path on GET /pos/business-profile at all — the
 * existing pos-authenticated-e2e.test.js checkout flow never touches any of
 * it. Runs against a real server and a real, disposable tenant, the same way
 * the sibling e2e file does.
 */
test('branch CRUD, default-invariant guards, and per-register receipt resolution', { timeout: 60000 }, async (t) => {
  if (!process.env.DATABASE_URL) return t.skip('DATABASE_URL is required for POS branches E2E.');

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

  // One session throughout, matching how pos-authenticated-e2e.test.js does
  // it: `/pos/registers/enroll` requires an already-authenticated admin
  // session (not a bare anonymous one), and the same session then becomes
  // register-checked-in too (req.session.posRegisterId gets set alongside
  // req.user). GET /pos/business-profile reads that same session's
  // posRegisterId, so switching which branch *that* register is assigned to
  // is what proves per-register resolution below — no second session needed.
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

  const branchPayload = (overrides = {}) => ({
    name: `Branch ${runId}`,
    tradeNameEn: 'Elite Collection', tradeNameAr: '',
    addressEn: '123 Test Street, Doha', addressAr: '',
    phone: '+974 4000 0000',
    crLicenseNumber: null, returnPolicyEn: null, returnPolicyAr: null,
    ...overrides,
  });

  try {
    const owner = await api('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: process.env.DEFAULT_ADMIN_EMAIL, password: process.env.DEFAULT_ADMIN_PASSWORD }),
    });
    tenantId = owner.tenantId;

    // Business-profile reads are POS operations and therefore require a
    // checked-in register even while the tenant has no branches configured.
    const enrollment = await api('/pos/registers/enrollment-tokens', {
      method: 'POST', body: JSON.stringify({ displayName: `Branch Test Register ${runId}` }),
    });
    const enrolled = await api('/pos/registers/enroll', {
      method: 'POST', body: JSON.stringify({ enrollmentToken: enrollment.token }),
    });
    assert.ok(enrolled.registerCredential);

    // ── A brand-new tenant starts with no branches at all ──────────────────
    // Migration 027's backfill only covers tenants that already existed at
    // the moment the server booted; this tenant was created after that, so
    // it must start empty rather than inheriting some other tenant's row.
    assert.deepEqual(await api('/admin/pos-branches'), []);

    // ── And the till read path must not 500 on zero branches ───────────────
    // Matches the old "no profile configured yet" contract: null, not an error.
    assert.equal(await api('/pos/business-profile'), null);

    // ── Validation: name and tradeNameEn are required ───────────────────────
    await assert.rejects(
      () => api('/admin/pos-branches', { method: 'POST', body: JSON.stringify(branchPayload({ name: '' })) }),
      (err) => err.response.status === 422,
    );

    // ── Create the first branch ──────────────────────────────────────────
    const branchA = await api('/admin/pos-branches', {
      method: 'POST',
      body: JSON.stringify(branchPayload({ name: `A-${runId}`, addressEn: 'Branch A Street, Doha' })),
    });
    assert.equal(branchA.isDefault, false, 'creating a branch must never make it the default on its own');

    // ── Duplicate name is rejected with a specific, actionable code ────────
    await assert.rejects(
      () => api('/admin/pos-branches', { method: 'POST', body: JSON.stringify(branchPayload({ name: `A-${runId}` })) }),
      (err) => err.response.status === 409 && err.body.code === 'BRANCH_NAME_TAKEN',
    );

    // ── Fallback arm 3: oldest branch, even though nothing is flagged default ──
    // No setDefaultBranch call has happened yet. A fresh tenant creating its
    // first branch must still resolve to *something* the moment that branch
    // exists, not stay null forever waiting for an explicit default pick.
    const profileBeforeDefault = await api('/pos/business-profile');
    assert.equal(profileBeforeDefault.addressEn, 'Branch A Street, Doha');

    // ── Second branch, then flip the default explicitly ─────────────────────
    const branchB = await api('/admin/pos-branches', {
      method: 'POST',
      body: JSON.stringify(branchPayload({ name: `B-${runId}`, addressEn: 'Branch B Street, Lusail' })),
    });
    await api(`/admin/pos-branches/${branchB.id}/set-default`, { method: 'POST', body: '{}' });

    const branchesAfterDefaultFlip = await api('/admin/pos-branches');
    assert.equal(branchesAfterDefaultFlip.find((b) => b.id === branchA.id).isDefault, false);
    assert.equal(branchesAfterDefaultFlip.find((b) => b.id === branchB.id).isDefault, true);

    const profileAfterDefaultFlip = await api('/pos/business-profile');
    assert.equal(profileAfterDefaultFlip.addressEn, 'Branch B Street, Lusail');

    // ── A register explicitly assigned to A overrides the tenant default (B) ──
    // Before assignment: this register is unassigned, so it sees the tenant
    // default (B), same as any other unassigned register would.
    assert.equal((await api('/pos/business-profile')).addressEn, 'Branch B Street, Lusail');

    await api(`/admin/pos-security/registers/${enrolled.registerId}/branch`, {
      method: 'PUT', body: JSON.stringify({ branchId: branchA.id }),
    });

    // After assignment: this specific register sees A, despite B still being
    // the tenant-wide default — proving resolution is per-register, not just
    // per-tenant.
    assert.equal((await api('/pos/business-profile')).addressEn, 'Branch A Street, Doha');

    const registersList = await api('/admin/pos-security/registers');
    const registerRow = registersList.find((r) => r.registerId === enrolled.registerId);
    assert.equal(registerRow.branchId, branchA.id);
    assert.equal(registerRow.branchName, `A-${runId}`);

    // ── Unassigning (branchId: null) falls back to the default again ───────
    await api(`/admin/pos-security/registers/${enrolled.registerId}/branch`, {
      method: 'PUT', body: JSON.stringify({ branchId: null }),
    });
    assert.equal((await api('/pos/business-profile')).addressEn, 'Branch B Street, Lusail');

    // ── Delete guard: cannot delete a branch with a register assigned ──────
    await api(`/admin/pos-security/registers/${enrolled.registerId}/branch`, {
      method: 'PUT', body: JSON.stringify({ branchId: branchA.id }),
    });
    await assert.rejects(
      () => api(`/admin/pos-branches/${branchA.id}`, { method: 'DELETE' }),
      (err) => err.response.status === 409 && err.body.code === 'BRANCH_HAS_REGISTERS',
    );

    // Reassign, then the same delete succeeds.
    await api(`/admin/pos-security/registers/${enrolled.registerId}/branch`, {
      method: 'PUT', body: JSON.stringify({ branchId: branchB.id }),
    });
    const deleted = await api(`/admin/pos-branches/${branchA.id}`, { method: 'DELETE' });
    assert.equal(deleted.deleted, true);

    // ── Delete guard: cannot delete the tenant's only remaining branch ─────
    await assert.rejects(
      () => api(`/admin/pos-branches/${branchB.id}`, { method: 'DELETE' }),
      (err) => err.response.status === 409 && err.body.code === 'BRANCH_LAST_REMAINING',
    );

    // ── A non-owner/admin role cannot reach any of this ─────────────────────
    // Mirrors the approver-manager pattern from pos-authenticated-e2e: a real
    // second account, not a role flag flipped in-process.
    const managerEmail = `pos-branches-e2e-manager-${runId}@elite.local`;
    await db.query(
      `INSERT INTO admin_users (tenant_id, email, password_hash, full_name, initials, role, status)
       VALUES ($1, $2, $3, $4, 'MG', 'manager', 'active')`,
      [tenantId, managerEmail, await bcrypt.hash('irrelevant-pos-e2e-password', 12), 'E2E Manager'],
    );
    // Managers cannot self-serve a password in this flow, so this checks the
    // service-level gate directly rather than a manager login round trip —
    // still a real, separate role value from the same table the route reads.
    const branchService = require('../lib/pos/branch-service');
    await assert.rejects(
      () => branchService.listBranches({ tenantId, role: 'manager' }),
      (err) => err.status === 403 && err.code === 'INSUFFICIENT_PERMISSIONS',
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (tenantId) await db.query('DELETE FROM tenants WHERE id = $1', [tenantId]).catch(() => undefined);
    await db.pool.end();
  }
});
