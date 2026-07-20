const db = require('../../db/client');

// This server's Postgres session runs with TimeZone = Asia/Qatar already set
// (confirmed via SHOW TIMEZONE — see card-reconciliation-service.js), so a
// single `timestamptz AT TIME ZONE 'Asia/Qatar'` double-converts: the value
// is already displayed in Qatar local time by the session before AT TIME
// ZONE shifts it again, landing on the wrong calendar day. Every business-
// date computation in this file normalizes through UTC first, which is
// correct regardless of the session's configured timezone.
const QATAR_TIME_ZONE = 'Asia/Qatar';

/**
 * Builds a "business_date >= from AND business_date <= to" SQL fragment for
 * a given timestamptz column, appending each bound value (zone name, then
 * from/to as needed) after the caller's existing params array. Returns the
 * SQL fragment plus the full params array (leadingParams + any appended).
 */
function bindBusinessDate(column, from, to, leadingParams) {
  const offset = leadingParams.length;
  const params = [...leadingParams];
  const expr = () => {
    params.push(QATAR_TIME_ZONE);
    return `((${column} AT TIME ZONE 'UTC') AT TIME ZONE $${params.length})::date`;
  };
  const conditions = [];
  if (from) {
    const e = expr();
    params.push(from);
    conditions.push(`${e} >= $${params.length}::date`);
  }
  if (to) {
    const e = expr();
    params.push(to);
    conditions.push(`${e} <= $${params.length}::date`);
  }
  return { sql: conditions.length ? conditions.join(' AND ') : 'true', params };
}

async function withClient(fn) {
  const client = await db.pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

function parseFilters(query) {
  const from = query?.from && /^\d{4}-\d{2}-\d{2}$/.test(query.from) ? query.from : null;
  const to = query?.to && /^\d{4}-\d{2}-\d{2}$/.test(query.to) ? query.to : null;
  const registerId = query?.registerId || null;
  const cashierId = query?.cashierId || null;
  return { from, to, registerId, cashierId };
}

/** Report 1: daily sales by payment method / cashier / register / item / hour. */
async function dailySales(context, query) {
  const { from, to, registerId, cashierId } = parseFilters(query);
  return withClient(async (client) => {
    const base = [context.tenantId];
    let where = `t.tenant_id = $1 AND t.status = 'completed'`;
    const bd = bindBusinessDate('t.server_received_at', from, to, base);
    where += ` AND ${bd.sql}`;
    let params = bd.params;
    if (registerId) { params = [...params, registerId]; where += ` AND t.register_id = $${params.length}`; }
    if (cashierId) { params = [...params, cashierId]; where += ` AND t.cashier_id = $${params.length}`; }

    // A single pg connection cannot run concurrent queries — Promise.all
    // here would fire all seven at once on the same client, which pg only
    // tolerates via deprecated internal queueing (warns, and is slated for
    // removal). Sequential awaits are the correct approach for one client;
    // true parallelism would need one connection per query, which isn't
    // worth it for six report calls that already run fast.
    const byDay = await client.query(
      `SELECT ((t.server_received_at AT TIME ZONE 'UTC') AT TIME ZONE '${QATAR_TIME_ZONE}')::date AS business_date,
              COALESCE(sum(t.total_cents), 0)::bigint AS total_cents,
              count(*)::integer AS transaction_count
       FROM pos_transactions t WHERE ${where}
       GROUP BY 1 ORDER BY 1`,
      params,
    );
    const byPayment = await client.query(
      `SELECT t.payment_method, COALESCE(sum(t.total_cents), 0)::bigint AS total_cents, count(*)::integer AS transaction_count
       FROM pos_transactions t WHERE ${where}
       GROUP BY 1 ORDER BY 1`,
      params,
    );
    const byCashier = await client.query(
      `SELECT t.cashier_id, au.full_name AS cashier_name,
              COALESCE(sum(t.total_cents), 0)::bigint AS total_cents, count(*)::integer AS transaction_count
       FROM pos_transactions t JOIN admin_users au ON au.id = t.cashier_id
       WHERE ${where}
       GROUP BY t.cashier_id, au.full_name ORDER BY total_cents DESC`,
      params,
    );
    const byRegister = await client.query(
      `SELECT t.register_id, pr.display_name AS register_name,
              COALESCE(sum(t.total_cents), 0)::bigint AS total_cents, count(*)::integer AS transaction_count
       FROM pos_transactions t JOIN pos_registers pr ON pr.id = t.register_id
       WHERE ${where}
       GROUP BY t.register_id, pr.display_name ORDER BY total_cents DESC`,
      params,
    );
    const byHour = await client.query(
      `SELECT EXTRACT(HOUR FROM (t.server_received_at AT TIME ZONE 'UTC') AT TIME ZONE '${QATAR_TIME_ZONE}')::integer AS hour_of_day,
              COALESCE(sum(t.total_cents), 0)::bigint AS total_cents, count(*)::integer AS transaction_count
       FROM pos_transactions t WHERE ${where}
       GROUP BY 1 ORDER BY 1`,
      params,
    );
    const byItem = await client.query(
      `SELECT ti.sku, ti.product_name, ti.variant_title,
              COALESCE(sum(ti.quantity), 0)::integer AS quantity,
              COALESCE(sum(ti.line_total_cents), 0)::bigint AS total_cents
       FROM pos_transaction_items ti
       JOIN pos_transactions t ON t.id = ti.transaction_id
       WHERE ${where}
       GROUP BY ti.sku, ti.product_name, ti.variant_title
       ORDER BY total_cents DESC
       LIMIT 100`,
      params,
    );
    const totals = await client.query(
      `SELECT COALESCE(sum(t.total_cents), 0)::bigint AS total_cents, count(*)::integer AS transaction_count
       FROM pos_transactions t WHERE ${where}`,
      params,
    );

    const t = totals.rows[0];
    return {
      totalCents: Number(t.total_cents),
      transactionCount: Number(t.transaction_count),
      byDay: byDay.rows.map((r) => ({ businessDate: r.business_date, totalCents: Number(r.total_cents), transactionCount: Number(r.transaction_count) })),
      byPaymentMethod: byPayment.rows.map((r) => ({ paymentMethod: r.payment_method, totalCents: Number(r.total_cents), transactionCount: Number(r.transaction_count) })),
      byCashier: byCashier.rows.map((r) => ({ cashierId: r.cashier_id, cashierName: r.cashier_name, totalCents: Number(r.total_cents), transactionCount: Number(r.transaction_count) })),
      byRegister: byRegister.rows.map((r) => ({ registerId: r.register_id, registerName: r.register_name, totalCents: Number(r.total_cents), transactionCount: Number(r.transaction_count) })),
      byHour: byHour.rows.map((r) => ({ hourOfDay: Number(r.hour_of_day), totalCents: Number(r.total_cents), transactionCount: Number(r.transaction_count) })),
      byItem: byItem.rows.map((r) => ({ sku: r.sku, productName: r.product_name, variantTitle: r.variant_title, quantity: Number(r.quantity), totalCents: Number(r.total_cents) })),
    };
  });
}

/** Report 2: cash drawer movements + variance (from pos_cash_movements + pos_z_reports). */
async function cashMovements(context, query) {
  const { from, to, registerId } = parseFilters(query);
  return withClient(async (client) => {
    const base = [context.tenantId];
    let where = `cm.tenant_id = $1`;
    const bd = bindBusinessDate('cm.created_at', from, to, base);
    where += ` AND ${bd.sql}`;
    let params = bd.params;
    if (registerId) { params = [...params, registerId]; where += ` AND cm.register_id = $${params.length}`; }

    const movementsResult = await client.query(
      `SELECT cm.id, cm.kind, cm.amount_cents, cm.reason, cm.created_at,
              cm.register_id, pr.display_name AS register_name,
              cm.cashier_id, cashier.full_name AS cashier_name,
              cm.manager_id, manager.full_name AS manager_name
       FROM pos_cash_movements cm
       JOIN pos_registers pr ON pr.id = cm.register_id
       JOIN admin_users cashier ON cashier.id = cm.cashier_id
       LEFT JOIN admin_users manager ON manager.id = cm.manager_id
       WHERE ${where}
       ORDER BY cm.created_at DESC
       LIMIT 500`,
      params,
    );

    const zBase = [context.tenantId];
    let zWhere = `z.tenant_id = $1`;
    const zBd = bindBusinessDate('z.created_at', from, to, zBase);
    zWhere += ` AND ${zBd.sql}`;
    let zParams = zBd.params;
    if (registerId) { zParams = [...zParams, registerId]; zWhere += ` AND z.register_id = $${zParams.length}`; }

    const varianceResult = await client.query(
      `SELECT z.id AS z_report_id, z.created_at, z.register_id, pr.display_name AS register_name,
              z.expected_cash_cents, z.physical_cash_cents, z.variance_cents, z.cash_in_cents, z.cash_out_cents
       FROM pos_z_reports z
       JOIN pos_registers pr ON pr.id = z.register_id
       WHERE ${zWhere}
       ORDER BY z.created_at DESC
       LIMIT 200`,
      zParams,
    );

    return {
      movements: movementsResult.rows.map((r) => ({
        movementId: r.id, kind: r.kind, amountCents: Number(r.amount_cents), reason: r.reason, createdAt: r.created_at,
        registerId: r.register_id, registerName: r.register_name,
        cashierId: r.cashier_id, cashierName: r.cashier_name,
        managerId: r.manager_id, managerName: r.manager_name,
      })),
      zReportVariances: varianceResult.rows.map((r) => ({
        zReportId: r.z_report_id, createdAt: r.created_at, registerId: r.register_id, registerName: r.register_name,
        expectedCashCents: Number(r.expected_cash_cents), physicalCashCents: Number(r.physical_cash_cents),
        varianceCents: Number(r.variance_cents), cashInCents: Number(r.cash_in_cents), cashOutCents: Number(r.cash_out_cents),
      })),
    };
  });
}

/** Report 3: card settlement exceptions (from pos_card_reconciliation). */
async function cardSettlementExceptions(context, query) {
  const { from, to, registerId } = parseFilters(query);
  return withClient(async (client) => {
    const params = [context.tenantId];
    let where = `r.tenant_id = $1`;
    if (from) { params.push(from); where += ` AND r.business_date >= $${params.length}`; }
    if (to) { params.push(to); where += ` AND r.business_date <= $${params.length}`; }
    if (registerId) { params.push(registerId); where += ` AND r.register_id = $${params.length}`; }
    const result = await client.query(
      `SELECT r.id, r.business_date, r.register_id, pr.display_name AS register_name,
              r.pos_total_cents, r.settlement_total_cents, r.status, r.notes,
              r.resolved_by_user_id, au.full_name AS resolved_by_name, r.resolved_at
       FROM pos_card_reconciliation r
       JOIN pos_registers pr ON pr.id = r.register_id
       LEFT JOIN admin_users au ON au.id = r.resolved_by_user_id
       WHERE ${where}
       ORDER BY r.business_date DESC, pr.display_name ASC
       LIMIT 500`,
      params,
    );
    return result.rows.map((r) => ({
      reconciliationId: r.id,
      businessDate: r.business_date,
      registerId: r.register_id,
      registerName: r.register_name,
      posTotalCents: Number(r.pos_total_cents),
      settlementTotalCents: r.settlement_total_cents === null ? null : Number(r.settlement_total_cents),
      varianceCents: r.settlement_total_cents === null ? null : Number(r.settlement_total_cents) - Number(r.pos_total_cents),
      status: r.status,
      notes: r.notes,
      resolvedByName: r.resolved_by_name,
      resolvedAt: r.resolved_at,
    }));
  });
}

/** Report 4: inventory movement / shrinkage report, filterable by reason. */
async function inventoryMovements(context, query) {
  const { from, to } = parseFilters(query);
  const reason = query?.reason || null;
  return withClient(async (client) => {
    const base = [context.tenantId];
    let where = `im.tenant_id = $1`;
    const bd = bindBusinessDate('im.occurred_at', from, to, base);
    where += ` AND ${bd.sql}`;
    let params = bd.params;
    if (reason) { params = [...params, reason]; where += ` AND im.reason = $${params.length}`; }

    // Sequential, not Promise.all — see dailySales's comment on why a single
    // pg client can't run concurrent queries.
    const byReason = await client.query(
      `SELECT im.reason, COALESCE(sum(im.delta), 0)::integer AS net_delta, count(*)::integer AS movement_count
       FROM inventory_movements im WHERE ${where}
       GROUP BY im.reason ORDER BY im.reason`,
      params,
    );
    const movements = await client.query(
      `SELECT im.id, im.occurred_at, im.reason, im.delta, im.reference_type, im.reference_id,
              p.name AS product_name, pv.sku
       FROM inventory_movements im
       JOIN products p ON p.id = im.product_id
       LEFT JOIN product_variants pv ON pv.id = im.variant_id
       WHERE ${where}
       ORDER BY im.occurred_at DESC
       LIMIT 500`,
      params,
    );
    const drift = await client.query(
      `SELECT pv.sku, pv.stock_quantity AS current_stock, b.baseline_stock,
              COALESCE(sum(im2.delta), 0)::integer AS ledger_delta_total,
              pv.stock_quantity - b.baseline_stock - COALESCE(sum(im2.delta), 0)::integer AS drift
       FROM pos_inventory_baselines b
       JOIN product_variants pv ON pv.id = b.variant_id AND pv.tenant_id = b.tenant_id
       LEFT JOIN inventory_movements im2 ON im2.variant_id = b.variant_id AND im2.tenant_id = b.tenant_id
       WHERE b.tenant_id = $1
       GROUP BY pv.sku, pv.stock_quantity, b.baseline_stock
       HAVING pv.stock_quantity - b.baseline_stock - COALESCE(sum(im2.delta), 0)::integer != 0`,
      [context.tenantId],
    );

    return {
      byReason: byReason.rows.map((r) => ({ reason: r.reason, netDelta: Number(r.net_delta), movementCount: Number(r.movement_count) })),
      movements: movements.rows.map((r) => ({
        movementId: r.id, occurredAt: r.occurred_at, reason: r.reason, delta: Number(r.delta),
        referenceType: r.reference_type, referenceId: r.reference_id, productName: r.product_name, sku: r.sku,
      })),
      driftAlerts: drift.rows.map((r) => ({
        sku: r.sku, currentStock: Number(r.current_stock), baselineStock: Number(r.baseline_stock),
        ledgerDeltaTotal: Number(r.ledger_delta_total), drift: Number(r.drift),
      })),
    };
  });
}

/** Report 5: refund / void exception dashboard. */
async function refundVoidExceptions(context, query) {
  const { from, to, registerId } = parseFilters(query);
  return withClient(async (client) => {
    const voidBase = [context.tenantId];
    let voidWhere = `v.tenant_id = $1`;
    const voidBd = bindBusinessDate('v.created_at', from, to, voidBase);
    voidWhere += ` AND ${voidBd.sql}`;
    let voidParams = voidBd.params;
    if (registerId) { voidParams = [...voidParams, registerId]; voidWhere += ` AND v.register_id = $${voidParams.length}`; }

    const refundBase = [context.tenantId];
    let refundWhere = `r.tenant_id = $1 AND r.status = 'completed'`;
    const refundBd = bindBusinessDate('r.created_at', from, to, refundBase);
    refundWhere += ` AND ${refundBd.sql}`;
    let refundParams = refundBd.params;
    if (registerId) { refundParams = [...refundParams, registerId]; refundWhere += ` AND r.register_id = $${refundParams.length}`; }

    // Sequential, not Promise.all — see dailySales's comment on why a single
    // pg client can't run concurrent queries.
    const voids = await client.query(
      `SELECT v.id, v.created_at, v.amount_cents, v.reason,
              v.register_id, pr.display_name AS register_name,
              v.cashier_id, cashier.full_name AS cashier_name,
              v.manager_id, manager.full_name AS manager_name,
              v.transaction_id
       FROM pos_voids v
       JOIN pos_registers pr ON pr.id = v.register_id
       JOIN admin_users cashier ON cashier.id = v.cashier_id
       JOIN admin_users manager ON manager.id = v.manager_id
       WHERE ${voidWhere}
       ORDER BY v.created_at DESC
       LIMIT 500`,
      voidParams,
    );
    const refunds = await client.query(
      `SELECT r.id, r.created_at, r.amount_cents, r.method, r.reason,
              r.register_id, pr.display_name AS register_name,
              r.cashier_id, cashier.full_name AS cashier_name,
              r.manager_id, manager.full_name AS manager_name,
              r.original_transaction_id
       FROM pos_refunds r
       JOIN pos_registers pr ON pr.id = r.register_id
       JOIN admin_users cashier ON cashier.id = r.cashier_id
       JOIN admin_users manager ON manager.id = r.manager_id
       WHERE ${refundWhere}
       ORDER BY r.created_at DESC
       LIMIT 500`,
      refundParams,
    );

    return {
      voids: voids.rows.map((r) => ({
        voidId: r.id, createdAt: r.created_at, amountCents: Number(r.amount_cents), reason: r.reason,
        registerId: r.register_id, registerName: r.register_name,
        cashierId: r.cashier_id, cashierName: r.cashier_name,
        managerId: r.manager_id, managerName: r.manager_name,
        transactionId: r.transaction_id,
      })),
      refunds: refunds.rows.map((r) => ({
        refundId: r.id, createdAt: r.created_at, amountCents: Number(r.amount_cents), method: r.method, reason: r.reason,
        registerId: r.register_id, registerName: r.register_name,
        cashierId: r.cashier_id, cashierName: r.cashier_name,
        managerId: r.manager_id, managerName: r.manager_name,
        originalTransactionId: r.original_transaction_id,
      })),
    };
  });
}

/** Report 6: Z-report history — already built in Phase 3 (shift-service.js's
 *  listZReports); this just re-exposes it with date-range filtering for the
 *  reporting suite so it lives alongside the other five under one menu. */
async function zReportHistory(context, query) {
  const { from, to, registerId } = parseFilters(query);
  return withClient(async (client) => {
    const params = [context.tenantId];
    let where = `z.tenant_id = $1`;
    if (from) { params.push(from); where += ` AND ((z.created_at AT TIME ZONE 'UTC') AT TIME ZONE '${QATAR_TIME_ZONE}')::date >= $${params.length}::date`; }
    if (to) { params.push(to); where += ` AND ((z.created_at AT TIME ZONE 'UTC') AT TIME ZONE '${QATAR_TIME_ZONE}')::date <= $${params.length}::date`; }
    if (registerId) { params.push(registerId); where += ` AND z.register_id = $${params.length}`; }
    const result = await client.query(
      `SELECT z.*, pr.display_name AS register_name
       FROM pos_z_reports z
       JOIN pos_registers pr ON pr.id = z.register_id
       WHERE ${where}
       ORDER BY z.created_at DESC
       LIMIT 500`,
      params,
    );
    return result.rows.map((row) => ({
      zReportId: row.id,
      registerId: row.register_id,
      registerName: row.register_name,
      openingFloatCents: Number(row.opening_float_cents),
      grossSalesCents: Number(row.gross_sales_cents),
      cashSalesCents: Number(row.cash_sales_cents),
      cardSalesCents: Number(row.card_sales_cents),
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
      createdAt: row.created_at,
    }));
  });
}

module.exports = {
  dailySales,
  cashMovements,
  cardSettlementExceptions,
  inventoryMovements,
  refundVoidExceptions,
  zReportHistory,
};
