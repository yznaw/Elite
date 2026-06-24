const { audit, inTransaction, requireRegister } = require('./db');
const { assertPos, nonEmpty, uuid } = require('./errors');
const { consumeOverride } = require('./manager-service');

async function listConflicts(context) {
  return inTransaction(async (client) => {
    await requireRegister(client, context);
    const result = await client.query(
      `SELECT c.id, c.transaction_id, c.variant_id, c.conflict_type,
         c.expected_value, c.actual_value, c.shortage_quantity, c.status,
         c.resolution, c.created_at, t.idempotency_key, r.receipt_number,
         i.product_name, i.sku
       FROM pos_sync_conflicts c
       JOIN pos_transactions t ON t.id = c.transaction_id
       JOIN pos_receipts r ON r.id = t.receipt_id
       LEFT JOIN pos_transaction_items i
         ON i.transaction_id = t.id AND i.variant_id = c.variant_id
       WHERE c.tenant_id = $1 AND c.status = 'open'
       ORDER BY c.created_at`,
      [context.tenantId],
    );
    return result.rows.map((row) => ({
      conflictId: row.id,
      transactionId: row.transaction_id,
      idempotencyKey: row.idempotency_key,
      receiptNumber: String(row.receipt_number).padStart(8, '0'),
      variantId: row.variant_id,
      productName: row.product_name || '',
      sku: row.sku || '',
      type: row.conflict_type,
      expectedValue: row.expected_value === null ? null : Number(row.expected_value),
      actualValue: row.actual_value === null ? null : Number(row.actual_value),
      shortageQuantity: row.shortage_quantity === null ? null : Number(row.shortage_quantity),
      status: row.status,
      createdAt: row.created_at,
    }));
  });
}

async function resolveConflict(context, conflictIdValue, body) {
  const conflictId = uuid(conflictIdValue, 'conflictId');
  const resolution = nonEmpty(body?.resolution, 'resolution', 1000);
  return inTransaction(async (client) => {
    await requireRegister(client, context);
    const override = await consumeOverride(client, context, 'sync-conflict-override', body);
    const result = await client.query(
      `UPDATE pos_sync_conflicts
       SET status = 'resolved', resolution = $3, resolved_by_user_id = $4, resolved_at = now()
       WHERE tenant_id = $1 AND id = $2 AND status = 'open'
       RETURNING id, transaction_id, resolved_at`,
      [context.tenantId, conflictId, resolution, override.manager_id],
    );
    assertPos(result.rowCount === 1, 404, 'SYNC_CONFLICT_NOT_FOUND', 'Open sync conflict not found.');
    await audit(client, context, 'pos.sync-conflict.resolved', 'pos_sync_conflict', conflictId, {
      resolution,
      managerId: override.manager_id,
    });
    return {
      conflictId,
      transactionId: result.rows[0].transaction_id,
      status: 'resolved',
      resolvedAt: result.rows[0].resolved_at,
    };
  });
}

module.exports = { listConflicts, resolveConflict };
