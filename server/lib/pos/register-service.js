const crypto = require('node:crypto');
const { audit, inTransaction, requireRegister } = require('./db');
const { assertPos, nonEmpty } = require('./errors');

const ENROLLMENT_TTL_MS = 15 * 60 * 1000;
const RECEIPT_BLOCK_SIZE = 100;

function secret() {
  return crypto.randomBytes(32).toString('base64url');
}

function hash(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

async function createEnrollmentToken(context, body) {
  assertPos(['owner', 'admin'].includes(context.role), 403, 'INSUFFICIENT_PERMISSIONS', 'Only owners and admins can enroll POS terminals.');
  const displayName = nonEmpty(body?.displayName, 'displayName', 80);
  const rawToken = secret();
  const expiresAt = new Date(Date.now() + ENROLLMENT_TTL_MS);

  return inTransaction(async (client) => {
    const result = await client.query(
      `INSERT INTO pos_register_enrollment_tokens
        (tenant_id, token_hash, display_name, created_by_user_id, expires_at)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, display_name, expires_at`,
      [context.tenantId, hash(rawToken), displayName, context.userId, expiresAt],
    );
    await audit(client, context, 'pos.register.enrollment-created', 'pos_register_enrollment_token', result.rows[0].id, {
      displayName,
      expiresAt,
    });
    return { token: rawToken, displayName, expiresAt };
  });
}

async function enrollRegister(context, body) {
  const enrollmentToken = nonEmpty(body?.enrollmentToken, 'enrollmentToken', 200);

  return inTransaction(async (client) => {
    const tokenResult = await client.query(
      `SELECT * FROM pos_register_enrollment_tokens
       WHERE tenant_id = $1 AND token_hash = $2
       FOR UPDATE`,
      [context.tenantId, hash(enrollmentToken)],
    );
    const token = tokenResult.rows[0];
    assertPos(token, 401, 'ENROLLMENT_TOKEN_INVALID', 'Enrollment token is invalid.');
    assertPos(!token.consumed_at, 409, 'ENROLLMENT_TOKEN_USED', 'Enrollment token has already been used.');
    assertPos(new Date(token.expires_at).getTime() > Date.now(), 410, 'ENROLLMENT_TOKEN_EXPIRED', 'Enrollment token has expired.');

    const rawCredential = secret();
    const registerResult = await client.query(
      `INSERT INTO pos_registers
        (tenant_id, display_name, credential_hash, created_by_user_id)
       VALUES ($1, $2, $3, $4)
       RETURNING id, display_name, status`,
      [context.tenantId, token.display_name, hash(rawCredential), context.userId],
    );
    const register = registerResult.rows[0];

    await client.query(
      `UPDATE pos_register_enrollment_tokens
       SET consumed_at = now(), register_id = $1
       WHERE id = $2`,
      [register.id, token.id],
    );
    await audit(client, context, 'pos.register.enrolled', 'pos_register', register.id, { displayName: register.display_name });
    return { registerId: register.id, displayName: register.display_name, registerCredential: rawCredential };
  });
}

async function checkInRegister(context, body) {
  const registerId = nonEmpty(body?.registerId, 'registerId', 50);
  const credential = nonEmpty(body?.registerCredential, 'registerCredential', 200);

  return inTransaction(async (client) => {
    const result = await client.query(
      `SELECT * FROM pos_registers WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
      [context.tenantId, registerId],
    );
    const register = result.rows[0];
    assertPos(register && register.credential_hash === hash(credential), 401, 'REGISTER_CREDENTIAL_INVALID', 'Register credentials are invalid.');
    assertPos(register.status === 'active', 403, 'REGISTER_DISABLED', 'This POS register is disabled or revoked.');

    await client.query('UPDATE pos_registers SET last_seen_at = now() WHERE id = $1', [register.id]);
    const shiftResult = await client.query(
      `SELECT id, state FROM pos_shifts
       WHERE tenant_id = $1 AND register_id = $2 AND state IN ('open', 'closing')
       ORDER BY opened_at DESC LIMIT 1`,
      [context.tenantId, register.id],
    );
    const receiptResult = await client.query(
      `SELECT b.range_end - b.range_start + 1 - count(r.id)::bigint AS remaining
       FROM pos_receipt_number_blocks b
       LEFT JOIN pos_receipts r ON r.block_id = b.id
       WHERE b.tenant_id = $1 AND b.register_id = $2
       GROUP BY b.id
       ORDER BY b.allocated_at DESC LIMIT 1`,
      [context.tenantId, register.id],
    );

    return {
      registerId: register.id,
      displayName: register.display_name,
      currentShiftId: shiftResult.rows[0]?.id || null,
      currentShiftState: shiftResult.rows[0]?.state || null,
      receiptNumbersRemaining: Number(receiptResult.rows[0]?.remaining || 0),
    };
  });
}

async function currentRegister(context) {
  return inTransaction(async (client) => {
    const register = await requireRegister(client, context);
    const shiftResult = await client.query(
      `SELECT id, state, opening_float_cents, opened_at
       FROM pos_shifts
       WHERE tenant_id = $1 AND register_id = $2 AND state IN ('open', 'closing')
       ORDER BY opened_at DESC LIMIT 1`,
      [context.tenantId, register.id],
    );
    return {
      registerId: register.id,
      displayName: register.display_name,
      status: register.status,
      shift: shiftResult.rowCount
        ? {
            id: shiftResult.rows[0].id,
            state: shiftResult.rows[0].state,
            openingFloatCents: Number(shiftResult.rows[0].opening_float_cents),
            openedAt: shiftResult.rows[0].opened_at,
          }
        : null,
    };
  });
}

async function allocateReceiptBlock(context) {
  return inTransaction(async (client) => {
    const register = await requireRegister(client, context, { lock: true });
    await client.query(
      `INSERT INTO pos_receipt_sequences (tenant_id, next_value)
       VALUES ($1, 1)
       ON CONFLICT (tenant_id) DO NOTHING`,
      [context.tenantId],
    );
    const sequence = await client.query(
      `UPDATE pos_receipt_sequences
       SET next_value = next_value + $2, updated_at = now()
       WHERE tenant_id = $1
       RETURNING next_value - $2 AS range_start, next_value - 1 AS range_end`,
      [context.tenantId, RECEIPT_BLOCK_SIZE],
    );
    const { range_start: rangeStart, range_end: rangeEnd } = sequence.rows[0];
    const result = await client.query(
      `INSERT INTO pos_receipt_number_blocks (tenant_id, register_id, range_start, range_end)
       VALUES ($1, $2, $3, $4)
       RETURNING id, range_start, range_end, allocated_at`,
      [context.tenantId, register.id, rangeStart, rangeEnd],
    );
    const block = result.rows[0];
    await audit(client, context, 'pos.receipts.allocated', 'pos_receipt_number_block', block.id, {
      rangeStart: Number(block.range_start),
      rangeEnd: Number(block.range_end),
    });
    return {
      blockId: block.id,
      start: Number(block.range_start),
      end: Number(block.range_end),
      next: Number(block.range_start),
      allocatedAt: block.allocated_at,
    };
  });
}

module.exports = {
  allocateReceiptBlock,
  checkInRegister,
  createEnrollmentToken,
  currentRegister,
  enrollRegister,
  hash,
};
