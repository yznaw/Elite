const { Router } = require('express');
const db = require('../db/client');
const { bookNboxForPaidOrder } = require('../lib/order-delivery');
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
// Body: { orderId: string }  — orderId must be the UUID (not public_number)
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

    // Update the payments record created at checkout to reflect Sadad as provider
    await client.query(
      `UPDATE payments
          SET provider   = 'sadad',
              updated_at = NOW()
        WHERE order_id = $1`,
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
// after the customer completes (or exits) the payment page.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/sadad/callback', asyncHandler(async (req, res) => {
  const payload = req.body;

  // ── 1. Verify checksum ────────────────────────────────────────────────────
  const receivedHash = payload.checksumhash;
  const paramsForVerification = { ...payload };
  delete paramsForVerification.checksumhash;

  const isValid = sadad.verifyChecksum(paramsForVerification, receivedHash);
  if (!isValid) {
    console.warn('[sadad-callback] Checksum FAILED', { orderId: payload.ORDERID });
    return res.redirect(`${storefrontBase(req)}/checkout/failure?reason=invalid_signature`);
  }

  // ── 2. Parse fields ───────────────────────────────────────────────────────
  // Sadad returns ORDER_ID without hyphens — restore UUID format for DB lookup
  const orderId           = sadad.restoreUuidHyphens(payload.ORDERID);
  const transactionStatus = Number(payload.transaction_status);
  const transactionNumber = payload.transaction_number;
  const paymentStatus     = sadad.toOrderPaymentStatus(transactionStatus);

  console.log('[sadad-callback]', { orderId, transactionStatus, transactionNumber, paymentStatus });

  // ── 3. Update DB ──────────────────────────────────────────────────────────
  const client = await db.pool.connect();
  let publicOrderNumber = '';
  let paymentUpdateSaved = false;
  try {
    // Guard: never downgrade a paid order. The Sadad webhook and callback can
    // arrive in any order. If the webhook already marked this order 'paid',
    // the WHERE clause prevents the callback from overwriting it.
    const orderResult = await client.query(
      `UPDATE orders
          SET payment_status = $1::order_payment_status,
              paid_at        = CASE WHEN $1::order_payment_status = 'paid' THEN NOW() ELSE paid_at END,
              updated_at     = NOW()
        WHERE id = $2::uuid
          AND payment_status != 'paid'
        RETURNING tenant_id, public_number`,
      [paymentStatus, orderId],
    );

    if (orderResult.rowCount === 0) {
      // rowCount is 0 for two reasons:
      //   1. Order does not exist → genuine error.
      //   2. Order is already 'paid' → webhook arrived first and updated it.
      //      In that case we still want to send the customer to /thank-you.
      const existing = await client.query(
        `SELECT public_number, payment_status FROM orders WHERE id = $1::uuid`,
        [orderId],
      );
      if (existing.rowCount === 0) {
        console.warn('[sadad-callback] Order not found', { orderId, transactionNumber });
        return res.redirect(`${storefrontBase(req)}/checkout/failure?reason=order_not_found`);
      }
      const alreadyPaid = existing.rows[0];
      console.log('[sadad-callback] Order already paid — redirecting to thank-you', { orderId });
      return res.redirect(`${storefrontBase(req)}/thank-you?order=${encodeURIComponent(alreadyPaid.public_number)}`);
    }

    const updatedOrder = orderResult.rows[0];
    publicOrderNumber = updatedOrder.public_number;
    paymentUpdateSaved = true;

    const paymentGatewayMetadata = {
      paymentGateway: {
        provider: 'sadad',
        method: 'web_checkout',
        status: paymentStatus,
        transactionNumber: transactionNumber || null,
        transactionStatus,
      },
    };

    await client.query(
      `UPDATE orders
          SET metadata = metadata || $3::jsonb
        WHERE tenant_id = $1 AND id = $2`,
      [updatedOrder.tenant_id, orderId, JSON.stringify(paymentGatewayMetadata)],
    ).catch((err) => {
      console.warn('[sadad-callback] Non-critical metadata update failed', {
        orderId,
        code: err.code,
        message: err.message,
      });
    });

    // Update the payments record with Sadad transaction details
    await client.query(
      `UPDATE payments
          SET provider            = 'sadad',
              provider_payment_id = $1,
              status              = $2::order_payment_status,
              processed_at        = CASE WHEN $2::order_payment_status = 'paid' THEN NOW() ELSE processed_at END,
              updated_at          = NOW()
        WHERE order_id = $3`,
      [transactionNumber || null, paymentStatus, orderId],
    ).catch((err) => {
      console.warn('[sadad-callback] Non-critical payments update failed', {
        orderId,
        code: err.code,
        message: err.message,
      });
    });

    if (paymentStatus === 'paid') {
      await client.query(
        `
          INSERT INTO order_timeline_entries (tenant_id, order_id, kind, detail, metadata)
          SELECT $1, $2, 'paid', $3, $4::jsonb
          WHERE NOT EXISTS (
            SELECT 1
              FROM order_timeline_entries
             WHERE order_id = $2
               AND kind = 'paid'
               AND metadata->>'provider' = 'sadad'
          )
        `,
        [
          updatedOrder.tenant_id,
          orderId,
          'SADAD payment confirmed.',
          JSON.stringify({
            provider: 'sadad',
            transactionNumber: transactionNumber || null,
            transactionStatus,
          }),
        ],
      ).catch((err) => {
        console.warn('[sadad-callback] Non-critical timeline insert failed', {
          orderId,
          code: err.code,
          message: err.message,
        });
      });

      await bookNboxForPaidOrder(client, updatedOrder.tenant_id, orderId)
        .then((deliveryResult) => {
          if (deliveryResult.failed) {
            console.warn('[sadad-callback] NBOX booking failed after payment confirmation', {
              orderId,
              result: deliveryResult,
            });
          }
        })
        .catch((err) => {
          console.warn('[sadad-callback] Non-critical NBOX booking error', {
            orderId,
            code: err.code,
            message: err.message,
          });
        });
    }
  } catch (err) {
    console.error('[sadad-callback] Critical order payment update failed', {
      orderId,
      paymentStatus,
      code: err.code,
      message: err.message,
      stack: err.stack,
    });
  } finally {
    client.release();
  }

  // ── 4. Redirect to storefront ─────────────────────────────────────────────
  const sf = storefrontBase(req);
  const orderRef = encodeURIComponent(publicOrderNumber || orderId);
  if (!paymentUpdateSaved) {
    return res.redirect(`${sf}/checkout/failure?order=${orderRef}&reason=payment_update_failed`);
  }
  if (paymentStatus === 'paid') {
    return res.redirect(`${sf}/thank-you?order=${orderRef}`);
  }
  if (paymentStatus === 'failed') {
    return res.redirect(`${sf}/checkout/failure?order=${orderRef}&reason=${encodeURIComponent(payload.RESPMSG || 'failed')}`);
  }
  return res.redirect(`${sf}/checkout/pending?order=${orderRef}`);
}));

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/payments/order-status/:orderId
// Lets the storefront check if a pending order was paid after the user returns
// from the Sadad payment page via browser back.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/order-status/:orderId', asyncHandler(async (req, res) => {
  const { orderId } = req.params;

  if (!orderId) {
    return res.status(400).json({ success: false, message: 'orderId is required' });
  }

  const { rows } = await db.pool.query(
    `SELECT id, payment_status, public_number
       FROM orders
      WHERE id = $1::uuid`,
    [orderId],
  );

  if (rows.length === 0) {
    return res.status(404).json({ success: false, message: 'Order not found' });
  }

  return res.json({
    success: true,
    data: {
      paymentStatus: rows[0].payment_status,
      publicNumber:  rows[0].public_number,
    },
  });
}));

module.exports = router;
