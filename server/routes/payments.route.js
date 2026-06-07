const { Router } = require('express');
const sadad = require('../lib/sadad');

const router = Router();

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function siteOrigin(req) {
  // Prefer the configured storefront URL, fall back to request origin
  return process.env.STOREFRONT_URL || `${req.protocol}://${req.get('host')}`;
}

/**
 * POST /api/payments/sadad/initiate
 * Body: { orderId: string }
 *
 * Creates a Sadad payment session for an existing pending order
 * and returns the redirect URL to send the customer to.
 */
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

  const origin = siteOrigin(req);
  const [firstName, ...rest] = (order.customer_name || 'Guest').split(' ');

  const session = await sadad.createPaymentSession({
    orderId: order.id,
    amount: order.total_cents / 100,
    currency: order.currency || 'QAR',
    customer: {
      firstName: firstName || 'Guest',
      lastName: rest.join(' ') || '-',
      email: order.customer_email || '',
      phone: order.customer_phone || '',
    },
    successUrl: `${origin}/checkout/success?order=${order.id}`,
    failureUrl: `${origin}/checkout/failure?order=${order.id}`,
    webhookUrl: `${process.env.SERVER_URL || origin}/webhooks/sadad`,
  });

  // Persist the Sadad session ID on the order for later status checks
  await db.query(
    `UPDATE orders SET payment_reference = $1, updated_at = NOW() WHERE id = $2`,
    [session.sessionId, order.id],
  );

  return res.json({ success: true, data: { redirectUrl: session.redirectUrl, sessionId: session.sessionId } });
}));

/**
 * GET /api/payments/sadad/status/:sessionId
 * Checks payment status for an order after the customer returns from the gateway.
 */
router.get('/sadad/status/:sessionId', asyncHandler(async (req, res) => {
  const { sessionId } = req.params;

  const status = await sadad.getPaymentStatus(sessionId);
  const paymentStatus = sadad.toOrderPaymentStatus(status.status);

  const db = req.app.locals.db;

  if (paymentStatus === 'paid') {
    await db.query(
      `UPDATE orders
          SET payment_status    = 'paid',
              payment_provider  = 'sadad',
              payment_reference = $1,
              fulfillment_status = CASE WHEN fulfillment_status = 'pending' THEN 'awaiting' ELSE fulfillment_status END,
              updated_at        = NOW()
        WHERE payment_reference = $1`,
      [sessionId],
    );
  }

  return res.json({ success: true, data: { sessionId, paymentStatus, raw: status } });
}));

module.exports = router;
