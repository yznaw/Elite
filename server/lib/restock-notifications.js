const { ensureRestockNotificationsSchema } = require('../db/restock-notifications-schema');
const { sendMail } = require('./mailer');

function normalizeColor(value) {
  return String(value || '').trim().toLowerCase();
}

function productUrl(productId) {
  const base = (process.env.STOREFRONT_BASE_URL || process.env.CLIENT_BASE_URL || 'http://localhost:4200').replace(/\/+$/, '');
  return `${base}/product/${productId}`;
}

function buildRestockEmail(notification) {
  const colorLine = notification.color ? `Color: ${notification.color}\n` : '';
  const link = productUrl(notification.product_id);
  const subject = `${notification.product_name} is back in stock`;
  const text = [
    `Good news${notification.name ? `, ${notification.name}` : ''}.`,
    '',
    `${notification.product_name} is available again in size ${notification.size}.`,
    colorLine.trim(),
    '',
    `Shop it here: ${link}`,
    '',
    'Elite',
  ].filter(Boolean).join('\n');

  return { subject, text };
}

async function createRestockNotification(client, tenantId, input) {
  await ensureRestockNotificationsSchema(client);

  const inserted = await client.query(
    `
      INSERT INTO restock_notifications (
        tenant_id, product_id, email, name, phone, size, color, locale
      )
      VALUES ($1, $2, $3, $4, $5, $6, NULLIF($7, ''), $8)
      ON CONFLICT (tenant_id, product_id, email, size, lower(COALESCE(color, '')))
      WHERE status = 'pending'
      DO UPDATE SET
        name = COALESCE(EXCLUDED.name, restock_notifications.name),
        phone = COALESCE(EXCLUDED.phone, restock_notifications.phone),
        locale = EXCLUDED.locale,
        requested_at = now(),
        last_error = NULL,
        updated_at = now()
      RETURNING id, status, requested_at
    `,
    [
      tenantId,
      input.productId,
      input.email,
      input.name || null,
      input.phone || null,
      String(input.size),
      String(input.color || '').trim(),
      input.locale || 'en',
    ],
  );

  return inserted.rows[0];
}

async function processRestockNotifications(client, tenantId, productId) {
  await ensureRestockNotificationsSchema(client);

  const pending = await client.query(
    `
      SELECT
        rn.*,
        p.name AS product_name
      FROM restock_notifications rn
      JOIN products p ON p.id = rn.product_id
      WHERE rn.tenant_id = $1
        AND rn.product_id = $2
        AND rn.status = 'pending'
        AND EXISTS (
          SELECT 1
          FROM product_variants pv
          WHERE pv.product_id = rn.product_id
            AND pv.is_active = true
            AND pv.stock_quantity > 0
            AND pv.size = rn.size
            AND (
              rn.color IS NULL
              OR rn.color = ''
              OR lower(COALESCE(pv.color, '')) = lower(rn.color)
            )
        )
      ORDER BY rn.requested_at
    `,
    [tenantId, productId],
  );

  const summary = { sent: 0, failed: 0, pending: pending.rowCount };

  for (const notification of pending.rows) {
    const email = buildRestockEmail(notification);
    try {
      await sendMail({
        to: notification.email,
        subject: email.subject,
        text: email.text,
      });

      await client.query(
        `
          UPDATE restock_notifications
          SET status = 'notified',
              notified_at = now(),
              last_error = NULL,
              updated_at = now()
          WHERE id = $1
        `,
        [notification.id],
      );
      summary.sent += 1;
    } catch (err) {
      await client.query(
        `
          UPDATE restock_notifications
          SET last_error = $2,
              updated_at = now()
          WHERE id = $1
        `,
        [notification.id, err.message || 'Failed to send restock email.'],
      );
      summary.failed += 1;
      if (err.code !== 'SMTP_NOT_CONFIGURED') {
        console.warn(`[restock] Failed to email ${notification.email}: ${err.message}`);
      }
    }
  }

  return summary;
}

function variantKey(variant) {
  return `${String(variant.size || '').trim()}::${normalizeColor(variant.color)}`;
}

function hasRestockedVariant(beforeVariants, afterVariants) {
  const beforeStockByKey = new Map();
  beforeVariants.forEach((variant) => {
    beforeStockByKey.set(variantKey(variant), Number(variant.stock || 0));
  });

  return afterVariants.some((variant) => {
    const key = variantKey(variant);
    return (beforeStockByKey.get(key) || 0) <= 0 && Number(variant.stock || 0) > 0;
  });
}

module.exports = {
  createRestockNotification,
  hasRestockedVariant,
  processRestockNotifications,
};
