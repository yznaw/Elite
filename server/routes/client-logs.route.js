const express = require('express');
const { Router } = require('express');
const { requireAuth } = require('../middleware/require-auth');
const { clientLogLimiter, cspReportLimiter } = require('../middleware/rate-limit');
const { recordError } = require('../lib/error-log');
const { logger } = require('../lib/logger');
const { sendAlert } = require('../lib/alerts');

const router = Router();

const MAX_BATCH = 20;
const MAX_MESSAGE = 2000;
const MAX_STACK = 8000;
const ALLOWED_SOURCES = new Set(['pos-client', 'admin-client']);
const ALLOWED_SEVERITIES = new Set(['error', 'warn']);

/**
 * Print failures per register. In-memory and per-process on purpose: this only
 * decides whether to email someone, and the durable record is app_errors.
 */
const printFailures = new Map();
const PRINT_FAILURE_WINDOW_MS = 4 * 60 * 60 * 1000; // roughly one shift
const PRINT_FAILURE_THRESHOLD = 5;

function truncate(value, max) {
  if (value === null || value === undefined) return null;
  const text = String(value);
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/**
 * Second redaction pass. The browser-side shipper already strips these
 * (client-logger.service.ts), but a log endpoint must not trust its client:
 * anything that reaches the database has to be clean regardless of what was
 * posted, including by an authenticated user with a stale app build.
 */
const SENSITIVE_KEY = /(pin|password|passwd|secret|token|cookie|authorization|csrf|card|pan|cvv)/i;

function scrub(value, depth = 0) {
  if (depth > 4) return '[depth-limit]';
  if (value === null || typeof value !== 'object') {
    return typeof value === 'string' ? truncate(value, 500) : value;
  }
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => scrub(item, depth + 1));
  const out = {};
  for (const [key, raw] of Object.entries(value).slice(0, 30)) {
    out[key] = SENSITIVE_KEY.test(key) ? '[redacted]' : scrub(raw, depth + 1);
  }
  return out;
}

function trackPrintFailure(registerId) {
  if (!registerId) return null;
  const now = Date.now();
  const entries = (printFailures.get(registerId) || []).filter((at) => now - at < PRINT_FAILURE_WINDOW_MS);
  entries.push(now);
  printFailures.set(registerId, entries);
  return entries.length;
}

/**
 * POST /api/client-logs
 *
 * The gap this closes: the register runs in a browser inside the shop. Before
 * this endpoint, an error on the cashier's screen existed only in a DevTools
 * console that closes with the tab — "the screen froze" left literally no
 * evidence to investigate. Entries now land in app_errors alongside server
 * faults, grouped by the same fingerprinting, and visible on the Diagnostics
 * page.
 *
 * Authenticated (any signed-in role, cashier included) and rate limited. The
 * batch shape mirrors what the client buffers in IndexedDB so an offline
 * register can flush everything it accumulated once it reconnects.
 */
router.post('/', clientLogLimiter, requireAuth(), express.json({ limit: '256kb' }), async (req, res) => {
  const entries = Array.isArray(req.body?.entries) ? req.body.entries.slice(0, MAX_BATCH) : [];
  if (!entries.length) {
    return res.status(422).json({ success: false, message: 'entries[] is required.', requestId: req.requestId });
  }

  let accepted = 0;
  for (const entry of entries) {
    const source = ALLOWED_SOURCES.has(entry?.source) ? entry.source : 'admin-client';
    const message = truncate(entry?.message, MAX_MESSAGE);
    if (!message) continue;

    // registerId/shiftId are taken from the session and the posted body:
    // session first, because a client cannot be trusted to name its own
    // register, but the body is accepted as a fallback for a log flushed
    // after the session was re-established on a different visit.
    const registerId = req.session?.posRegisterId || entry?.registerId || null;

    // eslint-disable-next-line no-await-in-loop -- batches are capped at 20 and
    // ordering keeps the fingerprint dedup counters correct.
    await recordError({
      source,
      severity: ALLOWED_SEVERITIES.has(entry?.severity) ? entry.severity : 'error',
      code: truncate(entry?.code, 120),
      message,
      stack: truncate(entry?.stack, MAX_STACK),
      route: truncate(entry?.route || entry?.url, 300),
      httpStatus: Number.isInteger(entry?.httpStatus) ? entry.httpStatus : null,
      // The client's own correlation id when it has one (it reads
      // X-Request-Id off the failed response), otherwise this request's.
      requestId: truncate(entry?.requestId, 64) || req.requestId,
      tenantId: req.user?.tenantId,
      userId: req.user?.id,
      registerId,
      shiftId: entry?.shiftId || null,
      context: scrub({
        ...(entry?.context || {}),
        clientOccurredAt: entry?.occurredAt || null,
        online: entry?.online ?? null,
        pendingSales: entry?.pendingSales ?? null,
        userAgent: truncate(req.headers['user-agent'], 300),
      }),
    });
    accepted += 1;

    if (entry?.code === 'PRINT_FAILED') {
      const count = trackPrintFailure(registerId);
      if (count && count >= PRINT_FAILURE_THRESHOLD) {
        void sendAlert(
          `print-failures:${registerId}`,
          `Repeated receipt-print failures on a register`,
          `${count} print failures reported from register ${registerId} in the last `
          + `${PRINT_FAILURE_WINDOW_MS / 3600000} hour(s).\n\nLast error: ${message}\n\n`
          + 'Sales are still being saved (printing happens after commit), but customers are not '
          + 'getting receipts. Check paper, the printer power/USB, and that QZ Tray is running.',
        );
      }
    }
  }

  res.json({ success: true, data: { accepted }, requestId: req.requestId });
});

/**
 * POST /api/client-logs/csp
 *
 * Sink for the browser's own Content-Security-Policy violation reports.
 *
 * Public and CSRF-exempt by necessity: the browser generates these itself and
 * cannot attach a CSRF header, and a report can fire before any session
 * exists. It is therefore rate limited harder and body-capped tighter than the
 * authenticated endpoint.
 *
 * Why it exists at all: helmet runs CSP in report-only mode with no report
 * destination, so docs/15 Phase 1's "review violation reports before switching
 * CSP to enforcing" gate could never be satisfied — the reports went nowhere.
 */
router.post(
  '/csp',
  cspReportLimiter,
  express.json({ limit: '32kb', type: ['application/csp-report', 'application/reports+json', 'application/json'] }),
  async (req, res) => {
    // Always 204: a browser must never be given a reason to retry, and a
    // malformed report is not worth an error response.
    res.status(204).end();

    try {
      const report = req.body?.['csp-report'] || req.body?.body || req.body || {};
      const directive = truncate(report['effective-directive'] || report.effectiveDirective || report['violated-directive'], 120);
      const blocked = truncate(report['blocked-uri'] || report.blockedURL, 300);
      if (!directive && !blocked) return;

      void recordError({
        source: 'csp',
        severity: 'warn',
        code: directive || 'csp-violation',
        message: `CSP ${directive || 'violation'} blocked ${blocked || 'unknown resource'}`,
        route: truncate(report['document-uri'] || report.documentURL, 300),
        requestId: req.requestId,
        tenantId: req.user?.tenantId,
        context: scrub(report),
      });
    } catch (error) {
      logger.warn({ err: error?.message }, 'CSP report handling failed');
    }
  },
);

module.exports = router;
