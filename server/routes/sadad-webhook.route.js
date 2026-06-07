const { Router } = require('express');
const sadad = require('../lib/sadad');

const router = Router();

// Sadad sends a raw body — mount this route BEFORE express.json() or use raw body capture.
// In your Express app setup, make sure to add:
//   app.use('/api/webhooks/sadad', express.raw({ type: 'application/json' }))
// BEFORE the global express.json() middleware, then register this router.

router.post('/', async (req, res) => {
  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body));
  const signature = req.headers['x-sadad-signature'] || req.headers['x-signature'] || '';

  if (!sadad.verifyWebhookSignature(rawBody, signature)) {
    return res.status(401).json({ success: false, message: 'Invalid webhook signature' });
  }

  let event;
  try {
    event = JSON.parse(rawBody.toString());
  } catch {
    return res.status(400).json({ success: false, message: 'Invalid JSON payload' });
  }

  // TODO: adjust field names to match actual Sadad webhook payload shape
  const orderId = event.merchant_order_id || event.order_id;
  const sadadStatus = event.status || event.payment_status;
  const transactionId = event.transaction_id;

  if (!orderId) {
    return res.status(400).json({ success: false, message: 'Missing order ID in webhook payload' });
  }

  const paymentStatus = sadad.toOrderPaymentStatus(sadadStatus);

  try {
    const db = req.app.locals.db;

    await db.query(
      `UPDATE orders
          SET payment_status    = $1,
              payment_provider  = 'sadad',
              payment_reference = $2,
              updated_at        = NOW()
        WHERE id = $3`,
      [paymentStatus, transactionId || null, orderId],
    );

    if (paymentStatus === 'paid') {
      await db.query(
        `UPDATE orders SET fulfillment_status = 'awaiting' WHERE id = $1 AND fulfillment_status = 'pending'`,
        [orderId],
      );
    }

    console.log(`[sadad-webhook] order=${orderId} status=${paymentStatus} txn=${transactionId}`);
    return res.json({ success: true });
  } catch (err) {
    console.error('[sadad-webhook] DB update failed', err);
    return res.status(500).json({ success: false, message: 'Internal error' });
  }
});

module.exports = router;
