const db = require('../../db/client');
const { assertPos, cents, nonEmpty, uuid } = require('./errors');

// The card terminal at this shop is standalone — no cable/API link to the
// POS (docs/15 Phase 4) — so there is no automatic settlement feed. This
// tolerance absorbs small terminal-vs-bank timing/fee differences without
// flagging every business day as an exception; anything past it is a real
// mismatch worth a manager's attention.
const TOLERANCE_CENTS = 100; // QAR 1.00

const QATAR_TIME_ZONE = 'Asia/Qatar';

function mapRow(row) {
  return {
    reconciliationId: row.id,
    registerId: row.register_id,
    registerName: row.register_name || null,
    businessDate: row.business_date,
    posTotalCents: Number(row.pos_total_cents),
    settlementTotalCents: row.settlement_total_cents === null ? null : Number(row.settlement_total_cents),
    varianceCents: row.settlement_total_cents === null ? null : Number(row.settlement_total_cents) - Number(row.pos_total_cents),
    status: row.status,
    notes: row.notes,
    resolvedByUserId: row.resolved_by_user_id,
    resolvedAt: row.resolved_at,
    createdAt: row.created_at,
  };
}

/**
 * The POS-side card total for one register's business day, computed in
 * Qatar local time (not UTC midnight) — a card sale rung up at 1am Qatar
 * time is still "yesterday's" business for reconciliation purposes, same
 * convention this needs to match once Phase 5 reporting lands.
 */
async function posCardTotal(client, tenantId, registerId, businessDate) {
  // This server's Postgres session already runs with `TimeZone = Asia/Qatar`
  // (confirmed via `SHOW TIMEZONE`), so a single `timestamptz AT TIME ZONE
  // 'Asia/Qatar'` double-converts: the value is already displayed in Qatar
  // local time by the session before AT TIME ZONE shifts it again, landing
  // on the wrong calendar day. Normalizing through UTC first
  // (`AT TIME ZONE 'UTC'` on a timestamptz yields a plain timestamp already
  // expressed in UTC) makes the second AT TIME ZONE the only real shift,
  // regardless of the session's configured timezone.
  const result = await client.query(
    `WITH sales AS (
       SELECT COALESCE(sum(card_amount_cents), 0)::bigint AS total
       FROM pos_transactions
       WHERE tenant_id = $1 AND register_id = $2 AND status = 'completed'
         AND payment_method = 'card'
         AND ((server_received_at AT TIME ZONE 'UTC') AT TIME ZONE $4)::date = $3::date
     ), refunds AS (
       SELECT COALESCE(sum(amount_cents), 0)::bigint AS total
       FROM pos_refunds
       WHERE tenant_id = $1 AND register_id = $2 AND status = 'completed'
         AND method = 'card'
         AND ((created_at AT TIME ZONE 'UTC') AT TIME ZONE $4)::date = $3::date
     )
     SELECT (sales.total - refunds.total)::bigint AS net_card_total
     FROM sales CROSS JOIN refunds`,
    [tenantId, registerId, businessDate, QATAR_TIME_ZONE],
  );
  return Number(result.rows[0].net_card_total);
}

/**
 * Creates or refreshes the pending reconciliation row for a register/day
 * from live POS totals, without touching any settlement figure the office
 * may have already entered. Called both by submitSettlement() (so it always
 * compares against the current POS total, not a stale one) and by a
 * standalone "recompute" action for a day nobody has entered a settlement
 * for yet.
 */
async function ensurePendingRow(client, tenantId, registerId, businessDate) {
  const posTotalCents = await posCardTotal(client, tenantId, registerId, businessDate);
  const result = await client.query(
    `INSERT INTO pos_card_reconciliation (tenant_id, register_id, business_date, pos_total_cents)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (tenant_id, register_id, business_date) DO UPDATE
       SET pos_total_cents = EXCLUDED.pos_total_cents
       WHERE pos_card_reconciliation.status = 'pending'
     RETURNING *`,
    [tenantId, registerId, businessDate, posTotalCents],
  );
  if (result.rowCount) return result.rows[0];
  // Row already exists and isn't 'pending' (matched/exception/resolved) —
  // the ON CONFLICT...WHERE guard above means the UPDATE didn't fire, so
  // fetch it as-is rather than silently overwrite a settled figure.
  const existing = await client.query(
    `SELECT * FROM pos_card_reconciliation WHERE tenant_id = $1 AND register_id = $2 AND business_date = $3`,
    [tenantId, registerId, businessDate],
  );
  return existing.rows[0];
}

async function listReconciliations(context, { registerId, from, to, status } = {}) {
  const client = await db.pool.connect();
  try {
    const conditions = ['r.tenant_id = $1'];
    const params = [context.tenantId];
    if (registerId) { params.push(uuid(registerId, 'registerId')); conditions.push(`r.register_id = $${params.length}`); }
    if (from) { params.push(from); conditions.push(`r.business_date >= $${params.length}`); }
    if (to) { params.push(to); conditions.push(`r.business_date <= $${params.length}`); }
    if (status) { params.push(status); conditions.push(`r.status = $${params.length}`); }
    const result = await client.query(
      `SELECT r.*, pr.display_name AS register_name
       FROM pos_card_reconciliation r
       JOIN pos_registers pr ON pr.id = r.register_id AND pr.tenant_id = r.tenant_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY r.business_date DESC, pr.display_name ASC
       LIMIT 200`,
      params,
    );
    return result.rows.map(mapRow);
  } finally {
    client.release();
  }
}

/**
 * Recomputes the POS-side total for a register/day and creates a `pending`
 * row if none exists yet — lets the settlement screen show "here's what the
 * POS says" before anyone has typed in the bank's number.
 */
async function refreshBusinessDay(context, body) {
  const registerId = uuid(body?.registerId, 'registerId');
  const businessDate = nonEmpty(body?.businessDate, 'businessDate', 10);
  assertPos(/^\d{4}-\d{2}-\d{2}$/.test(businessDate), 422, 'INVALID_DATE', 'businessDate must be YYYY-MM-DD.');
  const client = await db.pool.connect();
  try {
    const register = await client.query(
      'SELECT id, display_name FROM pos_registers WHERE tenant_id = $1 AND id = $2',
      [context.tenantId, registerId],
    );
    assertPos(register.rowCount, 404, 'REGISTER_NOT_FOUND', 'POS register not found.');
    const row = await ensurePendingRow(client, context.tenantId, registerId, businessDate);
    return mapRow({ ...row, register_name: register.rows[0].display_name });
  } finally {
    client.release();
  }
}

/**
 * Manual/CSV entry of the bank's daily settlement total. Matches
 * automatically within TOLERANCE_CENTS; anything wider is flagged as an
 * exception requiring a manager note before it can be marked resolved.
 */
async function submitSettlement(context, body) {
  const registerId = uuid(body?.registerId, 'registerId');
  const businessDate = nonEmpty(body?.businessDate, 'businessDate', 10);
  assertPos(/^\d{4}-\d{2}-\d{2}$/.test(businessDate), 422, 'INVALID_DATE', 'businessDate must be YYYY-MM-DD.');
  const settlementTotalCents = cents(body?.settlementTotalCents, 'settlementTotalCents');

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const register = await client.query(
      'SELECT id, display_name FROM pos_registers WHERE tenant_id = $1 AND id = $2',
      [context.tenantId, registerId],
    );
    assertPos(register.rowCount, 404, 'REGISTER_NOT_FOUND', 'POS register not found.');

    const posTotalCents = await posCardTotal(client, context.tenantId, registerId, businessDate);
    const varianceCents = settlementTotalCents - posTotalCents;
    const status = Math.abs(varianceCents) <= TOLERANCE_CENTS ? 'matched' : 'exception';

    const result = await client.query(
      `INSERT INTO pos_card_reconciliation (tenant_id, register_id, business_date, pos_total_cents, settlement_total_cents, status)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (tenant_id, register_id, business_date) DO UPDATE
         SET pos_total_cents = EXCLUDED.pos_total_cents,
             settlement_total_cents = EXCLUDED.settlement_total_cents,
             status = EXCLUDED.status,
             resolved_by_user_id = NULL,
             resolved_at = NULL,
             notes = NULL
       RETURNING *`,
      [context.tenantId, registerId, businessDate, posTotalCents, settlementTotalCents, status],
    );
    await client.query('COMMIT');
    return mapRow({ ...result.rows[0], register_name: register.rows[0].display_name });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/** Requires a manager note — an exception cannot be silently dismissed. */
async function resolveException(context, reconciliationId, body) {
  uuid(reconciliationId, 'reconciliationId');
  const note = nonEmpty(body?.note, 'note', 500);
  const client = await db.pool.connect();
  try {
    const existing = await client.query(
      'SELECT * FROM pos_card_reconciliation WHERE tenant_id = $1 AND id = $2',
      [context.tenantId, reconciliationId],
    );
    assertPos(existing.rowCount, 404, 'RECONCILIATION_NOT_FOUND', 'Reconciliation record not found.');
    assertPos(existing.rows[0].status === 'exception', 409, 'NOT_AN_EXCEPTION', 'Only a flagged exception can be resolved.');
    const result = await client.query(
      `UPDATE pos_card_reconciliation
       SET status = 'resolved', resolved_by_user_id = $3, resolved_at = now(), notes = $4
       WHERE tenant_id = $1 AND id = $2
       RETURNING *`,
      [context.tenantId, reconciliationId, context.userId, note],
    );
    return mapRow(result.rows[0]);
  } finally {
    client.release();
  }
}

async function listRegisters(context) {
  const client = await db.pool.connect();
  try {
    const result = await client.query(
      `SELECT id, display_name FROM pos_registers
       WHERE tenant_id = $1 AND status = 'active'
       ORDER BY display_name ASC`,
      [context.tenantId],
    );
    return result.rows.map((row) => ({ registerId: row.id, displayName: row.display_name }));
  } finally {
    client.release();
  }
}

module.exports = { TOLERANCE_CENTS, listReconciliations, listRegisters, refreshBusinessDay, resolveException, submitSettlement };
