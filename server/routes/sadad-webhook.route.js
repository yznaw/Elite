const { Router } = require('express');
const db = require('../db/client');
const { bookNboxForPaidOrder } = require('../lib/order-delivery');
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
    }

    if (existing.rows[0]?.provider_payment_id === transactionNumber) {
      console.log('[sadad-webhook] Duplicate — already processed', { transactionNumber });
    }

    // Update orders table
    const orderResult = await client.query(
      `UPDATE orders
          SET payment_status = $1::order_payment_status,
              paid_at        = CASE WHEN $1::order_payment_status = 'paid' THEN NOW() ELSE paid_at END,
              updated_at     = NOW()
        WHERE id = $2::uuid
        RETURNING tenant_id`,
      [paymentStatus, websiteRefNo],
    );

    if (orderResult.rowCount === 0) {
      console.warn('[sadad-webhook] Order not found', { websiteRefNo });
      return;
    }

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
      [orderResult.rows[0].tenant_id, websiteRefNo, JSON.stringify(paymentGatewayMetadata)],
    ).catch((err) => {
      console.warn('[sadad-webhook] Non-critical metadata update failed', {
        websiteRefNo,
        code: err.code,
        message: err.message,
      });
    });

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
    ).catch((err) => {
      console.warn('[sadad-webhook] Non-critical payments update failed', {
        websiteRefNo,
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
          orderResult.rows[0].tenant_id,
          websiteRefNo,
          'SADAD payment confirmed.',
          JSON.stringify({
            provider: 'sadad',
            transactionNumber: transactionNumber || null,
            transactionStatus,
          }),
        ],
      ).catch((err) => {
        console.warn('[sadad-webhook] Non-critical timeline insert failed', {
          websiteRefNo,
          code: err.code,
          message: err.message,
        });
      });

      await bookNboxForPaidOrder(client, orderResult.rows[0].tenant_id, websiteRefNo)
        .then((deliveryResult) => {
          if (deliveryResult.failed) {
            console.warn('[sadad-webhook] NBOX booking failed after payment confirmation', {
              websiteRefNo,
              result: deliveryResult,
            });
          }
        })
        .catch((err) => {
          console.warn('[sadad-webhook] Non-critical NBOX booking error', {
            websiteRefNo,
            code: err.code,
            message: err.message,
          });
        });
    }

    console.log('[sadad-webhook] Order updated', { websiteRefNo, paymentStatus, transactionNumber });
  } catch (err) {
    console.error('[sadad-webhook] Critical order payment update failed', {
      websiteRefNo,
      code: err.code,
      message: err.message,
    });
  } finally {
    client.release();
  }
});

module.exports = router;
