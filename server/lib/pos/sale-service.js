const { audit, inTransaction, requireRegister } = require('./db');
const { assertPos, cents, nonEmpty, positiveInt, uuid } = require('./errors');
const { recordMovement } = require('../inventory-ledger');
const db = require('../../db/client');
const { sendReceiptForPaidOrder } = require('../order-receipt');

const MAX_ORDER_CENTS = 2_147_483_647;

function variantTitle(row) {
  return [row.color, row.size, row.material].filter(Boolean).join(' / ');
}

function mapCatalogRow(row) {
  return {
    productId: row.product_id,
    variantId: row.variant_id,
    name: row.product_name,
    // Carried through the catalogue so an offline sale can still print the
    // bilingual item line — the cached catalogue is all the register has.
    nameAr: row.product_name_ar || '',
    variant: variantTitle(row),
    size: row.size || '',
    color: row.color || '',
    material: row.material || '',
    sku: row.sku,
    barcode: row.barcode || '',
    priceCents: Number(row.price_cents),
    stock: Number(row.stock_quantity),
    imageUrl: row.image_url || '',
    // Storefront status and POS status are independent. A hidden storefront
    // product can be sold in-store, but pos_status='hidden' cannot.
    isActive: row.product_status !== 'archived' && row.product_pos_status === 'active' && row.is_active,
  };
}

async function searchProducts(context, query) {
  const q = String(query?.q || '').trim();
  // This limit caps distinct PRODUCTS per page, not variant rows — a product
  // with 60 size/color variants (e.g. shoes) previously ate the entire row
  // limit by itself and starved every other product out of the results.
  const limit = Math.min(200, Math.max(1, Number.parseInt(query?.limit, 10) || 50));
  const page = Math.max(0, Number.parseInt(query?.page, 10) || 0);
  const offset = page * limit;
  const includeOutOfStock = String(query?.includeOutOfStock || 'false') === 'true';
  const size = String(query?.size || '').trim();
  const color = String(query?.color || '').trim();

  // Shared filter + param list, applied identically to the product-matching
  // subquery and the count query — only the outer LIMIT/OFFSET differ.
  // pv2.size/color use plain equality with an empty-string sentinel meaning
  // "no filter", matching the existing $2 = '%%' convention for q. Both
  // queries bind the same 7 params (even though the count query's text never
  // references $6/$7) so Postgres never has to infer a param's type from a
  // query where it doesn't appear.
  const matchClause = `
    p2.tenant_id = $1
    AND p2.status <> 'archived'
    AND p2.pos_status = 'active'
    AND pv2.is_active = true
    AND ($2 = '%%' OR p2.name ILIKE $2 OR pv2.sku ILIKE $2 OR pv2.barcode ILIKE $2)
    AND ($3::boolean OR pv2.stock_quantity > 0)
    AND ($4 = '' OR pv2.size = $4)
    AND ($5 = '' OR pv2.color = $5)
  `;
  const params = [context.tenantId, `%${q}%`, includeOutOfStock, size, color, limit, offset];

  return inTransaction(async (client) => {
    const countResult = await client.query(
      `SELECT COUNT(DISTINCT p2.id)::integer AS total
       FROM products p2
       JOIN product_variants pv2 ON pv2.product_id = p2.id AND pv2.tenant_id = p2.tenant_id
       WHERE ${matchClause} AND ($6::integer IS NOT NULL) AND ($7::integer IS NOT NULL)`,
      params,
    );
    const total = countResult.rows[0].total;

    const result = await client.query(
      `SELECT
         p.id AS product_id, p.name AS product_name, p.status AS product_status,
         p.pos_status AS product_pos_status,
         pt.name AS product_name_ar,
         pv.id AS variant_id, pv.sku, pv.barcode, pv.size, pv.color, pv.material,
         pv.price_cents, pv.stock_quantity, pv.is_active,
         COALESCE(pm.preview_url, pm.storage_url, '') AS image_url
       FROM product_variants pv
       JOIN products p ON p.id = pv.product_id AND p.tenant_id = pv.tenant_id
       LEFT JOIN product_translations pt ON pt.product_id = p.id AND pt.locale = 'ar'
       LEFT JOIN media_assets pm ON pm.id = p.primary_media_id
       WHERE pv.tenant_id = $1
         AND p.status <> 'archived'
         AND p.pos_status = 'active'
         AND pv.is_active = true
         AND ($2 = '%%' OR p.name ILIKE $2 OR pv.sku ILIKE $2 OR pv.barcode ILIKE $2)
         AND ($3::boolean OR pv.stock_quantity > 0)
         AND ($4 = '' OR pv.size = $4)
         AND ($5 = '' OR pv.color = $5)
         AND p.id IN (
           SELECT id FROM (
             SELECT DISTINCT p2.id, p2.name
             FROM products p2
             JOIN product_variants pv2 ON pv2.product_id = p2.id AND pv2.tenant_id = p2.tenant_id
             WHERE ${matchClause}
             ORDER BY p2.name, p2.id
             LIMIT $6 OFFSET $7
           ) matched_products
         )
       ORDER BY p.name, pv.sort_order, pv.sku`,
      params,
    );

    return {
      products: result.rows.map(mapCatalogRow),
      total,
      page,
      limit,
      pages: Math.max(1, Math.ceil(total / limit)),
      serverTimestamp: new Date().toISOString(),
    };
  });
}

async function listProductFilters(context) {
  return inTransaction(async (client) => {
    const result = await client.query(
      `SELECT
         COALESCE(array_agg(DISTINCT pv.size)  FILTER (WHERE pv.size IS NOT NULL AND pv.size <> ''),  ARRAY[]::text[]) AS sizes,
         COALESCE(array_agg(DISTINCT pv.color) FILTER (WHERE pv.color IS NOT NULL AND pv.color <> ''), ARRAY[]::text[]) AS colors
       FROM product_variants pv
       JOIN products p ON p.id = pv.product_id AND p.tenant_id = pv.tenant_id
       WHERE pv.tenant_id = $1 AND p.status <> 'archived' AND p.pos_status = 'active' AND pv.is_active = true`,
      [context.tenantId],
    );
    const row = result.rows[0];
    return {
      sizes: [...row.sizes].sort(),
      colors: [...row.colors].sort(),
    };
  });
}

async function findByBarcode(context, barcodeValue) {
  const barcode = nonEmpty(barcodeValue, 'barcode', 120);
  return inTransaction(async (client) => {
    const result = await client.query(
      `SELECT
         p.id AS product_id, p.name AS product_name, p.status AS product_status,
         p.pos_status AS product_pos_status,
         pt.name AS product_name_ar,
         pv.id AS variant_id, pv.sku, pv.barcode, pv.size, pv.color, pv.material,
         pv.price_cents, pv.stock_quantity, pv.is_active,
         COALESCE(pm.preview_url, pm.storage_url, '') AS image_url
       FROM product_variants pv
       JOIN products p ON p.id = pv.product_id AND p.tenant_id = pv.tenant_id
       LEFT JOIN product_translations pt ON pt.product_id = p.id AND pt.locale = 'ar'
       LEFT JOIN media_assets pm ON pm.id = p.primary_media_id
       WHERE pv.tenant_id = $1 AND lower(pv.barcode) = lower($2)
         AND p.status <> 'archived' AND p.pos_status = 'active' AND pv.is_active = true`,
      [context.tenantId, barcode],
    );
    assertPos(result.rowCount === 1, 404, 'BARCODE_NOT_FOUND', `No active product uses barcode ${barcode}.`);
    return mapCatalogRow(result.rows[0]);
  });
}

function normalizeSale(body) {
  const idempotencyKey = nonEmpty(body?.idempotencyKey, 'idempotencyKey', 160);
  const receiptNumber = positiveInt(body?.receiptNumber, 'receiptNumber');
  const shiftId = uuid(body?.shiftId, 'shiftId');
  const customerId = body?.customerId ? uuid(body.customerId, 'customerId') : null;
  assertPos(Array.isArray(body?.items) && body.items.length > 0, 422, 'CART_EMPTY', 'Cart must contain at least one item.');
  assertPos(body.items.length <= 100, 422, 'CART_TOO_LARGE', 'Cart cannot contain more than 100 lines.');

  const seen = new Set();
  const items = body.items.map((item, index) => {
    const variantId = uuid(item?.variantId, `items[${index}].variantId`);
    assertPos(!seen.has(variantId), 422, 'DUPLICATE_CART_LINE', 'Each variant must appear only once in the cart.');
    seen.add(variantId);
    return {
      variantId,
      quantity: positiveInt(item?.quantity, `items[${index}].quantity`),
      unitPriceCents: cents(item?.unitPriceCents, `items[${index}].unitPriceCents`),
    };
  });

  const method = String(body?.payment?.method || '');
  assertPos(['cash', 'card'].includes(method), 422, 'PAYMENT_METHOD_INVALID', 'Payment method must be cash or card.');
  // The card terminal at this shop is a standalone unit with no cable/API link
  // to the POS (docs/15 Phase 4) — the only paper trail available is whatever
  // reference/approval code the cashier reads off the terminal's own receipt,
  // so it is captured here and required rather than accepted as a bare "paid".
  const terminalReference = method === 'card'
    ? nonEmpty(body?.payment?.terminalReference, 'payment.terminalReference', 80)
    : null;
  const clientCreatedAt = body?.clientCreatedAt ? new Date(body.clientCreatedAt) : null;
  assertPos(!clientCreatedAt || !Number.isNaN(clientCreatedAt.getTime()), 422, 'INVALID_TIMESTAMP', 'clientCreatedAt must be a valid timestamp.');
  return {
    idempotencyKey,
    receiptNumber,
    shiftId,
    customerId,
    items,
    payment: {
      method,
      cashAmountCents: cents(body?.payment?.cashAmountCents, 'payment.cashAmountCents'),
      cardAmountCents: cents(body?.payment?.cardAmountCents, 'payment.cardAmountCents'),
      amountTenderedCents: cents(body?.payment?.amountTenderedCents, 'payment.amountTenderedCents'),
      changeGivenCents: cents(body?.payment?.changeGivenCents, 'payment.changeGivenCents'),
      terminalReference,
    },
    clientCreatedAt,
  };
}

async function claimReceipt(client, context, receiptNumber, kind) {
  const blockResult = await client.query(
    `SELECT * FROM pos_receipt_number_blocks
     WHERE tenant_id = $1 AND register_id = $2
       AND $3 BETWEEN range_start AND range_end
     FOR UPDATE`,
    [context.tenantId, context.registerId, receiptNumber],
  );
  assertPos(blockResult.rowCount === 1, 422, 'INVALID_RECEIPT_NUMBER', 'Receipt number is not reserved for this register.');
  const receipt = await client.query(
    `INSERT INTO pos_receipts (tenant_id, register_id, block_id, receipt_number, kind)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, receipt_number, issued_at`,
    [context.tenantId, context.registerId, blockResult.rows[0].id, receiptNumber, kind],
  );
  return receipt.rows[0];
}

async function loadSale(client, tenantId, transactionId) {
  uuid(transactionId, 'transactionId');
  const transactionResult = await client.query(
    `SELECT t.*, r.receipt_number, o.public_number,
       au.full_name AS cashier_name, reg.display_name AS register_name,
       -- Joined so a linked customer is visible on the sale result, the
       -- sale-complete screen and the printed receipt. Left join: a walk-in
       -- sale has no customer and must still load (docs/25 Phase 5).
       cust.full_name AS customer_name,
       COALESCE(cust.phone_number, cust.phone) AS customer_phone,
       COALESCE(jsonb_agg(jsonb_build_object(
         'id', i.id,
         'variantId', i.variant_id,
         'name', i.product_name,
         'nameAr', i.product_name_ar,
         'variant', i.variant_title,
         'sku', i.sku,
         'barcode', i.barcode,
         'quantity', i.quantity,
         'unitPriceCents', i.unit_price_cents,
         'lineTotalCents', i.line_total_cents
       ) ORDER BY i.created_at) FILTER (WHERE i.id IS NOT NULL), '[]'::jsonb) AS items
     FROM pos_transactions t
     JOIN pos_receipts r ON r.id = t.receipt_id
     JOIN orders o ON o.id = t.order_id
     JOIN admin_users au ON au.id = t.cashier_id
     JOIN pos_registers reg ON reg.id = t.register_id
     LEFT JOIN customers cust ON cust.id = t.customer_id
     LEFT JOIN pos_transaction_items i ON i.transaction_id = t.id
     WHERE t.tenant_id = $1 AND t.id = $2
     GROUP BY t.id, r.receipt_number, o.public_number, au.full_name, reg.display_name,
              cust.full_name, cust.phone_number, cust.phone`,
    [tenantId, transactionId],
  );
  assertPos(transactionResult.rowCount === 1, 404, 'TRANSACTION_NOT_FOUND', 'POS transaction not found.');
  const row = transactionResult.rows[0];
  const refundResult = await client.query(
    `SELECT rf.id, rf.amount_cents, rf.method, rf.reason, rf.status, rf.created_at,
       rr.receipt_number
     FROM pos_refunds rf
     JOIN pos_receipts rr ON rr.id = rf.receipt_id
     WHERE rf.tenant_id = $1 AND rf.original_transaction_id = $2
     ORDER BY rf.created_at`,
    [tenantId, transactionId],
  );
  const refundedQuantityResult = await client.query(
    `SELECT ri.original_transaction_item_id AS item_id,
       COALESCE(sum(ri.quantity) FILTER (WHERE rf.status = 'completed'), 0)::integer AS quantity
     FROM pos_refund_items ri
     JOIN pos_refunds rf ON rf.id = ri.refund_id
     WHERE ri.tenant_id = $1 AND rf.original_transaction_id = $2
     GROUP BY ri.original_transaction_item_id`,
    [tenantId, transactionId],
  );
  const refundedByItem = new Map(refundedQuantityResult.rows.map((item) => [item.item_id, Number(item.quantity)]));
  const receiptNumber = Number(row.receipt_number);
  const items = (row.items || []).map((item) => ({
    ...item,
    unitPriceCents: Number(item.unitPriceCents),
    lineTotalCents: Number(item.lineTotalCents),
    refundableQty: Math.max(0, Number(item.quantity) - (refundedByItem.get(item.id) || 0)),
  }));
  return {
    transactionId: row.id,
    orderId: row.order_id,
    orderNumber: row.public_number,
    customerId: row.customer_id || null,
    customerName: row.customer_name || null,
    customerPhone: row.customer_phone || null,
    receiptNumber: String(receiptNumber).padStart(8, '0'),
    status: row.status,
    paymentMethod: row.payment_method,
    subtotalCents: Number(row.subtotal_cents),
    taxCents: Number(row.tax_cents),
    totalCents: Number(row.total_cents),
    amountTenderedCents: Number(row.amount_tendered_cents),
    changeGivenCents: Number(row.change_given_cents),
    voidReason: row.void_reason || null,
    voidedAt: row.voided_at || null,
    items,
    refunds: refundResult.rows.map((refund) => ({
      refundId: refund.id,
      amountCents: Number(refund.amount_cents),
      method: refund.method,
      reason: refund.reason,
      status: refund.status,
      receiptNumber: String(refund.receipt_number).padStart(8, '0'),
      createdAt: refund.created_at,
    })),
    stockUpdates: [],
    receipt: {
      qrCodeValue: `elite-pos:${row.id}`,
      receiptData: {
        receiptNumber: String(receiptNumber).padStart(8, '0'),
        transactionId: row.id,
        createdAt: row.client_created_at || row.server_received_at,
        cashierName: row.cashier_name || '',
        registerId: row.register_id,
        registerName: row.register_name || '',
        paymentMethod: row.payment_method,
        items,
        subtotalCents: Number(row.subtotal_cents),
        taxCents: Number(row.tax_cents),
        totalCents: Number(row.total_cents),
        amountTenderedCents: Number(row.amount_tendered_cents),
        changeGivenCents: Number(row.change_given_cents),
        lookupCode: `elite-pos:${row.id}`,
      },
    },
  };
}

async function createSale(context, body, options = {}) {
  const sale = normalizeSale(body);
  const offline = options.offline === true;
  if (offline) {
    assertPos(sale.clientCreatedAt, 422, 'INVALID_TIMESTAMP', 'Offline sales require clientCreatedAt.');
  }
  const result = await inTransaction(async (client) => {
    const existing = await client.query(
      `SELECT id, register_id, cashier_id
       FROM pos_transactions WHERE tenant_id = $1 AND idempotency_key = $2`,
      [context.tenantId, sale.idempotencyKey],
    );
    if (existing.rowCount) {
      assertPos(
        existing.rows[0].register_id === context.registerId && existing.rows[0].cashier_id === context.userId,
        409,
        'IDEMPOTENCY_KEY_CONFLICT',
        'This idempotency key belongs to another POS session.',
      );
      const result = await loadSale(client, context.tenantId, existing.rows[0].id);
      const conflicts = await client.query(
        `SELECT id, conflict_type, variant_id FROM pos_sync_conflicts
         WHERE tenant_id = $1 AND transaction_id = $2 ORDER BY created_at`,
        [context.tenantId, existing.rows[0].id],
      );
      result.syncConflicts = conflicts.rows.map((conflict) => ({
        conflictId: conflict.id,
        type: conflict.conflict_type,
        variantId: conflict.variant_id,
      }));
      return result;
    }

    await requireRegister(client, context, { lock: true });
    const shiftResult = await client.query(
      `SELECT * FROM pos_shifts
       WHERE tenant_id = $1 AND id = $2
       FOR UPDATE`,
      [context.tenantId, sale.shiftId],
    );
    const shift = shiftResult.rows[0];
    assertPos(shift, 404, 'SHIFT_NOT_FOUND', 'POS shift not found.');
    assertPos(shift.register_id === context.registerId, 403, 'SHIFT_REGISTER_MISMATCH', 'Shift belongs to another register.');
    assertPos(shift.cashier_id === context.userId, 403, 'SHIFT_CASHIER_MISMATCH', 'Shift belongs to another cashier.');
    assertPos(shift.state === 'open', 409, 'SHIFT_NOT_OPEN', 'Sales require an open shift.');

    const variantIds = sale.items.map((item) => item.variantId);
    const variantsResult = await client.query(
      `SELECT pv.id, pv.product_id, pv.sku, pv.barcode, pv.size, pv.color, pv.material,
         pv.price_cents, pv.stock_quantity, pv.is_active,
         p.name AS product_name, p.status AS product_status, p.pos_status AS product_pos_status,
         -- Snapshotted onto the sale below, not joined at print time: a receipt
         -- reprinted later must show what was sold, not what the catalogue says
         -- now (owner decision 2026-08-01 — item lines are bilingual, the rest
         -- of the receipt stays English).
         pt.name AS product_name_ar,
         COALESCE(pm.preview_url, pm.storage_url, '') AS image_url
       FROM product_variants pv
       JOIN products p ON p.id = pv.product_id AND p.tenant_id = pv.tenant_id
       LEFT JOIN product_translations pt ON pt.product_id = p.id AND pt.locale = 'ar'
       LEFT JOIN media_assets pm ON pm.id = p.primary_media_id
       WHERE pv.tenant_id = $1 AND pv.id = ANY($2::uuid[])
       -- Locks are taken in a deterministic order. Without ORDER BY, two
       -- concurrent multi-line sales touching the same variants could grab
       -- them in opposite orders and deadlock; sorting by id means every
       -- writer in the system queues in the same sequence.
       ORDER BY pv.id
       FOR UPDATE OF pv`,
      [context.tenantId, variantIds],
    );
    assertPos(variantsResult.rowCount === variantIds.length, 422, 'VARIANT_NOT_FOUND', 'One or more product variants no longer exist.');
    const variants = new Map(variantsResult.rows.map((row) => [row.id, row]));

    let subtotalCents = 0;
    const pendingConflicts = [];
    const saleLines = sale.items.map((item) => {
      const variant = variants.get(item.variantId);
      assertPos(
        variant.is_active && variant.product_status !== 'archived' && variant.product_pos_status === 'active',
        422,
        'VARIANT_INACTIVE',
        `${variant.sku} is not available for sale.`,
      );
      const availableStock = Number(variant.stock_quantity);
      const catalogPriceCents = Number(variant.price_cents);
      if (availableStock < item.quantity) {
        assertPos(offline, 409, 'INSUFFICIENT_STOCK', `${variant.sku} has insufficient stock.`, {
          variantId: variant.id,
          available: availableStock,
        });
        pendingConflicts.push({
          type: 'insufficient_stock',
          variantId: variant.id,
          expectedValue: item.quantity,
          actualValue: availableStock,
          shortageQuantity: item.quantity - availableStock,
        });
      }
      if (catalogPriceCents !== item.unitPriceCents) {
        assertPos(offline, 409, 'PRICE_CHANGED', `${variant.sku} price changed.`, {
          variantId: variant.id,
          priceCents: catalogPriceCents,
        });
        pendingConflicts.push({
          type: 'price_changed',
          variantId: variant.id,
          expectedValue: item.unitPriceCents,
          actualValue: catalogPriceCents,
          shortageQuantity: null,
        });
      }
      const unitPriceCents = offline ? item.unitPriceCents : catalogPriceCents;
      const lineTotalCents = unitPriceCents * item.quantity;
      assertPos(Number.isSafeInteger(lineTotalCents), 422, 'ORDER_TOTAL_TOO_LARGE', 'Order total exceeds the supported limit.');
      subtotalCents += lineTotalCents;
      return { ...item, variant, unitPriceCents, lineTotalCents };
    });
    assertPos(subtotalCents <= MAX_ORDER_CENTS, 422, 'ORDER_TOTAL_TOO_LARGE', 'Order total exceeds the supported limit.');
    const totalCents = subtotalCents;
    validatePayment(sale.payment, totalCents);

    let customer = null;
    // Set when an offline sale referenced a customer that no longer exists;
    // recorded on the audit event so the broken link is traceable instead of
    // silently vanishing.
    let droppedCustomerId = null;
    if (sale.customerId) {
      const customerResult = await client.query(
        `SELECT id, full_name, email, COALESCE(phone_number, phone) AS phone
         FROM customers
         WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
        [context.tenantId, sale.customerId],
      );
      // Online, an unknown customer id is a real client error and is rejected.
      // Offline it must not be: the sale was already tendered and printed, and
      // the customer could have been deleted or merged in the hours since. A
      // completed financial fact is never discarded over a broken link — the
      // sale falls back to walk-in and the lost link is recorded, matching the
      // policy already applied to stale offline prices and stock.
      if (customerResult.rowCount === 1) {
        customer = customerResult.rows[0];
      } else {
        assertPos(offline, 404, 'CUSTOMER_NOT_FOUND', 'Customer not found.');
        droppedCustomerId = sale.customerId;
      }
    }

    const receipt = await claimReceipt(client, context, sale.receiptNumber, 'sale');
    const publicNumber = `POS-${String(sale.receiptNumber).padStart(8, '0')}`;
    const orderResult = await client.query(
      `INSERT INTO orders (
         tenant_id, public_number, idempotency_key, customer_id, customer_email,
         customer_name, customer_phone, status, payment_status, fulfillment_status,
         subtotal_cents, shipping_cents, tax_cents, discount_cents, total_cents,
         shipping_address, billing_address, paid_at, metadata
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,'completed','paid','delivered',$8,0,0,0,$8,
         '{}'::jsonb,'{}'::jsonb,now(),$9::jsonb
       ) RETURNING id`,
      [
        context.tenantId,
        publicNumber,
        sale.idempotencyKey,
        customer?.id || null,
        customer?.email || null,
        customer?.full_name || 'Walk-in customer',
        customer?.phone || null,
        totalCents,
        JSON.stringify({ source: 'pos', offline, registerId: context.registerId, receiptNumber: sale.receiptNumber }),
      ],
    );
    const orderId = orderResult.rows[0].id;
    const paymentResult = await client.query(
      `INSERT INTO payments
        (tenant_id, order_id, provider, method, status, amount_cents, currency, processed_at, raw_payload, terminal_reference)
       VALUES ($1,$2,'pos-manual',$3,'paid',$4,'QAR',now(),$5::jsonb,$6)
       RETURNING id`,
      [
        context.tenantId,
        orderId,
        sale.payment.method,
        totalCents,
        JSON.stringify({ source: 'pos', offline }),
        sale.payment.terminalReference,
      ],
    );
    const transactionResult = await client.query(
      `INSERT INTO pos_transactions (
         tenant_id, order_id, receipt_id, register_id, shift_id, cashier_id, customer_id,
         idempotency_key, payment_method, subtotal_cents, tax_cents, total_cents,
         cash_amount_cents, card_amount_cents, amount_tendered_cents, change_given_cents,
         client_created_at, metadata
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,0,$10,$11,$12,$13,$14,$15,$16::jsonb)
       RETURNING id`,
      [
        context.tenantId,
        orderId,
        receipt.id,
        context.registerId,
        shift.id,
        context.userId,
        customer?.id || null,
        sale.idempotencyKey,
        sale.payment.method,
        totalCents,
        sale.payment.cashAmountCents,
        sale.payment.cardAmountCents,
        sale.payment.amountTenderedCents,
        sale.payment.changeGivenCents,
        sale.clientCreatedAt,
        JSON.stringify({ offline }),
      ],
    );
    const transactionId = transactionResult.rows[0].id;

    const stockUpdates = [];
    const affectedProducts = new Set();
    for (const line of saleLines) {
      const v = line.variant;
      const title = variantTitle(v);
      const orderItem = await client.query(
        `INSERT INTO order_items (
           tenant_id, order_id, product_id, variant_id, sku, product_name,
           variant_title, size, quantity, unit_price_cents, total_cents, media_url, metadata
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)
         RETURNING id`,
        [
          context.tenantId,
          orderId,
          v.product_id,
          v.id,
          v.sku,
          v.product_name,
          title || null,
          v.size,
          line.quantity,
          line.unitPriceCents,
          line.lineTotalCents,
          v.image_url || null,
          JSON.stringify({ color: v.color || null, material: v.material || null, source: 'pos', offline }),
        ],
      );
      await client.query(
        `INSERT INTO pos_transaction_items (
           tenant_id, transaction_id, order_item_id, product_id, variant_id,
           sku, barcode, product_name, product_name_ar, variant_title, quantity,
           unit_price_cents, tax_rate, tax_amount_cents, line_total_cents
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,0,0,$13)`,
        [
          context.tenantId,
          transactionId,
          orderItem.rows[0].id,
          v.product_id,
          v.id,
          v.sku,
          v.barcode,
          v.product_name,
          v.product_name_ar || null,
          title || null,
          line.quantity,
          line.unitPriceCents,
          line.lineTotalCents,
        ],
      );
      const stockResult = await client.query(
        `UPDATE product_variants
         SET stock_quantity = ${offline ? 'GREATEST(stock_quantity - $3, 0)' : 'stock_quantity - $3'}
         WHERE tenant_id = $1 AND id = $2 ${offline ? '' : 'AND stock_quantity >= $3'}
         RETURNING stock_quantity`,
        [context.tenantId, v.id, line.quantity],
      );
      assertPos(stockResult.rowCount === 1, 409, 'INSUFFICIENT_STOCK', `${v.sku} has insufficient stock.`);
      const stock = Number(stockResult.rows[0].stock_quantity);
      stockUpdates.push({ variantId: v.id, stock });
      affectedProducts.add(v.product_id);
      await recordMovement(client, context, {
        productId: v.product_id,
        variantId: v.id,
        delta: -line.quantity,
        reason: 'pos_sale',
        referenceType: 'pos_transaction',
        referenceId: transactionId,
        metadata: { offline, sku: v.sku },
      });
      await client.query(
        `INSERT INTO pos_events (tenant_id, register_id, event_type, payload)
         VALUES ($1, NULL, 'stock.updated', $2::jsonb)`,
        [context.tenantId, JSON.stringify({ variantId: v.id, stock, sourceRegisterId: context.registerId })],
      );
    }

    const syncConflicts = [];
    for (const conflict of pendingConflicts) {
      const inserted = await client.query(
        `INSERT INTO pos_sync_conflicts (
           tenant_id, transaction_id, variant_id, conflict_type,
           expected_value, actual_value, shortage_quantity
         ) VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING id, conflict_type, variant_id`,
        [
          context.tenantId,
          transactionId,
          conflict.variantId,
          conflict.type,
          conflict.expectedValue,
          conflict.actualValue,
          conflict.shortageQuantity,
        ],
      );
      syncConflicts.push({
        conflictId: inserted.rows[0].id,
        type: inserted.rows[0].conflict_type,
        variantId: inserted.rows[0].variant_id,
      });
    }

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
      [context.tenantId, [...affectedProducts]],
    );
    await client.query(
      `INSERT INTO order_timeline_entries (tenant_id, order_id, kind, detail, metadata)
       VALUES ($1,$2,'placed','POS sale completed.',$3::jsonb)`,
      [context.tenantId, orderId, JSON.stringify({ transactionId, registerId: context.registerId })],
    );
    if (customer) {
      await client.query(
        `UPDATE customers
         SET orders_count = orders_count + 1,
             ltv_cents = ltv_cents + $3,
             last_order_at = now(),
             updated_at = now()
         WHERE tenant_id = $1 AND id = $2`,
        [context.tenantId, customer.id, totalCents],
      );
    }
    await client.query('UPDATE pos_receipts SET entity_id = $1 WHERE id = $2', [transactionId, receipt.id]);
    await audit(client, context, offline ? 'pos.sale.offline-synced' : 'pos.sale.completed', 'pos_transaction', transactionId, {
      orderId,
      paymentId: paymentResult.rows[0].id,
      receiptNumber: sale.receiptNumber,
      totalCents,
      conflicts: syncConflicts.length,
      customerId: customer?.id || null,
      ...(droppedCustomerId ? { droppedCustomerId } : {}),
    });

    const result = await loadSale(client, context.tenantId, transactionId);
    result.stockUpdates = stockUpdates;
    result.syncConflicts = syncConflicts;
    return result;
  });
  const client = await db.pool.connect();
  try {
    await sendReceiptForPaidOrder(client, context.tenantId, result.orderId).catch((err) => {
      console.warn('[pos] Receipt email failed:', err.message);
    });
  } finally {
    client.release();
  }
  return result;
}

function validatePayment(payment, totalCents) {
  if (payment.method === 'cash') {
    assertPos(payment.cashAmountCents === totalCents, 422, 'PAYMENT_TOTAL_MISMATCH', 'Cash amount must equal the sale total.');
    assertPos(payment.cardAmountCents === 0, 422, 'PAYMENT_TOTAL_MISMATCH', 'Card amount must be zero for a cash sale.');
    assertPos(payment.amountTenderedCents >= totalCents, 422, 'PAYMENT_INSUFFICIENT', 'Tendered cash is less than the sale total.');
    assertPos(
      payment.changeGivenCents === payment.amountTenderedCents - totalCents,
      422,
      'CHANGE_MISMATCH',
      'Change due is incorrect.',
    );
    return;
  }
  assertPos(payment.cardAmountCents === totalCents, 422, 'PAYMENT_TOTAL_MISMATCH', 'Card amount must equal the sale total.');
  assertPos(payment.cashAmountCents === 0 && payment.amountTenderedCents === 0 && payment.changeGivenCents === 0, 422, 'PAYMENT_TOTAL_MISMATCH', 'Cash fields must be zero for a card sale.');
}

module.exports = { claimReceipt, createSale, findByBarcode, listProductFilters, loadSale, normalizeSale, searchProducts, validatePayment };
