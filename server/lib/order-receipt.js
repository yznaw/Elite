const { sendMail } = require('./mailer');

function money(cents, currency = 'QAR') {
  return `${(Number(cents || 0) / 100).toFixed(2)} ${currency}`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

async function sendReceiptForPaidOrder(client, tenantId, orderId) {
  const lock = `receipt:${tenantId}:${orderId}`;
  await client.query('SELECT pg_advisory_lock(hashtext($1)::bigint)', [lock]);
  try {
    const orderResult = await client.query(
      `SELECT o.*, t.currency FROM orders o JOIN tenants t ON t.id = o.tenant_id
        WHERE o.tenant_id = $1 AND o.id = $2 AND o.payment_status = 'paid'`,
      [tenantId, orderId],
    );
    if (!orderResult.rowCount) return { sent: false, reason: 'order_not_paid_or_not_found' };
    const order = orderResult.rows[0];
    if (!order.customer_email) return { sent: false, reason: 'customer_email_missing' };
    if (order.metadata?.receipt?.sentAt) return { sent: false, skipped: true, reason: 'already_sent' };

    const itemResult = await client.query(
      `SELECT product_name, sku, size, quantity, total_cents FROM order_items
        WHERE tenant_id = $1 AND order_id = $2 ORDER BY created_at, id`,
      [tenantId, orderId],
    );
    const currency = order.currency || 'QAR';
    const lines = itemResult.rows.map((item) => `${item.quantity} x ${item.product_name}${item.size ? ` (${item.size})` : ''} — ${money(item.total_cents, currency)}`);
    const text = [
      'Elite Collections — Payment Receipt', '', `Order: ${order.public_number}`,
      `Date: ${new Date(order.paid_at || order.updated_at || Date.now()).toLocaleString('en-GB', { timeZone: 'Asia/Qatar' })}`,
      `Customer: ${order.customer_name || ''}`, '', 'Items:', ...lines, '',
      `Subtotal: ${money(order.subtotal_cents, currency)}`,
      `Delivery: ${money(order.shipping_cents, currency)}`,
      `Total paid: ${money(order.total_cents, currency)}`, '',
      'Thank you for shopping with Elite Collections.',
    ].join('\n');
    const htmlItems = itemResult.rows.map((item) => `<tr>
      <td style="padding:16px 14px;border-bottom:1px solid #e8e1d6;color:#201a13;font-size:14px;line-height:20px">
        <strong style="font-weight:600">${escapeHtml(item.product_name)}${item.size ? ` <span style="font-weight:400;color:#867967">· Size ${escapeHtml(item.size)}</span>` : ''}</strong>
        ${item.sku ? `<br><span style="font-size:11px;letter-spacing:.08em;color:#9a8b78">${escapeHtml(item.sku)}</span>` : ''}
      </td>
      <td style="padding:16px 8px;border-bottom:1px solid #e8e1d6;text-align:center;color:#6f6457;font-size:14px">${escapeHtml(item.quantity)}</td>
      <td style="padding:16px 14px;border-bottom:1px solid #e8e1d6;text-align:right;color:#201a13;font-size:14px;white-space:nowrap">${escapeHtml(money(item.total_cents, currency))}</td>
    </tr>`).join('');
    const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1.0"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"></head>
      <body style="margin:0;padding:0;background:#f4f0e8;color:#201a13;font-family:Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%">
        <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">Your Elite Collections payment receipt for order ${escapeHtml(order.public_number)}.</div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f0e8;width:100%">
          <tr><td align="center" style="padding:28px 12px">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:640px;background:#fffdf9;border:1px solid #e8e1d6;border-top:4px solid #b8924a">
              <tr><td style="padding:34px 36px 28px;background:#024638;color:#fffaf0">
                <div style="font-family:Georgia,'Times New Roman',serif;font-size:28px;letter-spacing:.16em;line-height:34px">ELITE</div>
                <div style="margin-top:8px;color:#d6bc91;font-size:11px;letter-spacing:.18em;text-transform:uppercase">Arabic Leather Artisans · Est. 2018</div>
              </td></tr>
              <tr><td style="padding:34px 36px 12px">
                <div style="color:#b8924a;font-size:11px;letter-spacing:.16em;text-transform:uppercase;font-weight:bold">Payment confirmed</div>
                <h1 style="margin:10px 0 8px;color:#201a13;font-family:Georgia,'Times New Roman',serif;font-size:30px;line-height:36px;font-weight:normal">Thank you for your order.</h1>
                <p style="margin:0;color:#6f6457;font-size:14px;line-height:22px">Your payment has been received. Please keep this receipt for your records.</p>
              </td></tr>
              <tr><td style="padding:20px 36px 26px">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f0e8;border:1px solid #e8e1d6">
                  <tr><td style="padding:14px 16px;color:#897b6b;font-size:11px;letter-spacing:.1em;text-transform:uppercase">Order number</td><td style="padding:14px 16px;text-align:right;color:#201a13;font-size:14px;font-weight:bold">${escapeHtml(order.public_number)}</td></tr>
                  <tr><td style="padding:0 16px 14px;color:#897b6b;font-size:11px;letter-spacing:.1em;text-transform:uppercase">Customer</td><td style="padding:0 16px 14px;text-align:right;color:#201a13;font-size:14px">${escapeHtml(order.customer_name || '')}</td></tr>
                </table>
              </td></tr>
              <tr><td style="padding:0 36px 8px"><div style="color:#201a13;font-family:Georgia,'Times New Roman',serif;font-size:20px">Order summary</div></td></tr>
              <tr><td style="padding:0 36px 24px">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse">
                  <thead><tr style="background:#024638;color:#fffaf0"><th align="left" style="padding:11px 14px;font-size:10px;letter-spacing:.12em;text-transform:uppercase;font-weight:normal">Item</th><th align="center" style="padding:11px 8px;font-size:10px;letter-spacing:.12em;text-transform:uppercase;font-weight:normal">Qty</th><th align="right" style="padding:11px 14px;font-size:10px;letter-spacing:.12em;text-transform:uppercase;font-weight:normal">Amount</th></tr></thead>
                  <tbody>${htmlItems}</tbody>
                  <tfoot><tr><td colspan="2" style="padding:18px 14px 5px;text-align:right;color:#6f6457;font-size:13px">Subtotal</td><td style="padding:18px 14px 5px;text-align:right;color:#201a13;font-size:13px;white-space:nowrap">${escapeHtml(money(order.subtotal_cents, currency))}</td></tr>
                  <tr><td colspan="2" style="padding:5px 14px;text-align:right;color:#6f6457;font-size:13px">Delivery</td><td style="padding:5px 14px;text-align:right;color:#201a13;font-size:13px;white-space:nowrap">${escapeHtml(money(order.shipping_cents, currency))}</td></tr>
                  <tr><td colspan="2" style="padding:16px 14px;text-align:right;border-top:1px solid #b8924a;color:#024638;font-size:15px;font-weight:bold">Total paid</td><td style="padding:16px 14px;text-align:right;border-top:1px solid #b8924a;color:#024638;font-size:15px;font-weight:bold;white-space:nowrap">${escapeHtml(money(order.total_cents, currency))}</td></tr></tfoot>
                </table>
              </td></tr>
              <tr><td style="padding:24px 36px 30px;background:#f4f0e8;border-top:1px solid #e8e1d6;text-align:center">
                <div style="color:#024638;font-family:Georgia,'Times New Roman',serif;font-size:17px">Crafted with distinction.</div>
                <div style="margin-top:8px;color:#897b6b;font-size:12px;line-height:20px">Thank you for shopping with Elite Collections.<br>For assistance, contact our client advisors.</div>
              </td></tr>
            </table>
          </td></tr>
        </table>
      </body></html>`;

    await sendMail({ to: order.customer_email, subject: `Your Elite Collections receipt — ${order.public_number}`, text, html });
    await client.query(
      `UPDATE orders SET metadata = metadata || jsonb_build_object('receipt', jsonb_build_object('sentAt', $3::text, 'email', $4::text)), updated_at = NOW() WHERE tenant_id = $1 AND id = $2`,
      [tenantId, orderId, new Date().toISOString(), order.customer_email],
    );
    return { sent: true, email: order.customer_email };
  } finally {
    await client.query('SELECT pg_advisory_unlock(hashtext($1)::bigint)', [lock]).catch(() => {});
  }
}

module.exports = { sendReceiptForPaidOrder };
