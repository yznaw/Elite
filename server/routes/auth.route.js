const { Router } = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db/client');
const { ensureDefaultTenant } = require('../db/tenant');
const { asyncHandler, ok, validationError } = require('./lib');

const router = Router();

function publicUser(row, tenantSlug) {
  return {
    id: row.id,
    email: row.email,
    name: row.full_name,
    initials: row.initials,
    role: row.role,
    tenantId: row.tenant_id,
    tenantSlug: tenantSlug || null,
  };
}

router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    if (!email || !password) {
      return validationError(res, ['Email and password are required.']);
    }

    const client = await db.pool.connect();
    try {
      const tenant = await ensureDefaultTenant(client);
      const result = await client.query(
        `
          SELECT id, tenant_id, email, password_hash, full_name, initials, role, status
          FROM admin_users
          WHERE tenant_id = $1 AND email = $2
          LIMIT 1
        `,
        [tenant.id, email],
      );

      const user = result.rows[0];
      if (!user || !user.password_hash) {
        return res.status(401).json({ success: false, message: 'Invalid email or password.' });
      }
      if (user.status !== 'active') {
        return res.status(403).json({ success: false, message: 'Account is not active.' });
      }

      const match = await bcrypt.compare(password, user.password_hash);
      if (!match) {
        return res.status(401).json({ success: false, message: 'Invalid email or password.' });
      }

      await client.query(
        'UPDATE admin_users SET last_login_at = now() WHERE id = $1',
        [user.id],
      );

      const session = req.session;
      session.user = publicUser(user, tenant.slug);
      session.save((err) => {
        if (err) {
          return res.status(500).json({ success: false, message: 'Failed to start session.' });
        }
        ok(res, session.user, 'Logged in.');
      });
    } finally {
      client.release();
    }
  }),
);

router.get(
  '/me',
  asyncHandler(async (req, res) => {
    if (!req.session || !req.session.user) {
      return res.status(401).json({ success: false, message: 'Not authenticated.' });
    }
    ok(res, req.session.user);
  }),
);

router.post(
  '/logout',
  asyncHandler(async (req, res) => {
    if (!req.session) return ok(res, { success: true }, 'Already logged out.');
    req.session.destroy((err) => {
      if (err) {
        return res.status(500).json({ success: false, message: 'Failed to log out.' });
      }
      res.clearCookie(process.env.SESSION_COOKIE_NAME || 'elite.sid');
      ok(res, { success: true }, 'Logged out.');
    });
  }),
);

module.exports = router;
