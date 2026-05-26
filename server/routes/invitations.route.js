const crypto = require('crypto');
const bcrypt = require('bcrypt');
const { Router } = require('express');
const db = require('../db/client');
const { asyncHandler, ok, validationError } = require('./lib');

const router = Router();

router.get('/validate', asyncHandler(async (req, res) => {
  const { token } = req.query;
  if (!token) return validationError(res, ['Token is required.']);
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const client = await db.pool.connect();
  try {
    const result = await client.query(
      'SELECT email, role FROM team_invitations WHERE token_hash=$1 AND expires_at > NOW()',
      [tokenHash],
    );
    if (result.rows.length === 0) {
      return res.status(400).json({ success: false, message: 'Invalid or expired invitation link.' });
    }
    ok(res, result.rows[0]);
  } finally {
    client.release();
  }
}));

router.post('/accept', asyncHandler(async (req, res) => {
  const { token, password, name } = req.body;
  if (!token || !password) return validationError(res, ['Token and password are required.']);
  if (password.length < 8) return validationError(res, ['Password must be at least 8 characters.']);
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const client = await db.pool.connect();
  try {
    const invResult = await client.query(
      'SELECT * FROM team_invitations WHERE token_hash=$1 AND expires_at > NOW()',
      [tokenHash],
    );
    if (invResult.rows.length === 0) {
      return res.status(400).json({ success: false, message: 'Invalid or expired invitation link.' });
    }
    const inv = invResult.rows[0];
    const passwordHash = await bcrypt.hash(password, 10);
    const displayName  = name?.trim() || inv.email.split('@')[0];
    const userInitials = String(displayName).split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]?.toUpperCase()).join('') || 'U';
    await client.query('BEGIN');
    const userResult = await client.query(
      `INSERT INTO admin_users (tenant_id, email, full_name, initials, role, password_hash, status)
       VALUES ($1,$2,$3,$4,$5,$6,'active')
       ON CONFLICT (tenant_id, email) DO UPDATE
       SET full_name=$3, initials=$4, role=$5, password_hash=$6, status='active'
       RETURNING id`,
      [inv.tenant_id, inv.email, displayName, userInitials, inv.role, passwordHash],
    );
    await client.query('DELETE FROM team_invitations WHERE id=$1', [inv.id]);
    await client.query('COMMIT');
    ok(res, { id: userResult.rows[0].id, email: inv.email, role: inv.role }, 'Account created. You can now sign in.');
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw err;
  } finally {
    client.release();
  }
}));

module.exports = router;
