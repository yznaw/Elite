const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
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
    await audit(client, context, 'pos.manager-pin.approved', 'pos_manager_override', override.id, { action, managerId });
    return {
      value: { overrideId: override.id, token: rawToken, managerId, action, expiresAt: override.expires_at },
    };
  });
  if (outcome.error) throw outcome.error;
  return outcome.value;
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

module.exports = { consumeOverride, setManagerPin, verifyManagerPin };
