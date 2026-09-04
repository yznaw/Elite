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
    const jar = { cookie: '', csrf: '', device: '' };
    return async function api(path, options = {}) {
      const response = await fetch(`${base}${path}`, {
        ...options,
        headers: {
          ...(options.body ? { 'content-type': 'application/json' } : {}),
          ...(() => {
            const parts = [jar.cookie, jar.csrf && `elite.csrf=${jar.csrf}`, jar.device].filter(Boolean);
            return parts.length ? { cookie: parts.join('; ') } : {};
          })(),
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
        // The device binding lives here, deliberately outside the session —
        // see lib/pos/device-cookie.js. An expired maxAge means "forget it".
        if (name === 'elite.pos_device') jar.device = /Max-Age=0|Expires=Thu, 01 Jan 1970/i.test(raw) ? '' : pair;
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
    const cashierUser = await db.query(
      `INSERT INTO admin_users
        (tenant_id, email, password_hash, full_name, initials, role, status)
       VALUES ($1,$2,$3,$4,'PC','cashier','active')
       RETURNING id`,
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

    // A different browser taking an already-paired till is explicit, even
    // before a shift opens. With no manager PIN configured, confirmation is
    // sufficient; the new lease invalidates the old browser immediately.
    await assert.rejects(
      () => cashier('/pos/registers/claim', {
        method: 'POST', body: JSON.stringify({ registerId: created.registerId }),
      }),
      (error) => error.status === 409 && error.body.code === 'REGISTER_TAKEOVER_CONFIRM',
    );
    const reclaimed = await cashier('/pos/registers/claim', {
      method: 'POST', body: JSON.stringify({ registerId: created.registerId, confirmTakeover: true }),
    });
    assert.equal(reclaimed.registerId, created.registerId);
    assert.notEqual(reclaimed.registerCredential, created.registerCredential);
    await cashier('/pos/registers/check-in', {
      method: 'POST',
      body: JSON.stringify({ registerId: reclaimed.registerId, registerCredential: reclaimed.registerCredential }),
    });
    await assert.rejects(
      () => owner('/pos/registers/current'),
      (error) => error.status === 409 && error.body.code === 'REGISTER_LEASE_INVALID',
    );

    // One register stays one terminal: the superseded credential is dead, so
    // the machine that held it is sent back to the picker rather than quietly
    // ringing sales into a drawer someone else is now counting.
    //
    // 409 and not 401 on purpose. The admin portal turns any 401 into "session
    // expired" and redirects to /login, which bounces straight back to /pos
    // while the login is in fact valid — a till whose register had been deleted
    // ping-ponged between the two until its cookies were cleared by hand.
    await assert.rejects(
      () => owner('/pos/registers/check-in', {
        method: 'POST',
        body: JSON.stringify({ registerId: created.registerId, registerCredential: created.registerCredential }),
      }),
      (error) => error.status === 409 && error.body.code === 'REGISTER_CREDENTIAL_INVALID',
    );

    // An open shift is surfaced in the list so the next person sees it before
    // taking the till over.
    const openedShift = await cashier('/pos/shifts/open', { method: 'POST', body: JSON.stringify({ openingFloatCents: 2500 }) });
    await assert.rejects(
      () => owner(`/admin/settings/team/${cashierUser.rows[0].id}`, {
        method: 'PATCH', body: JSON.stringify({ status: 'disabled' }),
      }),
      (error) => error.status === 409 && error.body.code === 'USER_HAS_ACTIVE_SHIFT',
    );
    await assert.rejects(
      () => owner('/pos/sync-state', {
        method: 'PUT',
        body: JSON.stringify({ shiftId: openedShift.shiftId, pendingCount: 0, rejectedCount: 0 }),
      }),
      (error) => error.status === 409 && error.body.code === 'REGISTER_LEASE_INVALID',
    );

    // Two people sharing the same cashier login are still two physical
    // devices. The matching user id does not bypass takeover confirmation.
    const cashierClone = agent();
    await cashierClone('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: `pos-pick-cashier-${runId}@elite.local`, password: cashierPassword }),
    });
    await assert.rejects(
      () => cashierClone('/pos/registers/claim', {
        method: 'POST', body: JSON.stringify({ registerId: created.registerId }),
      }),
      (error) => error.status === 409 && error.body.code === 'REGISTER_TAKEOVER_CONFIRM',
    );
    const withShift = await cashier('/pos/registers');
    const busy = withShift.registers.find((item) => item.registerId === created.registerId);
    assert.ok(busy.openShiftId);
    assert.equal(busy.openShiftCashier, 'Picker Cashier');

    // Branch scope. Every POS user used to see every register in the tenant,
    // so a cashier standing in one shop could bind their browser to a till in
    // another and rotate its credential from across town (migration 035).
    //
    // Both branches are explicit and the register is pinned to one of them: a
    // register with no branch of its own resolves to the tenant's default (or
    // oldest) branch, which would otherwise make what is being tested depend
    // on which branch row happened to be created first.
    const branchA = await db.query(
      `INSERT INTO pos_branches (tenant_id, name, trade_name_en)
       VALUES ($1, $2, 'Main Shop') RETURNING id`,
      [tenantId, `Main Shop ${runId}`],
    );
    const branchB = await db.query(
      `INSERT INTO pos_branches (tenant_id, name, trade_name_en)
       VALUES ($1, $2, 'Second Shop') RETURNING id`,
      [tenantId, `Second Shop ${runId}`],
    );
    await db.query('UPDATE pos_registers SET branch_id = $1 WHERE id = $2', [branchA.rows[0].id, created.registerId]);
    await db.query(
      `UPDATE admin_users SET pos_branch_id = $1 WHERE tenant_id = $2 AND role = 'cashier'`,
      [branchB.rows[0].id, tenantId],
    );

    // The till stands in branch A, the cashier works at branch B, so it drops
    // out of their picker entirely.
    const scopedList = await cashier('/pos/registers');
    assert.equal(scopedList.registers.some((item) => item.registerId === created.registerId), false);
    await assert.rejects(
      () => cashier('/pos/registers/current'),
      (error) => error.status === 403 && error.body.code === 'REGISTER_OUT_OF_BRANCH',
    );

    // Hiding it is not the rule — claiming it by id is refused too, since
    // registerId is just a body field the client controls.
    await assert.rejects(
      () => cashier('/pos/registers/claim', { method: 'POST', body: JSON.stringify({ registerId: created.registerId }) }),
      (error) => error.status === 403 && error.body.code === 'REGISTER_OUT_OF_BRANCH',
    );

    // Owners and admins stay unscoped, and the row now names its branch so a
    // till called "Counter 2" is not ambiguous across shops.
    const ownerList = await owner('/pos/registers');
    const ownerRow = ownerList.registers.find((item) => item.registerId === created.registerId);
    assert.ok(ownerRow, 'an unscoped owner still sees every till');
    assert.equal(ownerRow.branchName, `Main Shop ${runId}`);

    // Move the cashier to the till's own branch and it comes back.
    await db.query(
      `UPDATE admin_users SET pos_branch_id = $1 WHERE tenant_id = $2 AND role = 'cashier'`,
      [branchA.rows[0].id, tenantId],
    );
    const rescopedList = await cashier('/pos/registers');
    assert.ok(rescopedList.registers.some((item) => item.registerId === created.registerId));

    // Taking a till off the cashier who is mid-shift on it is a two-step act:
    // claiming re-mints the credential, so the machine at that counter is
    // signed out and whoever claims inherits the open drawer. The first attempt
    // is refused and names the holder.
    await assert.rejects(
      () => owner('/pos/registers/claim', { method: 'POST', body: JSON.stringify({ registerId: created.registerId }) }),
      (error) => error.status === 409
        && error.body.code === 'REGISTER_TAKEOVER_CONFIRM'
        && error.body.message.includes('Picker Cashier'),
    );

    // With no manager PIN configured anywhere in the shop there is nothing to
    // check one against, so an explicit confirmation is enough — same rule
    // verifyManagerPin() applies, and the audit event still records the
    // takeover and who it was taken from.
    const takenOver = await owner('/pos/registers/claim', {
      method: 'POST', body: JSON.stringify({ registerId: created.registerId, confirmTakeover: true }),
    });
    assert.equal(takenOver.registerId, created.registerId);
    const takeoverAudit = await db.query(
      `SELECT after_state FROM audit_events
        WHERE tenant_id = $1 AND action = 'pos.register.claimed' AND entity_id = $2
        ORDER BY occurred_at DESC LIMIT 1`,
      [tenantId, created.registerId],
    );
    assert.equal(takeoverAudit.rows[0].after_state.takeover, true);
    assert.equal(takeoverAudit.rows[0].after_state.takenFromCashierName, 'Picker Cashier');

    // Once a manager PIN exists, the confirmation alone is not enough.
    await db.query(
      `UPDATE admin_users SET pos_pin_hash = $1 WHERE tenant_id = $2 AND role = 'owner'`,
      [await bcrypt.hash('4821', 12), tenantId],
    );
    // The same account on a different physical browser is still a takeover;
    // sharing a login must not bypass the device lease.
    await assert.rejects(
      () => cashier('/pos/registers/claim', { method: 'POST', body: JSON.stringify({ registerId: created.registerId }) }),
      (error) => error.status === 409 && error.body.code === 'REGISTER_TAKEOVER_CONFIRM',
    );
    await cashier('/pos/registers/claim', {
      method: 'POST',
      body: JSON.stringify({ registerId: created.registerId, confirmTakeover: true, managerPin: '4821' }),
    });
    await assert.rejects(
      () => owner('/pos/registers/claim', {
        method: 'POST', body: JSON.stringify({ registerId: created.registerId, confirmTakeover: true }),
      }),
      (error) => error.status === 403 && error.body.code === 'MANAGER_PIN_REQUIRED',
    );
    await assert.rejects(
      () => owner('/pos/registers/claim', {
        method: 'POST',
        body: JSON.stringify({ registerId: created.registerId, confirmTakeover: true, managerPin: '0000' }),
      }),
      (error) => error.status === 403 && error.body.code === 'MANAGER_PIN_INVALID',
    );
    const approved = await owner('/pos/registers/claim', {
      method: 'POST',
      body: JSON.stringify({ registerId: created.registerId, confirmTakeover: true, managerPin: '4821' }),
    });
    assert.equal(approved.registerId, created.registerId);

    // The binding belongs to the machine, not to the login. Signing out and
    // back in — or a second admin signing in on the same counter PC — used to
    // land on the "Which till is this?" picker for a terminal that had been
    // enrolled for weeks, because the register only lived in the session.
    await owner('/auth/logout', { method: 'POST', body: '{}' });
    await owner('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: process.env.DEFAULT_ADMIN_EMAIL, password: process.env.DEFAULT_ADMIN_PASSWORD }),
    });
    const afterRelogin = await owner('/pos/registers/current');
    assert.equal(afterRelogin.registerId, created.registerId);

    // The escape hatch out of a wedged terminal: forget the binding entirely,
    // in the session and in the cookie, so the next load starts at the picker.
    const released = await owner('/pos/registers/release', { method: 'POST', body: '{}' });
    assert.equal(released.released, true);
    await assert.rejects(
      () => owner('/pos/registers/current'),
      (error) => error.status === 428 && error.body.code === 'REGISTER_REQUIRED',
    );

    // Revocation cannot strand money state. Settle the fixture's shift first,
    // then the retired register drops out of the picker and cannot be claimed.
    await assert.rejects(
      () => owner(`/admin/pos-security/registers/${created.registerId}/revoke`, { method: 'POST', body: '{}' }),
      (error) => error.status === 409 && error.body.code === 'REGISTER_HAS_ACTIVE_SHIFT',
    );
    await db.query(
      `UPDATE pos_shifts SET state = 'closed', closed_at = now()
        WHERE tenant_id = $1 AND register_id = $2 AND state IN ('open', 'closing')`,
      [tenantId, created.registerId],
    );
    await owner(`/admin/pos-security/registers/${created.registerId}/revoke`, { method: 'POST', body: '{}' });
    const afterRevoke = await cashier('/pos/registers');
    assert.equal(afterRevoke.registers.some((item) => item.registerId === created.registerId), false);
    await assert.rejects(
      () => cashier('/pos/registers/claim', { method: 'POST', body: JSON.stringify({ registerId: created.registerId }) }),
      (error) => error.status === 403 && error.body.code === 'REGISTER_DISABLED',
    );

    // Replacement preserves the logical register id/name and its audit
    // history. It does not create a duplicate till just because the physical
    // computer was retired.
    const replacement = await owner(`/admin/pos-security/registers/${created.registerId}/replacement-token`, {
      method: 'POST', body: '{}',
    });
    assert.ok(replacement.token);
    const replaced = await owner('/pos/registers/enroll', {
      method: 'POST', body: JSON.stringify({ enrollmentToken: replacement.token }),
    });
    assert.equal(replaced.registerId, created.registerId);
    assert.equal(replaced.displayName, created.displayName);
    const replacedCurrent = await owner('/pos/registers/current');
    assert.equal(replacedCurrent.registerId, created.registerId);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (tenantId) await db.query('DELETE FROM tenants WHERE id = $1', [tenantId]).catch(() => undefined);
    await db.pool.end();
  }
});
