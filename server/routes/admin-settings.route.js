const crypto = require('crypto');
const { Router } = require('express');
const db = require('../db/client');
const { ensureDefaultTenant } = require('../db/tenant');
const { asyncHandler, created, notFound, ok, validationError } = require('./lib');
const { sendInvitationEmail } = require('../lib/invitation-email');
const { requireAuth } = require('../middleware/require-auth');
const { PosError } = require('../lib/pos/errors');

const router = Router();

// This router mixes broad-read endpoints (any authenticated role can GET
// store settings / team / integrations / invitations — see index.js's
// mount comment) with owner/admin-only writes. requireAuth() at the
// router-mount level only proves "logged in," so every write route below
// applies this explicitly — it was previously missing entirely, meaning
// the client's roleGuard(['owner','admin']) on the /settings route was the
// *only* thing stopping a manager/cashier/viewer session from calling
// these directly (docs/32-permission-enforcement-ux-design.md §1).
const ownerOrAdmin = requireAuth({ roles: ['owner', 'admin'] });

router.get('/store', asyncHandler(async (_req, res) => {
  const client = await db.pool.connect();
  try {
    const tenant = await ensureDefaultTenant(client);
    const result = await client.query(
      `
        SELECT t.slug, t.name, t.currency, t.timezone, t.config, bp.*, ss.*
        FROM tenants t
        LEFT JOIN brand_profiles bp ON bp.tenant_id = t.id
        LEFT JOIN store_settings ss ON ss.tenant_id = t.id
        WHERE t.id = $1
      `,
      [tenant.id],
    );
    ok(res, result.rows[0]);
  } finally {
    client.release();
  }
}));

router.patch('/store', ownerOrAdmin, asyncHandler(async (req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const tenant = await ensureDefaultTenant(client);
    await client.query(
      `
        UPDATE tenants
        SET name = COALESCE($2, name),
            currency = COALESCE($3, currency),
            timezone = COALESCE($4, timezone),
            config = config || COALESCE($5::jsonb, '{}'::jsonb)
        WHERE id = $1
      `,
      [tenant.id, req.body.name, req.body.currency, req.body.timezone, req.body.config ? JSON.stringify(req.body.config) : null],
    );
    await client.query(
      `
        UPDATE store_settings
        SET store_name = COALESCE($2, store_name),
            contact_email = COALESCE($3, contact_email),
            support_phone = COALESCE($4, support_phone),
            checkout_enabled = COALESCE($5, checkout_enabled)
        WHERE tenant_id = $1
      `,
      [tenant.id, req.body.storeName || req.body.name, req.body.contactEmail, req.body.supportPhone, req.body.checkoutEnabled],
    );
    // logoUrl is a distinct key (not COALESCE-skippable like the fields
    // above) because "remove the logo" is a valid action — the client sends
    // an explicit null to clear it, which must not be treated as "field
    // omitted, keep existing value."
    if (req.body.logoUrl !== undefined) {
      await client.query(
        `
          INSERT INTO brand_profiles (tenant_id, logo_url)
          VALUES ($1, $2)
          ON CONFLICT (tenant_id) DO UPDATE SET logo_url = EXCLUDED.logo_url
        `,
        [tenant.id, req.body.logoUrl],
      );
    }
    await client.query('COMMIT');
    ok(res, { tenantId: tenant.id }, 'Store settings updated.');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}));

router.get('/team', asyncHandler(async (_req, res) => {
  const client = await db.pool.connect();
  try {
    const tenant = await ensureDefaultTenant(client);
    const result = await client.query(
      `SELECT u.id, u.full_name AS name, u.email, u.role, u.initials, u.created_at AS joined,
              u.status, u.last_login_at,
              u.pos_branch_id AS "posBranchId", b.name AS "posBranchName"
         FROM admin_users u
         LEFT JOIN pos_branches b ON b.id = u.pos_branch_id AND b.tenant_id = u.tenant_id
        WHERE u.tenant_id = $1 AND u.status != 'removed'
        ORDER BY u.created_at`,
      [tenant.id],
    );
    ok(res, result.rows);
  } finally {
    client.release();
  }
}));

router.post('/team', ownerOrAdmin, asyncHandler(async (req, res) => {
  if (!req.body.email || !req.body.name) return validationError(res, ['Team member name and email are required.']);
  const role = normalizeRole(req.body.role);
  if (!role) return validationError(res, [`Role must be one of: ${ASSIGNABLE_ROLES.join(', ')}.`]);
  if (!canAssignRole(req.user.role, role)) return validationError(res, ['Only the owner can grant the owner role.']);
  const client = await db.pool.connect();
  try {
    const tenant = await ensureDefaultTenant(client);
    const result = await client.query(
      `
        INSERT INTO admin_users (tenant_id, email, full_name, initials, role, status)
        VALUES ($1, $2, $3, $4, $5, 'active')
        ON CONFLICT (tenant_id, email) DO UPDATE
        SET full_name = EXCLUDED.full_name,
            initials = EXCLUDED.initials,
            role = EXCLUDED.role,
            status = 'active'
        RETURNING id, full_name AS name, email, role, initials, created_at AS joined, status
      `,
      [tenant.id, req.body.email, req.body.name, req.body.initials || initials(req.body.name), role],
    );
    created(res, result.rows[0], 'Team member saved.');
  } finally {
    client.release();
  }
}));

router.patch('/team/:id', ownerOrAdmin, asyncHandler(async (req, res) => {
  let role = null;
  if (req.body.role) {
    role = normalizeRole(req.body.role);
    if (!role) return validationError(res, [`Role must be one of: ${ASSIGNABLE_ROLES.join(', ')}.`]);
    if (!canAssignRole(req.user.role, role)) return validationError(res, ['Only the owner can grant the owner role.']);
  }
  // Which branch this person works at, and so which tills the POS picker
  // offers them (migration 035). Three states, hence the explicit flag: absent
  // from the body means "leave it alone", null means "clear it, they work
  // across all branches", an id means "scope them to that branch".
  const branchProvided = Object.prototype.hasOwnProperty.call(req.body, 'posBranchId');
  const posBranchId = branchProvided ? (req.body.posBranchId || null) : null;
  const client = await db.pool.connect();
  try {
    const tenant = await ensureDefaultTenant(client);
    const removesPosAccess = req.body.status === 'disabled'
      || req.body.status === 'removed'
      || role === 'viewer';
    if (removesPosAccess || branchProvided) {
      const activeShift = await client.query(
        `SELECT id, state FROM pos_shifts
          WHERE tenant_id = $1 AND cashier_id = $2 AND state IN ('open', 'closing')
          LIMIT 1`,
        [tenant.id, req.params.id],
      );
      if (activeShift.rowCount) {
        throw new PosError(
          409,
          'USER_HAS_ACTIVE_SHIFT',
          'Close and reconcile this user\'s active POS shift before disabling, removing, moving branches, or removing POS access.',
          { shiftId: activeShift.rows[0].id, shiftState: activeShift.rows[0].state },
        );
      }
    }
    if (branchProvided && posBranchId) {
      const branch = await client.query(
        'SELECT 1 FROM pos_branches WHERE tenant_id = $1 AND id = $2',
        [tenant.id, posBranchId],
      );
      if (branch.rowCount === 0) return validationError(res, ['That branch does not exist.']);
    }
    const result = await client.query(
      `
        UPDATE admin_users u
        SET full_name = COALESCE($3, u.full_name),
            email = COALESCE($4, u.email),
            role = COALESCE($5, u.role),
            status = COALESCE($6, u.status),
            pos_branch_id = CASE WHEN $7 THEN $8::uuid ELSE u.pos_branch_id END
        WHERE u.tenant_id = $1 AND u.id = $2
        RETURNING u.id, u.full_name AS name, u.email, u.role, u.initials,
                  u.created_at AS joined, u.status, u.pos_branch_id AS "posBranchId"
      `,
      [tenant.id, req.params.id, req.body.name, req.body.email, role, req.body.status, branchProvided, posBranchId],
    );
    if (result.rowCount === 0) return notFound(res, 'Team member not found.');
    const row = result.rows[0];
    if (req.body.status === 'disabled' || req.body.status === 'removed') {
      // Defense in depth with requireAuth's live status check: remove every
      // existing browser session now so the account disappears immediately,
      // including from idle tabs that would otherwise wait for their next API
      // request to discover the status change.
      await client.query(
        `DELETE FROM admin_sessions
          WHERE sess::jsonb -> 'user' ->> 'id' = $1`,
        [row.id],
      );
      if (row.id === req.user.id) req.session.destroy(() => undefined);
    }
    if (row.posBranchId) {
      const branch = await client.query('SELECT name FROM pos_branches WHERE id = $1', [row.posBranchId]);
      row.posBranchName = branch.rows[0]?.name || null;
    } else {
      row.posBranchName = null;
    }
    ok(res, row, 'Team member updated.');
  } finally {
    client.release();
  }
}));

router.get('/integrations', asyncHandler(async (_req, res) => {
  const client = await db.pool.connect();
  try {
    const tenant = await ensureDefaultTenant(client);
    const result = await client.query('SELECT id, integration_key, name, description AS desc, status, meta, config FROM integrations WHERE tenant_id = $1 ORDER BY name', [tenant.id]);
    ok(res, result.rows.map((r) => ({ ...r, connected: r.status === 'connected' })));
  } finally {
    client.release();
  }
}));

router.post('/integrations', ownerOrAdmin, asyncHandler(async (req, res) => {
  if (!req.body.key && !req.body.integrationKey) return validationError(res, ['Integration key is required.']);
  const client = await db.pool.connect();
  try {
    const tenant = await ensureDefaultTenant(client);
    const result = await client.query(
      `
        INSERT INTO integrations (tenant_id, integration_key, name, description, status, meta, config, connected_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, CASE WHEN $5 = 'connected' THEN now() ELSE NULL END)
        ON CONFLICT (tenant_id, integration_key) DO UPDATE
        SET name = EXCLUDED.name, description = EXCLUDED.description, status = EXCLUDED.status, meta = EXCLUDED.meta, config = EXCLUDED.config
        RETURNING *
      `,
      [tenant.id, req.body.key || req.body.integrationKey, req.body.name || '', req.body.desc || req.body.description || '', req.body.status || (req.body.connected ? 'connected' : 'disconnected'), req.body.meta || '', JSON.stringify(req.body.config || {})],
    );
    created(res, result.rows[0], 'Integration saved.');
  } finally {
    client.release();
  }
}));

// ── Team Invitations ─────────────────────────────────────────────────────────

router.get('/invitations', asyncHandler(async (req, res) => {
  const client = await db.pool.connect();
  try {
    const tenant = await ensureDefaultTenant(client);
    const result = await client.query(
      `SELECT i.id, i.email, i.role, i.expires_at, i.created_at, i.last_sent_at, i.email_sent, i.resend_count,
              u.full_name AS invited_by_name
       FROM team_invitations i
       LEFT JOIN admin_users u ON u.id = i.invited_by
       WHERE i.tenant_id = $1 AND i.expires_at > NOW()
       ORDER BY i.created_at DESC`,
      [tenant.id],
    );
    ok(res, result.rows);
  } finally {
    client.release();
  }
}));

// Shared by POST /invitations (new invite) and POST /invitations/:id/resend
// (same email, fresh token) — both boil down to "issue a token, mail it,
// record what happened," they only differ in how the row gets there.
async function dispatchInvitation(client, { tenant, email, role, invitedBy, req, resend }) {
  const token     = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

  await client.query(
    resend
      ? `UPDATE team_invitations
         SET token_hash = $3, expires_at = NOW() + INTERVAL '48 hours',
             last_sent_at = NOW(), resend_count = resend_count + 1
         WHERE tenant_id = $1 AND email = $2`
      : `INSERT INTO team_invitations (tenant_id, email, role, token_hash, invited_by, last_sent_at)
         VALUES ($1, $2, $4, $3, $5, NOW())
         ON CONFLICT (tenant_id, email) DO UPDATE
         SET role = EXCLUDED.role, token_hash = EXCLUDED.token_hash,
             invited_by = EXCLUDED.invited_by,
             expires_at = NOW() + INTERVAL '48 hours',
             created_at = NOW(), last_sent_at = NOW(), resend_count = 0`,
    resend ? [tenant.id, email, tokenHash] : [tenant.id, email, tokenHash, role, invitedBy],
  );

  // Prefer the actual origin this request came from over a hardcoded
  // fallback — a request from the real admin portal always carries its own
  // origin, so this needs no separate env var to stay in sync with
  // wherever the admin portal is actually deployed. ADMIN_ORIGIN remains a
  // manual override for the rare case of no Origin header (e.g. a
  // server-to-server call); localhost:4300 is a dev-only last resort and
  // must never be reached in production once CORS_ORIGINS is set.
  const inviteBase = req.get('origin') || process.env.ADMIN_ORIGIN || 'http://localhost:4300';
  const inviteLink = `${inviteBase}/accept-invite?token=${token}`;

  let inviterName = null;
  if (invitedBy) {
    const inviter = await client.query('SELECT full_name FROM admin_users WHERE id = $1', [invitedBy]);
    inviterName = inviter.rows[0]?.full_name || null;
  }

  // The invite link above is always returned regardless of what happens
  // here — email is a delivery convenience on top of it, never the only
  // way to get it, matching the .catch-and-log convention every other
  // sendMail() caller in this codebase uses (see order-receipt.js).
  let emailSent = false;
  try {
    await sendInvitationEmail({ to: email, role, inviteLink, inviterName, tenantName: tenant.name });
    emailSent = true;
  } catch (err) {
    console.warn('[settings] Invitation email failed:', err.message);
  }
  await client.query('UPDATE team_invitations SET email_sent = $3 WHERE tenant_id = $1 AND email = $2', [tenant.id, email, emailSent]);

  return { inviteLink, emailSent };
}

router.post('/invitations', ownerOrAdmin, asyncHandler(async (req, res) => {
  const { email: rawEmail, role: rawRole } = req.body;
  if (!rawEmail) return validationError(res, ['Email is required.']);
  const role = normalizeRole(rawRole);
  if (!role) return validationError(res, [`Role must be one of: ${ASSIGNABLE_ROLES.join(', ')}.`]);
  if (!canAssignRole(req.user.role, role)) return validationError(res, ['Only the owner can grant the owner role.']);
  const email = rawEmail.toLowerCase().trim();
  const client = await db.pool.connect();
  try {
    const tenant = await ensureDefaultTenant(client);
    const invitedBy = req.session?.userId || null;

    const existing = await client.query(
      'SELECT id, created_at FROM team_invitations WHERE tenant_id = $1 AND email = $2 AND expires_at > NOW()',
      [tenant.id, email],
    );
    const hadPendingInvite = existing.rowCount > 0;

    const { inviteLink, emailSent } = await dispatchInvitation(client, { tenant, email, role, invitedBy, req, resend: false });

    created(res, { email, inviteLink, emailSent, hadPendingInvite }, emailSent ? 'Invitation emailed.' : 'Invitation created.');
  } finally {
    client.release();
  }
}));

router.post('/invitations/:id/resend', ownerOrAdmin, asyncHandler(async (req, res) => {
  const client = await db.pool.connect();
  try {
    const tenant = await ensureDefaultTenant(client);
    const existing = await client.query(
      'SELECT email, role FROM team_invitations WHERE tenant_id = $1 AND id = $2',
      [tenant.id, req.params.id],
    );
    if (existing.rowCount === 0) return notFound(res, 'Invitation not found.');
    const { email, role } = existing.rows[0];
    const invitedBy = req.session?.userId || null;

    const { inviteLink, emailSent } = await dispatchInvitation(client, { tenant, email, role, invitedBy, req, resend: true });

    ok(res, { email, inviteLink, emailSent }, emailSent ? 'Invitation re-emailed.' : 'Invitation link renewed.');
  } finally {
    client.release();
  }
}));

router.delete('/invitations/:id', ownerOrAdmin, asyncHandler(async (req, res) => {
  const client = await db.pool.connect();
  try {
    const tenant = await ensureDefaultTenant(client);
    const result = await client.query(
      'DELETE FROM team_invitations WHERE tenant_id=$1 AND id=$2 RETURNING id',
      [tenant.id, req.params.id],
    );
    if (result.rowCount === 0) return notFound(res, 'Invitation not found.');
    ok(res, { id: req.params.id }, 'Invitation revoked.');
  } finally {
    client.release();
  }
}));


function initials(name) {
  return String(name || 'User').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('') || 'U';
}

// Owner is assignable like any other role (no separate "promote" flow —
// picking it in the same role dropdown is the whole action), but only an
// existing owner can hand it out. Cashier is POS-only
// (server/routes/pos.route.js).
const ASSIGNABLE_ROLES = ['owner', 'admin', 'manager', 'cashier', 'viewer'];

function normalizeRole(role) {
  const value = String(role || 'viewer').toLowerCase();
  return ASSIGNABLE_ROLES.includes(value) ? value : null;
}

// Only an owner can grant the owner role — an admin (who otherwise passes
// `ownerOrAdmin` on every route below) must not be able to hand out the
// account's top permission tier to themselves or anyone else.
function canAssignRole(actorRole, targetRole) {
  return targetRole !== 'owner' || actorRole === 'owner';
}

module.exports = router;
