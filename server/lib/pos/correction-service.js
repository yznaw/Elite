const { audit, inTransaction, requireRegister } = require('./db');
const { assertPos, nonEmpty, positiveInt, uuid } = require('./errors');
const { consumeOverride } = require('./manager-service');
const { claimReceipt, loadSale } = require('./sale-service');

async function updateProductTotals(client, tenantId, productIds) {
  if (!productIds.size) return;
  await client.query(
    `UPDATE products p
     SET stock_quantity = totals.stock
     FROM (
       SELECT product_id, COALESCE(sum(stock_quantity), 0)::integer AS stock
       FROM product_variants
       WHERE tenant_id = $1 AND product_id = ANY($2::uuid[])
       GROUP BY product_id
     ) totals
     WHERE p.tenant_id = $1 AND p.id = totals.product_id`,
    [tenantId, [...productIds]],
  );
}

async function publishStock(client, context, variantId, stock) {
  await client.query(
    `INSERT INTO pos_events (tenant_id, register_id, event_type, payload)
     VALUES ($1, NULL, 'stock.updated', $2::jsonb)`,
    [context.tenantId, JSON.stringify({ variantId, stock, sourceRegisterId: context.registerId })],
  );
}

function mapVoid(row, stockRestored = []) {
  return {
    voidId: row.id,
    transactionId: row.transaction_id,
    amountCents: Number(row.amount_cents),
    reason: row.reason,
    voidedAt: row.created_at,
    stockRestored,
  };
}

async function voidTransaction(context, transactionIdValue, body) {
  const transactionId = uuid(transactionIdValue, 'transactionId');
  const idempotencyKey = nonEmpty(body?.idempotencyKey, 'idempotencyKey', 160);
  const reason = nonEmpty(body?.voidReason, 'voidReason', 500);

  return inTransaction(async (client) => {
    const existing = await client.query(
      `SELECT * FROM pos_voids WHERE tenant_id = $1 AND idempotency_key = $2`,
      [context.tenantId, idempotencyKey],
    );
    if (existing.rowCount) {
      assertPos(
        existing.rows[0].register_id === context.registerId && existing.rows[0].cashier_id === context.userId,
        409,
        'IDEMPOTENCY_KEY_CONFLICT',
        'This void idempotency key belongs to another POS session.',
      );
      return mapVoid(existing.rows[0]);
    }

    const register = await requireRegister(client, context, { lock: true });
    const transactionResult = await client.query(
      `SELECT t.*, o.customer_id, p.id AS payment_id
       FROM pos_transactions t
       JOIN orders o ON o.id = t.order_id
       JOIN payments p ON p.order_id = o.id AND p.status = 'paid'
       WHERE t.tenant_id = $1 AND t.id = $2
       FOR UPDATE OF t, o, p`,
      [context.tenantId, transactionId],
    );
    assertPos(transactionResult.rowCount === 1, 404, 'TRANSACTION_NOT_FOUND', 'POS transaction not found.');
    const transaction = transactionResult.rows[0];
    assertPos(transaction.register_id === register.id, 403, 'VOID_REGISTER_MISMATCH', 'Only the original register can void this sale.');
    assertPos(transaction.cashier_id === context.userId, 403, 'VOID_CASHIER_MISMATCH', 'Only the original cashier can void this sale.');
    assertPos(transaction.status === 'completed', 409, 'TRANSACTION_NOT_VOIDABLE', 'Transaction is already voided.');

    const shiftResult = await client.query(
      `SELECT state FROM pos_shifts WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
      [context.tenantId, transaction.shift_id],
    );
    assertPos(shiftResult.rows[0]?.state === 'open', 409, 'VOID_SHIFT_CLOSED', 'Voids are only allowed in the original open shift.');
    const refunds = await client.query(
      `SELECT 1 FROM pos_refunds
       WHERE tenant_id = $1 AND original_transaction_id = $2 AND status = 'completed' LIMIT 1`,
      [context.tenantId, transaction.id],
    );
    assertPos(!refunds.rowCount, 409, 'TRANSACTION_ALREADY_REFUNDED', 'A refunded transaction cannot be voided.');

    const override = await consumeOverride(client, context, 'void', body);
    const voidResult = await client.query(
      `INSERT INTO pos_voids (
         tenant_id, transaction_id, order_id, payment_id, register_id, shift_id,
         cashier_id, manager_id, idempotency_key, amount_cents, reason
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING *`,
      [
        context.tenantId,
        transaction.id,
        transaction.order_id,
        transaction.payment_id,
        register.id,
        transaction.shift_id,
        context.userId,
        override.manager_id,
        idempotencyKey,
        transaction.total_cents,
        reason,
      ],
    );

    const items = await client.query(
      `SELECT variant_id, product_id, quantity FROM pos_transaction_items
       WHERE tenant_id = $1 AND transaction_id = $2 FOR UPDATE`,
      [context.tenantId, transaction.id],
    );
    const stockRestored = [];
    const products = new Set();
    for (const item of items.rows) {
      if (!item.variant_id) continue;
      const stock = await client.query(
        `UPDATE product_variants SET stock_quantity = stock_quantity + $3
         WHERE tenant_id = $1 AND id = $2 RETURNING stock_quantity`,
        [context.tenantId, item.variant_id, item.quantity],
      );
      if (stock.rowCount) {
        const value = Number(stock.rows[0].stock_quantity);
        stockRestored.push({ variantId: item.variant_id, stock: value });
        if (item.product_id) products.add(item.product_id);
        await publishStock(client, context, item.variant_id, value);
      }
    }
    await updateProductTotals(client, context.tenantId, products);

    await client.query(
      `UPDATE pos_transactions
       SET status = 'voided', void_reason = $2, voided_at = now(), voided_by_user_id = $3
       WHERE id = $1`,
      [transaction.id, reason, override.manager_id],
    );
    await client.query(
      `UPDATE orders SET status = 'cancelled', payment_status = 'refunded', cancelled_at = now()
       WHERE id = $1`,
      [transaction.order_id],
    );
    await client.query(
      `UPDATE payments
       SET status = 'refunded', raw_payload = raw_payload || $2::jsonb
       WHERE id = $1`,
      [transaction.payment_id, JSON.stringify({ posVoidId: voidResult.rows[0].id, reason })],
    );
    await client.query(
      `INSERT INTO order_timeline_entries
        (tenant_id, order_id, kind, detail, actor_user_id, metadata)
       VALUES ($1,$2,'cancelled',$3,$4,$5::jsonb)`,
      [context.tenantId, transaction.order_id, `POS sale voided: ${reason}`, override.manager_id, JSON.stringify({ posVoidId: voidResult.rows[0].id })],
    );
    if (transaction.customer_id) {
      await client.query(
        `UPDATE customers SET ltv_cents = GREATEST(ltv_cents - $3, 0), updated_at = now()
         WHERE tenant_id = $1 AND id = $2`,
        [context.tenantId, transaction.customer_id, transaction.total_cents],
      );
    }
    await audit(client, context, 'pos.transaction.voided', 'pos_void', voidResult.rows[0].id, {
      transactionId: transaction.id,
      reason,
      amountCents: Number(transaction.total_cents),
      managerId: override.manager_id,
    });
    await client.query(
      `INSERT INTO pos_events (tenant_id, register_id, event_type, payload)
       VALUES ($1, NULL, 'transaction.voided', $2::jsonb)`,
      [context.tenantId, JSON.stringify({ transactionId: transaction.id, voidId: voidResult.rows[0].id })],
    );
    return mapVoid(voidResult.rows[0], stockRestored);
  });
}

async function loadRefundReceiptData(client, tenantId, refundId) {
  const result = await client.query(
    `SELECT rf.*, rr.receipt_number, o.payment_status AS order_payment_status,
       au.full_name AS cashier_name, reg.display_name AS register_name
     FROM pos_refunds rf
     JOIN pos_receipts rr ON rr.id = rf.receipt_id
     JOIN orders o ON o.id = rf.original_order_id
     JOIN admin_users au ON au.id = rf.cashier_id
     JOIN pos_registers reg ON reg.id = rf.register_id
     WHERE rf.tenant_id = $1 AND rf.id = $2`,
    [tenantId, refundId],
  );
  assertPos(result.rowCount === 1, 404, 'REFUND_NOT_FOUND', 'POS refund not found.');
  const items = await client.query(
    `SELECT ri.quantity, ri.refund_amount_cents,
       i.product_name, i.variant_title, i.sku, i.unit_price_cents, i.created_at
     FROM pos_refund_items ri
     JOIN pos_transaction_items i ON i.id = ri.original_transaction_item_id
     WHERE ri.tenant_id = $1 AND ri.refund_id = $2
     ORDER BY i.created_at`,
    [tenantId, refundId],
  );
  return { row: result.rows[0], items: items.rows };
}

function mapRefund(row, { stockUpdates = [], items = [] } = {}) {
  const receiptNumber = Number(row.receipt_number);
  const padded = String(receiptNumber).padStart(8, '0');
  const receiptItems = items.map((item) => ({
    name: item.product_name,
    variant: item.variant_title || '',
    sku: item.sku || '',
    quantity: Number(item.quantity),
    unitPriceCents: Number(item.unit_price_cents),
    lineTotalCents: Number(item.refund_amount_cents),
  }));
  return {
    refundId: row.id,
    originalTransactionId: row.original_transaction_id,
    refundReceiptNumber: padded,
    amountCents: Number(row.amount_cents),
    method: row.method,
    reason: row.reason,
    orderPaymentStatus: row.order_payment_status,
    stockUpdates,
    receipt: {
      qrCodeValue: `elite-pos-refund:${row.id}`,
      receiptData: {
        kind: 'refund',
        refundId: row.id,
        originalTransactionId: row.original_transaction_id,
        receiptNumber: padded,
        createdAt: row.created_at,
        cashierName: row.cashier_name || '',
        registerId: row.register_id || '',
        registerName: row.register_name || '',
        method: row.method,
        items: receiptItems,
        amountCents: Number(row.amount_cents),
        reason: row.reason,
        lookupCode: `elite-pos-refund:${row.id}`,
      },
    },
  };
}

async function createRefund(context, body) {
  const idempotencyKey = nonEmpty(body?.idempotencyKey, 'idempotencyKey', 160);
  const originalTransactionId = uuid(body?.originalTransactionId, 'originalTransactionId');
  const shiftId = uuid(body?.shiftId, 'shiftId');
  const receiptNumber = positiveInt(body?.receiptNumber, 'receiptNumber');
  const method = String(body?.refundMethod || '');
  assertPos(['cash', 'card'].includes(method), 422, 'REFUND_METHOD_INVALID', 'Refund method must be cash or card.');
  const reason = nonEmpty(body?.reason, 'reason', 500);
  assertPos(Array.isArray(body?.lines) && body.lines.length > 0 && body.lines.length <= 100, 422, 'REFUND_LINES_INVALID', 'Refund must contain 1 to 100 lines.');
  const seen = new Set();
  const lines = body.lines.map((line, index) => {
    const transactionItemId = uuid(line?.transactionItemId, `lines[${index}].transactionItemId`);
    assertPos(!seen.has(transactionItemId), 422, 'REFUND_LINE_DUPLICATE', 'Refund lines cannot be duplicated.');
    seen.add(transactionItemId);
    return { transactionItemId, quantity: positiveInt(line?.quantity, `lines[${index}].quantity`), restock: line?.restock !== false };
  });

  return inTransaction(async (client) => {
    const existing = await client.query(
      `SELECT rf.*, rr.receipt_number, o.payment_status AS order_payment_status
       FROM pos_refunds rf
       JOIN pos_receipts rr ON rr.id = rf.receipt_id
       JOIN orders o ON o.id = rf.original_order_id
       WHERE rf.tenant_id = $1 AND rf.idempotency_key = $2`,
      [context.tenantId, idempotencyKey],
    );
    if (existing.rowCount) {
      assertPos(
        existing.rows[0].register_id === context.registerId && existing.rows[0].cashier_id === context.userId,
        409,
        'IDEMPOTENCY_KEY_CONFLICT',
        'This refund idempotency key belongs to another POS session.',
      );
      const replay = await loadRefundReceiptData(client, context.tenantId, existing.rows[0].id);
      return mapRefund(replay.row, { items: replay.items });
    }

    const register = await requireRegister(client, context, { lock: true });
    const shift = await client.query(
      `SELECT id FROM pos_shifts
       WHERE tenant_id = $1 AND id = $2 AND register_id = $3 AND cashier_id = $4 AND state = 'open'
       FOR UPDATE`,
      [context.tenantId, shiftId, register.id, context.userId],
    );
    assertPos(shift.rowCount === 1, 409, 'SHIFT_NOT_OPEN', 'Refunds require the cashier\'s current open shift.');

    const transactionResult = await client.query(
      `SELECT t.*, o.customer_id, o.payment_status, p.id AS payment_id, p.amount_cents AS payment_amount_cents
       FROM pos_transactions t
       JOIN orders o ON o.id = t.order_id
       JOIN payments p ON p.order_id = o.id
       WHERE t.tenant_id = $1 AND t.id = $2
       ORDER BY p.created_at LIMIT 1
       FOR UPDATE OF t, o, p`,
      [context.tenantId, originalTransactionId],
    );
    assertPos(transactionResult.rowCount === 1, 404, 'TRANSACTION_NOT_FOUND', 'Original POS transaction not found.');
    const transaction = transactionResult.rows[0];
    assertPos(transaction.status === 'completed', 409, 'TRANSACTION_VOIDED', 'A voided transaction cannot be refunded.');
    assertPos(transaction.payment_method === method, 422, 'REFUND_METHOD_MISMATCH', 'Refund method must match the original payment method.');

    const itemIds = lines.map((line) => line.transactionItemId);
    const itemResult = await client.query(
      `SELECT i.*,
         COALESCE((
           SELECT sum(ri.quantity)
           FROM pos_refund_items ri
           JOIN pos_refunds rf ON rf.id = ri.refund_id
           WHERE ri.original_transaction_item_id = i.id AND rf.status = 'completed'
         ), 0)::integer AS refunded_quantity
       FROM pos_transaction_items i
       WHERE i.tenant_id = $1 AND i.transaction_id = $2 AND i.id = ANY($3::uuid[])
       FOR UPDATE`,
      [context.tenantId, transaction.id, itemIds],
    );
    assertPos(itemResult.rowCount === lines.length, 422, 'REFUND_ITEM_INVALID', 'One or more refund lines do not belong to the original sale.');
    const itemMap = new Map(itemResult.rows.map((item) => [item.id, item]));
    let amountCents = 0;
    for (const line of lines) {
      const item = itemMap.get(line.transactionItemId);
      const refundableQty = Number(item.quantity) - Number(item.refunded_quantity);
      assertPos(line.quantity <= refundableQty, 409, 'REFUND_QUANTITY_EXCEEDED', `${item.product_name} has only ${refundableQty} refundable units.`);
      amountCents += Number(item.unit_price_cents) * line.quantity;
    }
    assertPos(amountCents > 0, 422, 'REFUND_AMOUNT_INVALID', 'Refund amount must be positive.');
    const priorRefunds = await client.query(
      `SELECT COALESCE(sum(amount_cents) FILTER (WHERE status = 'completed'), 0)::bigint AS amount
       FROM payment_refunds WHERE tenant_id = $1 AND payment_id = $2`,
      [context.tenantId, transaction.payment_id],
    );
    const cumulativeAmount = Number(priorRefunds.rows[0].amount) + amountCents;
    assertPos(cumulativeAmount <= Number(transaction.payment_amount_cents), 409, 'REFUND_AMOUNT_EXCEEDED', 'Refund exceeds the original payment amount.');

    const override = await consumeOverride(client, context, 'refund', body);
    const receipt = await claimReceipt(client, context, receiptNumber, 'refund');
    const refundResult = await client.query(
      `INSERT INTO pos_refunds (
         tenant_id, original_transaction_id, original_order_id, original_payment_id,
         receipt_id, register_id, shift_id, cashier_id, manager_id, idempotency_key,
         method, amount_cents, status, reason
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'completed',$13)
       RETURNING *`,
      [
        context.tenantId,
        transaction.id,
        transaction.order_id,
        transaction.payment_id,
        receipt.id,
        register.id,
        shiftId,
        context.userId,
        override.manager_id,
        idempotencyKey,
        method,
        amountCents,
        reason,
      ],
    );
    const refund = refundResult.rows[0];
    const stockUpdates = [];
    const products = new Set();
    for (const line of lines) {
      const item = itemMap.get(line.transactionItemId);
      await client.query(
        `INSERT INTO pos_refund_items
          (tenant_id, refund_id, original_transaction_item_id, quantity, refund_amount_cents, restocked)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [context.tenantId, refund.id, item.id, line.quantity, Number(item.unit_price_cents) * line.quantity, line.restock],
      );
      if (line.restock) {
        assertPos(item.variant_id, 409, 'REFUND_VARIANT_MISSING', `${item.product_name} can no longer be returned to inventory.`);
        const stock = await client.query(
          `UPDATE product_variants SET stock_quantity = stock_quantity + $3
           WHERE tenant_id = $1 AND id = $2 RETURNING stock_quantity`,
          [context.tenantId, item.variant_id, line.quantity],
        );
        assertPos(stock.rowCount === 1, 409, 'REFUND_VARIANT_MISSING', `${item.product_name} variant no longer exists.`);
        const value = Number(stock.rows[0].stock_quantity);
        stockUpdates.push({ variantId: item.variant_id, stock: value });
        if (item.product_id) products.add(item.product_id);
        await publishStock(client, context, item.variant_id, value);
      }
    }
    await updateProductTotals(client, context.tenantId, products);
    await client.query(
      `INSERT INTO payment_refunds
        (tenant_id, payment_id, pos_refund_id, method, amount_cents, status, processed_at, raw_payload)
       VALUES ($1,$2,$3,$4,$5,'completed',now(),$6::jsonb)`,
      [context.tenantId, transaction.payment_id, refund.id, method, amountCents, JSON.stringify({ source: 'pos', reason })],
    );
    const paymentStatus = cumulativeAmount === Number(transaction.payment_amount_cents) ? 'refunded' : 'partially_refunded';
    await client.query(
      `UPDATE orders
       SET payment_status = $2::order_payment_status,
           status = CASE WHEN $2::text = 'refunded' THEN 'refunded'::order_status ELSE status END
       WHERE id = $1`,
      [transaction.order_id, paymentStatus],
    );
    await client.query('UPDATE payments SET status = $2 WHERE id = $1', [transaction.payment_id, paymentStatus]);
    await client.query(
      `INSERT INTO order_timeline_entries
        (tenant_id, order_id, kind, detail, actor_user_id, metadata)
       VALUES ($1,$2,'refunded',$3,$4,$5::jsonb)`,
      [context.tenantId, transaction.order_id, `POS refund: ${reason}`, override.manager_id, JSON.stringify({ posRefundId: refund.id, amountCents })],
    );
    if (transaction.customer_id) {
      await client.query(
        `UPDATE customers SET ltv_cents = GREATEST(ltv_cents - $3, 0), updated_at = now()
         WHERE tenant_id = $1 AND id = $2`,
        [context.tenantId, transaction.customer_id, amountCents],
      );
    }
    await client.query('UPDATE pos_receipts SET entity_id = $1 WHERE id = $2', [refund.id, receipt.id]);
    await audit(client, context, 'pos.transaction.refunded', 'pos_refund', refund.id, {
      transactionId: transaction.id,
      amountCents,
      reason,
      managerId: override.manager_id,
    });
    await client.query(
      `INSERT INTO pos_events (tenant_id, register_id, event_type, payload)
       VALUES ($1, NULL, 'transaction.refunded', $2::jsonb)`,
      [context.tenantId, JSON.stringify({ transactionId: transaction.id, refundId: refund.id })],
    );
    const receiptData = await loadRefundReceiptData(client, context.tenantId, refund.id);
    return mapRefund(receiptData.row, { stockUpdates, items: receiptData.items });
  });
}

const UUID_RE = /^[0-9a-f-]{36}$/i;

// Accepts everything a receipt can carry: the sale QR (`elite-pos:<uuid>` or,
// for an offline receipt, `elite-pos:<idempotencyKey>`), the refund QR
// (`elite-pos-refund:<refundId>`), a bare transaction UUID, an idempotency key,
// or a printed `#<receiptNumber>` from either a sale or a refund receipt.
async function findTransaction(context, lookup) {
  const raw = nonEmpty(lookup, 'lookup', 160);
  return inTransaction(async (client) => {
    await requireRegister(client, context);

    let value = raw.trim();
    let viaRefund = false;
    if (/^elite-pos-refund:/i.test(value)) {
      viaRefund = true;
      value = value.replace(/^elite-pos-refund:/i, '').trim();
    } else if (/^elite-pos:/i.test(value)) {
      value = value.replace(/^elite-pos:/i, '').trim();
    }
    value = value.replace(/^#/, '').trim();

    let transactionId;
    if (viaRefund) {
      assertPos(UUID_RE.test(value), 422, 'TRANSACTION_LOOKUP_INVALID', 'Invalid refund reference.');
      transactionId = await resolveRefund(client, context.tenantId, value);
    } else if (UUID_RE.test(value)) {
      // A sale transaction id, or an offline receipt's idempotency key.
      const result = await client.query(
        `SELECT id FROM pos_transactions
         WHERE tenant_id = $1 AND (id::text = $2 OR idempotency_key = $2)`,
        [context.tenantId, value],
      );
      assertPos(result.rowCount === 1, 404, 'TRANSACTION_NOT_FOUND', 'POS transaction not found.');
      transactionId = result.rows[0].id;
    } else {
      const receiptNumber = Number.parseInt(value, 10);
      assertPos(Number.isSafeInteger(receiptNumber) && receiptNumber > 0, 422, 'TRANSACTION_LOOKUP_INVALID', 'Enter a transaction ID or receipt number.');
      const receipt = await client.query(
        `SELECT kind, entity_id FROM pos_receipts
         WHERE tenant_id = $1 AND receipt_number = $2`,
        [context.tenantId, receiptNumber],
      );
      assertPos(receipt.rowCount === 1 && receipt.rows[0].entity_id, 404, 'TRANSACTION_NOT_FOUND', 'POS transaction not found.');
      transactionId = receipt.rows[0].kind === 'refund'
        ? await resolveRefund(client, context.tenantId, receipt.rows[0].entity_id)
        : receipt.rows[0].entity_id;
    }
    return loadSale(client, context.tenantId, transactionId);
  });
}

async function resolveRefund(client, tenantId, refundId) {
  const result = await client.query(
    `SELECT original_transaction_id FROM pos_refunds WHERE tenant_id = $1 AND id = $2`,
    [tenantId, refundId],
  );
  assertPos(result.rowCount === 1, 404, 'TRANSACTION_NOT_FOUND', 'POS transaction not found.');
  return result.rows[0].original_transaction_id;
}

module.exports = { createRefund, findTransaction, mapRefund, mapVoid, voidTransaction };
