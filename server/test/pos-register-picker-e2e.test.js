const test = require('node:test');
const assert = require('node:assert/strict');

require('dotenv').config();

const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
process.env.DEFAULT_TENANT_SLUG = `pos-pick-${runId}`;
process.env.DEFAULT_TENANT_NAME = 'POS Picker E2E';
process.env.DEFAULT_ADMIN_EMAIL = `pos-pick-${runId}@elite.local`;
process.env.DEFAULT_ADMIN_PASSWORD = 'pos-pick-password';
process.env.DEFAULT_ADMIN_NAME = 'POS Picker Owner';
process.env.SESSION_SECRET = `pos-pick-session-${runId}`;

const bcrypt = require('bcryptjs');
const db = require('../db/client');
const { startServer } = require('../index');

/**
 * The register picker replaced the enrollment-token ceremony as the everyday
 * way onto a counter (docs/12 section 6). What matters here is that a cashier
 * standing at a till can bind this browser to it without an owner present,
 * that re-picking the same till after a wiped IndexedDB works, and that the
 * privileged half (creating a register) is still owner/admin only.
 */
test('register picker: list, claim, credential rotation, and role limits', { timeout: 60000 }, async (t) => {
  if (!process.env.DATABASE_URL) return t.skip('DATABASE_URL is required for POS E2E.');

  let tenantId = '';
  const server = await startServer(0);
  const base = `http://127.0.0.1:${server.address().port}/api`;

  /** Each session is its own cookie jar so owner and cashier can be driven side by side. */
  function agent() {
    const jar = { cookie: '', csrf: '' };
    return async function api(path, options = {}) {
      const response = await fetch(`${base}${path}`, {
        ...options,
        headers: {
          ...(options.body ? { 'content-type': 'application/json' } : {}),
          ...(jar.cookie ? { cookie: jar.csrf ? `${jar.cookie}; elite.csrf=${jar.csrf}` : jar.cookie } : {}),
          ...(jar.csrf ? { 'x-csrf-token': jar.csrf } : {}),
          ...(options.headers || {}),
        },
      });
      const setCookies = typeof response.headers.getSetCookie === 'function'
        ? response.headers.getSetCookie()
        : [response.headers.get('set-cookie')].filter(Boolean);
      for (const raw of setCookies) {
        const [pair] = raw.split(';');
        const [name, value] = pair.split('=');
        if (name === 'elite.sid') jar.cookie = pair;
        if (name === 'elite.csrf') jar.csrf = decodeURIComponent(value);
      }
      const body = await response.json();
      if (!response.ok) throw Object.assign(new Error(`${response.status}: ${body.message}`), { status: response.status, body });
      return body.data;
    };
  }

  try {
    const owner = agent();
    const ownerUser = await owner('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: process.env.DEFAULT_ADMIN_EMAIL, password: process.env.DEFAULT_ADMIN_PASSWORD }),
    });
    tenantId = ownerUser.tenantId;

    const cashierPassword = 'pos-pick-cashier-password';
    await db.query(
      `INSERT INTO admin_users
        (tenant_id, email, password_hash, full_name, initials, role, status)
       VALUES ($1,$2,$3,$4,'PC','cashier','active')`,
      [ownerUser.tenantId, `pos-pick-cashier-${runId}@elite.local`, await bcrypt.hash(cashierPassword, 12), 'Picker Cashier'],
    );

    // Owner adds the first till by name — no token minted, no paste step.
    const created = await owner('/pos/registers/claim', {
      method: 'POST', body: JSON.stringify({ displayName: `Picker Till ${runId}` }),
    });
    assert.ok(created.registerId);
    assert.ok(created.registerCredential);
    assert.equal(created.displayName, `Picker Till ${runId}`);

    // A duplicate name is refused, pointing at the existing till rather than
    // creating a second register that competes for the same drawer.
    await assert.rejects(
      () => owner('/pos/registers/claim', { method: 'POST', body: JSON.stringify({ displayName: `picker till ${runId}` }) }),
      (error) => error.status === 409 && error.body.code === 'REGISTER_NAME_TAKEN',
    );

    const cashier = agent();
    await cashier('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: `pos-pick-cashier-${runId}@elite.local`, password: cashierPassword }),
    });

    // The list is readable by a cashier: picking your own till is not privileged.
    const listed = await cashier('/pos/registers');
    const row = listed.registers.find((item) => item.registerId === created.registerId);
    assert.ok(row, 'cashier should see the till in the picker');
    assert.equal(row.displayName, `Picker Till ${runId}`);
    assert.equal(row.openShiftId, null);

    // Creating one is still owner/admin only.
    await assert.rejects(
      () => cashier('/pos/registers/claim', { method: 'POST', body: JSON.stringify({ displayName: `Cashier Till ${runId}` }) }),
      (error) => error.status === 403 && error.body.code === 'INSUFFICIENT_PERMISSIONS',
    );

    // This is the wiped-IndexedDB case: the cashier picks the same till and
    // gets a working credential, without an owner walking over with a token.
    const reclaimed = await cashier('/pos/registers/claim', {
      method: 'POST', body: JSON.stringify({ registerId: created.registerId }),
    });
    assert.equal(reclaimed.registerId, created.registerId);
    assert.notEqual(reclaimed.registerCredential, created.registerCredential);
    await cashier('/pos/registers/check-in', {
      method: 'POST',
      body: JSON.stringify({ registerId: reclaimed.registerId, registerCredential: reclaimed.registerCredential }),
    });

    // One register stays one terminal: the superseded credential is dead, so
    // the machine that held it is sent back to the picker rather than quietly
    // ringing sales into a drawer someone else is now counting.
    await assert.rejects(
      () => owner('/pos/registers/check-in', {
        method: 'POST',
        body: JSON.stringify({ registerId: created.registerId, registerCredential: created.registerCredential }),
      }),
      (error) => error.status === 401 && error.body.code === 'REGISTER_CREDENTIAL_INVALID',
    );

    // An open shift is surfaced in the list so the next person sees it before
    // taking the till over.
    await cashier('/pos/shifts/open', { method: 'POST', body: JSON.stringify({ openingFloatCents: 2500 }) });
    const withShift = await cashier('/pos/registers');
    const busy = withShift.registers.find((item) => item.registerId === created.registerId);
    assert.ok(busy.openShiftId);
    assert.equal(busy.openShiftCashier, 'Picker Cashier');

    // A revoked register drops out of the picker and cannot be claimed.
    await owner(`/admin/pos-security/registers/${created.registerId}/revoke`, { method: 'POST', body: '{}' });
    const afterRevoke = await cashier('/pos/registers');
    assert.equal(afterRevoke.registers.some((item) => item.registerId === created.registerId), false);
    await assert.rejects(
      () => cashier('/pos/registers/claim', { method: 'POST', body: JSON.stringify({ registerId: created.registerId }) }),
      (error) => error.status === 403 && error.body.code === 'REGISTER_DISABLED',
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (tenantId) await db.query('DELETE FROM tenants WHERE id = $1', [tenantId]).catch(() => undefined);
    await db.pool.end();
  }
});
