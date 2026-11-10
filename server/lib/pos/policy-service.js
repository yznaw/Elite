const db = require('../../db/client');
const { audit, inTransaction } = require('./db');
const { assertPos } = require('./errors');

/**
 * Tenant-level POS approval policy. These are the switches that decide when a
 * protected action needs a second person, so every change is audited and only
 * owners may make one.
 */

function publicPolicy(row) {
  return {
    selfCloseShiftEnabled: Boolean(row?.pos_self_close_shift_enabled),
    emergencySelfApprovalEnabled: Boolean(row?.pos_emergency_self_approval_enabled),
  };
}

async function getPosPolicy(context) {
  assertPos(
    ['owner', 'admin'].includes(context.role),
    403,
    'INSUFFICIENT_PERMISSIONS',
    'Only owners and admins can view POS approval settings.',
  );
  const client = await db.pool.connect();
  try {
    const result = await client.query(
      `SELECT pos_self_close_shift_enabled, pos_emergency_self_approval_enabled
       FROM tenants WHERE id = $1`,
      [context.tenantId],
    );
    return publicPolicy(result.rows[0]);
  } finally {
    client.release();
  }
}

async function updatePosPolicy(context, body) {
  // Owner only, deliberately stricter than the read above: admins can see the
  // policy but loosening approver separation is the owner's call.
  assertPos(
    context.role === 'owner',
    403,
    'INSUFFICIENT_PERMISSIONS',
    'Only the owner can change POS approval settings.',
  );
  // Each switch is optional so one can be flipped without restating the other,
  // but anything present must be an explicit boolean — a missing field and a
  // field sent as null mean very different things for a security setting.
  const changes = {};
  for (const field of ['selfCloseShiftEnabled', 'emergencySelfApprovalEnabled']) {
    if (body?.[field] === undefined) continue;
    assertPos(typeof body[field] === 'boolean', 422, 'INVALID_FIELD', `${field} must be true or false.`);
    changes[field] = body[field];
  }
  assertPos(Object.keys(changes).length > 0, 422, 'INVALID_FIELD', 'No POS approval setting was supplied.');

  return inTransaction(async (client) => {
    const result = await client.query(
      `UPDATE tenants SET
         pos_self_close_shift_enabled = COALESCE($2, pos_self_close_shift_enabled),
         pos_emergency_self_approval_enabled = COALESCE($3, pos_emergency_self_approval_enabled)
       WHERE id = $1
       RETURNING pos_self_close_shift_enabled, pos_emergency_self_approval_enabled`,
      [
        context.tenantId,
        changes.selfCloseShiftEnabled ?? null,
        changes.emergencySelfApprovalEnabled ?? null,
      ],
    );
    assertPos(result.rowCount === 1, 404, 'TENANT_NOT_FOUND', 'Tenant not found.');
    // Turning emergency self-approval on removes the second pair of eyes from
    // voids and refunds, so the audit entry records who did it and when.
    await audit(client, context, 'pos.policy.updated', 'tenant', context.tenantId, changes);
    return publicPolicy(result.rows[0]);
  });
}

module.exports = { getPosPolicy, updatePosPolicy };
