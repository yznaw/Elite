const { Router } = require('express');
const db = require('../db/client');
const nbox = require('../lib/nbox');
const { ensureDefaultTenant } = require('../db/tenant');
const { asyncHandler, created, fromCents, notFound, ok, toCents, validationError } = require('./lib');

const router = Router();

function mapOrder(row) {
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
    timeline: row.timeline || [],
    notes: row.notes || [],
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

function mapPayment(status) {
  if (status === 'authorized') return 'pending';
  if (status === 'partially_refunded') return 'refunded';
  return status;
}

function nboxQuoteFromOrder(order) {
  return order.metadata?.nbox?.quote || null;
}

async function bookNboxForPaidOrder(client, tenantId, orderId) {
  const existing = await client.query(
    "SELECT id FROM shipments WHERE tenant_id = $1 AND order_id = $2 AND carrier = 'nbox' LIMIT 1",
    [tenantId, orderId],
  );
  if (existing.rowCount > 0) return null;

  const orderResult = await client.query('SELECT * FROM orders WHERE tenant_id = $1 AND id = $2', [tenantId, orderId]);
  if (orderResult.rowCount === 0) return null;
  const order = orderResult.rows[0];

  const itemResult = await client.query(
    `
      SELECT product_id, sku, product_name, quantity, unit_price_cents
      FROM order_items
      WHERE tenant_id = $1 AND order_id = $2
      ORDER BY created_at
    `,
    [tenantId, orderId],
  );

  const shipment = await nbox.createShipment({
    orderNumber: order.public_number,
    customer: {
      name: order.customer_name,
      email: order.customer_email,
      phone: order.customer_phone,
    },
    shippingAddress: order.shipping_address || {},
    items: itemResult.rows.map((item) => ({
      id: item.product_id,
      sku: item.sku,
      name: item.product_name,
      qty: item.quantity,
      price: fromCents(item.unit_price_cents),
    })),
    shippingQuote: nboxQuoteFromOrder(order),
  });

  await client.query(
    `
      INSERT INTO shipments (
        tenant_id, order_id, carrier, service, tracking_number, tracking_url, status, address
      )
      VALUES ($1, $2, 'nbox', $3, $4, $5, 'processing', $6::jsonb)
    `,
    [
      tenantId,
      order.id,
      shipment.id || nboxQuoteFromOrder(order)?.serviceName || 'NBOX',
      shipment.trackingNumber || null,
      shipment.trackingUrl || null,
      JSON.stringify(order.shipping_address || {}),
    ],
  );

  await client.query(
    `
      UPDATE orders
      SET fulfillment_status = 'processing',
          metadata = metadata || $3::jsonb
      WHERE tenant_id = $1 AND id = $2
    `,
    [
      tenantId,
      order.id,
      JSON.stringify({
        nbox: {
          quote: nboxQuoteFromOrder(order),
          shipment,
          bookedAt: new Date().toISOString(),
        },
      }),
    ],
  );

  await client.query(
    'INSERT INTO order_timeline_entries (tenant_id, order_id, kind, detail, metadata) VALUES ($1, $2, $3, $4, $5::jsonb)',
    [
      tenantId,
      order.id,
      'processing',
      shipment.trackingNumber
        ? `NBOX shipment booked. Tracking: ${shipment.trackingNumber}`
        : 'NBOX shipment booked.',
      JSON.stringify({ provider: 'nbox', shipment }),
    ],
  );

  return shipment;
}

async function loadAdminOrder(client, tenantId, id) {
  const result = await client.query(
    `
      SELECT o.*, COUNT(oi.id)::integer AS items_count, s.tracking_number,
        COALESCE(jsonb_agg(DISTINCT jsonb_build_object('n', oi.product_name, 's', COALESCE(oi.size, ''), 'q', oi.quantity, 'p', round(oi.unit_price_cents / 100.0))) FILTER (WHERE oi.id IS NOT NULL), '[]'::jsonb) AS items,
        COALESCE((SELECT jsonb_agg(jsonb_build_object('id', t.id, 'ts', to_char(t.occurred_at, 'YYYY-MM-DD HH24:MI'), 'kind', t.kind, 'detail', t.detail) ORDER BY t.occurred_at) FROM order_timeline_entries t WHERE t.order_id = o.id), '[]'::jsonb) AS timeline,
        COALESCE((SELECT jsonb_agg(jsonb_build_object('id', n.id, 'ts', to_char(n.created_at, 'YYYY-MM-DD HH24:MI'), 'author', 'Admin', 'initials', 'AD', 'body', n.body) ORDER BY n.created_at DESC) FROM order_notes n WHERE n.order_id = o.id), '[]'::jsonb) AS notes
      FROM orders o
      LEFT JOIN order_items oi ON oi.order_id = o.id
      LEFT JOIN shipments s ON s.order_id = o.id
      WHERE o.tenant_id = $1 AND (o.id::text = $2 OR o.public_number = $2)
      GROUP BY o.id, s.tracking_number
    `,
    [tenantId, id],
  );
  return result.rowCount === 0 ? null : mapOrder(result.rows[0]);
}

router.get('/', asyncHandler(async (_req, res) => {
  const client = await db.pool.connect();
  try {
    const tenant = await ensureDefaultTenant(client);
    const result = await client.query(
      `
        SELECT
          o.*,
          COUNT(oi.id)::integer AS items_count,
          s.tracking_number,
          COALESCE(
            jsonb_agg(
              DISTINCT jsonb_build_object('n', oi.product_name, 's', COALESCE(oi.size, ''), 'q', oi.quantity, 'p', round(oi.unit_price_cents / 100.0))
            ) FILTER (WHERE oi.id IS NOT NULL),
            '[]'::jsonb
          ) AS items
        FROM orders o
        LEFT JOIN order_items oi ON oi.order_id = o.id
        LEFT JOIN shipments s ON s.order_id = o.id
        WHERE o.tenant_id = $1
        GROUP BY o.id, s.tracking_number
        ORDER BY o.placed_at DESC
      `,
      [tenant.id],
    );
    ok(res, result.rows.map(mapOrder));
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

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const tenant = await ensureDefaultTenant(client);
    const subtotal = items.reduce((sum, item) => sum + toCents(item.price || item.p || 0) * (Number(item.quantity || item.q) || 1), 0);
    const publicNumber = req.body.publicNumber || `EC-${new Date().getFullYear().toString().slice(2)}-${Date.now().toString().slice(-5)}`;

    const order = await client.query(
      `
        INSERT INTO orders (
          tenant_id, public_number, customer_id, customer_email, customer_name, customer_phone,
          payment_status, fulfillment_status, subtotal_cents, shipping_cents, tax_cents, discount_cents,
          total_cents, shipping_address, billing_address
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb, $15::jsonb)
        RETURNING *
      `,
      [
        tenant.id,
        publicNumber,
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
    );

    for (const item of items) {
      const qty = Number(item.quantity || item.q) || 1;
      const unit = toCents(item.price || item.p || 0);
      await client.query(
        `
          INSERT INTO order_items (tenant_id, order_id, product_id, variant_id, sku, product_name, size, quantity, unit_price_cents, total_cents)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
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
  const client = await db.pool.connect();
  let shouldBookNbox = false;
  let updatedOrderId = null;
  let tenantId = null;
  try {
    await client.query('BEGIN');
    const tenant = await ensureDefaultTenant(client);
    tenantId = tenant.id;
    const trackingNumber = String(req.body.trackingNumber || '').trim();
    const order = await client.query(
      `
        UPDATE orders
        SET payment_status = COALESCE($3, payment_status),
            paid_at = CASE WHEN $3 = 'paid' THEN COALESCE(paid_at, now()) ELSE paid_at END,
            fulfillment_status = COALESCE($4, fulfillment_status),
            status = COALESCE($5, status)
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
      'INSERT INTO order_timeline_entries (tenant_id, order_id, kind, detail) VALUES ($1, $2, $3, $4)',
      [tenant.id, order.rows[0].id, req.body.timelineKind || 'note', req.body.detail || 'Status updated'],
    );
    await client.query('COMMIT');
    if (shouldBookNbox) {
      try {
        await bookNboxForPaidOrder(client, tenantId, updatedOrderId);
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
    }
    ok(res, await loadAdminOrder(client, tenant.id, req.params.id), 'Order status updated.');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
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
      'INSERT INTO order_notes (tenant_id, order_id, body) VALUES ($1, $2, $3) RETURNING *',
      [tenant.id, order.rows[0].id, body],
    );
    await client.query(
      'INSERT INTO order_timeline_entries (tenant_id, order_id, kind, detail) VALUES ($1, $2, $3, $4)',
      [tenant.id, order.rows[0].id, 'note', body.length > 80 ? `${body.slice(0, 77)}...` : body],
    );
    created(res, note.rows[0], 'Order note added.');
  } finally {
    client.release();
  }
}));

module.exports = router;
