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
  return register;
}

async function audit(client, context, action, entityType, entityId, afterState = undefined, beforeState = undefined) {
  await client.query(
    `INSERT INTO audit_events
      (tenant_id, actor_user_id, action, entity_type, entity_id, before_state, after_state, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9)`,
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
    ],
  );
}

module.exports = { audit, inTransaction, requireRegister };
