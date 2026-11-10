/**
 * Session-based auth middleware. Reads `req.session.user` (populated by
 * the login route) and short-circuits with 401 / 403 if absent or wrong role.
 *
 *   app.use('/api/admin/*', requireAuth());
 *   app.use('/api/admin/settings/team', requireAuth({ roles: ['owner', 'admin'] }));
 */
const db = require('../db/client');

function requireAuth(options = {}) {
  const allowedRoles = options.roles ? new Set(options.roles) : null;

  return async (req, res, next) => {
    const sessionUser = req.session && req.session.user;
    if (!sessionUser) {
      return res
        .status(401)
        .json({ success: false, message: 'Authentication required.' });
    }

    try {
      // Status and role are security controls, so never trust the login-time
      // snapshot for the lifetime of a rolling session. This makes disable,
      // remove and role changes effective on the very next request.
      const result = await db.query(
        `SELECT id, tenant_id, email, full_name, initials, role, status
           FROM admin_users
          WHERE id = $1 AND tenant_id = $2
          LIMIT 1`,
        [sessionUser.id, sessionUser.tenantId],
      );
      const row = result.rows[0];
      if (!row || row.status !== 'active') {
        req.session.destroy(() => undefined);
        res.clearCookie(process.env.SESSION_COOKIE_NAME || 'elite.sid');
        return res.status(401).json({
          success: false,
          code: 'ACCOUNT_INACTIVE',
          message: 'This account is no longer active. Sign in with an active account.',
        });
      }

      const user = {
        id: row.id,
        email: row.email,
        name: row.full_name,
        initials: row.initials,
        role: row.role,
        tenantId: row.tenant_id,
        tenantSlug: sessionUser.tenantSlug || null,
      };
      // Keep nested role middleware and /auth/me on the fresh values during
      // this request, and persist them naturally with the rolling session.
      req.session.user = user;
      if (req.session.sessionMeta) req.session.sessionMeta.lastSeenAt = new Date().toISOString();

      if (allowedRoles && !allowedRoles.has(user.role)) {
        return res
          .status(403)
          .json({ success: false, message: 'Insufficient permissions.' });
      }
      req.user = user;
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

module.exports = { requireAuth };
