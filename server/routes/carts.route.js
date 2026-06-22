const { Router } = require('express');
const db = require('../db/client');
const nbox = require('../lib/nbox');
const { bookNboxForPaidOrder, nboxQuoteMetadata } = require('../lib/order-delivery');
const { ensureDefaultTenant } = require('../db/tenant');
const { asyncHandler, created, fromCents, notFound, ok, toCents, validationError } = require('./lib');

const router = Router();

async function loadCart(client, cartId) {
  const cart = await client.query('SELECT * FROM carts WHERE id = $1', [cartId]);
  if (cart.rowCount === 0) return null;
  const items = await client.query('SELECT * FROM cart_items WHERE cart_id = $1 ORDER BY created_at', [cartId]);
  return { ...cart.rows[0], items: items.rows };
}

function cartSessionId(req) {
  if (req.session?.user?.id) return `admin-user:${req.session.user.id}`;

  // Guest carts are keyed by the Express session id. Touch the session so
  // saveUninitialized: false still persists it and sends the cookie needed to
  // retrieve the same cart after a page refresh.
  if (req.session) req.session.cartInitialized = true;
  return `session:${req.sessionID}`;
}

async function ensureSessionCart(client, req) {
  const tenant = await ensureDefaultTenant(client);
  const result = await client.query(
    `
      INSERT INTO carts (tenant_id, session_id, currency, expires_at)
      VALUES ($1, $2, $3, now() + interval '30 days')
      ON CONFLICT (tenant_id, session_id) WHERE session_id IS NOT NULL AND status = 'active'
      DO UPDATE SET updated_at = now(), expires_at = now() + interval '30 days'
      RETURNING *
    `,
    [tenant.id, cartSessionId(req), tenant.currency],
  );
  return result.rows[0];
}

function mapPublicCart(cart) {
  return {
    id: cart.id,
    subtotal: fromCents(cart.subtotal_cents || 0),
    items: (cart.items || []).map((item) => ({
      id: String(item.product_id),
      variantId: item.variant_id ? String(item.variant_id) : undefined,
      sku: item.sku || '',
      name: item.product_name,
      price: fromCents(item.unit_price_cents),
      image: item.metadata?.image || '',
      leather: item.metadata?.leather || '',
      color: item.metadata?.color || null,
      size: Number(item.size) || 0,
      qty: Number(item.quantity) || 1,
    })),
  };
}

async function refreshCartSubtotal(client, cartId) {
  await client.query(
    `
      UPDATE carts
      SET subtotal_cents = COALESCE((SELECT sum(quantity * unit_price_cents) FROM cart_items WHERE cart_id = $1), 0),
          updated_at = now()
      WHERE id = $1
    `,
    [cartId],
  );
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}

function publicOrderNumber() {
  const year = new Date().getFullYear().toString().slice(2);
  const suffix = `${Date.now().toString().slice(-5)}${Math.floor(Math.random() * 90 + 10)}`;
  return `EC-${year}-${suffix}`;
}

function normalizeCheckout(req) {
  const customer = req.body.customer || {};
  const shippingAddress = req.body.shippingAddress || {};
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  const fullName = String(
    shippingAddress.fullName ||
    customer.name ||
    `${customer.firstName || ''} ${customer.lastName || ''}`,
  ).trim();

  const shippingQuote = req.body.shippingQuote || req.body.deliveryQuote || null;

  return {
    customer: {
      firstName: String(customer.firstName || '').trim(),
      lastName: String(customer.lastName || '').trim(),
      email: String(customer.email || req.body.email || '').trim(),
      phone: String(customer.phone || req.body.phone || shippingAddress.phone || '').trim(),
      name: fullName || 'Guest',
    },
    shippingAddress: {
      fullName: fullName || 'Guest',
      phone: String(shippingAddress.phone || customer.phone || '').trim(),
      line1: String(shippingAddress.line1 || shippingAddress.address || '').trim(),
      line2: String(shippingAddress.line2 || '').trim(),
      zone: String(shippingAddress.zone || '').trim(),
      street: String(shippingAddress.street || '').trim(),
      building: String(shippingAddress.building || '').trim(),
      additionalDetails: String(shippingAddress.additionalDetails || shippingAddress.notes || '').trim(),
      city: String(shippingAddress.city || '').trim(),
      state: String(shippingAddress.state || shippingAddress.region || '').trim(),
      zip: String(shippingAddress.zip || shippingAddress.postalCode || shippingAddress.postal_code || '').trim(),
      country: String(shippingAddress.country || '').trim(),
      longitude: shippingAddress.longitude ?? shippingAddress.lng ?? null,
      latitude: shippingAddress.latitude ?? shippingAddress.lat ?? null,
    },
    items,
    payment: req.body.payment || {},
    shippingQuote,
  };
}

function isPaidPayment(payment) {
  return String(payment?.status || '').trim().toLowerCase() === 'paid';
}

async function upsertCustomer(client, tenantId, customer, shippingAddress) {
  if (!customer.email) return null;
  const result = await client.query(
    `
      INSERT INTO customers (tenant_id, email, full_name, phone, city, country, last_order_at)
      VALUES ($1, $2, $3, $4, $5, $6, now())
      ON CONFLICT (tenant_id, email)
      DO UPDATE SET
        full_name = EXCLUDED.full_name,
        phone = EXCLUDED.phone,
        city = EXCLUDED.city,
        country = EXCLUDED.country,
        last_order_at = now(),
        updated_at = now()
      RETURNING id
    `,
    [
      tenantId,
      customer.email,
      customer.name,
      customer.phone || null,
      shippingAddress.city || null,
      shippingAddress.country || null,
    ],
  );
  return result.rows[0].id;
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

router.get('/current', asyncHandler(async (req, res) => {
  const client = await db.pool.connect();
  try {
    const cart = await ensureSessionCart(client, req);
    ok(res, mapPublicCart(await loadCart(client, cart.id)), 'Cart retrieved.');
  } finally {
    client.release();
  }
}));

router.post('/current/items', asyncHandler(async (req, res) => {
  if (!isUuid(req.body.productId || req.body.id)) {
    return validationError(res, ['Product id must be a persisted product UUID.']);
  }
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const cart = await ensureSessionCart(client, req);
    const productId = req.body.productId || req.body.id;
    const qty = Math.max(1, Number.parseInt(req.body.quantity || req.body.qty, 10) || 1);
    const size = req.body.size == null ? null : String(req.body.size);

    await client.query(
      `
        INSERT INTO cart_items (
          cart_id, product_id, variant_id, product_name, sku, size,
          quantity, unit_price_cents, currency, metadata
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
        ON CONFLICT (cart_id, product_id, variant_id, size)
        DO UPDATE SET
          quantity = cart_items.quantity + EXCLUDED.quantity,
          unit_price_cents = EXCLUDED.unit_price_cents,
          product_name = EXCLUDED.product_name,
          metadata = cart_items.metadata || EXCLUDED.metadata,
          updated_at = now()
      `,
      [
        cart.id,
        productId,
        isUuid(req.body.variantId) ? req.body.variantId : null,
        String(req.body.name || 'Item'),
        String(req.body.sku || productId),
        size,
        qty,
        toCents(req.body.price),
        cart.currency,
        JSON.stringify({
          image: req.body.image || null,
          leather: req.body.leather || null,
          color: req.body.color || null,
        }),
      ],
    );
    await refreshCartSubtotal(client, cart.id);
    await client.query('COMMIT');
    ok(res, mapPublicCart(await loadCart(client, cart.id)), 'Cart item saved.');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}));

router.delete('/current/items/:productId', asyncHandler(async (req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const cart = await ensureSessionCart(client, req);
    const size = req.query.size == null ? null : String(req.query.size);
    const variantId = isUuid(req.query.variantId) ? req.query.variantId : null;
    const color = req.query.color == null ? null : String(req.query.color).trim().toLowerCase();
    await client.query(
      `
        DELETE FROM cart_items
        WHERE cart_id = $1
          AND product_id = $2
          AND ($3::text IS NULL OR size = $3)
          AND ($4::uuid IS NULL OR variant_id = $4)
          AND ($4::uuid IS NOT NULL OR $5::text IS NULL OR lower(metadata->>'color') = $5)
      `,
      [cart.id, req.params.productId, size, variantId, color],
    );
    await refreshCartSubtotal(client, cart.id);
    await client.query('COMMIT');
    ok(res, mapPublicCart(await loadCart(client, cart.id)), 'Cart item removed.');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}));

router.delete('/current/items', asyncHandler(async (req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const cart = await ensureSessionCart(client, req);
    await client.query('DELETE FROM cart_items WHERE cart_id = $1', [cart.id]);
    await refreshCartSubtotal(client, cart.id);
    await client.query('COMMIT');
    ok(res, mapPublicCart(await loadCart(client, cart.id)), 'Cart cleared.');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}));

router.post('/shipping-quote', asyncHandler(async (req, res) => {
  const checkout = normalizeCheckout(req);
  const errors = [];
  if (!checkout.customer.name || checkout.customer.name === 'Guest') errors.push('Customer name is required.');
  if (!checkout.customer.phone) errors.push('Customer phone is required.');
  if (!checkout.shippingAddress.line1 || !checkout.shippingAddress.city || !checkout.shippingAddress.country) {
    errors.push('Delivery address, city, and country are required.');
  }
  if (checkout.items.length === 0) errors.push('At least one cart item is required.');
  if (errors.length > 0) return validationError(res, errors);

  if (!nbox.isConfigured()) {
    return ok(res, { available: true, amount: 0, currency: 'QAR', serviceName: 'Standard Delivery', serviceCode: 'standard' }, 'Delivery quote ready.');
  }

  try {
    const quote = await nbox.getDeliveryQuote(checkout);
    ok(res, quote, quote.available ? 'NBOX delivery quote ready.' : 'NBOX delivery is unavailable.');
  } catch (err) {
    if (err.name === 'NboxError') {
      return res.status(502).json({
        success: false,
        message: err.message,
        details: err.details || {},
      });
    }
    throw err;
  }
}));

router.post('/checkout', asyncHandler(async (req, res) => {
  const checkout = normalizeCheckout(req);
  const errors = [];
  if (!checkout.customer.name || checkout.customer.name === 'Guest') errors.push('Customer name is required.');
  if (!checkout.customer.email) errors.push('Customer email is required.');
  if (!checkout.customer.phone) errors.push('Customer phone is required.');
  if (!checkout.shippingAddress.line1 || !checkout.shippingAddress.city || !checkout.shippingAddress.country) {
    errors.push('Delivery address, city, and country are required.');
  }
  if (checkout.items.length === 0) errors.push('At least one cart item is required.');
  if (nbox.isConfigured() && !checkout.shippingQuote?.available) errors.push('A valid NBOX delivery quote is required.');
  if (errors.length > 0) return validationError(res, errors);

  const client = await db.pool.connect();
  let createdOrder = null;
  let tenantId = null;
  let nboxShipment = null;
  let inTransaction = false;
  try {
    await client.query('BEGIN');
    inTransaction = true;
    const tenant = await ensureDefaultTenant(client);
    tenantId = tenant.id;
    const customerId = await upsertCustomer(client, tenant.id, checkout.customer, checkout.shippingAddress);
    const subtotalCents = checkout.items.reduce((sum, item) => {
      const qty = Number(item.qty || item.quantity) || 1;
      return sum + toCents(item.price) * qty;
    }, 0);
    const shippingCents = toCents(checkout.shippingQuote?.amount || 0);
    const totalCents = subtotalCents + shippingCents;
    const paymentStatus = isPaidPayment(checkout.payment) ? 'paid' : 'pending';
    const paidAt = paymentStatus === 'paid' ? new Date() : null;

    const order = await client.query(
      `
        INSERT INTO orders (
          tenant_id, public_number, customer_id, customer_email, customer_name, customer_phone,
          payment_status, paid_at, fulfillment_status, subtotal_cents, shipping_cents, total_cents, shipping_address, billing_address,
          metadata
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'awaiting', $9, $10, $11, $12::jsonb, $13::jsonb, $14::jsonb)
        RETURNING *
      `,
      [
        tenant.id,
        publicOrderNumber(),
        customerId,
        checkout.customer.email,
        checkout.customer.name,
        checkout.customer.phone,
        paymentStatus,
        paidAt,
        subtotalCents,
        shippingCents,
        totalCents,
        JSON.stringify(checkout.shippingAddress),
        JSON.stringify(checkout.shippingAddress),
        JSON.stringify({
          source: 'client-web-checkout',
          nbox: {
            quote: nboxQuoteMetadata(checkout.shippingQuote),
          },
          paymentGateway: {
            provider: req.body.payment?.provider || 'pending_gateway',
            method: req.body.payment?.method || 'gateway_placeholder',
            status: paymentStatus,
          },
        }),
      ],
    );
    createdOrder = order.rows[0];

    for (const item of checkout.items) {
      const qty = Number(item.qty || item.quantity) || 1;
      const unit = toCents(item.price);
      await client.query(
        `
          INSERT INTO order_items (
            tenant_id, order_id, product_id, variant_id, sku, product_name, size,
            quantity, unit_price_cents, total_cents, media_url, metadata
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)
        `,
        [
          tenant.id,
          order.rows[0].id,
          isUuid(item.id || item.productId) ? (item.id || item.productId) : null,
          isUuid(item.variantId) ? item.variantId : null,
          String(item.sku || item.id || ''),
          String(item.name || item.n || 'Item'),
          item.size || item.s || null,
          qty,
          unit,
          unit * qty,
          item.image || null,
          JSON.stringify({ leather: item.leather || null, color: item.color || null }),
        ],
      );
    }

    await client.query(
      'INSERT INTO order_timeline_entries (tenant_id, order_id, kind, detail) VALUES ($1, $2, $3, $4)',
      [
        tenant.id,
        order.rows[0].id,
        'placed',
        paymentStatus === 'paid'
          ? 'Checkout submitted and payment confirmed.'
          : 'Checkout submitted; payment gateway pending integration.',
      ],
    );
    await client.query(
      `
        INSERT INTO payments (tenant_id, order_id, provider, method, status, amount_cents, currency, raw_payload)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
      `,
      [
        tenant.id,
        order.rows[0].id,
        req.body.payment?.provider || 'pending_gateway',
        req.body.payment?.method || 'gateway_placeholder',
        paymentStatus,
        totalCents,
        tenant.currency,
        JSON.stringify({
          integrationPending: paymentStatus !== 'paid',
          nboxQuote: nboxQuoteMetadata(checkout.shippingQuote),
        }),
      ],
    );
    if (customerId) {
      await client.query(
        `
          UPDATE customers
          SET orders_count = orders_count + 1,
              ltv_cents = ltv_cents + $3,
              last_order_at = now(),
              updated_at = now()
          WHERE tenant_id = $1 AND id = $2
        `,
        [tenant.id, customerId, subtotalCents],
      );
    }

    await client.query('COMMIT');
    inTransaction = false;

    if (paymentStatus === 'paid') {
      const deliveryResult = await bookNboxForPaidOrder(client, tenantId, createdOrder.id);
      nboxShipment = deliveryResult.created ? deliveryResult.shipment : null;
    }

    created(res, {
      id: createdOrder.id,                   // UUID — used for payment initiation
      orderNumber: createdOrder.public_number, // human-readable display reference
      total: fromCents(createdOrder.total_cents),
      delivery: fromCents(createdOrder.shipping_cents),
      payment: paymentStatus,
      fulfillment: nboxShipment ? 'processing' : createdOrder.fulfillment_status,
      nbox: nboxShipment ? { shipment: nboxShipment } : { quote: nboxQuoteMetadata(checkout.shippingQuote) },
    }, 'Checkout order created.');
  } catch (err) {
    if (inTransaction) await client.query('ROLLBACK');
    throw err;
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
