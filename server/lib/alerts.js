// Required as a module object rather than destructured so tests can substitute
// `sendMail` — destructuring would bind the original function at import time
// and make the dedup behaviour untestable without a real SMTP server.
const mailer = require('./mailer');
const { logger } = require('./logger');

const DEDUP_WINDOW_MS = 60 * 60 * 1000; // one email per alert key per hour
const lastSentAt = new Map();

/**
 * Operational alerting for the few conditions that need a human the same day.
 *
 * Deliberately narrow. Everything else belongs in `app_errors` (queryable,
 * grouped, visible in the admin portal) rather than in an inbox — an alert
 * stream that cries wolf trains the owner to ignore it, which is worse than
 * having no alerts at all.
 *
 * Two hard rules:
 *  1. Deduplicated per `key` for an hour, so a fault that repeats 400 times
 *     sends one email, not 400.
 *  2. Never throws. `mailer.js` raises when SMTP_HOST is unconfigured (dev,
 *     test, and any deployment that has not set SMTP up yet), and an alert
 *     failing must never take down the job that triggered it.
 *
 * No-ops entirely unless ALERT_EMAIL (or BACKUP_ALERT_EMAIL, reused so the
 * backup script's existing configuration covers this too) is set.
 */
function alertRecipient() {
  return process.env.ALERT_EMAIL || process.env.BACKUP_ALERT_EMAIL || '';
}

/**
 * True for tenants that exist only to be tested against.
 *
 * The browser release gate deliberately provokes offline queues, stuck syncs
 * and failed sales. Those are the test doing its job, not an incident, and an
 * alert stream that cries wolf trains the owner to ignore the inbox — worse
 * than no alerts at all (docs/24 D3). Suppressing by tenant rather than by
 * `NODE_ENV` keeps the alerting code itself testable, and still protects a
 * staging box that legitimately has ALERT_EMAIL configured.
 */
function isTestTenant(slug) {
  return /^(pos-browser-e2e|pos-e2e|inv-e2e|cust-e2e|obs-e2e|race-e2e|pos-recon-e2e)/.test(String(slug || ''));
}

function shouldSend(key) {
  const now = Date.now();
  const previous = lastSentAt.get(key) || 0;
  if (now - previous < DEDUP_WINDOW_MS) return false;
  lastSentAt.set(key, now);
  return true;
}

/**
 * @param {string} key    dedup key, e.g. `inventory-drift:elite`
 * @param {string} subject
 * @param {string} body   plain text; keep it actionable, no stack dumps
 * @returns {Promise<{sent:boolean, reason?:string}>} never rejects
 */
async function sendAlert(key, subject, body) {
  const to = alertRecipient();
  if (!to) return { sent: false, reason: 'no_recipient_configured' };
  if (!shouldSend(key)) return { sent: false, reason: 'deduplicated' };

  try {
    await mailer.sendMail({
      to,
      subject: `[Elite alert] ${subject}`,
      text: `${body}\n\nThis is an automated alert from the Elite API.\nAlert key: ${key}`,
    });
    logger.warn({ alertKey: key, subject }, 'operational alert sent');
    return { sent: true };
  } catch (error) {
    // Roll the dedup timestamp back so a transient SMTP failure does not
    // silently swallow the alert for a full hour.
    lastSentAt.delete(key);
    logger.error({ alertKey: key, err: error?.message }, 'operational alert failed to send');
    return { sent: false, reason: error?.code || 'send_failed' };
  }
}

/** Test/maintenance helper — clears the dedup window. */
function resetAlertDedup() {
  lastSentAt.clear();
}

module.exports = { sendAlert, resetAlertDedup, isTestTenant, DEDUP_WINDOW_MS };
