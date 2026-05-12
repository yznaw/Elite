const { Router } = require('express');
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const db = require('../db/client');
const { ensureDefaultTenant } = require('../db/tenant');
const { asyncHandler, ok, validationError } = require('./lib');

const router = Router();

const RESET_TOKEN_TTL_MS = 30 * 60 * 1000; // 30 minutes
const MIN_PASSWORD_LENGTH = 8;

function hashToken(rawToken) {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

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

/**
 * POST /api/auth/forgot
 *
 * Always returns 200 — we never leak whether an email is registered. If the
 * account exists, a single-use reset token is created (SHA-256 hashed in the
 * DB) and the reset URL is logged to stdout (in lieu of an email transport,
 * which is not configured for the dev/prototype environment).
 */
router.post(
  '/forgot',
  asyncHandler(async (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!email) return validationError(res, ['Email is required.']);

    const client = await db.pool.connect();
    try {
      const tenant = await ensureDefaultTenant(client);
      const result = await client.query(
        'SELECT id FROM admin_users WHERE tenant_id = $1 AND email = $2 AND status = $3',
        [tenant.id, email, 'active'],
      );

      if (result.rowCount > 0) {
        const userId = result.rows[0].id;
        const rawToken = crypto.randomBytes(32).toString('hex');
        const tokenHash = hashToken(rawToken);
        const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);

        // Invalidate any prior outstanding tokens for this user so a fresh
        // request always supersedes a stale one.
        await client.query(
          'UPDATE password_reset_tokens SET used_at = now() WHERE user_id = $1 AND used_at IS NULL',
          [userId],
        );

        await client.query(
          `
            INSERT INTO password_reset_tokens (
              tenant_id, user_id, token_hash, requested_ip, requested_user_agent, expires_at
            )
            VALUES ($1, $2, $3, $4, $5, $6)
          `,
          [tenant.id, userId, tokenHash, req.ip || null, req.headers['user-agent'] || null, expiresAt],
        );

        // Real deployments would send this via email/SMS. For local dev we
        // log it so the URL is recoverable from the server console.
        const adminBase = process.env.ADMIN_BASE_URL || 'http://localhost:4300';
        const resetUrl = `${adminBase}/reset-password?token=${rawToken}`;
        console.log(`\n[auth] Password reset requested for ${email}`);
        console.log(`[auth] Reset URL (valid 30m): ${resetUrl}\n`);
      }

      ok(res, { sent: true }, 'If that account exists, reset instructions have been sent.');
    } finally {
      client.release();
    }
  }),
);

/**
 * POST /api/auth/reset
 *
 * Body: { token, password }
 * Updates the user's password if the token is valid + unused + unexpired,
 * then marks the token used.
 */
router.post(
  '/reset',
  asyncHandler(async (req, res) => {
    const rawToken = String(req.body?.token || '').trim();
    const password = String(req.body?.password || '');
    if (!rawToken) return validationError(res, ['Reset token is required.']);
    if (password.length < MIN_PASSWORD_LENGTH) {
      return validationError(res, [`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`]);
    }

    const tokenHash = hashToken(rawToken);

    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      const lookup = await client.query(
        `
          SELECT id, user_id, expires_at, used_at
          FROM password_reset_tokens
          WHERE token_hash = $1
          LIMIT 1
        `,
        [tokenHash],
      );

      const row = lookup.rows[0];
      if (!row || row.used_at || new Date(row.expires_at) < new Date()) {
        await client.query('ROLLBACK');
        return res
          .status(400)
          .json({ success: false, message: 'Reset link is invalid or has expired.' });
      }

      const passwordHash = await bcrypt.hash(password, 10);
      await client.query('UPDATE admin_users SET password_hash = $1 WHERE id = $2', [passwordHash, row.user_id]);
      await client.query('UPDATE password_reset_tokens SET used_at = now() WHERE id = $1', [row.id]);
      await client.query('COMMIT');

      ok(res, { reset: true }, 'Password updated. Please sign in.');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }),
);

module.exports = router;
