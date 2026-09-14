const { randomUUID } = require('node:crypto');
const db = require('../db/client');
const mailer = require('./mailer');
const alerts = require('./alerts');
const { logger } = require('./logger');
const { stockSql } = require('./restock-notifications');
const { storefrontBaseUrl, buildRestockEmail } = require('./restock-email');
const BACKOFF_MINUTES = [5, 30, 120, 720];
let lastConfigAlert = 0;
let lastCleanupDay = '';

async function cleanupRestockNotifications(pool = db.pool) {
  return pool.query(`DELETE FROM restock_notifications
    WHERE (status IN ('notified','cancelled','failed') AND updated_at < now() - interval '180 days')
       OR (status = 'pending' AND requested_at < now() - interval '365 days')`);
}
async function reportConfigurationError(message, alert = alerts.sendAlert) {
  logger.error({ code: 'RESTOCK_CONFIGURATION' }, message);
  if (Date.now() - lastConfigAlert >= 86400000) {
    lastConfigAlert = Date.now();
    await alert('restock-configuration', 'Restock emails are blocked', `${message}\nConfigure STOREFRONT_BASE_URL and SMTP_HOST/SMTP_FROM, then check Restock Requests.`);
  }
}
async function runRestockDispatch({ pool = db.pool, sendMail = mailer.sendMail, smtpConfigured = Boolean(process.env.SMTP_HOST), productIds = null, beforeSend, alert = alerts.sendAlert } = {}) {
  const summary = { sent: 0, failed: 0, claimed: 0, deferred: 0 };
  // Recover crashed owners; clear their token so a late completion cannot update a new claim.
  await pool.query(`UPDATE restock_notifications SET status = 'pending', claimed_at = NULL, claim_token = NULL
    WHERE status = 'sending' AND claimed_at < now() - interval '15 minutes'`);
  await pool.query(`UPDATE restock_notifications rn SET status = 'cancelled', claimed_at = NULL, claim_token = NULL
    FROM products p WHERE p.id = rn.product_id AND p.tenant_id = rn.tenant_id AND p.status <> 'active' AND rn.status IN ('pending','sending')`);
  const day = new Date().toISOString().slice(0, 10);
  if (day !== lastCleanupDay) { await cleanupRestockNotifications(pool); lastCleanupDay = day; }
  let base;
  try { base = storefrontBaseUrl(); } catch (error) { await reportConfigurationError(error.message, alert); return summary; }
  if (!smtpConfigured) { await reportConfigurationError('SMTP_HOST is not configured; restock requests remain pending.', alert); return summary; }
  const token = randomUUID();
  const claimed = await pool.query(`UPDATE restock_notifications rn
    SET status = 'sending', claimed_at = now(), claim_token = $1
    WHERE rn.id IN (
      SELECT rn.id FROM restock_notifications rn JOIN products p ON p.id = rn.product_id AND p.tenant_id = rn.tenant_id
      WHERE rn.status = 'pending' AND rn.next_attempt_at <= now() AND p.status = 'active'
        AND ($2::uuid[] IS NULL OR rn.product_id = ANY($2::uuid[])) AND ${stockSql()} > 0
      ORDER BY rn.requested_at, rn.id LIMIT 50 FOR UPDATE OF rn SKIP LOCKED
    ) RETURNING rn.id`, [token, productIds?.length ? productIds : null]);
  summary.claimed = claimed.rowCount;
  // Keep the whole bounded batch leased while SMTP is slow. Claim-token guards
  // also protect against cancellation, recovery and a worker completing late.
  const heartbeat = setInterval(() => {
    void pool.query("UPDATE restock_notifications SET claimed_at = now() WHERE claim_token = $1 AND status = 'sending'", [token])
      .catch(error => logger.error({ err: error.message }, 'restock claim heartbeat failed'));
  }, 30000);
  heartbeat.unref?.();
  try {
    for (const row of claimed.rows) {
      if (beforeSend) await beforeSend(row.id);
      const result = await pool.query(`SELECT rn.*, p.name AS product_name, pt.name AS product_name_ar,
        p.base_price_cents, COALESCE(m.preview_url, m.storage_url, (SELECT COALESCE(ma.preview_url, ma.storage_url)
          FROM media_links ml JOIN media_assets ma ON ma.id = ml.media_id WHERE ml.product_id = p.id ORDER BY ml.sort_order LIMIT 1)) AS product_image,
        (SELECT rc.name_ar FROM ref_colors rc WHERE rc.tenant_id = p.tenant_id AND restock_color_key(rc.name_en) = rn.color_key LIMIT 1) AS color_name_ar,
        p.status = 'active' AND ${stockSql()} > 0 AS in_stock
        FROM restock_notifications rn JOIN products p ON p.id = rn.product_id AND p.tenant_id = rn.tenant_id
        LEFT JOIN product_translations pt ON pt.product_id = p.id AND pt.locale = 'ar'
        LEFT JOIN media_assets m ON m.id = p.primary_media_id
        WHERE rn.id = $1 AND rn.status = 'sending' AND rn.claim_token = $2`, [row.id, token]);
      const n = result.rows[0];
      if (!n) continue;
      if (!n.in_stock) {
        await pool.query("UPDATE restock_notifications SET status = 'pending', claimed_at = NULL, claim_token = NULL WHERE id = $1 AND claim_token = $2 AND status = 'sending'", [n.id, token]);
        summary.deferred++;
        continue;
      }
      try {
        await sendMail({ to: n.email, ...buildRestockEmail(n, base), messageId: `<restock-${n.id}@${new URL(base).hostname}>` });
      } catch (error) {
        if (error.code === 'SMTP_NOT_CONFIGURED') {
          await pool.query("UPDATE restock_notifications SET status = 'pending', claimed_at = NULL, claim_token = NULL WHERE claim_token = $1 AND status = 'sending'", [token]);
          await reportConfigurationError(error.message, alert);
          break;
        }
        const attempts = n.attempts + 1;
        await pool.query(`UPDATE restock_notifications SET status = $3, attempts = $4, last_error = $5,
          next_attempt_at = now() + $6 * interval '1 minute', claimed_at = NULL, claim_token = NULL
          WHERE id = $1 AND claim_token = $2 AND status = 'sending'`,
        [n.id, token, attempts >= 5 ? 'failed' : 'pending', attempts, String(error.message || 'Mail delivery failed').slice(0, 1000), BACKOFF_MINUTES[Math.min(attempts - 1, 3)]]);
        logger.warn({ requestId: n.id, attempts }, 'restock email failed');
        summary.failed++;
        continue;
      }
      // A DB failure after SMTP acceptance must leave the lease recoverable,
      // rather than counting it as an SMTP failure and immediately resending.
      await pool.query(`UPDATE restock_notifications SET status = 'notified', notified_at = now(), last_error = NULL,
        claimed_at = NULL, claim_token = NULL WHERE id = $1 AND claim_token = $2 AND status = 'sending'`, [n.id, token]);
      summary.sent++;
    }
  } finally { clearInterval(heartbeat); }
  return summary;
}
let scheduler = null;
function kickRestockDispatch(productIds = []) { scheduler?.(productIds); }
function startRestockDispatchJob() {
  try { storefrontBaseUrl(); } catch (error) { logger.error({ code: 'RESTOCK_CONFIGURATION' }, error.message); }
  if (!process.env.DATABASE_URL || process.env.NODE_ENV === 'test') return () => {};
  let running = false, stopped = false, queued = false, immediate;
  const run = async () => {
    if (stopped) return;
    if (running) { queued = true; return; }
    running = true;
    try { await runRestockDispatch(); } catch (error) { logger.error({ err: error.message }, 'restock dispatcher failed'); }
    finally {
      running = false;
      if (queued && !stopped) { queued = false; schedule(); }
    }
  };
  // Coalesce bursts and always include all due products, preventing starvation
  // when a fast path fires while a periodic run is already in flight.
  const schedule = () => {
    if (!immediate && !stopped) {
      immediate = setTimeout(() => { immediate = null; void run(); }, 100);
      immediate.unref?.();
    }
  };
  scheduler = schedule;
  const timer = setInterval(() => void run(), 120000);
  timer.unref?.();
  schedule();
  return () => { stopped = true; clearInterval(timer); clearTimeout(immediate); if (scheduler === schedule) scheduler = null; };
}
module.exports = { runRestockDispatch, kickRestockDispatch, startRestockDispatchJob, cleanupRestockNotifications, BACKOFF_MINUTES };
