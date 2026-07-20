const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const db = require('../../db/client');
const { audit, inTransaction, requireRegister } = require('./db');
const { PosError, assertPos, nonEmpty, uuid } = require('./errors');
const { hash } = require('./register-service');

const ACTIONS = new Set(['refund', 'void', 'z-report', 'drawer-open', 'sync-conflict-override']);
const MAX_FAILURES = 5;
const LOCK_MS = 5 * 60 * 1000;
const OVERRIDE_TTL_MS = 5 * 60 * 1000;

async function setManagerPin(context, body) {
  const managerId = body?.managerId ? uuid(body.managerId, 'managerId') : context.userId;
  const pin = nonEmpty(body?.pin, 'pin', 12);
  assertPos(/^\d{4,8}$/.test(pin), 422, 'PIN_FORMAT_INVALID', 'Manager PIN must contain 4 to 8 digits.');
  assertPos(
    managerId === context.userId || ['owner', 'admin'].includes(context.role),
    403,
    'INSUFFICIENT_PERMISSIONS',
    'Only owners and admins can set another user\'s manager PIN.',
  );

  return inTransaction(async (client) => {
    const manager = await client.query(
      `SELECT id, role, status FROM admin_users
       WHERE tenant_id = $1 AND id = $2 AND role IN ('owner', 'admin', 'manager')`,
      [context.tenantId, managerId],
    );
    assertPos(manager.rowCount === 1 && manager.rows[0].status === 'active', 404, 'MANAGER_NOT_FOUND', 'Active manager account not found.');
    const pinHash = await bcrypt.hash(pin, 12);
    await client.query('UPDATE admin_users SET pos_pin_hash = $1 WHERE id = $2', [pinHash, managerId]);
    await audit(client, context, 'pos.manager-pin.updated', 'admin_user', managerId);
    return { managerId, configured: true };
  });
}

async function verifyManagerPin(context, body) {
  const pin = nonEmpty(body?.pin, 'pin', 12);
  const action = nonEmpty(body?.action, 'action', 40);
  assertPos(ACTIONS.has(action), 422, 'OVERRIDE_ACTION_INVALID', 'Manager override action is invalid.');

  const outcome = await inTransaction(async (client) => {
    const register = await requireRegister(client, context);
    const tenantResult = await client.query(
      'SELECT pos_emergency_self_approval_enabled FROM tenants WHERE id = $1',
      [context.tenantId],
    );
    const emergencySelfApprovalEnabled = Boolean(tenantResult.rows[0]?.pos_emergency_self_approval_enabled);
    const failuresResult = await client.query(
      `SELECT * FROM pos_pin_failures
       WHERE tenant_id = $1 AND register_id = $2 AND cashier_id = $3
       FOR UPDATE`,
      [context.tenantId, register.id, context.userId],
    );
    const failures = failuresResult.rows[0];
    if (failures?.locked_until && new Date(failures.locked_until).getTime() > Date.now()) {
      return { error: new PosError(429, 'PIN_LOCKED', 'Manager PIN verification is temporarily locked.') };
    }

    const managers = await client.query(
      `SELECT id, pos_pin_hash FROM admin_users
       WHERE tenant_id = $1
         AND status = 'active'
         AND role IN ('owner', 'admin', 'manager')
         AND pos_pin_hash IS NOT NULL`,
      [context.tenantId],
    );
    let managerId = null;
    for (const manager of managers.rows) {
      // A manager-role cashier could otherwise approve their own void/refund/
      // etc. by entering their own PIN — the cashier role is structurally
      // excluded from this lookup already (see the role IN (...) filter
      // above), but an owner/admin/manager acting as the till operator is
      // not, so self-approval must be rejected explicitly here (docs/15
      // Phase 3, P0-7) unless the tenant has opted into the audited
      // emergency exception.
      if (manager.id === context.userId && !emergencySelfApprovalEnabled) continue;
      if (await bcrypt.compare(pin, manager.pos_pin_hash)) {
        managerId = manager.id;
        break;
      }
    }

    if (!managerId) {
      const nextCount = Number(failures?.failed_count || 0) + 1;
      const lockedUntil = nextCount >= MAX_FAILURES ? new Date(Date.now() + LOCK_MS) : null;
      await client.query(
        `INSERT INTO pos_pin_failures
          (tenant_id, register_id, cashier_id, failed_count, locked_until)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (tenant_id, register_id, cashier_id) DO UPDATE
         SET failed_count = EXCLUDED.failed_count,
             locked_until = EXCLUDED.locked_until,
             updated_at = now()`,
        [context.tenantId, register.id, context.userId, nextCount, lockedUntil],
      );
      await audit(client, context, 'pos.manager-pin.failed', 'pos_register', register.id, { action, locked: Boolean(lockedUntil) });
      return {
        error: new PosError(
          lockedUntil ? 429 : 401,
          lockedUntil ? 'PIN_LOCKED' : 'PIN_INVALID',
          lockedUntil ? 'Manager PIN verification is temporarily locked.' : 'Manager PIN is incorrect.',
        ),
      };
    }

    await client.query(
      `DELETE FROM pos_pin_failures
       WHERE tenant_id = $1 AND register_id = $2 AND cashier_id = $3`,
      [context.tenantId, register.id, context.userId],
    );
    const rawToken = crypto.randomBytes(32).toString('base64url');
    const overrideResult = await client.query(
      `INSERT INTO pos_manager_overrides
        (tenant_id, register_id, cashier_id, manager_id, action, token_hash, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, manager_id, action, expires_at`,
      [
        context.tenantId,
        register.id,
        context.userId,
        managerId,
        action,
        hash(rawToken),
        new Date(Date.now() + OVERRIDE_TTL_MS),
      ],
    );
    const override = overrideResult.rows[0];
    const isSelfApproval = managerId === context.userId;
    await audit(client, context, 'pos.manager-pin.approved', 'pos_manager_override', override.id, {
      action,
      managerId,
      ...(isSelfApproval ? { selfApproval: true, emergencySelfApprovalEnabled: true } : {}),
    });
    return {
      value: { overrideId: override.id, token: rawToken, managerId, action, expiresAt: override.expires_at },
    };
  });
  if (outcome.error) throw outcome.error;
  return outcome.value;
}

async function listManagerPins(context) {
  assertPos(['owner', 'admin'].includes(context.role), 403, 'INSUFFICIENT_PERMISSIONS', 'Only owners and admins can view manager PIN status.');
  const client = await db.pool.connect();
  try {
    const users = await client.query(
      `SELECT id, full_name AS name, email, role, (pos_pin_hash IS NOT NULL) AS configured
       FROM admin_users
       WHERE tenant_id = $1 AND role IN ('owner', 'admin', 'manager') AND status = 'active'
       ORDER BY role, full_name`,
      [context.tenantId],
    );
    const ids = users.rows.map((row) => row.id);
    const lastUpdated = new Map();
    if (ids.length) {
      const events = await client.query(
        `SELECT DISTINCT ON (entity_id) entity_id, occurred_at
         FROM audit_events
         WHERE tenant_id = $1 AND action = 'pos.manager-pin.updated' AND entity_id = ANY($2::uuid[])
         ORDER BY entity_id, occurred_at DESC`,
        [context.tenantId, ids],
      );
      for (const row of events.rows) lastUpdated.set(row.entity_id, row.occurred_at);
    }
    return users.rows.map((row) => ({
      userId: row.id,
      name: row.name,
      email: row.email,
      role: row.role,
      configured: row.configured,
      lastUpdatedAt: lastUpdated.get(row.id) || null,
    }));
  } finally {
    client.release();
  }
}

async function clearManagerPin(context, managerId) {
  assertPos(['owner', 'admin'].includes(context.role), 403, 'INSUFFICIENT_PERMISSIONS', 'Only owners and admins can clear another user\'s manager PIN.');
  uuid(managerId, 'managerId');

  return inTransaction(async (client) => {
    const result = await client.query(
      `UPDATE admin_users
       SET pos_pin_hash = NULL
       WHERE tenant_id = $1 AND id = $2 AND role IN ('owner', 'admin', 'manager')
       RETURNING id`,
      [context.tenantId, managerId],
    );
    assertPos(result.rowCount === 1, 404, 'MANAGER_NOT_FOUND', 'Active manager account not found.');
    await audit(client, context, 'pos.manager-pin.cleared', 'admin_user', managerId);
    return { managerId, configured: false };
  });
}

async function consumeOverride(client, context, action, body) {
  const overrideId = uuid(body?.managerOverrideId, 'managerOverrideId');
  const token = nonEmpty(body?.managerOverrideToken, 'managerOverrideToken', 200);
  const result = await client.query(
    `SELECT * FROM pos_manager_overrides
     WHERE tenant_id = $1 AND id = $2
     FOR UPDATE`,
    [context.tenantId, overrideId],
  );
  const override = result.rows[0];
  assertPos(override, 401, 'MANAGER_OVERRIDE_INVALID', 'Manager approval is invalid.');
  assertPos(override.register_id === context.registerId, 401, 'MANAGER_OVERRIDE_INVALID', 'Manager approval belongs to another register.');
  assertPos(override.cashier_id === context.userId, 401, 'MANAGER_OVERRIDE_INVALID', 'Manager approval belongs to another cashier.');
  assertPos(override.action === action, 401, 'MANAGER_OVERRIDE_INVALID', 'Manager approval is scoped to another action.');
  assertPos(!override.used_at, 409, 'MANAGER_OVERRIDE_USED', 'Manager approval has already been used.');
  assertPos(new Date(override.expires_at).getTime() > Date.now(), 410, 'MANAGER_OVERRIDE_EXPIRED', 'Manager approval has expired.');
  assertPos(crypto.timingSafeEqual(Buffer.from(override.token_hash), Buffer.from(hash(token))), 401, 'MANAGER_OVERRIDE_INVALID', 'Manager approval token is invalid.');
  await client.query('UPDATE pos_manager_overrides SET used_at = now() WHERE id = $1', [override.id]);
  return override;
}

module.exports = { clearManagerPin, consumeOverride, listManagerPins, setManagerPin, verifyManagerPin };
