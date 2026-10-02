// Required as a module object so tests can substitute sendMail.
const mailer = require('./mailer');
const { logger } = require('./logger');

/**
 * "Your order is confirmed" email, sent after allocation for automatic orders
 * or staff approval for legacy orders. The payment receipt still goes out
 * at payment; this is the second message. It never mentions branches or
 * where the order ships from (client decision 2026-09-26).
 *
 * Idempotent via orders.metadata.confirmation.sentAt. Never throws.
 */

function money(cents, currency = 'QAR') {
  return `${(Number(cents || 0) / 100).toFixed(2)} ${currency}`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

async function sendOrderConfirmedEmail(client, tenantId, orderId) {
  try {
    const orderResult = await client.query(
      `SELECT o.*, t.currency FROM orders o JOIN tenants t ON t.id = o.tenant_id
        WHERE o.tenant_id = $1 AND o.id = $2 AND o.status NOT IN ('cancelled','refunded') AND (o.approved_at IS NOT NULL OR (o.fulfillment_version=1 AND o.payment_status='paid' AND o.allocation_state='allocated'))`,
      [tenantId, orderId],
    );
    if (!orderResult.rowCount) return { sent: false, reason: 'not_approved' };
    const order = orderResult.rows[0];
    if (!order.customer_email) return { sent: false, reason: 'customer_email_missing' };
    if (order.metadata?.confirmation?.sentAt) return { sent: false, skipped: true, reason: 'already_sent' };
    if (Date.parse(order.metadata?.confirmation?.nextAttemptAt) > Date.now()) return { sent: false, skipped: true, reason: 'retry_backoff' };

    const items = await client.query(
      `SELECT product_name, size, quantity FROM order_items WHERE tenant_id = $1 AND order_id = $2 ORDER BY created_at, id`,
      [tenantId, orderId],
    );
    const currency = order.currency || 'QAR';
    const firstName = String(order.customer_name || '').trim().split(/\s+/)[0] || '';
    const lines = items.rows.map((item) => `${item.quantity} x ${item.product_name}${item.size ? ` (Size ${item.size})` : ''}`);
    const text = [
      `Hello ${firstName},`.replace(' ,', ','),
      '',
      `Good news: your order ${order.public_number} is confirmed and is being prepared for delivery.`,
      '',
      ...lines,
      '',
      `Total: ${money(order.total_cents, currency)}`,
      '',
      'We will let you know as soon as it is on its way.',
      'Thank you for shopping with Elite Collections.',
    ].join('\n');
    const htmlItems = items.rows.map((item) => `<tr>
        <td style="padding:12px 14px;border-bottom:1px solid #e8e1d6;color:#201a13;font-size:14px">${escapeHtml(item.product_name)}${item.size ? ` <span style="color:#867967">· Size ${escapeHtml(item.size)}</span>` : ''}</td>
        <td style="padding:12px 14px;border-bottom:1px solid #e8e1d6;text-align:right;color:#6f6457;font-size:14px">× ${escapeHtml(item.quantity)}</td>
      </tr>`).join('');
    const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
      <body style="margin:0;padding:0;background:#f4f0e8;font-family:Arial,Helvetica,sans-serif;color:#201a13">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f0e8"><tr><td align="center" style="padding:28px 12px">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:640px;background:#fffdf9;border:1px solid #e8e1d6;border-top:4px solid #b8924a">
            <tr><td style="padding:30px 36px 24px;background:#024638;color:#fffaf0">
              <div style="font-family:Georgia,'Times New Roman',serif;font-size:28px;letter-spacing:.16em">ELITE</div>
            </td></tr>
            <tr><td style="padding:30px 36px 8px">
              <div style="color:#b8924a;font-size:11px;letter-spacing:.16em;text-transform:uppercase;font-weight:bold">Order confirmed</div>
              <h1 style="margin:10px 0 8px;font-family:Georgia,'Times New Roman',serif;font-size:28px;line-height:34px;font-weight:normal">Your order is being prepared.</h1>
              <p style="margin:0;color:#6f6457;font-size:14px;line-height:22px">${firstName ? `${escapeHtml(firstName)}, your` : 'Your'} order <strong>${escapeHtml(order.public_number)}</strong> is confirmed. We will let you know as soon as it is on its way.</p>
            </td></tr>
            <tr><td style="padding:18px 36px 8px">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse">${htmlItems}
                <tr><td style="padding:14px;text-align:right;color:#024638;font-weight:bold;border-top:1px solid #b8924a">Total</td>
                    <td style="padding:14px;text-align:right;color:#024638;font-weight:bold;border-top:1px solid #b8924a;white-space:nowrap">${escapeHtml(money(order.total_cents, currency))}</td></tr>
              </table>
            </td></tr>
            <tr><td style="padding:22px 36px 28px;background:#f4f0e8;border-top:1px solid #e8e1d6;text-align:center;color:#897b6b;font-size:12px;line-height:20px">
              Thank you for shopping with Elite Collections.
            </td></tr>
          </table>
        </td></tr></table>
      </body></html>`;

    await mailer.sendMail({ to: order.customer_email, subject: `Your order ${order.public_number} is confirmed`, text, html });
    await client.query(
      `UPDATE orders SET metadata = metadata || jsonb_build_object('confirmation', jsonb_build_object('sentAt', $3::text)), updated_at = now()
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, orderId, new Date().toISOString()],
    );
    return { sent: true };
  } catch (err) {
    logger.warn({ orderId, err: err.message, code: err.code }, 'order confirmation email failed');
    // An unavailable mail service must not monopolize every worker sweep.
    await client.query(`UPDATE orders SET metadata=jsonb_set(metadata,'{confirmation}',
      COALESCE(metadata->'confirmation','{}'::jsonb) || jsonb_build_object('nextAttemptAt',$3::text),true)
      WHERE tenant_id=$1 AND id=$2 AND fulfillment_version=1`,
    [tenantId, orderId, new Date(Date.now() + 5 * 60 * 1000).toISOString()]).catch(() => {});
    return { sent: false, reason: err.code || 'error' };
  }
}

module.exports = { sendOrderConfirmedEmail };
