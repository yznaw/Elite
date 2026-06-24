const { inTransaction, requireRegister } = require('./db');
const { assertPos, positiveInt, uuid } = require('./errors');
const { createSale } = require('./sale-service');

const MAX_SYNC_BATCH = 50;

async function syncTransactions(context, body) {
  assertPos(Array.isArray(body?.transactions), 422, 'INVALID_SYNC_BATCH', 'transactions must be an array.');
  assertPos(body.transactions.length <= MAX_SYNC_BATCH, 422, 'SYNC_BATCH_TOO_LARGE', `A sync batch cannot exceed ${MAX_SYNC_BATCH} sales.`);

  const accepted = [];
  const acceptedWithConflicts = [];
  const rejected = [];

  for (const entry of body.transactions) {
    const idempotencyKey = String(entry?.idempotencyKey || entry?.payload?.idempotencyKey || '').trim();
    try {
      assertPos(entry?.payload && typeof entry.payload === 'object', 422, 'INVALID_PAYLOAD', 'Offline sale payload is required.');
      assertPos(entry.payload.idempotencyKey === idempotencyKey, 422, 'INVALID_PAYLOAD', 'Offline idempotency key does not match its payload.');
      assertPos(entry.payload.receiptNumber === entry.receiptNumber, 422, 'INVALID_PAYLOAD', 'Offline receipt number does not match its payload.');
      assertPos(entry.payload.clientCreatedAt === entry.clientCreatedAt, 422, 'INVALID_PAYLOAD', 'Offline timestamp does not match its payload.');
      const result = await createSale(context, entry.payload, { offline: true });
      if (result.syncConflicts?.length) {
        acceptedWithConflicts.push({
          idempotencyKey,
          transactionId: result.transactionId,
          conflicts: result.syncConflicts,
        });
      } else {
        accepted.push({ idempotencyKey, transactionId: result.transactionId });
      }
    } catch (error) {
      rejected.push({
        idempotencyKey,
        reason: syncRejectionReason(error?.code),
        code: error?.code || 'SYNC_FAILED',
        message: error?.message || 'Offline sale could not be synchronized.',
      });
    }
  }

  return { accepted, acceptedWithConflicts, rejected };
}

function syncRejectionReason(code) {
  if (code === 'INVALID_RECEIPT_NUMBER' || code === 'POS_CONFLICT') return 'INVALID_RECEIPT_NUMBER';
  if (['REGISTER_REQUIRED', 'REGISTER_NOT_FOUND', 'REGISTER_DISABLED', 'SHIFT_REGISTER_MISMATCH', 'SHIFT_CASHIER_MISMATCH'].includes(code)) {
    return 'UNAUTHORIZED_REGISTER';
  }
  return 'INVALID_PAYLOAD';
}

async function reportSyncState(context, body) {
  const shiftId = uuid(body?.shiftId, 'shiftId');
  const pendingCount = body?.pendingCount === 0 ? 0 : positiveInt(body?.pendingCount, 'pendingCount');
  const rejectedCount = body?.rejectedCount === 0 ? 0 : positiveInt(body?.rejectedCount, 'rejectedCount');
  return inTransaction(async (client) => {
    const register = await requireRegister(client, context);
    const shift = await client.query(
      `SELECT id FROM pos_shifts
       WHERE tenant_id = $1 AND id = $2 AND register_id = $3`,
      [context.tenantId, shiftId, register.id],
    );
    assertPos(shift.rowCount === 1, 404, 'SHIFT_NOT_FOUND', 'POS shift not found for this register.');
    await client.query(
      `INSERT INTO pos_sync_states
        (tenant_id, register_id, shift_id, pending_count, rejected_count, last_reported_at)
       VALUES ($1,$2,$3,$4,$5,now())
       ON CONFLICT (tenant_id, register_id, shift_id) DO UPDATE
       SET pending_count = EXCLUDED.pending_count,
           rejected_count = EXCLUDED.rejected_count,
           last_reported_at = now()`,
      [context.tenantId, register.id, shiftId, pendingCount, rejectedCount],
    );
    return { shiftId, pendingCount, rejectedCount, reportedAt: new Date().toISOString() };
  });
}

module.exports = { reportSyncState, syncRejectionReason, syncTransactions };
