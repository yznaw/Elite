const db = require('../../db/client');
const { PosError, assertPos } = require('./errors');

async function inTransaction(work) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw mapDatabaseError(error);
  } finally {
    client.release();
  }
}

function mapDatabaseError(error) {
  if (error instanceof PosError) return error;
  if (error?.code === '23505') {
    return new PosError(409, 'POS_CONFLICT', 'This POS action conflicts with an existing record.');
  }
  if (error?.code === '23503' || error?.code === '23514' || error?.code === '22P02') {
    return new PosError(422, 'POS_DATA_INVALID', 'The POS request contains invalid or inconsistent data.');
  }
  return error;
}

async function requireRegister(client, context, { lock = false } = {}) {
  if (!lock && context.validatedRegister) return context.validatedRegister;
  assertPos(context.registerId, 428, 'REGISTER_REQUIRED', 'This terminal must be enrolled and checked in.');
  const result = await client.query(
    `SELECT * FROM pos_registers
      WHERE tenant_id = $1 AND id = $2
     ${lock ? 'FOR UPDATE' : ''}`,
    [context.tenantId, context.registerId],
  );
  const register = result.rows[0];
  assertPos(register, 404, 'REGISTER_NOT_FOUND', 'POS register not found.');
  assertPos(register.status === 'active', 403, 'REGISTER_DISABLED', 'This POS register is disabled or revoked.');
  assertPos(
    !register.device_lease_id || (context.registerLeaseId && register.device_lease_id === context.registerLeaseId),
    409,
    'REGISTER_LEASE_INVALID',
    'This register was connected to another device. Reconnect this terminal before continuing.',
  );
  if (context.enforceBranchScope) {
    const branch = await client.query(
      `SELECT u.pos_branch_id AS user_branch_id,
              COALESCE(
                $3::uuid,
                (SELECT b.id FROM pos_branches b WHERE b.tenant_id = $1 AND b.is_default = true),
                (SELECT b.id FROM pos_branches b WHERE b.tenant_id = $1 ORDER BY b.created_at ASC LIMIT 1)
              ) AS effective_branch_id
         FROM admin_users u
        WHERE u.tenant_id = $1 AND u.id = $2`,
      [context.tenantId, context.userId, register.branch_id],
    );
    const scope = branch.rows[0];
    assertPos(scope, 401, 'ACCOUNT_INACTIVE', 'The current POS user no longer exists.');
    assertPos(
      !scope.user_branch_id || scope.user_branch_id === scope.effective_branch_id,
      403,
      'REGISTER_OUT_OF_BRANCH',
      'This till belongs to another branch. Pick one from your own branch, or ask an owner to move you.',
    );
  }
  if (!lock) context.validatedRegister = register;
  return register;
}

async function audit(client, context, action, entityType, entityId, afterState = undefined, beforeState = undefined) {
  await client.query(
    `INSERT INTO audit_events
      (tenant_id, actor_user_id, action, entity_type, entity_id, before_state, after_state, ip_address, user_agent, request_id)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, $10)`,
    [
      context.tenantId,
      context.userId,
      action,
      entityType,
      entityId || null,
      beforeState ? JSON.stringify(beforeState) : null,
      afterState ? JSON.stringify(afterState) : null,
      context.ip || null,
      context.userAgent || null,
      // Read off the context rather than added as a parameter, so all ~20
      // existing audit() call sites stay untouched (docs/24, Phase A).
      context.requestId || null,
    ],
  );
}

module.exports = { audit, inTransaction, requireRegister };
