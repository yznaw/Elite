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
    orders: Number(row.orders_count || 0),
    ltv: fromCents(row.ltv_cents),
    sizePref: Number(row.size_preference || 0),
    lastOrder: row.last_order_at ? row.last_order_at.toISOString().slice(0, 10) : '',
    joined: row.joined_at ? row.joined_at.toISOString().slice(0, 10) : '',
    city: row.city || '',
    notes: row.notes || '',
  };
}

router.get('/', asyncHandler(async (_req, res) => {
  const client = await db.pool.connect();
  try {
    const tenant = await ensureDefaultTenant(client);
    const result = await client.query(
      `
        SELECT c.*, COALESCE(s.orders_count, c.orders_count) AS orders_count, COALESCE(s.ltv_cents, c.ltv_cents) AS ltv_cents, s.last_order_at
        FROM customers c
        LEFT JOIN v_customer_order_stats s ON s.customer_id = c.id
        WHERE c.tenant_id = $1
        ORDER BY COALESCE(s.last_order_at, c.joined_at) DESC
      `,
      [tenant.id],
    );
    ok(res, result.rows.map(mapCustomer));
  } finally {
    client.release();
  }
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const client = await db.pool.connect();
  try {
    const tenant = await ensureDefaultTenant(client);
    const result = await client.query('SELECT * FROM customers WHERE tenant_id = $1 AND id = $2', [tenant.id, req.params.id]);
    if (result.rowCount === 0) return notFound(res, 'Customer not found.');
    ok(res, mapCustomer(result.rows[0]));
  } finally {
    client.release();
  }
}));

router.post('/', asyncHandler(async (req, res) => {
  const name = String(req.body.name || '').trim();
  const email = String(req.body.email || '').trim();
  if (!name || !email) return validationError(res, ['Customer name and email are required.']);

  const client = await db.pool.connect();
  try {
    const tenant = await ensureDefaultTenant(client);
    const result = await client.query(
      `
        INSERT INTO customers (tenant_id, full_name, email, city, size_preference, notes, joined_at, ltv_cents, orders_count)
        VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7::timestamptz, now()), $8, $9)
        ON CONFLICT (tenant_id, email) DO UPDATE
        SET full_name = EXCLUDED.full_name,
            city = EXCLUDED.city,
            size_preference = EXCLUDED.size_preference,
            notes = EXCLUDED.notes
        RETURNING *
      `,
      [
        tenant.id,
        name,
        email,
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

router.patch('/:id', asyncHandler(async (req, res) => {
  const client = await db.pool.connect();
  try {
    const tenant = await ensureDefaultTenant(client);
    const result = await client.query(
      `
        UPDATE customers
        SET full_name = COALESCE($3, full_name),
            email = COALESCE($4, email),
            city = COALESCE($5, city),
            size_preference = COALESCE($6, size_preference),
            notes = COALESCE($7, notes)
        WHERE tenant_id = $1 AND id = $2
        RETURNING *
      `,
      [tenant.id, req.params.id, req.body.name, req.body.email, req.body.city, req.body.sizePref, req.body.notes],
    );
    if (result.rowCount === 0) return notFound(res, 'Customer not found.');
    ok(res, mapCustomer(result.rows[0]), 'Customer updated.');
  } finally {
    client.release();
  }
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const client = await db.pool.connect();
  try {
    const tenant = await ensureDefaultTenant(client);
    const result = await client.query('DELETE FROM customers WHERE tenant_id = $1 AND id = $2 RETURNING id', [tenant.id, req.params.id]);
    if (result.rowCount === 0) return notFound(res, 'Customer not found.');
    ok(res, { id: result.rows[0].id }, 'Customer deleted.');
  } finally {
    client.release();
  }
}));

module.exports = router;
