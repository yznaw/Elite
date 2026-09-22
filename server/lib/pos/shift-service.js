const { audit, inTransaction, requireRegister, resolveRegisterBranch } = require('./db');
const { assertPos, cents, nonEmpty, uuid } = require('./errors');
const { consumeOverride } = require('./manager-service');
const { cashMovementTotals } = require('./cash-movement-service');

function numeric(row, key) {
  return Number(row?.[key] || 0);
}

/**
 * True when this operator may close this shift without a second manager's PIN:
 * the tenant allows self-close and they are the cashier who opened the shift.
 * Shared by the summary (so the POS knows whether to show the PIN field) and
 * closeShift (which never trusts that answer and re-checks it here).
 */
async function selfCloseAllowed(client, context, shift) {
  if (!shift || shift.cashier_id !== context.userId) return false;
  const tenant = await client.query(
    'SELECT pos_self_close_shift_enabled FROM tenants WHERE id = $1',
    [context.tenantId],
  );
  return Boolean(tenant.rows[0]?.pos_self_close_shift_enabled);
}

async function loadShiftSummary(client, tenantId, shiftId) {
  const result = await client.query(
    `WITH tx AS (
       SELECT
         COALESCE(sum(total_cents), 0)::bigint AS gross_sales_cents,
         COALESCE(sum(total_cents) FILTER (WHERE payment_method = 'cash'), 0)::bigint AS cash_sales_cents,
         COALESCE(sum(total_cents) FILTER (WHERE payment_method = 'card'), 0)::bigint AS card_sales_cents,
         COALESCE(sum(total_cents) FILTER (WHERE payment_method = 'sadad'), 0)::bigint AS sadad_sales_cents,
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
     ), sold_items AS (
       SELECT COALESCE(sum(i.quantity), 0)::integer AS sold_item_quantity
       FROM pos_transaction_items i
       JOIN pos_transactions t ON t.id = i.transaction_id
       WHERE t.tenant_id = $1 AND t.shift_id = $2 AND t.status = 'completed'
     ), returned_items AS (
       SELECT COALESCE(sum(ri.quantity), 0)::integer AS returned_item_quantity
       FROM pos_refund_items ri
       JOIN pos_refunds rf ON rf.id = ri.refund_id
       WHERE rf.tenant_id = $1 AND rf.shift_id = $2 AND rf.status = 'completed'
     )
     SELECT s.id, s.register_id, s.cashier_id, s.state, s.opening_float_cents, s.opened_at,
       tx.*, refunds.*, sold_items.sold_item_quantity, returned_items.returned_item_quantity,
       (tx.gross_sales_cents - tx.void_total_cents - refunds.refund_total_cents)::bigint AS net_sales_cents
     FROM pos_shifts s CROSS JOIN tx CROSS JOIN refunds CROSS JOIN sold_items CROSS JOIN returned_items
     WHERE s.tenant_id = $1 AND s.id = $2`,
    [tenantId, shiftId],
  );
  assertPos(result.rowCount === 1, 404, 'SHIFT_NOT_FOUND', 'POS shift not found.');
  const row = result.rows[0];
  const { cashInCents, cashOutCents } = await cashMovementTotals(client, tenantId, shiftId);
  const openingFloatCents = numeric(row, 'opening_float_cents');
  const cashSalesCents = numeric(row, 'cash_sales_cents');
  const voidedCashCents = numeric(row, 'voided_cash_cents');
  const cashRefundCents = numeric(row, 'cash_refund_cents');
  return {
    shiftId: row.id,
    registerId: row.register_id,
    cashierId: row.cashier_id,
    state: row.state,
    openedAt: row.opened_at,
    openingFloatCents,
    grossSalesCents: numeric(row, 'gross_sales_cents'),
    cashSalesCents,
    cardSalesCents: numeric(row, 'card_sales_cents'),
    sadadSalesCents: numeric(row, 'sadad_sales_cents'),
    refundTotalCents: numeric(row, 'refund_total_cents'),
    cashRefundCents,
    voidTotalCents: numeric(row, 'void_total_cents'),
    voidedCashCents,
    netSalesCents: numeric(row, 'net_sales_cents'),
    cashInCents,
    cashOutCents,
    expectedCashCents: openingFloatCents + cashSalesCents - voidedCashCents - cashRefundCents + cashInCents - cashOutCents,
    transactionCount: numeric(row, 'transaction_count'),
    refundCount: numeric(row, 'refund_count'),
    voidCount: numeric(row, 'void_count'),
    soldItemQuantity: numeric(row, 'sold_item_quantity'),
    returnedItemQuantity: numeric(row, 'returned_item_quantity'),
    netItemQuantity: numeric(row, 'sold_item_quantity') - numeric(row, 'returned_item_quantity'),
  };
}

async function openShift(context, body) {
  const openingFloatCents = cents(body?.openingFloatCents, 'openingFloatCents');
  return inTransaction(async (client) => {
    const register = await requireRegister(client, context, { lock: true });
    const active = await client.query(
      `SELECT id FROM pos_shifts
       WHERE tenant_id = $1 AND register_id = $2 AND state IN ('open', 'closing')
       LIMIT 1`,
      [context.tenantId, register.id],
    );
    assertPos(!active.rowCount, 409, 'SHIFT_ALREADY_OPEN', 'This register already has an open shift.');
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
    // Drives whether the close-shift sheet asks for a manager PIN. Advisory
    // only — closeShift re-derives it server-side before skipping the override.
    return {
      ...summary,
      selfCloseAllowed: await selfCloseAllowed(client, context, { cashier_id: summary.cashierId }),
    };
  });
}

async function closeShift(context, body) {
  const shiftId = uuid(body?.shiftId, 'shiftId');
  const idempotencyKey = nonEmpty(body?.idempotencyKey, 'idempotencyKey', 160);
  const physicalCashCents = cents(body?.physicalCashCents, 'physicalCashCents');

  return inTransaction(async (client) => {
    const existing = await client.query(
      `SELECT z.*, pr.display_name AS register_name, cashier.full_name AS cashier_name,
              b.name AS branch_name
       FROM pos_z_reports z
       JOIN pos_registers pr ON pr.id = z.register_id AND pr.tenant_id = z.tenant_id
       JOIN pos_shifts s ON s.id = z.shift_id AND s.tenant_id = z.tenant_id
       LEFT JOIN admin_users cashier ON cashier.id = s.cashier_id AND cashier.tenant_id = z.tenant_id
       LEFT JOIN pos_branches b ON b.id = z.branch_id AND b.tenant_id = z.tenant_id
       WHERE z.tenant_id = $1 AND z.idempotency_key = $2`,
      [context.tenantId, idempotencyKey],
    );
    if (existing.rowCount) return mapZReport(existing.rows[0]);

    const register = await requireRegister(client, context, { lock: true });
    const shiftResult = await client.query(
      `SELECT s.*, cashier.full_name AS cashier_name
       FROM pos_shifts s
       LEFT JOIN admin_users cashier ON cashier.id = s.cashier_id AND cashier.tenant_id = s.tenant_id
       WHERE s.tenant_id = $1 AND s.id = $2
       FOR UPDATE OF s`,
      [context.tenantId, shiftId],
    );
    const shift = shiftResult.rows[0];
    assertPos(shift, 404, 'SHIFT_NOT_FOUND', 'POS shift not found.');
    assertPos(shift.register_id === register.id, 403, 'SHIFT_REGISTER_MISMATCH', 'Shift belongs to another register.');
    assertPos(shift.state === 'open', 409, 'SHIFT_NOT_OPEN', 'Only an open shift can be closed.');

    const syncState = await client.query(
      `SELECT COALESCE(sum(pending_count), 0)::integer AS pending_count,
         COALESCE(sum(rejected_count), 0)::integer AS rejected_count
       FROM pos_sync_states
       WHERE tenant_id = $1 AND register_id = $2 AND shift_id = $3`,
      [context.tenantId, register.id, shift.id],
    );
    const pendingCount = Number(syncState.rows[0].pending_count);
    const rejectedCount = Number(syncState.rows[0].rejected_count);
    assertPos(
      pendingCount === 0 && rejectedCount === 0,
      409,
      'SHIFT_SYNC_INCOMPLETE',
      'Shift cannot close while offline sales are pending or rejected.',
      { pendingCount, rejectedCount },
    );

    // The operator who held the drawer closes their own shift when the tenant
    // allows it (migration 026). Their count is the whole point of the Z
    // report, and Elite's shops have one branch manager who is often off-site.
    // Everyone else, and every shop that turned the toggle off, still needs a
    // different manager's PIN.
    const selfClose = await selfCloseAllowed(client, context, shift);
    const approverId = selfClose
      ? context.userId
      : (await consumeOverride(client, context, 'z-report', body)).manager_id;
    await client.query(
      `UPDATE pos_shifts SET state = 'closing', closing_started_at = now() WHERE id = $1`,
      [shift.id],
    );
    const summary = await loadShiftSummary(client, context.tenantId, shift.id);
    const branch = await resolveRegisterBranch(client, context.tenantId, register);
    const { businessDate, zNumber } = await nextZNumber(client, context.tenantId, branch.id, shift.opened_at);
    const reportData = { ...summary, physicalCashCents, businessDate, zNumber };
    const report = await client.query(
      `INSERT INTO pos_z_reports (
         tenant_id, shift_id, register_id, branch_id, manager_id, idempotency_key,
         opening_float_cents, gross_sales_cents, cash_sales_cents, card_sales_cents,
         refund_total_cents, cash_refund_cents, void_total_cents, voided_cash_cents,
         net_sales_cents, expected_cash_cents, physical_cash_cents,
         transaction_count, refund_count, void_count, sold_item_quantity, returned_item_quantity, report_data,
         cash_in_cents, cash_out_cents, sadad_sales_cents, business_date, z_number
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23::jsonb,$24,$25,$26,$27::date,$28
       ) RETURNING *`,
      [
        context.tenantId,
        shift.id,
        register.id,
        branch.id,
        approverId,
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
        summary.soldItemQuantity,
        summary.returnedItemQuantity,
        JSON.stringify(reportData),
        summary.cashInCents,
        summary.cashOutCents,
        summary.sadadSalesCents,
        businessDate,
        zNumber,
      ],
    );
    await client.query(
      `UPDATE pos_shifts
       SET state = 'closed', closed_at = now(), z_report_id = $2
       WHERE id = $1`,
      [shift.id, report.rows[0].id],
    );
    // selfClose is recorded on the audit entry so a Z report closed without a
    // second approver is identifiable afterwards, not just inferable from
    // manager_id matching the shift's cashier.
    await audit(client, context, 'pos.shift.closed', 'pos_z_report', report.rows[0].id, { ...reportData, selfClose });
    await client.query(
      `INSERT INTO pos_events (tenant_id, register_id, event_type, payload)
       VALUES ($1, $2, 'shift.closed', $3::jsonb)`,
      [context.tenantId, register.id, JSON.stringify({ shiftId: shift.id, zReportId: report.rows[0].id })],
    );
    return mapZReport({
      ...report.rows[0],
      register_name: register.display_name,
      branch_name: branch.name,
      cashier_name: shift.cashier_name,
    });
  });
}

/** YYYY-MM-DD for a `date` column. node-postgres turns `date` into a Date at
    local midnight, so the local calendar parts are the stored day. */
function isoDate(value) {
  if (!value) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  const pad = (n) => String(n).padStart(2, '0');
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

/**
 * The closing number the shop reads and files by: Z-DDMM-YYYY-NNN, where the
 * date is the Qatar day the shift was opened (a shift closed after midnight
 * or by morning recovery belongs to the day it sold) and NNN counts that
 * branch's closings on that day. Called inside closeShift's transaction with
 * the register row locked; pos_z_reports_branch_number_uq (migration 044) is
 * the backstop.
 */
async function nextZNumber(client, tenantId, branchId, openedAt) {
  const result = await client.query(
    `WITH day AS (
       SELECT ((($3::timestamptz) AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Qatar')::date AS d
     )
     SELECT to_char(day.d, 'YYYY-MM-DD') AS business_date,
            'Z-' || to_char(day.d, 'DDMM-YYYY') || '-' || lpad((count(z.id) + 1)::text, 3, '0') AS z_number
       FROM day
       LEFT JOIN pos_z_reports z
         ON z.tenant_id = $1 AND z.branch_id IS NOT DISTINCT FROM $2::uuid AND z.business_date = day.d
      GROUP BY day.d`,
    [tenantId, branchId || null, openedAt],
  );
  return { businessDate: result.rows[0].business_date, zNumber: result.rows[0].z_number };
}

function mapZReport(row) {
  return {
    zReportId: row.id,
    zNumber: row.z_number || null,
    businessDate: isoDate(row.business_date),
    shiftId: row.shift_id,
    registerId: row.register_id,
    registerName: row.register_name || null,
    branchId: row.branch_id || null,
    branchName: row.branch_name || null,
    cashierName: row.cashier_name || null,
    openingFloatCents: Number(row.opening_float_cents),
    grossSalesCents: Number(row.gross_sales_cents),
    cashSalesCents: Number(row.cash_sales_cents),
    cardSalesCents: Number(row.card_sales_cents),
    sadadSalesCents: Number(row.sadad_sales_cents || 0),
    refundTotalCents: Number(row.refund_total_cents),
    voidTotalCents: Number(row.void_total_cents),
    netSalesCents: Number(row.net_sales_cents),
    cashInCents: Number(row.cash_in_cents),
    cashOutCents: Number(row.cash_out_cents),
    expectedCashCents: Number(row.expected_cash_cents),
    physicalCashCents: Number(row.physical_cash_cents),
    varianceCents: Number(row.variance_cents),
    transactionCount: Number(row.transaction_count),
    refundCount: Number(row.refund_count),
    voidCount: Number(row.void_count),
    soldItemQuantity: Number(row.sold_item_quantity || 0),
    returnedItemQuantity: Number(row.returned_item_quantity || 0),
    netItemQuantity: Number(row.sold_item_quantity || 0) - Number(row.returned_item_quantity || 0),
    createdAt: row.created_at,
  };
}

async function listZReports(context, { limit = 30 } = {}) {
  const boundedLimit = Math.min(Math.max(Number(limit) || 30, 1), 100);
  return inTransaction(async (client) => {
    const register = await requireRegister(client, context);
    const result = await client.query(
      `SELECT z.*, pr.display_name AS register_name, cashier.full_name AS cashier_name,
              b.name AS branch_name
       FROM pos_z_reports z
       JOIN pos_registers pr ON pr.id = z.register_id AND pr.tenant_id = z.tenant_id
       JOIN pos_shifts s ON s.id = z.shift_id AND s.tenant_id = z.tenant_id
       LEFT JOIN admin_users cashier ON cashier.id = s.cashier_id AND cashier.tenant_id = z.tenant_id
       LEFT JOIN pos_branches b ON b.id = z.branch_id AND b.tenant_id = z.tenant_id
       WHERE z.tenant_id = $1 AND z.register_id = $2
       ORDER BY z.created_at DESC
       LIMIT $3`,
      [context.tenantId, register.id, boundedLimit],
    );
    return result.rows.map(mapZReport);
  });
}

async function loadZReportRow(client, tenantId, zReportId) {
  uuid(zReportId, 'zReportId');
  const result = await client.query(
    `SELECT z.*, pr.display_name AS register_name, cashier.full_name AS cashier_name,
            b.name AS branch_name
     FROM pos_z_reports z
     JOIN pos_registers pr ON pr.id = z.register_id AND pr.tenant_id = z.tenant_id
     JOIN pos_shifts s ON s.id = z.shift_id AND s.tenant_id = z.tenant_id
     LEFT JOIN admin_users cashier ON cashier.id = s.cashier_id AND cashier.tenant_id = z.tenant_id
     LEFT JOIN pos_branches b ON b.id = z.branch_id AND b.tenant_id = z.tenant_id
     WHERE z.tenant_id = $1 AND z.id = $2`,
    [tenantId, zReportId],
  );
  assertPos(result.rowCount, 404, 'Z_REPORT_NOT_FOUND', 'Z-report not found.');
  return result.rows[0];
}

async function getZReport(context, zReportId) {
  return inTransaction(async (client) => {
    const register = await requireRegister(client, context);
    const row = await loadZReportRow(client, context.tenantId, zReportId);
    assertPos(row.register_id === register.id, 403, 'Z_REPORT_REGISTER_MISMATCH', 'Z-report belongs to another register.');
    return mapZReport(row);
  });
}

/**
 * The item breakdown behind one closing, in the layout the shop files as its
 * daily sales report. Sales are completed (not voided) sales rung in the
 * shift; returns are completed refunds issued in the shift, attributed to the
 * refund's own method. Lines group by SKU, colour, size, unit price and
 * method, so the same shoe paid by cash and by card is two rows. Totals equal
 * the Z's net sales by construction.
 */
async function buildZReportItems(client, row) {
  const items = await client.query(
    `WITH lines AS (
       SELECT i.sku, i.product_name, i.color, i.size, i.unit_price_cents, t.payment_method AS method,
              i.quantity AS sold, 0 AS returned, i.line_total_cents AS amount
         FROM pos_transaction_items i
         JOIN pos_transactions t ON t.id = i.transaction_id
        WHERE t.tenant_id = $1 AND t.shift_id = $2 AND t.status = 'completed'
       UNION ALL
       SELECT i.sku, i.product_name, i.color, i.size, i.unit_price_cents, rf.method,
              0, ri.quantity, -ri.refund_amount_cents
         FROM pos_refund_items ri
         JOIN pos_refunds rf ON rf.id = ri.refund_id
         JOIN pos_transaction_items i ON i.id = ri.original_transaction_item_id
        WHERE rf.tenant_id = $1 AND rf.shift_id = $2 AND rf.status = 'completed'
     )
     SELECT sku, product_name, color, size, unit_price_cents, method,
            sum(sold)::integer AS sold, sum(returned)::integer AS returned, sum(amount)::bigint AS amount
       FROM lines
      GROUP BY sku, product_name, color, size, unit_price_cents, method
      ORDER BY product_name, size NULLS LAST, sku, method`,
    [row.tenant_id, row.shift_id],
  );
  const staff = await client.query(
    `SELECT au.full_name
       FROM (
         SELECT cashier_id, min(server_received_at) AS first_at FROM pos_transactions
          WHERE tenant_id = $1 AND shift_id = $2 GROUP BY cashier_id
         UNION ALL
         SELECT cashier_id, min(created_at) FROM pos_refunds
          WHERE tenant_id = $1 AND shift_id = $2 GROUP BY cashier_id
       ) people
       JOIN admin_users au ON au.id = people.cashier_id
      GROUP BY au.id, au.full_name
      ORDER BY min(people.first_at)`,
    [row.tenant_id, row.shift_id],
  );

  const lines = items.rows.map((r) => {
    const sold = Number(r.sold);
    const returned = Number(r.returned);
    return {
      sku: r.sku,
      description: r.product_name,
      color: r.color || null,
      size: r.size || null,
      soldQty: sold,
      returnQty: returned,
      netQty: sold - returned,
      unitPriceCents: Number(r.unit_price_cents),
      paymentMethod: r.method,
      totalCents: Number(r.amount),
    };
  });
  const byMethod = new Map();
  for (const line of lines) byMethod.set(line.paymentMethod, (byMethod.get(line.paymentMethod) || 0) + line.totalCents);
  const staffNames = staff.rows.map((s) => s.full_name).filter(Boolean);

  return {
    header: {
      zReportId: row.id,
      zNumber: row.z_number || null,
      businessDate: isoDate(row.business_date),
      branchName: row.branch_name || null,
      registerName: row.register_name || null,
      staffNames: staffNames.length ? staffNames : [row.cashier_name].filter(Boolean),
      closedAt: row.created_at,
      generatedAt: new Date().toISOString(),
    },
    items: lines,
    totals: {
      soldQty: lines.reduce((sum, l) => sum + l.soldQty, 0),
      returnQty: lines.reduce((sum, l) => sum + l.returnQty, 0),
      netQty: lines.reduce((sum, l) => sum + l.netQty, 0),
      totalCents: lines.reduce((sum, l) => sum + l.totalCents, 0),
    },
    byMethod: ['cash', 'card', 'sadad']
      .filter((method) => byMethod.has(method))
      .map((method) => ({ method, totalCents: byMethod.get(method) })),
  };
}

/** POS side: the register that closed it may read its breakdown. */
async function getZReportItems(context, zReportId) {
  return inTransaction(async (client) => {
    const register = await requireRegister(client, context);
    const row = await loadZReportRow(client, context.tenantId, zReportId);
    assertPos(row.register_id === register.id, 403, 'Z_REPORT_REGISTER_MISMATCH', 'Z-report belongs to another register.');
    return buildZReportItems(client, row);
  });
}

module.exports = {
  buildZReportItems, closeShift, isoDate, currentSummary, getZReport, getZReportItems, listZReports,
  loadShiftSummary, loadZReportRow, openShift,
};
