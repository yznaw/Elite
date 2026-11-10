const db = require('../db/client');
const { PosError } = require('./pos/errors');

const MAX_ROWS = 200;

function parseLimit(value) {
  const limit = Number.parseInt(value, 10);
  if (!Number.isFinite(limit) || limit <= 0) return 50;
  return Math.min(limit, MAX_ROWS);
}

/**
 * Grouped error list for the Diagnostics page.
 *
 * Scoped to the caller's tenant, plus rows with no tenant at all — a client
 * error or CSP report can arrive before a session is established, and those
 * are exactly the ones worth seeing (a login screen that fails for everyone
 * would otherwise be invisible). There is one tenant in practice; this keeps
 * the query honest if that changes.
 */
async function listErrors(context, query = {}) {
  const params = [context.tenantId];
  let where = '(e.tenant_id = $1 OR e.tenant_id IS NULL)';

  if (query.status === 'resolved') where += ' AND e.resolved_at IS NOT NULL';
  else if (query.status !== 'all') where += ' AND e.resolved_at IS NULL';

  if (query.source) {
    params.push(query.source);
    where += ` AND e.source = $${params.length}`;
  }
  if (query.severity) {
    params.push(query.severity);
    where += ` AND e.severity = $${params.length}`;
  }
  if (query.search) {
    // Two bindings, not one: the reference code a cashier reads out is an
    // exact request_id, while message/code/route are substring matches. Reusing
    // the %wrapped% pattern for request_id would never match.
    const term = String(query.search).slice(0, 120);
    params.push(`%${term}%`);
    const likeParam = params.length;
    params.push(term);
    const exactParam = params.length;
    where += ` AND (e.message ILIKE $${likeParam} OR e.code ILIKE $${likeParam}`
      + ` OR e.route ILIKE $${likeParam} OR e.request_id = $${exactParam})`;
  }

  params.push(parseLimit(query.limit));
  const { rows } = await db.pool.query(
    `SELECT e.id, e.fingerprint, e.source, e.severity, e.code, e.message, e.stack, e.route,
            e.http_status, e.request_id, e.register_id, e.shift_id, e.context,
            e.seen_count, e.first_seen_at, e.last_seen_at, e.resolved_at,
            u.full_name AS user_name, resolver.full_name AS resolved_by_name
     FROM app_errors e
     LEFT JOIN admin_users u ON u.id = e.user_id
     LEFT JOIN admin_users resolver ON resolver.id = e.resolved_by_user_id
     WHERE ${where}
     ORDER BY e.last_seen_at DESC
     LIMIT $${params.length}`,
    params,
  );

  return rows.map((row) => ({
    errorId: String(row.id),
    fingerprint: row.fingerprint,
    source: row.source,
    severity: row.severity,
    code: row.code,
    message: row.message,
    stack: row.stack,
    route: row.route,
    httpStatus: row.http_status,
    requestId: row.request_id,
    registerId: row.register_id,
    shiftId: row.shift_id,
    context: row.context,
    seenCount: Number(row.seen_count),
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    resolvedAt: row.resolved_at,
    userName: row.user_name,
    resolvedByName: row.resolved_by_name,
  }));
}

/** Counts for the page header, so "is anything wrong right now" is one glance. */
async function errorSummary(context) {
  const { rows } = await db.pool.query(
    `SELECT
       count(*) FILTER (WHERE resolved_at IS NULL)::integer AS open_count,
       count(*) FILTER (WHERE resolved_at IS NULL AND severity = 'error')::integer AS open_error_count,
       count(*) FILTER (WHERE resolved_at IS NULL AND last_seen_at > now() - interval '24 hours')::integer AS open_last_24h,
       COALESCE(sum(seen_count) FILTER (WHERE resolved_at IS NULL), 0)::bigint AS open_occurrences
     FROM app_errors
     WHERE tenant_id = $1 OR tenant_id IS NULL`,
    [context.tenantId],
  );
  const row = rows[0] || {};
  return {
    openCount: Number(row.open_count || 0),
    openErrorCount: Number(row.open_error_count || 0),
    openLast24h: Number(row.open_last_24h || 0),
    openOccurrences: Number(row.open_occurrences || 0),
  };
}

/**
 * Marks one grouped error resolved. Resolving is what lets the partial unique
 * index open a fresh row on the next occurrence, so a regression after a fix
 * shows up as new rather than being folded into the closed group.
 */
async function resolveError(context, errorId) {
  const id = Number.parseInt(errorId, 10);
  if (!Number.isFinite(id)) throw new PosError(422, 'INVALID_ID', 'A numeric error id is required.');

  const { rows } = await db.pool.query(
    `UPDATE app_errors
     SET resolved_at = now(), resolved_by_user_id = $2
     WHERE id = $1 AND (tenant_id = $3 OR tenant_id IS NULL) AND resolved_at IS NULL
     RETURNING id`,
    [id, context.userId, context.tenantId],
  );
  if (!rows.length) throw new PosError(404, 'ERROR_NOT_FOUND', 'That error is already resolved or does not exist.');
  return { errorId: String(rows[0].id), resolved: true };
}

/**
 * Audit-trail reader.
 *
 * `audit_events` has been written since migration 001 and had no UI at all, so
 * the audit trail required psql to read — effectively unreachable for the
 * owner it exists to protect. Filterable by action/entity, and by request_id so
 * a reference code from a cashier's error toast resolves straight to what the
 * request actually did.
 */
async function listAuditEvents(context, query = {}) {
  const params = [context.tenantId];
  let where = 'a.tenant_id = $1';

  if (query.action) {
    params.push(`%${String(query.action).slice(0, 120)}%`);
    where += ` AND a.action ILIKE $${params.length}`;
  }
  if (query.entityType) {
    params.push(query.entityType);
    where += ` AND a.entity_type = $${params.length}`;
  }
  if (query.requestId) {
    params.push(String(query.requestId).slice(0, 64));
    where += ` AND a.request_id = $${params.length}`;
  }
  if (query.from) {
    params.push(query.from);
    where += ` AND a.occurred_at >= $${params.length}::date`;
  }
  if (query.to) {
    params.push(query.to);
    where += ` AND a.occurred_at < ($${params.length}::date + interval '1 day')`;
  }

  params.push(parseLimit(query.limit));
  const { rows } = await db.pool.query(
    `SELECT a.id, a.action, a.entity_type, a.entity_id, a.occurred_at, a.request_id,
            a.ip_address, a.actor_user_id, u.full_name AS actor_name, u.role AS actor_role,
            a.before_state, a.after_state
     FROM audit_events a
     LEFT JOIN admin_users u ON u.id = a.actor_user_id
     WHERE ${where}
     ORDER BY a.occurred_at DESC
     LIMIT $${params.length}`,
    params,
  );

  return rows.map((row) => ({
    auditId: row.id,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    occurredAt: row.occurred_at,
    requestId: row.request_id,
    ipAddress: row.ip_address,
    actorId: row.actor_user_id,
    actorName: row.actor_name,
    actorRole: row.actor_role,
    beforeState: row.before_state,
    afterState: row.after_state,
  }));
}

/** Distinct action names, so the UI filter is a real list and not free text. */
async function auditActions(context) {
  const { rows } = await db.pool.query(
    `SELECT DISTINCT action FROM audit_events WHERE tenant_id = $1 ORDER BY action LIMIT 200`,
    [context.tenantId],
  );
  return rows.map((row) => row.action);
}

module.exports = { listErrors, errorSummary, resolveError, listAuditEvents, auditActions };
