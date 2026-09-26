// Required as a module object (not destructured) so tests can substitute
// sendMail, same as alerts.js.
const mailer = require('./mailer');
const { logger } = require('./logger');

/**
 * Staff notifications for new website orders: one row in the admin bell and
 * one email to the recipients configured under Settings → Notifications.
 *
 * Idempotent by construction. `admin_notifications` has a unique index on
 * (tenant, kind, entity), so every "this order is now paid" path (Sadad
 * webhook, Sadad browser callback, an admin marking it paid) can call this and
 * only the caller whose insert lands sends the email. Sadad delivers webhooks
 * more than once and the callback races them, so this matters.
 *
 * Never throws: a notification failure must not turn a confirmed payment into
 * an error.
 *
 * Deliberately carries no customer name, address or phone. The bell and the
 * Windows notification show on shared counter screens.
 */

const MAX_RECIPIENTS = 10;
// Deliberately strict: no whitespace, commas or angle brackets, so a stored
// value can never smuggle an extra header or recipient into the mail.
const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

class NotificationSettingsError extends Error {
  constructor(message, details) {
    super(message);
    this.name = 'NotificationSettingsError';
    this.details = details;
  }
}

function normalizeRecipients(input) {
  if (!Array.isArray(input)) throw new NotificationSettingsError('orderEmails must be a list of email addresses.');
  const seen = new Set();
  const emails = [];
  const invalid = [];
  for (const raw of input) {
    const email = String(raw ?? '').trim().toLowerCase();
    if (!email) continue;
    if (email.length > 254 || !EMAIL_RE.test(email)) {
      invalid.push(String(raw));
      continue;
    }
    if (!seen.has(email)) {
      seen.add(email);
      emails.push(email);
    }
  }
  if (invalid.length) throw new NotificationSettingsError(`Not a valid email address: ${invalid.join(', ')}`, { invalid });
  if (emails.length > MAX_RECIPIENTS) throw new NotificationSettingsError(`Up to ${MAX_RECIPIENTS} recipients are allowed.`);
  return emails;
}

async function readNotificationSettings(client, tenantId) {
  const { rows } = await client.query(
    `SELECT config->'notifications' AS notifications FROM tenants WHERE id = $1`,
    [tenantId],
  );
  const stored = rows[0]?.notifications || {};
  let orderEmails = [];
  try {
    orderEmails = normalizeRecipients(Array.isArray(stored.orderEmails) ? stored.orderEmails : []);
  } catch {
    // A hand-edited bad value must not stop the bell row from being written.
    orderEmails = [];
  }
  return {
    orderEmails,
    adminOrigin: typeof stored.adminOrigin === 'string' ? stored.adminOrigin : null,
  };
}

/**
 * Base URL for links back into the admin portal. A paid-order webhook has no
 * browser origin to borrow, so the settings save records the admin's own
 * origin (white-label friendly: no hard-coded domain), with env as fallback.
 */
function adminBaseUrl(settings) {
  const base = settings?.adminOrigin || process.env.ADMIN_ORIGIN || process.env.ADMIN_BASE_URL || 'http://localhost:4300';
  return base.replace(/\/+$/, '');
}

function money(cents, currency = 'QAR') {
  return `${(Number(cents || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function staffEmailHtml({ heading, intro, rows, ctaLabel, ctaUrl }) {
  const rowHtml = rows.map(([label, value]) => `<tr>
      <td style="padding:10px 16px;color:#6b7280;font-size:13px;border-bottom:1px solid #eef0f3">${escapeHtml(label)}</td>
      <td style="padding:10px 16px;color:#111827;font-size:13px;text-align:right;border-bottom:1px solid #eef0f3">${escapeHtml(value)}</td>
    </tr>`).join('');
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
    <body style="margin:0;padding:24px 12px;background:#f5f6f8;font-family:Arial,Helvetica,sans-serif;color:#111827">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:8px">
        <tr><td style="padding:24px 24px 8px">
          <div style="font-size:18px;font-weight:bold;color:#024638">${escapeHtml(heading)}</div>
          <p style="margin:8px 0 0;font-size:14px;line-height:21px;color:#4b5563">${escapeHtml(intro)}</p>
        </td></tr>
        ${rows.length ? `<tr><td style="padding:16px 8px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rowHtml}</table></td></tr>` : ''}
        ${ctaUrl ? `<tr><td style="padding:20px 24px 24px">
          <a href="${escapeHtml(ctaUrl)}" style="display:inline-block;padding:12px 20px;background:#024638;color:#ffffff;text-decoration:none;font-size:14px;font-weight:bold;border-radius:6px">${escapeHtml(ctaLabel)}</a>
        </td></tr>` : ''}
      </table>
    </body></html>`;
}

/**
 * Called after an order is confirmed paid. Only website checkout orders
 * notify; POS sales and manual admin orders do not.
 */
async function notifyNewWebOrder(client, tenantId, orderId) {
  try {
    const orderResult = await client.query(
      `SELECT o.id, o.public_number, o.total_cents, t.currency,
              (SELECT COALESCE(sum(oi.quantity), 0)::int FROM order_items oi WHERE oi.order_id = o.id) AS item_count
         FROM orders o JOIN tenants t ON t.id = o.tenant_id
        WHERE o.tenant_id = $1 AND o.id = $2
          AND o.payment_status = 'paid'
          AND o.metadata->>'source' = 'client-web-checkout'`,
      [tenantId, orderId],
    );
    if (!orderResult.rowCount) return { notified: false, reason: 'not_a_paid_web_order' };
    const order = orderResult.rows[0];
    const currency = order.currency || 'QAR';
    const itemLabel = `${order.item_count} ${order.item_count === 1 ? 'item' : 'items'}`;
    const route = `/orders?id=${order.id}`;

    const inserted = await client.query(
      `INSERT INTO admin_notifications (tenant_id, kind, title, body, route, entity_type, entity_id)
       VALUES ($1, 'order', $2, $3, $4, 'order', $5)
       ON CONFLICT (tenant_id, kind, entity_id) WHERE entity_id IS NOT NULL DO NOTHING
       RETURNING id`,
      [tenantId, `New order ${order.public_number}`, `${itemLabel} · ${money(order.total_cents, currency)}`, route, order.id],
    );
    if (!inserted.rowCount) return { notified: false, skipped: true, reason: 'already_notified' };

    const settings = await readNotificationSettings(client, tenantId);
    if (!settings.orderEmails.length) return { notified: true, emailed: false, reason: 'no_recipients' };

    const itemResult = await client.query(
      `SELECT product_name, size, quantity FROM order_items
        WHERE tenant_id = $1 AND order_id = $2 ORDER BY created_at, id`,
      [tenantId, orderId],
    );
    const lines = itemResult.rows.map((item) => [
      `${item.product_name}${item.size ? ` · ${item.size}` : ''}`,
      `× ${item.quantity}`,
    ]);
    const url = `${adminBaseUrl(settings)}${route}`;
    const subject = `New order ${order.public_number} · ${money(order.total_cents, currency)}`;
    const text = [
      `New website order ${order.public_number}`,
      '',
      ...lines.map(([name, qty]) => `${name} ${qty}`),
      '',
      `Total: ${money(order.total_cents, currency)}`,
      '',
      `Open the order: ${url}`,
    ].join('\n');
    const html = staffEmailHtml({
      heading: `New order ${order.public_number}`,
      intro: `A website order was paid: ${itemLabel}, ${money(order.total_cents, currency)}.`,
      rows: lines,
      ctaLabel: 'Open order',
      ctaUrl: url,
    });

    try {
      await mailer.sendMail({ to: settings.orderEmails.join(', '), subject, text, html });
      return { notified: true, emailed: true, recipients: settings.orderEmails.length };
    } catch (err) {
      logger.warn({ orderId, code: err.code, err: err.message }, 'New-order staff email failed');
      return { notified: true, emailed: false, reason: err.code || 'email_failed' };
    }
  } catch (err) {
    logger.warn({ orderId, err: err.message }, 'New-order staff notification failed');
    return { notified: false, reason: 'error' };
  }
}

/** Throws when SMTP is missing or the send fails, so the Settings page can say why. */
async function sendTestEmail(recipients, { adminOrigin } = {}) {
  const url = adminBaseUrl({ adminOrigin });
  await mailer.sendMail({
    to: recipients.join(', '),
    subject: 'Test: Elite order alerts',
    text: `This is a test from the Elite admin portal. New website orders will be emailed to this address.\n\n${url}/settings`,
    html: staffEmailHtml({
      heading: 'Order alerts are working',
      intro: 'This is a test from the Elite admin portal. New website orders will be emailed to this address.',
      rows: [],
      ctaLabel: 'Open settings',
      ctaUrl: `${url}/settings`,
    }),
  });
}

module.exports = {
  MAX_RECIPIENTS,
  NotificationSettingsError,
  normalizeRecipients,
  readNotificationSettings,
  notifyNewWebOrder,
  sendTestEmail,
};
