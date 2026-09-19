const { Router } = require('express');
const db = require('../db/client');
const { bookNboxForPaidOrder } = require('../lib/order-delivery');
const { sendReceiptForPaidOrder } = require('../lib/order-receipt');
const { ensurePaidOrderStock, reversePaidOrderStock } = require('../lib/order-stock');
const { ensureDefaultTenant } = require('../db/tenant');
const { insertWithRetry } = require('../lib/order-number');
const { asyncHandler, created, fromCents, notFound, ok, toCents, validationError } = require('./lib');

const router = Router();

// `detailed` distinguishes the single-order endpoint (which loads timeline and
// notes) from the list endpoint (which does not). The list must leave both
// undefined rather than empty so the client can tell "not loaded yet" from
// "genuinely has none" and render a loading state instead of a blank history.
function mapOrder(row, detailed = false) {
  const shippingAddress = row.shipping_address || {};
  return {
    id: row.public_number,
    dbId: row.id,
    date: row.placed_at ? row.placed_at.toISOString().slice(0, 10) : '',
    customer: row.customer_name,
    customerEmail: row.customer_email || '',
    customerPhone: row.customer_phone || '',
    itemsCount: Number(row.items_count || 0),
    total: fromCents(row.total_cents),
    payment: mapPayment(row.payment_status),
    fulfillment: row.fulfillment_status,
    items: row.items || [],
    address: formatAddress(shippingAddress),
    shippingAddress,
    billingAddress: row.billing_address || {},
    paymentGateway: row.metadata?.paymentGateway || undefined,
    trackingNumber: row.tracking_number || undefined,
    nboxBookingFailed: Boolean(
      row.metadata?.nbox?.bookingFailedAt && !row.metadata?.nbox?.bookedAt,
    ),
    nboxBookingError: row.metadata?.nbox?.bookingError || undefined,
    delivery: mapDelivery(row),
    ...(detailed ? { timeline: row.timeline || [], notes: row.notes || [] } : {}),
  };
}

/** Shipment + carrier details, or undefined when nothing has been booked yet.
    Drives the invoice's delivery block, so it must stay absent rather than
    empty when there is no shipment. */
function mapDelivery(row) {
  const quote = row.metadata?.nbox?.quote || null;
  const hasShipment = Boolean(row.carrier || row.tracking_number || row.shipped_at);
  if (!hasShipment && !quote) return undefined;

  const iso = (value) => (value ? new Date(value).toISOString() : undefined);
  return {
    carrier: row.carrier || (quote ? 'nbox' : undefined),
    service: row.service || quote?.serviceName || undefined,
    trackingNumber: row.tracking_number || undefined,
    trackingUrl: row.tracking_url || undefined,
    shippedAt: iso(row.shipped_at),
    deliveredAt: iso(row.delivered_at),
    eta: quote?.eta || undefined,
  };
}

function formatAddress(address) {
  return [
    address.line1 || address.address,
    address.city,
    address.region,
    address.country,
  ].filter(Boolean).join(', ');
}

// Mirrors the Postgres enums in 001_initial_schema.sql. Without these an
// unexpected body value reached the UPDATE as a raw cast failure and surfaced
// as a 500 instead of a 422 naming the bad field.
const PAYMENT_STATUSES     = new Set(['pending', 'authorized', 'paid', 'failed', 'refunded', 'partially_refunded']);
const FULFILLMENT_STATUSES = new Set(['awaiting', 'processing', 'shipped', 'delivered', 'cancelled', 'returned']);
const ORDER_STATUSES       = new Set(['placed', 'confirmed', 'processing', 'completed', 'cancelled', 'refunded', 'returned']);
const TIMELINE_KINDS       = new Set(['placed', 'paid', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded', 'returned', 'note']);

/** Returns an error string when `value` is present but not a member of `allowed`. */
function invalidEnum(field, value, allowed) {
  if (value === undefined || value === null || value === '') return null;
  return allowed.has(String(value))
    ? null
    : `${field} must be one of: ${[...allowed].join(', ')}.`;
}

function mapPayment(status) {
  if (status === 'authorized') return 'pending';
  if (status === 'partially_refunded') return 'refunded';
  return status;
}

async function loadAdminOrder(client, tenantId, id) {
  const result = await client.query(
    `
      SELECT o.*,
        (SELECT COUNT(*)::integer FROM order_items oi WHERE oi.order_id = o.id) AS items_count,
        s.carrier, s.service, s.tracking_number, s.tracking_url, s.shipped_at, s.delivered_at,
        COALESCE((SELECT jsonb_agg(jsonb_build_object('n', oi2.product_name, 's', COALESCE(oi2.size, ''), 'q', oi2.quantity, 'p', round(oi2.unit_price_cents / 100.0), 'img', oi2.media_url) ORDER BY oi2.id) FROM order_items oi2 WHERE oi2.order_id = o.id), '[]'::jsonb) AS items,
        COALESCE((SELECT jsonb_agg(jsonb_build_object('id', t.id, 'ts', to_char(t.occurred_at, 'YYYY-MM-DD HH24:MI'), 'kind', t.kind, 'detail', t.detail, 'actor', tu.full_name) ORDER BY t.occurred_at) FROM order_timeline_entries t LEFT JOIN admin_users tu ON tu.id = t.actor_user_id WHERE t.order_id = o.id), '[]'::jsonb) AS timeline,
        COALESCE((SELECT jsonb_agg(jsonb_build_object('id', n.id, 'ts', to_char(n.created_at, 'YYYY-MM-DD HH24:MI'), 'author', COALESCE(nu.full_name, 'Admin'), 'initials', COALESCE(nu.initials, 'AD'), 'body', n.body) ORDER BY n.created_at DESC) FROM order_notes n LEFT JOIN admin_users nu ON nu.id = n.author_user_id WHERE n.order_id = o.id), '[]'::jsonb) AS notes
      FROM orders o
      LEFT JOIN LATERAL (
        SELECT sh.carrier, sh.service, sh.tracking_number, sh.tracking_url,
               sh.shipped_at, sh.delivered_at
          FROM shipments sh
         WHERE sh.order_id = o.id
         ORDER BY (sh.tracking_number IS NOT NULL) DESC, sh.created_at DESC
         LIMIT 1
      ) s ON TRUE
      WHERE o.tenant_id = $1 AND (o.id::text = $2 OR o.public_number = $2)
    `,
    [tenantId, id],
  );
  return result.rowCount === 0 ? null : mapOrder(result.rows[0], true);
}

// Whitelist of sortable columns. The table header offered click-to-sort but the
// server always ordered by placed_at DESC, so the arrow sorted only the rows
// that happened to be on the current page.
const ORDER_SORTS = {
  id:          'o.public_number',
  date:        'o.placed_at',
  customer:    'o.customer_name',
  total:       'o.total_cents',
  itemsCount:  'items_count',
  payment:     'o.payment_status',
  fulfillment: 'o.fulfillment_status',
};

function orderOrderBy(sort, dir) {
  const column = ORDER_SORTS[sort];
  if (!column) return 'o.placed_at DESC';
  const direction = String(dir).toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  // Tie-break on placed_at so paging is stable across equal values.
  return `${column} ${direction} NULLS LAST, o.placed_at DESC`;
}

router.get('/', asyncHandler(async (req, res) => {
  const client = await db.pool.connect();
  try {
    const tenant = await ensureDefaultTenant(client);

    const page    = Math.max(0, parseInt(req.query.page  ?? '0', 10)  || 0);
    const limit   = Math.min(200, Math.max(1, parseInt(req.query.limit ?? '50', 10) || 50));
    const offset  = page * limit;

    const params = [tenant.id];
    const where  = ['o.tenant_id = $1'];

    if (req.query.payment) {
      // Map frontend aliases to the DB enum values used by mapPayment()
      const paymentMap = { pending: ['pending', 'authorized'], refunded: ['refunded', 'partially_refunded'] };
      const dbStatuses = paymentMap[req.query.payment] || [req.query.payment];
      params.push(dbStatuses);
      where.push(`o.payment_status = ANY($${params.length}::order_payment_status[])`);
    }
    if (req.query.fulfillment) {
      params.push(req.query.fulfillment);
      where.push(`o.fulfillment_status = $${params.length}`);
    }
    if (req.query.from) {
      params.push(req.query.from);
      where.push(`o.placed_at >= $${params.length}::date`);
    }
    if (req.query.to) {
      params.push(req.query.to);
      where.push(`o.placed_at < ($${params.length}::date + INTERVAL '1 day')`);
    }
    if (req.query.q) {
      params.push(`%${req.query.q}%`);
      where.push(`(o.customer_name ILIKE $${params.length} OR o.public_number ILIKE $${params.length} OR o.customer_email ILIKE $${params.length})`);
    }

    const whereClause = where.join(' AND ');
    const orderBy = orderOrderBy(req.query.sort, req.query.dir);

    // Total count for pagination metadata
    const countResult = await client.query(
      `SELECT COUNT(DISTINCT o.id)::integer AS total FROM orders o WHERE ${whereClause}`,
      params,
    );
    const total = countResult.rows[0].total;

    params.push(limit, offset);
    const result = await client.query(
      `
        SELECT
          o.*,
          (SELECT COUNT(*)::integer FROM order_items oi WHERE oi.order_id = o.id) AS items_count,
          s.carrier, s.service, s.tracking_number, s.tracking_url, s.shipped_at, s.delivered_at,
          COALESCE((SELECT jsonb_agg(jsonb_build_object('n', oi2.product_name, 's', COALESCE(oi2.size, ''), 'q', oi2.quantity, 'p', round(oi2.unit_price_cents / 100.0), 'img', oi2.media_url) ORDER BY oi2.id) FROM order_items oi2 WHERE oi2.order_id = o.id), '[]'::jsonb) AS items
        FROM orders o
        LEFT JOIN LATERAL (
          SELECT sh.carrier, sh.service, sh.tracking_number, sh.tracking_url,
                 sh.shipped_at, sh.delivered_at
            FROM shipments sh
           WHERE sh.order_id = o.id
           ORDER BY (sh.tracking_number IS NOT NULL) DESC, sh.created_at DESC
           LIMIT 1
        ) s ON TRUE
        WHERE ${whereClause}
        ORDER BY ${orderBy}
        LIMIT $${params.length - 1} OFFSET $${params.length}
      `,
      params,
    );

    ok(res, {
      orders: result.rows.map((row) => mapOrder(row)),
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    });
  } finally {
    client.release();
  }
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const client = await db.pool.connect();
  try {
    const tenant = await ensureDefaultTenant(client);
    const order = await loadAdminOrder(client, tenant.id, req.params.id);
    if (!order) return notFound(res, 'Order not found.');
    ok(res, order);
  } finally {
    client.release();
  }
}));

router.post('/', asyncHandler(async (req, res) => {
  const customerName = String(req.body.customerName || req.body.customer || '').trim();
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  if (!customerName || items.length === 0) return validationError(res, ['Customer name and at least one order item are required.']);

  const idempotencyKey = String(req.body.idempotencyKey || '').trim() || null;

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const tenant = await ensureDefaultTenant(client);

    // ── Idempotency check: return the existing order if key already used ──
    if (idempotencyKey) {
      const existing = await client.query(
        'SELECT * FROM orders WHERE tenant_id = $1 AND idempotency_key = $2',
        [tenant.id, idempotencyKey],
      );
      if (existing.rowCount > 0) {
        await client.query('ROLLBACK');
        return ok(res, await loadAdminOrder(client, tenant.id, existing.rows[0].id.toString()), 'Order already exists.');
      }
    }

    // ── Validate customer_id if provided ──
    if (req.body.customerId) {
      const cust = await client.query(
        'SELECT id FROM customers WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL',
        [tenant.id, req.body.customerId],
      );
      if (cust.rowCount === 0) {
        await client.query('ROLLBACK');
        return validationError(res, ['Customer ID does not exist.']);
      }
    }

    const subtotal = items.reduce((sum, item) => sum + toCents(item.price || item.p || 0) * (Number(item.quantity || item.q) || 1), 0);

    const order = await insertWithRetry(client, (publicNumber) => client.query(
      `
        INSERT INTO orders (
          tenant_id, public_number, idempotency_key,
          customer_id, customer_email, customer_name, customer_phone,
          payment_status, fulfillment_status, subtotal_cents, shipping_cents, tax_cents, discount_cents,
          total_cents, shipping_address, billing_address
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb, $16::jsonb)
        RETURNING *
      `,
      [
        tenant.id,
        publicNumber,
        idempotencyKey,
        req.body.customerId || null,
        req.body.customerEmail || null,
        customerName,
        req.body.customerPhone || null,
        req.body.payment || 'pending',
        req.body.fulfillment || 'awaiting',
        subtotal,
        toCents(req.body.shipping || 0),
        toCents(req.body.tax || 0),
        toCents(req.body.discount || 0),
        toCents(req.body.total || 0) || subtotal,
        JSON.stringify(req.body.shippingAddress || { line1: req.body.address || '' }),
        JSON.stringify(req.body.billingAddress || req.body.shippingAddress || {}),
      ],
    ));

    for (const item of items) {
      const qty = Number(item.quantity || item.q) || 1;
      const unit = toCents(item.price || item.p || 0);
      await client.query(
        `
          INSERT INTO order_items (
            tenant_id, order_id, product_id, variant_id, sku, product_name, size,
            quantity, unit_price_cents, total_cents,
            unit_cost_cents, shipping_cost_cents, total_cost_cents, cost_snapshot_source
          )
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
            (SELECT cost_price_cents FROM product_variants WHERE id = $4),
            (SELECT shipping_cost_cents FROM product_variants WHERE id = $4),
            (SELECT total_cost_cents FROM product_variants WHERE id = $4),
            CASE WHEN (SELECT total_cost_cents FROM product_variants WHERE id = $4) IS NULL THEN 'missing' ELSE 'captured' END)
        `,
        [tenant.id, order.rows[0].id, item.productId || null, item.variantId || null, item.sku || '', item.name || item.n || '', item.size || item.s || null, qty, unit, unit * qty],
      );
    }

    await client.query(
      'INSERT INTO order_timeline_entries (tenant_id, order_id, kind, detail) VALUES ($1, $2, $3, $4)',
      [tenant.id, order.rows[0].id, 'placed', 'Order placed'],
    );

    await client.query('COMMIT');
    created(res, mapOrder({ ...order.rows[0], items_count: items.length, items }), 'Order created.');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}));

router.patch('/:id/status', asyncHandler(async (req, res) => {
  const errors = [
    invalidEnum('payment', req.body.payment, PAYMENT_STATUSES),
    invalidEnum('fulfillment', req.body.fulfillment, FULFILLMENT_STATUSES),
    invalidEnum('status', req.body.status, ORDER_STATUSES),
    invalidEnum('timelineKind', req.body.timelineKind, TIMELINE_KINDS),
  ].filter(Boolean);
  if (errors.length > 0) return validationError(res, errors);

  const client = await db.pool.connect();
  let shouldBookNbox = false;
  let updatedOrderId = null;
  let tenantId = null;
  // Everything after COMMIT (NBOX booking, receipt email, stock helpers) runs
  // outside the transaction; rolling back there would target a non-transaction.
  let committed = false;
  try {
    await client.query('BEGIN');
    const tenant = await ensureDefaultTenant(client);
    tenantId = tenant.id;
    const trackingNumber = String(req.body.trackingNumber || '').trim();
    // Read the prior state so the stock effect can be driven by the actual
    // transition, not by the requested value. Marking an already-paid order
    // paid again, or re-cancelling a cancelled order, must not move stock.
    const previous = await client.query(
      'SELECT id, payment_status, status FROM orders WHERE tenant_id = $1 AND (id::text = $2 OR public_number = $2) FOR UPDATE',
      [tenant.id, req.params.id],
    );
    const previousPaymentStatus = previous.rows[0]?.payment_status || null;
    const previousStatus = previous.rows[0]?.status || null;
    const order = await client.query(
      `
        UPDATE orders
        SET payment_status = COALESCE($3, payment_status),
            paid_at = CASE WHEN $3 = 'paid' THEN COALESCE(paid_at, now()) ELSE paid_at END,
            fulfillment_status = COALESCE($4, fulfillment_status),
            status = COALESCE($5, status),
            cancelled_at = CASE WHEN $5 = 'cancelled' OR $4 = 'cancelled'
                                THEN COALESCE(cancelled_at, now()) ELSE cancelled_at END,
            updated_at = now()
        WHERE tenant_id = $1 AND (id::text = $2 OR public_number = $2)
        RETURNING *
      `,
      [tenant.id, req.params.id, req.body.payment, req.body.fulfillment, req.body.status],
    );
    if (order.rowCount === 0) {
      await client.query('ROLLBACK');
      return notFound(res, 'Order not found.');
    }
    updatedOrderId = order.rows[0].id;
    shouldBookNbox = String(req.body.payment || '').trim().toLowerCase() === 'paid';

    if (trackingNumber) {
      const shipment = await client.query(
        `
          UPDATE shipments
          SET tracking_number = $3,
              status = COALESCE($4, status),
              shipped_at = CASE WHEN $4 = 'shipped' THEN COALESCE(shipped_at, now()) ELSE shipped_at END,
              updated_at = now()
          WHERE tenant_id = $1 AND order_id = $2
          RETURNING id
        `,
        [tenant.id, order.rows[0].id, trackingNumber, req.body.fulfillment || order.rows[0].fulfillment_status],
      );
      if (shipment.rowCount === 0) {
        await client.query(
          `
            INSERT INTO shipments (tenant_id, order_id, tracking_number, status, shipped_at, address)
            VALUES ($1, $2, $3, COALESCE($4, 'awaiting'), CASE WHEN $4 = 'shipped' THEN now() ELSE NULL END, $5::jsonb)
          `,
        [
          tenant.id,
          order.rows[0].id,
          trackingNumber,
          req.body.fulfillment || order.rows[0].fulfillment_status,
          JSON.stringify(order.rows[0].shipping_address || {}),
        ],
        );
      }
    }

    await client.query(
      `INSERT INTO order_timeline_entries (tenant_id, order_id, kind, detail, actor_user_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        tenant.id,
        order.rows[0].id,
        req.body.timelineKind || 'note',
        req.body.detail || 'Status updated',
        // Without this you cannot tell who refunded or cancelled an order.
        req.user?.id || null,
      ],
    );
    await client.query('COMMIT');
    committed = true;
    if (shouldBookNbox) {
      try {
        const deliveryResult = await bookNboxForPaidOrder(client, tenantId, updatedOrderId);
        if (deliveryResult.failed) {
          console.warn('NBOX booking failed after order was marked paid.', deliveryResult);
        }
      } catch (err) {
        console.warn('NBOX booking failed after order was marked paid.', err);
        await client.query(
          'INSERT INTO order_timeline_entries (tenant_id, order_id, kind, detail, metadata) VALUES ($1, $2, $3, $4, $5::jsonb)',
          [
            tenantId,
            updatedOrderId,
            'note',
            'NBOX shipment booking failed after payment was marked paid.',
            JSON.stringify({ provider: 'nbox', error: err.message }),
          ],
        );
      }
      await sendReceiptForPaidOrder(client, tenantId, updatedOrderId).catch((err) => {
        console.warn('[admin-orders] Receipt email failed:', err.message);
      });
    }

    // Stock follows the transition, not the requested value (docs/25 Phase 1).
    // Both helpers are idempotent and open their own transaction, so they are
    // called after COMMIT and cannot poison this one.
    const newPaymentStatus = order.rows[0].payment_status;
    const newStatus = order.rows[0].status;
    const becamePaid = previousPaymentStatus !== 'paid' && newPaymentStatus === 'paid';
    const becameReversed =
      (previousPaymentStatus !== 'refunded' && newPaymentStatus === 'refunded')
      || (previousStatus !== 'cancelled' && newStatus === 'cancelled');

    if (becamePaid) {
      await ensurePaidOrderStock(tenantId, updatedOrderId, {
        actorUserId: req.user?.id || null,
        source: 'admin-mark-paid',
      });
    } else if (becameReversed) {
      // Without this, every cancellation or refund is permanent phantom
      // shrinkage: the units come back to the shelf but never to the system.
      await reversePaidOrderStock(tenantId, updatedOrderId, {
        actorUserId: req.user?.id || null,
        reason: newStatus === 'cancelled' ? 'cancelled' : 'refunded',
      });
    }

    ok(res, await loadAdminOrder(client, tenant.id, req.params.id), 'Order status updated.');
  } catch (err) {
    if (!committed) await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}));

router.post('/:id/rebook-delivery', asyncHandler(async (req, res) => {
  const client = await db.pool.connect();
  try {
    const tenant = await ensureDefaultTenant(client);
    const order = await client.query(
      'SELECT id, payment_status FROM orders WHERE tenant_id = $1 AND (id::text = $2 OR public_number = $2)',
      [tenant.id, req.params.id],
    );
    if (order.rowCount === 0) return notFound(res, 'Order not found.');
    if (order.rows[0].payment_status !== 'paid') {
      return res.status(409).json({ success: false, message: 'Delivery can only be booked for paid orders.' });
    }

    // Clear previous booking-failure flags so the attempt is treated as fresh.
    await client.query(
      `UPDATE orders
          SET metadata = metadata || jsonb_build_object(
                'nbox',
                (COALESCE(metadata->'nbox', '{}'::jsonb) - 'bookingFailedAt' - 'bookingError')
              )
        WHERE tenant_id = $1 AND id = $2`,
      [tenant.id, order.rows[0].id],
    );

    const result = await bookNboxForPaidOrder(client, tenant.id, order.rows[0].id);

    if (result.failed || (result.skipped && result.reason !== 'already_booked')) {
      return res.status(502).json({ success: false, message: 'NBOX booking failed.', data: result });
    }

    const message = result.skipped ? 'Delivery already booked.' : 'NBOX delivery booked successfully.';
    ok(res, await loadAdminOrder(client, tenant.id, req.params.id), message);
  } finally {
    client.release();
  }
}));

router.post('/:id/notes', asyncHandler(async (req, res) => {
  const body = String(req.body.body || '').trim();
  if (!body) return validationError(res, ['Note body is required.']);

  const client = await db.pool.connect();
  try {
    const tenant = await ensureDefaultTenant(client);
    const order = await client.query('SELECT id FROM orders WHERE tenant_id = $1 AND (id::text = $2 OR public_number = $2)', [tenant.id, req.params.id]);
    if (order.rowCount === 0) return notFound(res, 'Order not found.');
    const note = await client.query(
      'INSERT INTO order_notes (tenant_id, order_id, body, author_user_id) VALUES ($1, $2, $3, $4) RETURNING *',
      [tenant.id, order.rows[0].id, body, req.user?.id || null],
    );
    await client.query(
      `INSERT INTO order_timeline_entries (tenant_id, order_id, kind, detail, actor_user_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        tenant.id,
        order.rows[0].id,
        'note',
        body.length > 80 ? `${body.slice(0, 77)}...` : body,
        req.user?.id || null,
      ],
    );
    created(res, note.rows[0], 'Order note added.');
  } finally {
    client.release();
  }
}));

module.exports = router;
