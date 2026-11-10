const { audit, inTransaction, requireRegister } = require('./db');
const { assertPos, cents, nonEmpty, uuid } = require('./errors');
const { consumeOverride } = require('./manager-service');

const KINDS = new Set(['paid_in', 'paid_out', 'safe_drop', 'float_adjust', 'no_sale_drawer_open']);
// Removing cash (or opening the drawer with nothing to ring up) needs
// accountability beyond the cashier's own say-so — same manager-override
// requirement as void/refund. Adding cash to the till does not.
const REQUIRES_OVERRIDE = new Set(['paid_out', 'safe_drop', 'no_sale_drawer_open']);

function mapMovement(row) {
  return {
    movementId: row.id,
    shiftId: row.shift_id,
    registerId: row.register_id,
    cashierId: row.cashier_id,
    managerId: row.manager_id,
    kind: row.kind,
    amountCents: Number(row.amount_cents),
    reason: row.reason,
    createdAt: row.created_at,
  };
}

async function recordCashMovement(context, body) {
  const kind = nonEmpty(body?.kind, 'kind', 40);
  assertPos(KINDS.has(kind), 422, 'CASH_MOVEMENT_KIND_INVALID', 'Cash movement kind is invalid.');
  const shiftId = uuid(body?.shiftId, 'shiftId');
  const idempotencyKey = nonEmpty(body?.idempotencyKey, 'idempotencyKey', 160);
  const reason = nonEmpty(body?.reason, 'reason', 250);
  const amountCents = kind === 'no_sale_drawer_open'
    ? 0
    : cents(body?.amountCents, 'amountCents', { allowZero: false });

  return inTransaction(async (client) => {
    const existing = await client.query(
      'SELECT * FROM pos_cash_movements WHERE tenant_id = $1 AND idempotency_key = $2',
      [context.tenantId, idempotencyKey],
    );
    if (existing.rowCount) return mapMovement(existing.rows[0]);

    const register = await requireRegister(client, context);
    const shiftResult = await client.query(
      `SELECT * FROM pos_shifts WHERE tenant_id = $1 AND id = $2 AND register_id = $3 FOR UPDATE`,
      [context.tenantId, shiftId, register.id],
    );
    const shift = shiftResult.rows[0];
    assertPos(shift, 404, 'SHIFT_NOT_FOUND', 'POS shift not found.');
    assertPos(shift.state === 'open', 409, 'SHIFT_NOT_OPEN', 'Cash movements require an open shift.');

    let managerId = null;
    if (REQUIRES_OVERRIDE.has(kind)) {
      const override = await consumeOverride(client, context, 'drawer-open', body);
      managerId = override.manager_id;
    }

    const result = await client.query(
      `INSERT INTO pos_cash_movements (
         tenant_id, shift_id, register_id, cashier_id, manager_id, kind, amount_cents, reason, idempotency_key
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [context.tenantId, shift.id, register.id, context.userId, managerId, kind, amountCents, reason, idempotencyKey],
    );
    const movement = result.rows[0];
    await audit(client, context, 'pos.cash-movement.recorded', 'pos_cash_movement', movement.id, {
      kind, amountCents, reason, shiftId: shift.id,
    });
    await client.query(
      `INSERT INTO pos_events (tenant_id, register_id, event_type, payload)
       VALUES ($1, $2, 'cash-movement.recorded', $3::jsonb)`,
      [context.tenantId, register.id, JSON.stringify({ shiftId: shift.id, kind, amountCents })],
    );
    return mapMovement(movement);
  });
}

async function listCashMovements(context, shiftId) {
  uuid(shiftId, 'shiftId');
  return inTransaction(async (client) => {
    const register = await requireRegister(client, context);
    const shiftResult = await client.query(
      'SELECT id, register_id FROM pos_shifts WHERE tenant_id = $1 AND id = $2',
      [context.tenantId, shiftId],
    );
    const shift = shiftResult.rows[0];
    assertPos(shift, 404, 'SHIFT_NOT_FOUND', 'POS shift not found.');
    assertPos(shift.register_id === register.id, 403, 'SHIFT_REGISTER_MISMATCH', 'Shift belongs to another register.');
    const result = await client.query(
      `SELECT * FROM pos_cash_movements WHERE tenant_id = $1 AND shift_id = $2 ORDER BY created_at ASC`,
      [context.tenantId, shiftId],
    );
    return result.rows.map(mapMovement);
  });
}

/**
 * Aggregates by kind for shift-service.js's expected-cash calculation.
 * paid_in and float_adjust add cash to the drawer; paid_out and safe_drop
 * remove it; no_sale_drawer_open never moves cash (enforced by the
 * migration's CHECK), so it's excluded from the sum entirely.
 */
async function cashMovementTotals(client, tenantId, shiftId) {
  const result = await client.query(
    `SELECT
       COALESCE(sum(amount_cents) FILTER (WHERE kind IN ('paid_in', 'float_adjust')), 0)::bigint AS cash_in_cents,
       COALESCE(sum(amount_cents) FILTER (WHERE kind IN ('paid_out', 'safe_drop')), 0)::bigint AS cash_out_cents
     FROM pos_cash_movements
     WHERE tenant_id = $1 AND shift_id = $2`,
    [tenantId, shiftId],
  );
  const row = result.rows[0];
  return {
    cashInCents: Number(row.cash_in_cents),
    cashOutCents: Number(row.cash_out_cents),
  };
}

module.exports = { cashMovementTotals, listCashMovements, recordCashMovement };
