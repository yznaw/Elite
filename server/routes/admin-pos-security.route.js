const { Router } = require('express');
const crypto = require('node:crypto');
const db = require('../db/client');
const { asyncHandler, ok } = require('./lib');
const { PosError } = require('../lib/pos/errors');
const {
  createReplacementToken,
  listAllRegisters,
  revokeRegister,
  setRegisterBranch,
  listEnrollmentTokens,
  revokeEnrollmentToken,
} = require('../lib/pos/register-service');
const { listManagerPins, clearManagerPin } = require('../lib/pos/manager-service');
const { getPosPolicy, updatePosPolicy } = require('../lib/pos/policy-service');

const router = Router();

function publicSessionId(sessionId) {
  return crypto
    .createHmac('sha256', process.env.SESSION_SECRET || 'elite-dev-session-secret')
    .update(String(sessionId))
    .digest('base64url');
}

function context(req) {
  return {
    tenantId: req.user.tenantId,
    userId: req.user.id,
    role: req.user.role,
    ip: req.ip,
    userAgent: req.headers['user-agent'] || null,
    // This router writes audit_events (enrollment tokens, manager PINs), so it
    // carries the correlation id too — docs/24, Phase A.
    requestId: req.requestId || null,
  };
}

router.get('/registers', asyncHandler(async (req, res) => {
  ok(res, await listAllRegisters(context(req)));
}));

router.post('/registers/:id/revoke', asyncHandler(async (req, res) => {
  ok(res, await revokeRegister(context(req), req.params.id));
}));

router.post('/registers/:id/replacement-token', asyncHandler(async (req, res) => {
  ok(res, await createReplacementToken(context(req), req.params.id));
}));

router.put('/registers/:id/branch', asyncHandler(async (req, res) => {
  ok(res, await setRegisterBranch(context(req), req.params.id, req.body?.branchId ?? null));
}));

router.get('/enrollment-tokens', asyncHandler(async (req, res) => {
  ok(res, await listEnrollmentTokens(context(req)));
}));

router.post('/enrollment-tokens/:id/revoke', asyncHandler(async (req, res) => {
  ok(res, await revokeEnrollmentToken(context(req), req.params.id));
}));

router.get('/manager-pins', asyncHandler(async (req, res) => {
  ok(res, await listManagerPins(context(req)));
}));

router.post('/manager-pins/:userId/clear', asyncHandler(async (req, res) => {
  ok(res, await clearManagerPin(context(req), req.params.userId));
}));

router.get('/policy', asyncHandler(async (req, res) => {
  ok(res, await getPosPolicy(context(req)));
}));

router.put('/policy', asyncHandler(async (req, res) => {
  ok(res, await updatePosPolicy(context(req), req.body));
}));

router.get('/sessions', asyncHandler(async (req, res) => {
  const result = await db.query(
    `SELECT sid,
            expire,
            sess::jsonb -> 'user' ->> 'id' AS user_id,
            sess::jsonb -> 'user' ->> 'name' AS user_name,
            sess::jsonb -> 'user' ->> 'role' AS role,
            sess::jsonb -> 'sessionMeta' ->> 'createdAt' AS created_at,
            sess::jsonb -> 'sessionMeta' ->> 'lastSeenAt' AS last_seen_at,
            sess::jsonb -> 'sessionMeta' ->> 'ip' AS ip,
            sess::jsonb -> 'sessionMeta' ->> 'userAgent' AS user_agent,
            sess::jsonb ->> 'posRegisterId' AS register_id
       FROM admin_sessions
      WHERE sess::jsonb -> 'user' ->> 'tenantId' = $1
        AND expire > now()
      ORDER BY expire DESC`,
    [req.user.tenantId],
  );
  ok(res, result.rows.map((row) => ({
    // Never expose the bearer session id itself. This stable HMAC can identify
    // a row for revocation but cannot be replayed as a login cookie.
    sessionId: publicSessionId(row.sid),
    userId: row.user_id,
    userName: row.user_name,
    role: row.role,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    expiresAt: row.expire,
    ip: row.ip,
    userAgent: row.user_agent,
    registerId: row.register_id,
  })));
}));

router.post('/sessions/:id/revoke', asyncHandler(async (req, res) => {
  if (req.params.id === publicSessionId(req.sessionID)) {
    await new Promise((resolve, reject) => req.session.destroy((error) => (error ? reject(error) : resolve())));
    res.clearCookie(process.env.SESSION_COOKIE_NAME || 'elite.sid');
    ok(res, { sessionId: req.params.id, revoked: true });
    return;
  }
  const candidates = await db.query(
    `SELECT sid FROM admin_sessions
      WHERE sess::jsonb -> 'user' ->> 'tenantId' = $1 AND expire > now()`,
    [req.user.tenantId],
  );
  const match = candidates.rows.find((row) => publicSessionId(row.sid) === req.params.id);
  const result = match
    ? await db.query('DELETE FROM admin_sessions WHERE sid = $1 RETURNING sid', [match.sid])
    : { rowCount: 0 };
  ok(res, { sessionId: req.params.id, revoked: result.rowCount === 1 });
}));

// PosError shaping lives in the global error handler in index.js — see the
// note in pos.route.js. A router-local responder here would bypass the
// correlation id, the app_errors record and the structured log line.

module.exports = router;
