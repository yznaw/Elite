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

// Whitelist of sortable columns. The table header offered click-to-sort but the
// server always ordered by last activity, so the arrow sorted only the rows that
// happened to be on screen.
const CUSTOMER_SORTS = {
  name:      'c.full_name',
  email:     'c.email',
  city:      'c.city',
  orders:    'orders_count',
  ltv:       'ltv_cents',
  sizePref:  'c.size_preference',
  lastOrder: 'last_order_at',
  joined:    'c.joined_at',
};
const CUSTOMER_SORT_DEFAULT = 'COALESCE(s.last_order_at, c.joined_at) DESC';

function customerOrderBy(sort, dir) {
  const column = CUSTOMER_SORTS[sort];
  if (!column) return CUSTOMER_SORT_DEFAULT;
  const direction = String(dir).toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  // NULLS LAST keeps customers with no orders out of the top of an LTV sort.
  return `${column} ${direction} NULLS LAST`;
}

// ── GET / — paginated, searchable, sortable customer list ──
router.get('/', asyncHandler(async (req, res) => {
  const client = await db.pool.connect();
  try {
    const tenant = await ensureDefaultTenant(client);

    const page   = Math.max(0, parseInt(req.query.page ?? '0', 10) || 0);
    const limit  = Math.min(200, Math.max(1, parseInt(req.query.limit ?? '50', 10) || 50));
    const offset = page * limit;

    const params = [tenant.id];
    const where  = ['c.tenant_id = $1', 'c.deleted_at IS NULL'];

    if (req.query.q) {
      params.push(`%${req.query.q}%`);
      where.push(`(c.full_name ILIKE $${params.length} OR c.email ILIKE $${params.length} OR c.city ILIKE $${params.length} OR c.phone_number ILIKE $${params.length})`);
    }
    const whereClause = where.join(' AND ');
    const orderBy = customerOrderBy(req.query.sort, req.query.dir);

    const countResult = await client.query(
      `SELECT COUNT(*)::integer AS total FROM customers c WHERE ${whereClause}`,
      params,
    );
    const total = countResult.rows[0].total;

    params.push(limit, offset);
    const pagination = `LIMIT $${params.length - 1} OFFSET $${params.length}`;

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
          WHERE ${whereClause}
          ORDER BY ${orderBy}
          ${pagination}
        `,
        params,
      );
    } catch (viewErr) {
      // v_customer_order_stats may not exist yet — fall back to base table.
      console.warn('[customers] v_customer_order_stats unavailable, using denormalized columns:', viewErr.message);
      result = await client.query(
        `SELECT * FROM customers c
          WHERE ${whereClause}
          ORDER BY ${orderBy.includes('s.') || orderBy.includes('last_order_at') ? 'c.joined_at DESC' : orderBy}
          ${pagination}`,
        params,
      );
    }

    ok(res, {
      customers: result.rows.map(mapCustomer),
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    });
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
        -- An order can have both a manual and an NBOX shipment; a plain join
        -- would list that order twice in the customer's history.
        LEFT JOIN LATERAL (
          SELECT sh.tracking_number
            FROM shipments sh
           WHERE sh.order_id = o.id
           ORDER BY (sh.tracking_number IS NOT NULL) DESC, sh.created_at DESC
           LIMIT 1
        ) s ON TRUE
        WHERE o.tenant_id = $1
          AND (o.customer_id = $2 OR o.customer_email = $3)
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

    // Build the SET list from the keys the caller actually sent. The previous
    // blanket COALESCE meant a field could never be cleared: sending
    // `city: ''` was coerced to null and the old value was kept forever.
    const COLUMNS = {
      name:     'full_name',
      email:    'email',
      phone:    'phone_number',
      city:     'city',
      sizePref: 'size_preference',
      notes:    'notes',
    };
    // name and email are required, so an explicit blank is a validation error
    // rather than a clear.
    const REQUIRED = new Set(['name', 'email']);

    const sets = [];
    const params = [tenant.id, req.params.id];
    const errors = [];

    for (const [key, column] of Object.entries(COLUMNS)) {
      if (!(key in req.body)) continue;
      const raw = req.body[key];
      const value = typeof raw === 'string' ? raw.trim() : raw;

      if (REQUIRED.has(key) && !value) {
        errors.push(`${key} cannot be empty.`);
        continue;
      }
      params.push(value === '' || value === undefined ? null : value);
      sets.push(`${column} = $${params.length}`);
    }

    if (errors.length > 0) return validationError(res, errors);
    if (sets.length === 0) return validationError(res, ['No updatable fields were provided.']);

    const result = await client.query(
      `
        UPDATE customers
        SET ${sets.join(', ')}
        WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
        RETURNING *
      `,
      params,
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
