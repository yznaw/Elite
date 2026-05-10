const { Router } = require('express');
const db = require('../db/client');
const { ensureDefaultTenant } = require('../db/tenant');
const { asyncHandler, created, notFound, ok, toCents, validationError } = require('./lib');

const router = Router();

async function loadCart(client, cartId) {
  const cart = await client.query('SELECT * FROM carts WHERE id = $1', [cartId]);
  if (cart.rowCount === 0) return null;
  const items = await client.query('SELECT * FROM cart_items WHERE cart_id = $1 ORDER BY created_at', [cartId]);
  return { ...cart.rows[0], items: items.rows };
}

router.post('/', asyncHandler(async (req, res) => {
  const client = await db.pool.connect();
  try {
    const tenant = await ensureDefaultTenant(client);
    const result = await client.query(
      `
        INSERT INTO carts (tenant_id, customer_id, session_id, currency, expires_at)
        VALUES ($1, $2, $3, $4, now() + interval '30 days')
        ON CONFLICT (tenant_id, session_id) WHERE session_id IS NOT NULL AND status = 'active'
        DO UPDATE SET updated_at = now()
        RETURNING *
      `,
      [tenant.id, req.body.customerId || null, req.body.sessionId || null, req.body.currency || tenant.currency],
    );
    created(res, result.rows[0], 'Cart ready.');
  } finally {
    client.release();
  }
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const client = await db.pool.connect();
  try {
    const cart = await loadCart(client, req.params.id);
    if (!cart) return notFound(res, 'Cart not found.');
    ok(res, cart);
  } finally {
    client.release();
  }
}));

router.post('/:id/items', asyncHandler(async (req, res) => {
  if (!req.body.productId || !req.body.sku || !req.body.name) return validationError(res, ['Product id, SKU, and name are required.']);
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const cart = await client.query('SELECT * FROM carts WHERE id = $1', [req.params.id]);
    if (cart.rowCount === 0) {
      await client.query('ROLLBACK');
      return notFound(res, 'Cart not found.');
    }

    await client.query(
      `
        INSERT INTO cart_items (cart_id, product_id, variant_id, product_name, sku, size, quantity, unit_price_cents, currency)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (cart_id, product_id, variant_id, size)
        DO UPDATE SET quantity = cart_items.quantity + EXCLUDED.quantity, updated_at = now()
      `,
      [req.params.id, req.body.productId, req.body.variantId || null, req.body.name, req.body.sku, req.body.size || null, req.body.quantity || 1, toCents(req.body.price), cart.rows[0].currency],
    );
    await client.query(
      `
        UPDATE carts
        SET subtotal_cents = COALESCE((SELECT sum(quantity * unit_price_cents) FROM cart_items WHERE cart_id = $1), 0)
        WHERE id = $1
      `,
      [req.params.id],
    );
    await client.query('COMMIT');
    ok(res, await loadCart(client, req.params.id), 'Cart item saved.');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}));

router.delete('/:id/items/:itemId', asyncHandler(async (req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM cart_items WHERE cart_id = $1 AND id = $2', [req.params.id, req.params.itemId]);
    await client.query(
      'UPDATE carts SET subtotal_cents = COALESCE((SELECT sum(quantity * unit_price_cents) FROM cart_items WHERE cart_id = $1), 0) WHERE id = $1',
      [req.params.id],
    );
    await client.query('COMMIT');
    ok(res, await loadCart(client, req.params.id), 'Cart item removed.');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}));

router.post('/:id/checkout', asyncHandler(async (req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const cart = await loadCart(client, req.params.id);
    if (!cart) {
      await client.query('ROLLBACK');
      return notFound(res, 'Cart not found.');
    }
    if (cart.items.length === 0) {
      await client.query('ROLLBACK');
      return validationError(res, ['Cart is empty.']);
    }

    const publicNumber = `EC-${new Date().getFullYear().toString().slice(2)}-${Date.now().toString().slice(-5)}`;
    const order = await client.query(
      `
        INSERT INTO orders (tenant_id, public_number, customer_id, customer_email, customer_name, customer_phone, subtotal_cents, total_cents, shipping_address, billing_address)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $8::jsonb, $9::jsonb)
        RETURNING *
      `,
      [cart.tenant_id, publicNumber, cart.customer_id, req.body.email || null, req.body.name || 'Guest', req.body.phone || null, cart.subtotal_cents, JSON.stringify(req.body.shippingAddress || {}), JSON.stringify(req.body.billingAddress || req.body.shippingAddress || {})],
    );

    for (const item of cart.items) {
      await client.query(
        `
          INSERT INTO order_items (tenant_id, order_id, product_id, variant_id, sku, product_name, size, quantity, unit_price_cents, total_cents)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        `,
        [cart.tenant_id, order.rows[0].id, item.product_id, item.variant_id, item.sku, item.product_name, item.size, item.quantity, item.unit_price_cents, item.quantity * item.unit_price_cents],
      );
    }
    await client.query("UPDATE carts SET status = 'converted' WHERE id = $1", [req.params.id]);
    await client.query('COMMIT');
    created(res, order.rows[0], 'Checkout complete.');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}));

module.exports = router;
