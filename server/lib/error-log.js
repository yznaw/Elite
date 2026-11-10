const crypto = require('node:crypto');
const db = require('../db/client');
const { logger } = require('./logger');

const MAX_MESSAGE = 2000;
const MAX_STACK = 8000;
const VALID_SOURCES = new Set(['server', 'pos-client', 'admin-client', 'csp']);
const VALID_SEVERITIES = new Set(['error', 'warn']);

/**
 * Rolling counter used only to decide when a 5xx surge is worth an email.
 * In-memory and per-process on purpose: this is a "should a human look now"
 * signal, not an accounting record. The durable copy is the app_errors table.
 */
const recentServerErrors = [];
const SURGE_WINDOW_MS = 5 * 60 * 1000;
const SURGE_THRESHOLD = 10;

function truncate(value, max) {
  if (value === null || value === undefined) return null;
  const text = String(value);
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/**
 * First stack frame only. Including the whole stack would make every
 * occurrence of the same fault look unique the moment a line number shifts,
 * which defeats grouping; including nothing would merge unrelated faults that
 * happen to share a message.
 */
function firstFrame(stack) {
  if (!stack) return '';
  const line = String(stack).split('\n').find((l) => l.trim().startsWith('at '));
  return line ? line.trim() : '';
}

function fingerprintOf({ source, code, route, message, stack }) {
  const basis = [source, code || '', route || '', firstFrame(stack) || truncate(message, 200)].join('|');
  return crypto.createHash('sha256').update(basis).digest('hex').slice(0, 32);
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}

/**
 * Records one error occurrence, collapsing repeats onto a single open row.
 *
 * Contract, and the reason this function looks defensive: **it must never be
 * able to affect the caller.** It is invoked from the global error handler and
 * from the client-log endpoint, both of which sit next to money-handling
 * requests. It therefore:
 *   - never throws (every failure is swallowed and logged to pino only),
 *   - never returns a rejected promise to the caller (callers use `void`),
 *   - no-ops without DATABASE_URL, so unit tests and dev without a database
 *     behave exactly as before.
 */
async function recordError(input) {
  try {
    if (!process.env.DATABASE_URL) return null;

    const source = VALID_SOURCES.has(input?.source) ? input.source : 'server';
    const severity = VALID_SEVERITIES.has(input?.severity) ? input.severity : 'error';
    const message = truncate(input?.message || 'Unknown error', MAX_MESSAGE) || 'Unknown error';
    const stack = truncate(input?.stack, MAX_STACK);
    const route = truncate(input?.route, 300);
    const code = truncate(input?.code, 120);
    const fingerprint = fingerprintOf({ source, code, route, message, stack });

    if (source === 'server' && Number(input?.httpStatus) >= 500) noteServerError();

    // ON CONFLICT against the partial unique index on open rows: the database
    // decides insert-vs-increment, so two concurrent occurrences cannot race
    // into two rows the way a read-then-write check would.
    const result = await db.pool.query(
      `INSERT INTO app_errors (
         fingerprint, source, severity, code, message, stack, route, http_status,
         request_id, tenant_id, user_id, register_id, shift_id, context
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb)
       ON CONFLICT (fingerprint) WHERE resolved_at IS NULL DO UPDATE
         SET seen_count = app_errors.seen_count + 1,
             last_seen_at = now(),
             -- Keep the newest occurrence's request id and context so the
             -- freshest reproduction is the one an investigator lands on.
             request_id = COALESCE(EXCLUDED.request_id, app_errors.request_id),
             context = EXCLUDED.context
       RETURNING id, seen_count`,
      [
        fingerprint,
        source,
        severity,
        code,
        message,
        stack,
        route,
        Number.isInteger(input?.httpStatus) ? input.httpStatus : null,
        truncate(input?.requestId, 64),
        isUuid(input?.tenantId) ? input.tenantId : null,
        isUuid(input?.userId) ? input.userId : null,
        isUuid(input?.registerId) ? input.registerId : null,
        isUuid(input?.shiftId) ? input.shiftId : null,
        JSON.stringify(input?.context ?? {}),
      ],
    );
    return result.rows[0] || null;
  } catch (error) {
    // Deliberately terminal: a failure to record an error must not become a
    // second error, or a request that was about to return 500 would instead
    // crash the process.
    logger.warn({ err: error?.message }, 'app_errors write failed');
    return null;
  }
}

function noteServerError() {
  const now = Date.now();
  recentServerErrors.push(now);
  while (recentServerErrors.length && now - recentServerErrors[0] > SURGE_WINDOW_MS) {
    recentServerErrors.shift();
  }
}

/** True when 5xx volume in the surge window crossed the alert threshold. */
function serverErrorSurge() {
  const now = Date.now();
  while (recentServerErrors.length && now - recentServerErrors[0] > SURGE_WINDOW_MS) {
    recentServerErrors.shift();
  }
  return {
    count: recentServerErrors.length,
    surging: recentServerErrors.length >= SURGE_THRESHOLD,
    windowMinutes: SURGE_WINDOW_MS / 60000,
  };
}

module.exports = { recordError, serverErrorSurge, fingerprintOf, SURGE_THRESHOLD };
