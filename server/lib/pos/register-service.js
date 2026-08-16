const crypto = require('node:crypto');
const db = require('../../db/client');
const { audit, inTransaction, requireRegister } = require('./db');
const { assertPos, nonEmpty, uuid } = require('./errors');

const ENROLLMENT_TTL_MS = 15 * 60 * 1000;
const RECEIPT_BLOCK_SIZE = 100;

function secret() {
  return crypto.randomBytes(32).toString('base64url');
}

function hash(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function credentialMatches(storedHash, credential) {
  if (!storedHash) return false;
  const expected = Buffer.from(String(storedHash));
  const actual = Buffer.from(hash(credential));
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

async function createEnrollmentToken(context, body) {
  assertPos(['owner', 'admin'].includes(context.role), 403, 'INSUFFICIENT_PERMISSIONS', 'Only owners and admins can enroll POS terminals.');
  const displayName = nonEmpty(body?.displayName, 'displayName', 80);
  const rawToken = secret();
  const expiresAt = new Date(Date.now() + ENROLLMENT_TTL_MS);

  return inTransaction(async (client) => {
    // `pos_registers` has UNIQUE (tenant_id, display_name), and the collision
    // only surfaced later — at enrolment — as a bare 409 that told the operator
    // nothing actionable ("Request failed 409 — Conflict"). Checked up front so
    // the message names the real problem while the name is still on screen.
    const nameTaken = await client.query(
      'SELECT 1 FROM pos_registers WHERE tenant_id = $1 AND lower(display_name) = lower($2)',
      [context.tenantId, displayName],
    );
    assertPos(
      nameTaken.rowCount === 0,
      409,
      'REGISTER_NAME_TAKEN',
      `A register named "${displayName}" already exists. Choose a different name, or revoke the old register first.`,
    );

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
    assertPos(register && credentialMatches(register.credential_hash, credential), 401, 'REGISTER_CREDENTIAL_INVALID', 'Register credentials are invalid.');
    assertPos(register.status === 'active', 403, 'REGISTER_DISABLED', 'This POS register is disabled or revoked.');

    await client.query('UPDATE pos_registers SET last_seen_at = now() WHERE id = $1', [register.id]);
    const shiftResult = await client.query(
      `SELECT id, state FROM pos_shifts
       WHERE tenant_id = $1 AND register_id = $2 AND state IN ('open', 'closing')
       ORDER BY opened_at DESC LIMIT 1`,
      [context.tenantId, register.id],
    );
    const receiptResult = await client.query(
      `SELECT (
         COALESCE((
           SELECT sum(range_end - range_start + 1)
           FROM pos_receipt_number_blocks
           WHERE tenant_id = $1 AND register_id = $2
         ), 0)
         - COALESCE((
           SELECT count(*)
           FROM pos_receipts r
           JOIN pos_receipt_number_blocks b ON b.id = r.block_id
           WHERE b.tenant_id = $1 AND b.register_id = $2
         ), 0)
       )::bigint AS remaining`,
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
      `SELECT s.id, s.state, s.cashier_id, s.opening_float_cents, s.opened_at,
              u.full_name AS cashier_name
       FROM pos_shifts s
       LEFT JOIN admin_users u ON u.id = s.cashier_id AND u.tenant_id = s.tenant_id
       WHERE s.tenant_id = $1 AND s.register_id = $2 AND s.state IN ('open', 'closing')
       ORDER BY opened_at DESC LIMIT 1`,
      [context.tenantId, register.id],
    );
    // Lets the client skip showing a Manager PIN field at all for void,
    // refund, drawer-open, z-report and sync-conflict approvals when no
    // owner/admin/manager has ever configured one (see manager-service.js,
    // verifyManagerPin) — checked once per POS session instead of on every
    // protected action.
    const pinResult = await client.query(
      `SELECT EXISTS (
         SELECT 1 FROM admin_users
         WHERE tenant_id = $1 AND status = 'active'
           AND role IN ('owner', 'admin', 'manager') AND pos_pin_hash IS NOT NULL
       ) AS configured`,
      [context.tenantId],
    );
    return {
      registerId: register.id,
      displayName: register.display_name,
      status: register.status,
      managerPinConfigured: Boolean(pinResult.rows[0]?.configured),
      shift: shiftResult.rowCount
        ? {
            id: shiftResult.rows[0].id,
            state: shiftResult.rows[0].state,
            cashierId: shiftResult.rows[0].cashier_id,
            cashierName: shiftResult.rows[0].cashier_name || null,
            openingFloatCents: Number(shiftResult.rows[0].opening_float_cents),
            openedAt: shiftResult.rows[0].opened_at,
          }
        : null,
    };
  });
}

async function listAllRegisters(context) {
  assertPos(['owner', 'admin'].includes(context.role), 403, 'INSUFFICIENT_PERMISSIONS', 'Only owners and admins can view registered devices.');
  const client = await db.pool.connect();
  try {
    const result = await client.query(
      `SELECT r.id, r.display_name, r.status, r.last_seen_at, r.created_at,
              r.branch_id, b.name AS branch_name
       FROM pos_registers r
       LEFT JOIN pos_branches b ON b.id = r.branch_id AND b.tenant_id = r.tenant_id
       WHERE r.tenant_id = $1
       ORDER BY r.display_name ASC`,
      [context.tenantId],
    );
    return result.rows.map((row) => ({
      registerId: row.id,
      displayName: row.display_name,
      status: row.status,
      lastSeenAt: row.last_seen_at,
      createdAt: row.created_at,
      // null means "not explicitly assigned" — the till still resolves to
      // the tenant's default branch (branch-service.js's
      // getEffectiveBranchProfile), the admin UI just labels this "Default".
      branchId: row.branch_id,
      branchName: row.branch_name,
    }));
  } finally {
    client.release();
  }
}

async function revokeRegister(context, registerId) {
  assertPos(['owner', 'admin'].includes(context.role), 403, 'INSUFFICIENT_PERMISSIONS', 'Only owners and admins can revoke registers.');
  uuid(registerId, 'registerId');

  return inTransaction(async (client) => {
    const result = await client.query(
      `UPDATE pos_registers
       SET status = 'revoked'
       WHERE tenant_id = $1 AND id = $2 AND status != 'revoked'
       RETURNING id, display_name`,
      [context.tenantId, registerId],
    );
    assertPos(result.rowCount === 1, 404, 'REGISTER_NOT_FOUND', 'Register not found or already revoked.');
    await audit(client, context, 'pos.register.revoked', 'pos_register', registerId, { displayName: result.rows[0].display_name });
    return { registerId, status: 'revoked' };
  });
}

/**
 * `branchId` is nullable — unassigning a register (setting it back to null)
 * is a normal, supported action, not an error path: it makes the register
 * fall back to whatever the tenant's default branch is.
 *
 * When a branchId is given, it's verified to belong to this tenant with an
 * explicit lookup rather than relying on the FK constraint alone — a bad id
 * would otherwise surface as the FK's generic 422 `POS_DATA_INVALID` instead
 * of a clean, actionable 404.
 */
async function setRegisterBranch(context, registerId, branchId) {
  assertPos(['owner', 'admin'].includes(context.role), 403, 'INSUFFICIENT_PERMISSIONS', 'Only owners and admins can assign a register to a branch.');
  uuid(registerId, 'registerId');
  if (branchId !== null && branchId !== undefined) uuid(branchId, 'branchId');
  const targetBranchId = branchId || null;

  return inTransaction(async (client) => {
    if (targetBranchId) {
      const branchExists = await client.query(
        'SELECT 1 FROM pos_branches WHERE tenant_id = $1 AND id = $2',
        [context.tenantId, targetBranchId],
      );
      assertPos(branchExists.rowCount === 1, 404, 'BRANCH_NOT_FOUND', 'Branch not found.');
    }

    const result = await client.query(
      `UPDATE pos_registers
       SET branch_id = $3
       WHERE tenant_id = $1 AND id = $2
       RETURNING id, display_name`,
      [context.tenantId, registerId, targetBranchId],
    );
    assertPos(result.rowCount === 1, 404, 'REGISTER_NOT_FOUND', 'Register not found.');
    await audit(client, context, 'pos.register.branch-assigned', 'pos_register', registerId, { branchId: targetBranchId });
    return { registerId, branchId: targetBranchId };
  });
}

async function listEnrollmentTokens(context) {
  assertPos(['owner', 'admin'].includes(context.role), 403, 'INSUFFICIENT_PERMISSIONS', 'Only owners and admins can view enrollment tokens.');
  const client = await db.pool.connect();
  try {
    const result = await client.query(
      `SELECT t.id, t.display_name, t.created_by_user_id, t.expires_at, t.consumed_at, t.register_id, t.created_at,
              u.full_name AS created_by_name
       FROM pos_register_enrollment_tokens t
       LEFT JOIN admin_users u ON u.id = t.created_by_user_id
       WHERE t.tenant_id = $1
       ORDER BY t.created_at DESC`,
      [context.tenantId],
    );
    return result.rows.map((row) => ({
      tokenId: row.id,
      displayName: row.display_name,
      createdByName: row.created_by_name || null,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
      status: tokenStatus(row),
    }));
  } finally {
    client.release();
  }
}

function tokenStatus(row) {
  if (row.register_id) return 'used';
  if (row.consumed_at) return 'revoked';
  if (new Date(row.expires_at).getTime() <= Date.now()) return 'expired';
  return 'active';
}

async function revokeEnrollmentToken(context, tokenId) {
  assertPos(['owner', 'admin'].includes(context.role), 403, 'INSUFFICIENT_PERMISSIONS', 'Only owners and admins can revoke enrollment tokens.');
  uuid(tokenId, 'tokenId');

  return inTransaction(async (client) => {
    const result = await client.query(
      `UPDATE pos_register_enrollment_tokens
       SET consumed_at = now()
       WHERE tenant_id = $1 AND id = $2 AND consumed_at IS NULL
       RETURNING id, display_name`,
      [context.tenantId, tokenId],
    );
    assertPos(result.rowCount === 1, 404, 'ENROLLMENT_TOKEN_NOT_FOUND', 'Token not found, already used, or already revoked.');
    await audit(client, context, 'pos.register.enrollment-revoked', 'pos_register_enrollment_token', tokenId, { displayName: result.rows[0].display_name });
    return { tokenId, status: 'revoked' };
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
  listAllRegisters,
  listEnrollmentTokens,
  revokeEnrollmentToken,
  revokeRegister,
  setRegisterBranch,
};
