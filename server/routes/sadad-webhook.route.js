const { Router } = require('express');
const db = require('../db/client');
const sadad = require('../lib/sadad');

const router = Router();

// ─────────────────────────────────────────────────────────────────────────────
// POST /webhooks/sadad
//
// Sadad sends a JSON POST here for every transaction event, independently of
// the customer's browser. This is the authoritative server-to-server notification.
//
// IMPORTANT (per Sadad docs):
//   • Always respond HTTP 200 + { "status": "success" } — even on errors.
//     Non-200 responses cause Sadad to retry, increasing replay risk.
//   • Implement idempotent handling: track transactionNumber to avoid
//     processing the same transaction twice.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  // Respond 200 immediately (Sadad requirement) — processing happens after
  res.status(200).json({ status: 'success' });

  let payload;
  try {
    // req.body is already parsed by express.json() on this route because
    // index.js registers this router AFTER the global middleware.
    payload = req.body;
    if (!payload || typeof payload !== 'object') {
      console.warn('[sadad-webhook] Received empty or non-object body');
      return;
    }
  } catch (err) {
    console.error('[sadad-webhook] Failed to parse body', err);
    return;
  }

  // ── 1. Verify checksum ────────────────────────────────────────────────────
  const receivedHash = payload.checksumhash;
  const paramsForVerification = { ...payload };
  delete paramsForVerification.checksumhash;

  const isValid = sadad.verifyChecksum(paramsForVerification, receivedHash);
  if (!isValid) {
    console.warn('[sadad-webhook] Checksum verification FAILED — ignoring', {
      transactionNumber: payload.transactionNumber,
      websiteRefNo     : payload.websiteRefNo,
    });
    return;
  }

  // ── 2. Parse fields ───────────────────────────────────────────────────────
  const transactionNumber  = payload.transactionNumber;
  const websiteRefNo       = payload.websiteRefNo;   // merchant ORDER_ID
  const transactionStatus  = Number(payload.transactionStatus);
  const txnAmount          = payload.txnAmount;
  const isTestMode         = payload.isTestMode;

  const paymentStatus = sadad.toOrderPaymentStatus(transactionStatus);

  console.log('[sadad-webhook]', {
    transactionNumber, websiteRefNo, transactionStatus,
    paymentStatus, txnAmount, isTestMode,
  });

  if (!websiteRefNo) {
    console.warn('[sadad-webhook] Missing websiteRefNo — cannot update order');
    return;
  }

  // ── 3. Idempotency check ──────────────────────────────────────────────────
  // Only process status 2 (failed) or 3 (paid) — skip status 1 (in-progress)
  if (transactionStatus === 1) {
    console.log('[sadad-webhook] Status=1 (In Progress) — no update needed, awaiting final status');
    return;
  }

  const client = await db.pool.connect();

  try {
    // Check if we already processed this exact transaction
    const existing = await client.query(
      `SELECT payment_status, payment_reference FROM orders WHERE id = $1`,
      [websiteRefNo],
    );

    if (existing.rows.length === 0) {
      console.warn('[sadad-webhook] Order not found', { orderId: websiteRefNo });
      return;
    }

    const order = existing.rows[0];

    // Skip if already processed with this same transaction reference
    if (order.payment_reference === transactionNumber) {
      console.log('[sadad-webhook] Duplicate webhook — already processed', { transactionNumber });
      return;
    }

    // ── 4. Update order ───────────────────────────────────────────────────
    await client.query(
      `UPDATE orders
          SET payment_status    = $1,
              payment_reference = $2,
              payment_provider  = 'sadad',
              updated_at        = NOW()
        WHERE id = $3`,
      [paymentStatus, transactionNumber, websiteRefNo],
    );

    // Transition to awaiting-fulfilment only on success
    if (paymentStatus === 'paid') {
      await client.query(
        `UPDATE orders
            SET fulfillment_status = 'awaiting'
          WHERE id = $1 AND fulfillment_status IN ('pending', 'awaiting')`,
        [websiteRefNo],
      );
    }

    console.log('[sadad-webhook] Order updated', {
      orderId: websiteRefNo, paymentStatus, transactionNumber,
    });
  } catch (err) {
    console.error('[sadad-webhook] DB error', err);
  } finally {
    client.release();
  }
});

module.exports = router;
