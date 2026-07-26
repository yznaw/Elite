const { Router } = require('express');
const db = require('../db/client');
const { ensureDefaultTenant } = require('../db/tenant');
const { asyncHandler, created, fromCents, notFound, ok, toCents, validationError } = require('./lib');

const router = Router();

function mapCustomer(row) {
  return {
    id: row.id,
    name: row.full_name,
    email: row.email,
    phone: row.phone_number || '',
    orders: Number(row.orders_count || 0),
    ltv: fromCents(row.ltv_cents),
    sizePref: Number(row.size_preference || 0),
    lastOrder: row.last_order_at ? row.last_order_at.toISOString().slice(0, 10) : '',
    joined: row.joined_at ? row.joined_at.toISOString().slice(0, 10) : '',
    city: row.city || '',
    notes: row.notes || '',
  };
}

function mapOrderRow(row) {
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
    address: formatAddress(row.shipping_address || {}),
    shippingAddress: row.shipping_address || {},
    trackingNumber: row.tracking_number || undefined,
  };
}

function formatAddress(addr) {
  return [addr.line1 || addr.address, addr.city, addr.region, addr.country]
    .filter(Boolean).join(', ');
}

function mapPayment(status) {
  if (status === 'authorized') return 'pending';
  if (status === 'partially_refunded') return 'refunded';
  return status;
}

// ── GET / — list all customers (with live stats from view, graceful fallback) ──
router.get('/', asyncHandler(async (_req, res) => {
  const client = await db.pool.connect();
  try {
    const tenant = await ensureDefaultTenant(client);
    let result;
    try {
      result = await client.query(
        `
          SELECT c.*,
            COALESCE(s.orders_count, c.orders_count) AS orders_count,
            COALESCE(s.ltv_cents, c.ltv_cents)       AS ltv_cents,
            s.last_order_at
          FROM customers c
          LEFT JOIN v_customer_order_stats s ON s.customer_id = c.id
          WHERE c.tenant_id = $1
            AND c.deleted_at IS NULL
          ORDER BY COALESCE(s.last_order_at, c.joined_at) DESC
        `,
        [tenant.id],
      );
    } catch (viewErr) {
      // v_customer_order_stats may not exist yet — fall back to base table
      console.warn('[customers] v_customer_order_stats unavailable, using denormalized columns:', viewErr.message);
      result = await client.query(
        `SELECT * FROM customers WHERE tenant_id = $1 AND deleted_at IS NULL ORDER BY joined_at DESC`,
        [tenant.id],
      );
    }
    ok(res, result.rows.map(mapCustomer));
  } finally {
    client.release();
  }
}));

// ── GET /:id — single customer with live stats ──
router.get('/:id', asyncHandler(async (req, res) => {
  const client = await db.pool.connect();
  try {
    const tenant = await ensureDefaultTenant(client);
    let result;
    try {
      result = await client.query(
        `
          SELECT c.*,
            COALESCE(s.orders_count, c.orders_count) AS orders_count,
            COALESCE(s.ltv_cents, c.ltv_cents)       AS ltv_cents,
            s.last_order_at
          FROM customers c
          LEFT JOIN v_customer_order_stats s ON s.customer_id = c.id
          WHERE c.tenant_id = $1 AND c.id = $2 AND c.deleted_at IS NULL
        `,
        [tenant.id, req.params.id],
      );
    } catch {
      result = await client.query(
        `SELECT * FROM customers WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
        [tenant.id, req.params.id],
      );
    }
    if (result.rowCount === 0) return notFound(res, 'Customer not found.');
    ok(res, mapCustomer(result.rows[0]));
  } finally {
    client.release();
  }
}));

// ── GET /:id/orders — all orders for a customer (by id OR email fallback) ──
router.get('/:id/orders', asyncHandler(async (req, res) => {
  const client = await db.pool.connect();
  try {
    const tenant = await ensureDefaultTenant(client);

    // Resolve customer (need email for the fallback join)
    const cust = await client.query(
      `SELECT id, email FROM customers WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [tenant.id, req.params.id],
    );
    if (cust.rowCount === 0) return notFound(res, 'Customer not found.');
    const { id: custId, email } = cust.rows[0];

    const result = await client.query(
      `
        SELECT
          o.*,
          (SELECT COUNT(*)::int FROM order_items oi WHERE oi.order_id = o.id) AS items_count,
          s.tracking_number,
          COALESCE((SELECT jsonb_agg(jsonb_build_object('n', oi2.product_name, 's', COALESCE(oi2.size, ''), 'q', oi2.quantity, 'p', round(oi2.unit_price_cents / 100.0)) ORDER BY oi2.id) FROM order_items oi2 WHERE oi2.order_id = o.id), '[]'::jsonb) AS items
        FROM orders o
        LEFT JOIN shipments s ON s.order_id = o.id
        WHERE o.tenant_id = $1
          AND (o.customer_id = $2 OR o.customer_email = $3)
        GROUP BY o.id, s.tracking_number
        ORDER BY o.placed_at DESC
      `,
      [tenant.id, custId, email],
    );

    ok(res, result.rows.map(mapOrderRow));
  } finally {
    client.release();
  }
}));

// ── POST / — create or upsert by email ──
router.post('/', asyncHandler(async (req, res) => {
  const name = String(req.body.name || '').trim();
  const email = String(req.body.email || '').trim();
  if (!name || !email) return validationError(res, ['Customer name and email are required.']);

  const client = await db.pool.connect();
  try {
    const tenant = await ensureDefaultTenant(client);
    const result = await client.query(
      `
        INSERT INTO customers
          (tenant_id, full_name, email, phone_number, city, size_preference, notes,
           joined_at, ltv_cents, orders_count)
        VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8::timestamptz, now()), $9, $10)
        ON CONFLICT (tenant_id, email) DO UPDATE
          SET full_name       = EXCLUDED.full_name,
              phone_number    = COALESCE(EXCLUDED.phone_number, customers.phone_number),
              city            = COALESCE(EXCLUDED.city, customers.city),
              size_preference = COALESCE(EXCLUDED.size_preference, customers.size_preference),
              notes           = EXCLUDED.notes,
              deleted_at      = NULL
        RETURNING *
      `,
      [
        tenant.id,
        name,
        email,
        req.body.phone || null,
        req.body.city || null,
        req.body.sizePref || null,
        req.body.notes || '',
        req.body.joined || null,
        toCents(req.body.ltv || 0),
        Number.parseInt(req.body.orders, 10) || 0,
      ],
    );
    created(res, mapCustomer(result.rows[0]), 'Customer saved.');
  } finally {
    client.release();
  }
}));

// ── PATCH /:id — update customer fields ──
router.patch('/:id', asyncHandler(async (req, res) => {
  const client = await db.pool.connect();
  try {
    const tenant = await ensureDefaultTenant(client);
    const result = await client.query(
      `
        UPDATE customers
        SET full_name       = COALESCE($3, full_name),
            email           = COALESCE($4, email),
            phone_number    = COALESCE($5, phone_number),
            city            = COALESCE($6, city),
            size_preference = COALESCE($7, size_preference),
            notes           = COALESCE($8, notes)
        WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
        RETURNING *
      `,
      [
        tenant.id, req.params.id,
        req.body.name  || null,
        req.body.email || null,
        req.body.phone || null,
        req.body.city  || null,
        req.body.sizePref != null ? req.body.sizePref : null,
        req.body.notes != null   ? req.body.notes  : null,
      ],
    );
    if (result.rowCount === 0) return notFound(res, 'Customer not found.');
    ok(res, mapCustomer(result.rows[0]), 'Customer updated.');
  } finally {
    client.release();
  }
}));

// ── DELETE /:id — soft-delete (preserves order history) ──
router.delete('/:id', asyncHandler(async (req, res) => {
  const client = await db.pool.connect();
  try {
    const tenant = await ensureDefaultTenant(client);
    const result = await client.query(
      `UPDATE customers SET deleted_at = now()
       WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
       RETURNING id`,
      [tenant.id, req.params.id],
    );
    if (result.rowCount === 0) return notFound(res, 'Customer not found.');
    ok(res, { id: result.rows[0].id }, 'Customer deleted.');
  } finally {
    client.release();
  }
}));

// ── PATCH /:id/restore — undo soft-delete ──
router.patch('/:id/restore', asyncHandler(async (req, res) => {
  const client = await db.pool.connect();
  try {
    const tenant = await ensureDefaultTenant(client);
    const result = await client.query(
      `UPDATE customers SET deleted_at = NULL
       WHERE tenant_id = $1 AND id = $2
       RETURNING *`,
      [tenant.id, req.params.id],
    );
    if (result.rowCount === 0) return notFound(res, 'Customer not found.');
    ok(res, mapCustomer(result.rows[0]), 'Customer restored.');
  } finally {
    client.release();
  }
}));

module.exports = router;
