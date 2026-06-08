const { Router } = require('express');
const db = require('../db/client');
const sadad = require('../lib/sadad');

const router = Router();

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function callbackBase(req) {
  return (
    process.env.SADAD_CALLBACK_BASE ||
    process.env.SERVER_URL ||
    `${req.protocol}://${req.get('host')}`
  );
}

function storefrontBase(req) {
  return (
    process.env.STOREFRONT_URL ||
    `${req.protocol}://${req.get('host')}`
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/payments/sadad/initiate
// Body: { orderId: string }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/sadad/initiate', asyncHandler(async (req, res) => {
  const { orderId } = req.body;

  if (!orderId) {
    return res.status(400).json({ success: false, message: 'orderId is required' });
  }

  const client = await db.pool.connect();
  try {
    const { rows } = await client.query(
      `SELECT id, total_cents, currency, payment_status,
              customer_email, customer_name, customer_phone
         FROM orders
        WHERE id = $1`,
      [orderId],
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    const order = rows[0];

    if (order.payment_status === 'paid') {
      return res.status(409).json({ success: false, message: 'Order is already paid' });
    }

    const request = sadad.buildPaymentRequest({
      orderId    : order.id,
      amount     : order.total_cents / 100,
      callbackUrl: `${callbackBase(req)}/api/payments/sadad/callback`,
      customer   : {
        id   : order.id,
        email: order.customer_email || 'guest@sadad.qa',
        phone: order.customer_phone || '97400000000',
      },
      items: [{
        orderId : order.id,
        amount  : order.total_cents / 100,
        quantity: 1,
      }],
    });

    await client.query(
      `UPDATE orders
          SET payment_provider = 'sadad',
              payment_status   = 'pending',
              updated_at       = NOW()
        WHERE id = $1`,
      [order.id],
    );

    return res.json({
      success: true,
      data: {
        endpoint      : request.endpoint,
        params        : request.params,
        productDetails: request.productDetails,
      },
    });
  } finally {
    client.release();
  }
}));

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/payments/sadad/callback
// Sadad posts transaction result as application/x-www-form-urlencoded
// ─────────────────────────────────────────────────────────────────────────────
router.post('/sadad/callback', asyncHandler(async (req, res) => {
  const payload = req.body;

  // ── 1. Verify checksum ────────────────────────────────────────────────────
  const receivedHash = payload.checksumhash;
  const paramsForVerification = { ...payload };
  delete paramsForVerification.checksumhash;

  const isValid = sadad.verifyChecksum(paramsForVerification, receivedHash);

  if (!isValid) {
    console.warn('[sadad-callback] Checksum FAILED', { orderId: payload.ORDERID, txn: payload.transaction_number });
    return res.redirect(`${storefrontBase(req)}/checkout/failure?reason=invalid_signature`);
  }

  // ── 2. Parse fields ───────────────────────────────────────────────────────
  const orderId           = payload.ORDERID;
  const transactionStatus = Number(payload.transaction_status);
  const transactionNumber = payload.transaction_number;
  const paymentStatus     = sadad.toOrderPaymentStatus(transactionStatus);

  console.log('[sadad-callback]', { orderId, transactionStatus, transactionNumber, paymentStatus });

  // ── 3. Update DB ──────────────────────────────────────────────────────────
  const client = await db.pool.connect();
  try {
    await client.query(
      `UPDATE orders
          SET payment_status    = $1,
              payment_reference = $2,
              updated_at        = NOW()
        WHERE id = $3`,
      [paymentStatus, transactionNumber || null, orderId],
    );

    if (paymentStatus === 'paid') {
      await client.query(
        `UPDATE orders SET fulfillment_status = 'awaiting'
          WHERE id = $1 AND fulfillment_status IN ('pending', 'awaiting')`,
        [orderId],
      );
    }
  } catch (err) {
    console.error('[sadad-callback] DB update failed', err);
  } finally {
    client.release();
  }

  // ── 4. Redirect to storefront ─────────────────────────────────────────────
  const sf = storefrontBase(req);
  if (paymentStatus === 'paid') {
    return res.redirect(`${sf}/checkout/success?order=${orderId}`);
  }
  if (paymentStatus === 'failed') {
    return res.redirect(`${sf}/checkout/failure?order=${orderId}&reason=${encodeURIComponent(payload.RESPMSG || 'failed')}`);
  }
  return res.redirect(`${sf}/checkout/pending?order=${orderId}`);
}));

module.exports = router;
