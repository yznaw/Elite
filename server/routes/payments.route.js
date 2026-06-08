const { Router } = require('express');
const sadad = require('../lib/sadad');

const router = Router();

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

/**
 * Resolve the full server base URL for building CALLBACK_URL.
 * Priority: SADAD_CALLBACK_BASE > SERVER_URL > request origin
 */
function callbackBase(req) {
  return (
    process.env.SADAD_CALLBACK_BASE ||
    process.env.SERVER_URL ||
    `${req.protocol}://${req.get('host')}`
  );
}

/**
 * Resolve the Angular storefront URL for post-payment redirects.
 */
function storefrontBase(req) {
  return (
    process.env.STOREFRONT_URL ||
    `${req.protocol}://${req.get('host')}`
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/payments/sadad/initiate
// Body: { orderId: string }
//
// Generates a signed Sadad payment request and returns the form parameters
// as JSON. The Angular client builds a hidden form and submits it to Sadad,
// which redirects the customer to the SADAD-hosted payment page.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/sadad/initiate', asyncHandler(async (req, res) => {
  const { orderId } = req.body;

  if (!orderId) {
    return res.status(400).json({ success: false, message: 'orderId is required' });
  }

  const db = req.app.locals.db;

  const { rows } = await db.query(
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

  const [firstName, ...rest] = (order.customer_name || 'Guest').split(' ');

  const request = sadad.buildPaymentRequest({
    orderId    : order.id,
    amount     : order.total_cents / 100,
    callbackUrl: `${callbackBase(req)}/api/payments/sadad/callback`,
    customer   : {
      id   : order.id,
      email: order.customer_email || 'guest@sadad.qa',
      phone: order.customer_phone || '97400000000',
    },
    // One product line representing the entire order total
    items: [{
      orderId : order.id,
      amount  : order.total_cents / 100,
      quantity: 1,
    }],
  });

  // Persist that a payment was initiated (still pending)
  await db.query(
    `UPDATE orders
        SET payment_provider = 'sadad',
            payment_status   = 'pending',
            updated_at       = NOW()
      WHERE id = $1`,
    [order.id],
  );

  return res.json({
    success : true,
    data    : {
      endpoint      : request.endpoint,
      params        : request.params,
      productDetails: request.productDetails,
    },
  });
}));

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/payments/sadad/callback
//
// Sadad posts the transaction result here as application/x-www-form-urlencoded
// AFTER the customer completes (or exits) the payment page.
// This endpoint verifies the checksum, updates the order, then redirects
// the customer's browser to the Angular success or failure page.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/sadad/callback', asyncHandler(async (req, res) => {
  const payload = req.body; // express.urlencoded() already parsed this

  // ── 1. Extract and verify checksum ────────────────────────────────────────
  const receivedHash = payload.checksumhash;
  const paramsForVerification = { ...payload };
  delete paramsForVerification.checksumhash;

  const isValid = sadad.verifyChecksum(paramsForVerification, receivedHash);

  if (!isValid) {
    console.warn('[sadad-callback] Checksum verification FAILED', {
      orderId: payload.ORDERID,
      txn    : payload.transaction_number,
    });
    // Still redirect — do not leave customer stranded
    return res.redirect(`${storefrontBase(req)}/checkout/failure?reason=invalid_signature`);
  }

  // ── 2. Parse status ───────────────────────────────────────────────────────
  const orderId          = payload.ORDERID;
  const transactionStatus = Number(payload.transaction_status);
  const transactionNumber = payload.transaction_number;
  const paymentStatus    = sadad.toOrderPaymentStatus(transactionStatus);

  console.log('[sadad-callback]', {
    orderId, transactionStatus, transactionNumber, paymentStatus,
    respCode: payload.RESPCODE, respMsg: payload.RESPMSG,
  });

  // ── 3. Update order in DB ─────────────────────────────────────────────────
  try {
    const db = req.app.locals.db;

    await db.query(
      `UPDATE orders
          SET payment_status    = $1,
              payment_reference = $2,
              updated_at        = NOW()
        WHERE id = $3`,
      [paymentStatus, transactionNumber || null, orderId],
    );

    // Only transition to awaiting-fulfilment when fully paid
    if (paymentStatus === 'paid') {
      await db.query(
        `UPDATE orders
            SET fulfillment_status = 'awaiting'
          WHERE id = $1 AND fulfillment_status IN ('pending', 'awaiting')`,
        [orderId],
      );
    }
  } catch (err) {
    console.error('[sadad-callback] DB update failed', err);
    // Still redirect the customer — webhook will be the authoritative update
  }

  // ── 4. Redirect customer to Angular storefront ────────────────────────────
  const sf = storefrontBase(req);
  if (paymentStatus === 'paid') {
    return res.redirect(`${sf}/checkout/success?order=${orderId}`);
  }
  if (paymentStatus === 'failed') {
    return res.redirect(`${sf}/checkout/failure?order=${orderId}&reason=${encodeURIComponent(payload.RESPMSG || 'failed')}`);
  }
  // Status 1 (in-progress) — rare at callback time, send to a pending page
  return res.redirect(`${sf}/checkout/pending?order=${orderId}`);
}));

module.exports = router;
