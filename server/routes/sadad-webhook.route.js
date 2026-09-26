const { Router } = require('express');
const db = require('../db/client');
const { bookNboxForPaidOrder } = require('../lib/order-delivery');
const { sendReceiptForPaidOrder } = require('../lib/order-receipt');
const { notifyNewWebOrder } = require('../lib/staff-notify');
const { perLocationEnabled } = require('../lib/location-stock');
const { ensurePaidOrderStock } = require('../lib/order-stock');
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

    // A delivery for an order that is already paid still completes the
    // idempotent follow-ups. Without this, a first delivery that set the paid
    // flag and then crashed left the order without its stock deduction until
    // the browser callback or the sweep happened to run.
    async function repairAlreadyPaid() {
      if (paymentStatus !== 'paid') return;
      const paid = await client.query(
        `SELECT tenant_id FROM orders WHERE id = $1::uuid AND payment_status = 'paid'`,
        [websiteRefNo],
      );
      if (!paid.rowCount) return;
      await ensurePaidOrderStock(paid.rows[0].tenant_id, websiteRefNo, { source: 'sadad-webhook-repair' });
      await notifyNewWebOrder(client, paid.rows[0].tenant_id, websiteRefNo);
    }

    // Idempotency: Sadad may deliver the same webhook more than once.
    // If this transaction was already recorded, skip the update entirely.
    if (existing.rows[0]?.provider_payment_id === transactionNumber) {
      console.log('[sadad-webhook] Duplicate — already processed', { transactionNumber });
      await repairAlreadyPaid();
      return;
    }

    // Guard: never downgrade a paid order. Same race-condition protection as
    // the callback handler — whichever arrives first wins, the other is a no-op.
    const orderResult = await client.query(
      `UPDATE orders
          SET payment_status = $1::order_payment_status,
              paid_at        = CASE WHEN $1::order_payment_status = 'paid' THEN NOW() ELSE paid_at END,
              updated_at     = NOW()
        WHERE id = $2::uuid
          AND payment_status != 'paid'
        RETURNING tenant_id`,
      [paymentStatus, websiteRefNo],
    );

    if (orderResult.rowCount === 0) {
      console.warn('[sadad-webhook] Order not found or already paid', { websiteRefNo });
      await repairAlreadyPaid();
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

      // Stock per location: the courier is booked at approval, from the
      // chosen location (routes/admin-orders.route.js POST /:id/approve).
      if (!(await perLocationEnabled(client, orderResult.rows[0].tenant_id))) await bookNboxForPaidOrder(client, orderResult.rows[0].tenant_id, websiteRefNo)
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
      await sendReceiptForPaidOrder(client, orderResult.rows[0].tenant_id, websiteRefNo).catch((err) => {
        console.warn('[sadad-webhook] Receipt email failed:', err.message);
      });
      // Idempotent and never throws; the browser callback may have notified already.
      await notifyNewWebOrder(client, orderResult.rows[0].tenant_id, websiteRefNo);

      // See the matching call in payments.route.js. Sadad delivers webhooks
      // more than once by design, which is exactly why this is keyed on an
      // existing ledger row rather than on winning the paid-flag update.
      await ensurePaidOrderStock(orderResult.rows[0].tenant_id, websiteRefNo, { source: 'sadad-webhook' });
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
