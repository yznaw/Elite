const { Router } = require('express');
const db = require('../db/client');
const sadad = require('../lib/sadad');

const router = Router();

// ─────────────────────────────────────────────────────────────────────────────
// POST /webhooks/sadad  (JSON body)
//
// Always responds 200 + { "status": "success" } immediately (Sadad requirement).
// Processing happens after the response is sent.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  // Respond immediately — Sadad requires 200 or it will retry
  res.status(200).json({ status: 'success' });

  const payload = req.body;
  if (!payload || typeof payload !== 'object') {
    console.warn('[sadad-webhook] Empty or non-object body');
    return;
  }

  // ── 1. Verify checksum ────────────────────────────────────────────────────
  const receivedHash = payload.checksumhash;
  const paramsForVerification = { ...payload };
  delete paramsForVerification.checksumhash;

  if (!sadad.verifyChecksum(paramsForVerification, receivedHash)) {
    console.warn('[sadad-webhook] Checksum FAILED — ignoring', { txn: payload.transactionNumber });
    return;
  }

  // ── 2. Parse fields ───────────────────────────────────────────────────────
  const transactionNumber = payload.transactionNumber;
  // websiteRefNo was sent without hyphens — restore UUID format for DB lookup
  const websiteRefNo      = sadad.restoreUuidHyphens(payload.websiteRefNo);
  const transactionStatus = Number(payload.transactionStatus);
  const paymentStatus     = sadad.toOrderPaymentStatus(transactionStatus);

  console.log('[sadad-webhook]', { transactionNumber, websiteRefNo, transactionStatus, paymentStatus });

  if (!websiteRefNo) {
    console.warn('[sadad-webhook] Missing websiteRefNo');
    return;
  }

  // Skip status 1 (In Progress) — no DB update needed, wait for final status
  if (transactionStatus === 1) {
    console.log('[sadad-webhook] Status=1 (In Progress) — skipping until final');
    return;
  }

  // ── 3. Idempotency + update ───────────────────────────────────────────────
  const client = await db.pool.connect();
  try {
    // Check if this exact transaction was already processed
    const existing = await client.query(
      `SELECT provider_payment_id FROM payments WHERE order_id = $1`,
      [websiteRefNo],
    );

    if (existing.rows.length === 0) {
      console.warn('[sadad-webhook] No payments record for order', { websiteRefNo });
      return;
    }

    if (existing.rows[0].provider_payment_id === transactionNumber) {
      console.log('[sadad-webhook] Duplicate — already processed', { transactionNumber });
      return;
    }

    await client.query('BEGIN');

    // Update orders table
    const orderResult = await client.query(
      `UPDATE orders
          SET payment_status = $1,
              paid_at        = CASE WHEN $1 = 'paid' THEN NOW() ELSE paid_at END,
              updated_at     = NOW(),
              metadata       = metadata || $3::jsonb
        WHERE id = $2
        RETURNING tenant_id`,
      [
        paymentStatus,
        websiteRefNo,
        JSON.stringify({
          paymentGateway: {
            provider: 'sadad',
            method: 'web_checkout',
            status: paymentStatus,
            transactionNumber: transactionNumber || null,
            transactionStatus,
          },
        }),
      ],
    );

    if (orderResult.rowCount === 0) {
      await client.query('ROLLBACK');
      console.warn('[sadad-webhook] Order not found', { websiteRefNo });
      return;
    }

    // Update payments table
    await client.query(
      `UPDATE payments
          SET provider            = 'sadad',
              provider_payment_id = $1,
              status              = $2,
              processed_at        = CASE WHEN $2 = 'paid' THEN NOW() ELSE processed_at END,
              updated_at          = NOW()
        WHERE order_id = $3`,
      [transactionNumber, paymentStatus, websiteRefNo],
    );

    if (paymentStatus === 'paid') {
      await client.query(
        `UPDATE orders SET fulfillment_status = 'awaiting'
          WHERE id = $1 AND fulfillment_status = 'awaiting'`,
        [websiteRefNo],
      );

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
          orderResult.rows[0].tenant_id,
          websiteRefNo,
          'SADAD payment confirmed.',
          JSON.stringify({
            provider: 'sadad',
            transactionNumber: transactionNumber || null,
            transactionStatus,
          }),
        ],
      );
    }

    await client.query('COMMIT');
    console.log('[sadad-webhook] Order updated', { websiteRefNo, paymentStatus, transactionNumber });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[sadad-webhook] DB error', err);
  } finally {
    client.release();
  }
});

module.exports = router;
