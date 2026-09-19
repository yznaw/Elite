const { Router } = require('express');
const { persistCheckoutSession, scopedIdempotencyKey } = require('../lib/checkout-ownership');
const db = require('../db/client');
const nbox = require('../lib/nbox');
const { nboxQuoteMetadata } = require('../lib/order-delivery');
const { ensureDefaultTenant } = require('../db/tenant');
const { resolveCustomer } = require('../lib/customer-identity');
const { insertWithRetry } = require('../lib/order-number');
const { asyncHandler, created, fromCents, notFound, ok, toCents, validationError } = require('./lib');

const router = Router();
router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

async function loadCart(client, cartId) {
  const cart = await client.query('SELECT * FROM carts WHERE id = $1', [cartId]);
  if (cart.rowCount === 0) return null;
  // available_quantity lets the storefront flag a line that has sold out since
  // it was added, instead of the customer only finding out at payment. NULL
  // means the line is not linked to a variant, so there is nothing to check.
  const items = await client.query(
    `SELECT ci.*,
            CASE WHEN pv.id IS NULL THEN NULL
                 WHEN pv.is_active THEN GREATEST(pv.stock_quantity, 0)
                 ELSE 0 END AS available_quantity
       FROM cart_items ci
       LEFT JOIN product_variants pv ON pv.id = ci.variant_id
      WHERE ci.cart_id = $1
      ORDER BY ci.created_at`,
    [cartId],
  );
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
      available: item.available_quantity == null ? null : Number(item.available_quantity),
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

const MAX_CART_LINES = 100;
const MAX_ITEM_QUANTITY = 100;
function lineQty(item) {
  const raw = item.qty ?? item.quantity ?? 1;
  const qty = typeof raw === 'number' || typeof raw === 'string' ? Number(raw) : NaN;
  if (!Number.isSafeInteger(qty) || qty < 1 || qty > MAX_ITEM_QUANTITY) {
    throw Object.assign(new Error('Item quantity must be an integer between 1 and 100.'), { status: 422 });
  }
  return qty;
}

// Storefront sizes are numeric; a variant whose size is not a number reaches the
// browser without one and comes back as 0, so only numeric sizes are compared.
function sizesConflict(variantSize, sentSize) {
  const stored = String(variantSize ?? '').trim();
  if (!stored || !Number.isFinite(Number(stored))) return false;
  return Number(stored) !== Number(sentSize);
}

function colorsConflict(variantColor, sentColor) {
  const stored = String(variantColor || '').trim().toLowerCase();
  const sent = String(sentColor || '').trim().toLowerCase();
  return !!stored && !!sent && stored !== sent;
}

/**
 * Prices, names and SKUs for bag lines, read from the catalog.
 *
 * Everything about a line used to be taken from the request, price included, and the
 * order total (which is what the payment gateway charges) was summed from it. A variant
 * id was also accepted without checking it belonged to the product, colour and size sent
 * with it. Now the catalog is the only source of what a line costs and what it is; the
 * request only chooses which product/variant and how many.
 *
 * Returns `{ lines, problems }`. A problem is a line that cannot be sold as sent.
 */
async function resolveLines(client, tenantId, items) {
  const lines = [];
  const problems = [];
  if (!Array.isArray(items) || items.length < 1 || items.length > MAX_CART_LINES) {
    throw Object.assign(new Error('A cart must contain between 1 and 100 lines.'), { status: 422 });
  }
  for (const item of items) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw Object.assign(new Error('Invalid cart item.'), { status: 422 });
    }
    const qty = lineQty(item);
    const productId = String(item.productId || item.id || '').toLowerCase();
    const variantId = isUuid(item.variantId) ? String(item.variantId).toLowerCase() : null;
    const size = item.size ?? item.s ?? null;
    const color = item.color || null;
    const reject = (reason, name) => problems.push({
      productId: productId || null, variantId, size, color, sku: item.sku || '', name: name || item.name || 'Item', reason,
    });
    if (!isUuid(productId)) { reject('unknown_product'); continue; }

    // eslint-disable-next-line no-await-in-loop -- a bag is a handful of lines.
    const product = await client.query(
      `SELECT p.id, p.name, p.sku, p.status, p.base_price_cents,
              EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = p.id AND v.tenant_id = p.tenant_id) AS has_variants
         FROM products p WHERE p.tenant_id = $1 AND p.id = $2`,
      [tenantId, productId],
    );
    const p = product.rows[0];
    if (!p || p.status !== 'active') { reject('unavailable', p?.name); continue; }

    let unitCents = Number(p.base_price_cents) || 0;
    let sku = p.sku || String(productId);
    let storedColor = color;
    if (variantId) {
      // eslint-disable-next-line no-await-in-loop
      const variant = await client.query(
        `SELECT sku, size, color, price_cents, is_active FROM product_variants
          WHERE tenant_id = $1 AND id = $2 AND product_id = $3`,
        [tenantId, variantId, productId],
      );
      const v = variant.rows[0];
      if (!v || !v.is_active) { reject('unavailable', p.name); continue; }
      if (sizesConflict(v.size, size) || colorsConflict(v.color, color)) { reject('mismatch', p.name); continue; }
      // Same rule as the storefront's `variant.price || product.price`.
      if (Number(v.price_cents) > 0) unitCents = Number(v.price_cents);
      sku = v.sku || sku;
      storedColor = v.color || color;
    } else if (p.has_variants) {
      // Every size the storefront sells carries a variant id, so a line without one on a
      // product that has variants was not chosen on the storefront.
      reject('choose_size', p.name);
      continue;
    }

    lines.push({
      ...item,
      productId,
      variantId,
      name: p.name,
      sku,
      size,
      color: storedColor,
      qty,
      unitCents,
    });
  }
  return { lines, problems };
}

function unavailableResponse(res, req, problems) {
  return res.status(409).json({
    success: false,
    code: 'ITEM_UNAVAILABLE',
    message: problems.length === 1
      ? `${problems[0].name} is no longer available as selected. Please choose it again.`
      : 'Some items in your bag are no longer available as selected. Please choose them again.',
    details: problems,
    requestId: req.requestId,
  });
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

/**
 * Storefront checkout's customer resolution.
 *
 * Delegates to the shared matcher rather than upserting on email alone. The
 * difference that matters: a customer created at the till (phone, no email)
 * who then orders online is now **adopted** — their email is filled in on the
 * existing row — instead of becoming a second customer with a separate order
 * history and separate LTV. See server/lib/customer-identity.js.
 */
async function upsertCustomer(client, tenantId, customer, shippingAddress) {
  const { customerId } = await resolveCustomer(
    client,
    tenantId,
    {
      email: customer.email,
      phone: customer.phone || shippingAddress.phone,
      fullName: customer.name,
      city: shippingAddress.city,
      country: shippingAddress.country,
    },
    { source: 'web' },
  );
  return customerId;
}

// Obsolete APIs are deliberately closed rather than maintained as a second
// pricing/authorization implementation. The storefront uses /current + /checkout.
const retiredCart = (_req, res) => res.status(410).json({
  success: false, code: 'LEGACY_CART_RETIRED', message: 'This cart API is no longer available. Reload the shop.',
});
router.post('/', retiredCart);

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
    const qty = lineQty(req.body);
    const size = req.body.size == null ? null : String(req.body.size);
    const variantId = isUuid(req.body.variantId) ? req.body.variantId : null;

    const { lines, problems } = await resolveLines(client, cart.tenant_id, [{ ...req.body, productId, variantId }]);
    if (problems.length > 0) {
      await client.query('ROLLBACK');
      return unavailableResponse(res, req, problems);
    }
    const line = lines[0];

    // Refuse to put more in the bag than exists. The product page already hides
    // sold-out sizes, but it cannot see what is already in the bag, so adding
    // the last pair twice used to succeed and only fail at checkout.
    const inventory = variantId ? await client.query(
      `SELECT stock_quantity, is_active FROM product_variants
        WHERE tenant_id = $1 AND product_id = $2 AND id = $3`,
      [cart.tenant_id, productId, variantId],
    ) : await client.query(
      `SELECT stock_quantity, (status = 'active') AS is_active FROM products
        WHERE tenant_id = $1 AND id = $2`, [cart.tenant_id, productId],
    );
    // ensureSessionCart's upsert locks the cart until COMMIT, serializing adds.
    const inBag = await client.query(
      `SELECT COALESCE(sum(quantity), 0) AS qty FROM cart_items
        WHERE cart_id = $1 AND product_id = $2 AND variant_id IS NOT DISTINCT FROM $3::uuid`,
      [cart.id, productId, variantId],
    );
    const already = Number(inBag.rows[0].qty) || 0;
    const row = inventory.rows[0];
    const available = row?.is_active ? Math.max(0, Number(row.stock_quantity) || 0) : 0;
    if (already + qty > Math.min(available, MAX_ITEM_QUANTITY)) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        success: false, code: 'INSUFFICIENT_STOCK',
        message: available === 0 ? `${line.name} is sold out in this size.`
          : `Only ${Math.min(available, MAX_ITEM_QUANTITY)} of ${line.name} available per order.`,
        details: [{ variantId, sku: line.sku, name: line.name, size, color: line.color,
          requested: already + qty, inBag: already, available }],
        requestId: req.requestId,
      });
    }
    const itemCount = await client.query('SELECT count(*) AS count FROM cart_items WHERE cart_id = $1', [cart.id]);
    if (Number(itemCount.rows[0].count) >= MAX_CART_LINES) {
      throw Object.assign(new Error('The bag is full. Remove an item before adding another.'), { status: 422 });
    }

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
        variantId,
        line.name,
        line.sku,
        size,
        qty,
        line.unitCents,
        cart.currency,
        JSON.stringify({
          image: req.body.image || null,
          leather: req.body.leather || null,
          color: line.color || null,
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

  // Idempotency: the client sends a stable key per checkout attempt. If the same
  // key was already used (double-tap, retry, network re-send), return the
  // existing order instead of creating a duplicate.
  const ownerHash = await persistCheckoutSession(req);
  const idempotencyKey = scopedIdempotencyKey(ownerHash, req.body.idempotencyKey);

  const client = await db.pool.connect();
  let createdOrder = null;
  let tenantId = null;
  let inTransaction = false;
  try {
    await client.query('BEGIN');
    inTransaction = true;
    const tenant = await ensureDefaultTenant(client);
    tenantId = tenant.id;

    if (idempotencyKey) {
      // Serialize retries before checking existence, so concurrent submissions
      // cannot create two orders or surface a uniqueness failure.
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [idempotencyKey]);
      const existing = await client.query(
        "SELECT * FROM orders WHERE tenant_id = $1 AND idempotency_key = $2 AND metadata->>'checkoutOwnerHash' = $3",
        [tenant.id, idempotencyKey, ownerHash],
      );
      if (existing.rowCount > 0) {
        await client.query('ROLLBACK');
        const dup = existing.rows[0];
        return created(res, {
          id: dup.id,
          orderNumber: dup.public_number,
          total: fromCents(dup.total_cents),
          delivery: fromCents(dup.shipping_cents),
          payment: dup.payment_status,
          fulfillment: dup.fulfillment_status,
          nbox: { quote: nboxQuoteMetadata(checkout.shippingQuote) },
        }, 'Order already exists.');
      }
    }

    // What the order contains and costs comes from the catalog, never the request.
    const { lines, problems } = await resolveLines(client, tenant.id, checkout.items);
    if (problems.length > 0) {
      await client.query('ROLLBACK');
      inTransaction = false;
      return unavailableResponse(res, req, problems);
    }

    // The delivery fee is quoted here rather than trusted from the request, for the same
    // reason as the prices: it is part of what the gateway charges.
    let shippingQuote = null;
    if (nbox.isConfigured()) {
      try {
        shippingQuote = await nbox.getDeliveryQuote({
          customer: checkout.customer,
          shippingAddress: checkout.shippingAddress,
          items: lines.map((line) => ({ ...line, price: line.unitCents / 100, quantity: line.qty })),
        });
      } catch (err) {
        await client.query('ROLLBACK');
        inTransaction = false;
        if (err.name === 'NboxError') {
          return res.status(502).json({ success: false, message: err.message, details: err.details || {} });
        }
        throw err;
      }
      if (!shippingQuote?.available) {
        await client.query('ROLLBACK');
        inTransaction = false;
        return validationError(res, ['Delivery is not available to this address.']);
      }
    }

    // Stock check BEFORE the order exists, so a customer who cannot be served
    // is told now rather than after paying.
    //
    // This does not make overselling impossible — stock is only decremented at
    // payment confirmation (docs/25 Phase 1), so two people can still pass this
    // check seconds apart and both pay for the last unit. That residual case is
    // handled where the money already changed hands: the sale is kept, stock
    // floors at zero, and the order is flagged for the person fulfilling it.
    // What this check removes is the far more common and far more annoying
    // case — paying for something that was already out of stock when the
    // checkout button was pressed.
    const outOfStock = [];
    const totals = new Map();
    for (const line of lines) {
      const key = line.variantId || line.productId;
      const total = totals.get(key);
      if (total) total.qty += line.qty;
      else totals.set(key, { ...line });
    }
    // Stable lock order and one check per inventory identity, irrespective of
    // how many request lines or textual size representations identify it.
    for (const item of [...totals.values()].sort((a, b) =>
      (a.variantId || a.productId).localeCompare(b.variantId || b.productId))) {
      const { variantId } = item;
      const wanted = item.qty;
      // eslint-disable-next-line no-await-in-loop -- one row per cart line, and
      // the lock has to be taken per row anyway.
      const variant = variantId ? await client.query(
        `SELECT pv.stock_quantity, (pv.is_active AND p.status = 'active') AS is_active, p.name
           FROM product_variants pv JOIN products p ON p.id = pv.product_id
          WHERE pv.tenant_id = $1 AND pv.id = $2 AND pv.product_id = $3
          FOR UPDATE OF pv`, [tenant.id, variantId, item.productId],
      ) : await client.query(
        `SELECT stock_quantity, (status = 'active') AS is_active, name
           FROM products WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
        [tenant.id, item.productId],
      );
      const row = variant.rows[0];
      const available = Number(row?.stock_quantity) || 0;
      if (!row?.is_active || available < wanted || wanted > MAX_ITEM_QUANTITY) {
        outOfStock.push({
          variantId,
          size: item.size ?? item.s ?? null,
          color: item.color || null,
          sku: item.sku || '',
          name: row?.name || item.name,
          requested: wanted,
          available: Math.max(0, available),
        });
      }
    }
    if (outOfStock.length > 0) {
      await client.query('ROLLBACK');
      inTransaction = false;
      return res.status(409).json({
        success: false,
        code: 'INSUFFICIENT_STOCK',
        message: outOfStock.length === 1
          ? `${outOfStock[0].name} is no longer available in the quantity requested.`
          : 'Some items in your bag are no longer available in the quantity requested.',
        details: outOfStock,
        requestId: req.requestId,
      });
    }

    const customerId = await upsertCustomer(client, tenant.id, checkout.customer, checkout.shippingAddress);
    const subtotalCents = lines.reduce((sum, line) => sum + line.unitCents * line.qty, 0);
    const shippingCents = toCents(shippingQuote?.amount || 0);
    const totalCents = subtotalCents + shippingCents;
    // Only the payment gateway's confirmation may mark an order paid. The request used to
    // be able to say `payment.status: 'paid'`, which booked delivery and sent a receipt for
    // an order nobody paid for.
    const paymentStatus = 'pending';
    const paidAt = null;

    const order = await insertWithRetry(client, (publicNumber) => client.query(
      `
        INSERT INTO orders (
          tenant_id, public_number, customer_id, customer_email, customer_name, customer_phone,
          payment_status, paid_at, fulfillment_status, subtotal_cents, shipping_cents, total_cents, shipping_address, billing_address,
          metadata, idempotency_key
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'awaiting', $9, $10, $11, $12::jsonb, $13::jsonb, $14::jsonb, $15)
        RETURNING *
      `,
      [
        tenant.id,
        publicNumber,
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
          checkoutOwnerHash: ownerHash,
          nbox: {
            quote: nboxQuoteMetadata(shippingQuote),
          },
          paymentGateway: {
            provider: 'sadad',
            method: 'web_checkout',
            status: paymentStatus,
          },
        }),
        idempotencyKey,
      ],
    ));
    createdOrder = order.rows[0];

    // Cancel only this shopping session's other pending orders that were created
    // before this one. Handles the case where the user went back from Sadad,
    // changed their details, and submitted a new order — the previous pending
    // order is cancelled immediately instead of waiting for the 6h cleanup job.
    await client.query(
      `UPDATE orders
          SET payment_status = 'cancelled',
              updated_at     = NOW()
        WHERE tenant_id      = $1
          AND metadata->>'checkoutOwnerHash' = $2
          AND payment_status = 'pending'
          AND id            != $3`,
      [tenantId, ownerHash, createdOrder.id],
    ).catch((err) => {
      // Non-critical — cleanup job will handle them at the 6h mark.
      console.warn('[checkout] Could not cancel prior pending orders:', err.message);
    });

    for (const item of lines) {
      const { qty } = item;
      const unit = item.unitCents;
      await client.query(
        `
          INSERT INTO order_items (
            tenant_id, order_id, product_id, variant_id, sku, product_name, size,
            quantity, unit_price_cents, total_cents, media_url, metadata,
            unit_cost_cents, shipping_cost_cents, total_cost_cents, cost_snapshot_source
          )
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,
            (SELECT cost_price_cents FROM product_variants WHERE id = $4),
            (SELECT shipping_cost_cents FROM product_variants WHERE id = $4),
            (SELECT total_cost_cents FROM product_variants WHERE id = $4),
            CASE WHEN (SELECT total_cost_cents FROM product_variants WHERE id = $4) IS NULL THEN 'missing' ELSE 'captured' END)
        `,
        [
          tenant.id,
          order.rows[0].id,
          item.productId,
          item.variantId,
          item.sku,
          item.name,
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
        'Checkout submitted; awaiting verified payment.',
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
        'sadad',
        'web_checkout',
        paymentStatus,
        totalCents,
        tenant.currency,
        JSON.stringify({
          integrationPending: paymentStatus !== 'paid',
          nboxQuote: nboxQuoteMetadata(shippingQuote),
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

    created(res, {
      id: createdOrder.id,                   // UUID — used for payment initiation
      orderNumber: createdOrder.public_number, // human-readable display reference
      total: fromCents(createdOrder.total_cents),
      delivery: fromCents(createdOrder.shipping_cents),
      payment: paymentStatus,
      fulfillment: createdOrder.fulfillment_status,
      nbox: { quote: nboxQuoteMetadata(shippingQuote) },
    }, 'Checkout order created.');
  } catch (err) {
    if (inTransaction) await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}));

router.all('/:id', retiredCart);
router.all('/:id/items', retiredCart);
router.all('/:id/items/:itemId', retiredCart);
router.all('/:id/checkout', retiredCart);

module.exports = router;
