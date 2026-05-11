/**
 * Session-based auth middleware. Reads `req.session.user` (populated by
 * the login route) and short-circuits with 401 / 403 if absent or wrong role.
 *
 *   app.use('/api/admin/*', requireAuth());
 *   app.use('/api/admin/settings/team', requireAuth({ roles: ['owner', 'admin'] }));
 */
function requireAuth(options = {}) {
  const allowedRoles = options.roles ? new Set(options.roles) : null;

  return (req, res, next) => {
    const user = req.session && req.session.user;
    if (!user) {
      return res
        .status(401)
        .json({ success: false, message: 'Authentication required.' });
    }
    if (allowedRoles && !allowedRoles.has(user.role)) {
      return res
        .status(403)
        .json({ success: false, message: 'Insufficient permissions.' });
    }
    req.user = user;
    next();
  };
}

module.exports = { requireAuth };
