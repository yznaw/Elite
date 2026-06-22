const { audit, inTransaction, requireRegister } = require('./db');
const { assertPos, cents, nonEmpty, uuid } = require('./errors');
const { consumeOverride } = require('./manager-service');

function numeric(row, key) {
  return Number(row?.[key] || 0);
}

async function loadShiftSummary(client, tenantId, shiftId) {
  const result = await client.query(
    `WITH tx AS (
       SELECT
         COALESCE(sum(total_cents), 0)::bigint AS gross_sales_cents,
         COALESCE(sum(total_cents) FILTER (WHERE payment_method = 'cash'), 0)::bigint AS cash_sales_cents,
         COALESCE(sum(total_cents) FILTER (WHERE payment_method = 'card'), 0)::bigint AS card_sales_cents,
         COALESCE(sum(total_cents) FILTER (WHERE status = 'voided'), 0)::bigint AS void_total_cents,
         COALESCE(sum(total_cents) FILTER (WHERE status = 'voided' AND payment_method = 'cash'), 0)::bigint AS voided_cash_cents,
         count(*)::integer AS transaction_count,
         count(*) FILTER (WHERE status = 'voided')::integer AS void_count
       FROM pos_transactions
       WHERE tenant_id = $1 AND shift_id = $2
     ), refunds AS (
       SELECT
         COALESCE(sum(amount_cents) FILTER (WHERE status = 'completed'), 0)::bigint AS refund_total_cents,
         COALESCE(sum(amount_cents) FILTER (WHERE status = 'completed' AND method = 'cash'), 0)::bigint AS cash_refund_cents,
         count(*) FILTER (WHERE status = 'completed')::integer AS refund_count
       FROM pos_refunds
       WHERE tenant_id = $1 AND shift_id = $2
     )
     SELECT s.id, s.register_id, s.cashier_id, s.state, s.opening_float_cents, s.opened_at,
       tx.*, refunds.*,
       (tx.gross_sales_cents - tx.void_total_cents - refunds.refund_total_cents)::bigint AS net_sales_cents,
       (s.opening_float_cents + tx.cash_sales_cents - tx.voided_cash_cents - refunds.cash_refund_cents)::bigint AS expected_cash_cents
     FROM pos_shifts s CROSS JOIN tx CROSS JOIN refunds
     WHERE s.tenant_id = $1 AND s.id = $2`,
    [tenantId, shiftId],
  );
  assertPos(result.rowCount === 1, 404, 'SHIFT_NOT_FOUND', 'POS shift not found.');
  const row = result.rows[0];
  return {
    shiftId: row.id,
    registerId: row.register_id,
    cashierId: row.cashier_id,
    state: row.state,
    openedAt: row.opened_at,
    openingFloatCents: numeric(row, 'opening_float_cents'),
    grossSalesCents: numeric(row, 'gross_sales_cents'),
    cashSalesCents: numeric(row, 'cash_sales_cents'),
    cardSalesCents: numeric(row, 'card_sales_cents'),
    refundTotalCents: numeric(row, 'refund_total_cents'),
    cashRefundCents: numeric(row, 'cash_refund_cents'),
    voidTotalCents: numeric(row, 'void_total_cents'),
    voidedCashCents: numeric(row, 'voided_cash_cents'),
    netSalesCents: numeric(row, 'net_sales_cents'),
    expectedCashCents: numeric(row, 'expected_cash_cents'),
    transactionCount: numeric(row, 'transaction_count'),
    refundCount: numeric(row, 'refund_count'),
    voidCount: numeric(row, 'void_count'),
  };
}

async function openShift(context, body) {
  const openingFloatCents = cents(body?.openingFloatCents, 'openingFloatCents');
  return inTransaction(async (client) => {
    const register = await requireRegister(client, context, { lock: true });
    const result = await client.query(
      `INSERT INTO pos_shifts (tenant_id, register_id, cashier_id, opening_float_cents)
       VALUES ($1, $2, $3, $4)
       RETURNING id, register_id, cashier_id, opening_float_cents, state, opened_at`,
      [context.tenantId, register.id, context.userId, openingFloatCents],
    );
    const shift = result.rows[0];
    await audit(client, context, 'pos.shift.opened', 'pos_shift', shift.id, {
      registerId: register.id,
      openingFloatCents,
    });
    await client.query(
      `INSERT INTO pos_events (tenant_id, register_id, event_type, payload)
       VALUES ($1, $2, 'shift.opened', $3::jsonb)`,
      [context.tenantId, register.id, JSON.stringify({ shiftId: shift.id, registerId: register.id })],
    );
    return {
      shiftId: shift.id,
      registerId: shift.register_id,
      cashierId: shift.cashier_id,
      openingFloatCents: Number(shift.opening_float_cents),
      state: shift.state,
      openedAt: shift.opened_at,
    };
  });
}

async function currentSummary(context, shiftId = undefined) {
  return inTransaction(async (client) => {
    const register = await requireRegister(client, context);
    let resolvedShiftId = shiftId;
    if (resolvedShiftId) uuid(resolvedShiftId, 'shiftId');
    if (!resolvedShiftId) {
      const result = await client.query(
        `SELECT id FROM pos_shifts
         WHERE tenant_id = $1 AND register_id = $2 AND state IN ('open', 'closing')
         ORDER BY opened_at DESC LIMIT 1`,
        [context.tenantId, register.id],
      );
      resolvedShiftId = result.rows[0]?.id;
    }
    assertPos(resolvedShiftId, 409, 'SHIFT_NOT_OPEN', 'This register has no open shift.');
    const summary = await loadShiftSummary(client, context.tenantId, resolvedShiftId);
    assertPos(summary.registerId === register.id, 403, 'SHIFT_REGISTER_MISMATCH', 'Shift belongs to another register.');
    return summary;
  });
}

async function closeShift(context, body) {
  const shiftId = uuid(body?.shiftId, 'shiftId');
  const idempotencyKey = nonEmpty(body?.idempotencyKey, 'idempotencyKey', 160);
  const physicalCashCents = cents(body?.physicalCashCents, 'physicalCashCents');

  return inTransaction(async (client) => {
    const existing = await client.query(
      'SELECT * FROM pos_z_reports WHERE tenant_id = $1 AND idempotency_key = $2',
      [context.tenantId, idempotencyKey],
    );
    if (existing.rowCount) return mapZReport(existing.rows[0]);

    const register = await requireRegister(client, context, { lock: true });
    const shiftResult = await client.query(
      `SELECT * FROM pos_shifts WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
      [context.tenantId, shiftId],
    );
    const shift = shiftResult.rows[0];
    assertPos(shift, 404, 'SHIFT_NOT_FOUND', 'POS shift not found.');
    assertPos(shift.register_id === register.id, 403, 'SHIFT_REGISTER_MISMATCH', 'Shift belongs to another register.');
    assertPos(shift.state === 'open', 409, 'SHIFT_NOT_OPEN', 'Only an open shift can be closed.');

    const override = await consumeOverride(client, context, 'z-report', body);
    await client.query(
      `UPDATE pos_shifts SET state = 'closing', closing_started_at = now() WHERE id = $1`,
      [shift.id],
    );
    const summary = await loadShiftSummary(client, context.tenantId, shift.id);
    const reportData = { ...summary, physicalCashCents };
    const report = await client.query(
      `INSERT INTO pos_z_reports (
         tenant_id, shift_id, register_id, manager_id, idempotency_key,
         opening_float_cents, gross_sales_cents, cash_sales_cents, card_sales_cents,
         refund_total_cents, cash_refund_cents, void_total_cents, voided_cash_cents,
         net_sales_cents, expected_cash_cents, physical_cash_cents,
         transaction_count, refund_count, void_count, report_data
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20::jsonb
       ) RETURNING *`,
      [
        context.tenantId,
        shift.id,
        register.id,
        override.manager_id,
        idempotencyKey,
        summary.openingFloatCents,
        summary.grossSalesCents,
        summary.cashSalesCents,
        summary.cardSalesCents,
        summary.refundTotalCents,
        summary.cashRefundCents,
        summary.voidTotalCents,
        summary.voidedCashCents,
        summary.netSalesCents,
        summary.expectedCashCents,
        physicalCashCents,
        summary.transactionCount,
        summary.refundCount,
        summary.voidCount,
        JSON.stringify(reportData),
      ],
    );
    await client.query(
      `UPDATE pos_shifts
       SET state = 'closed', closed_at = now(), z_report_id = $2
       WHERE id = $1`,
      [shift.id, report.rows[0].id],
    );
    await audit(client, context, 'pos.shift.closed', 'pos_z_report', report.rows[0].id, reportData);
    await client.query(
      `INSERT INTO pos_events (tenant_id, register_id, event_type, payload)
       VALUES ($1, $2, 'shift.closed', $3::jsonb)`,
      [context.tenantId, register.id, JSON.stringify({ shiftId: shift.id, zReportId: report.rows[0].id })],
    );
    return mapZReport(report.rows[0]);
  });
}

function mapZReport(row) {
  return {
    zReportId: row.id,
    shiftId: row.shift_id,
    registerId: row.register_id,
    openingFloatCents: Number(row.opening_float_cents),
    grossSalesCents: Number(row.gross_sales_cents),
    cashSalesCents: Number(row.cash_sales_cents),
    cardSalesCents: Number(row.card_sales_cents),
    refundTotalCents: Number(row.refund_total_cents),
    voidTotalCents: Number(row.void_total_cents),
    netSalesCents: Number(row.net_sales_cents),
    expectedCashCents: Number(row.expected_cash_cents),
    physicalCashCents: Number(row.physical_cash_cents),
    varianceCents: Number(row.variance_cents),
    transactionCount: Number(row.transaction_count),
    refundCount: Number(row.refund_count),
    voidCount: Number(row.void_count),
    createdAt: row.created_at,
  };
}

module.exports = { closeShift, currentSummary, loadShiftSummary, openShift };
