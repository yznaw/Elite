const { audit, inTransaction } = require('./db');
const { assertPos, nonEmpty, uuid } = require('./errors');

const MAX_TEXT = 500;

function optionalText(value, field, maxLength = MAX_TEXT) {
  if (value === undefined || value === null || value === '') return null;
  const result = String(value).trim();
  assertPos(result.length <= maxLength, 422, 'INVALID_FIELD', `${field} is too long.`);
  return result || null;
}

/**
 * Optional, but stored as '' rather than NULL.
 *
 * For the columns declared `NOT NULL DEFAULT ''`, where "not provided" has to
 * round-trip as an empty string instead of a null.
 */
function optionalBlank(value, field, maxLength = MAX_TEXT) {
  const result = String(value ?? '').trim();
  assertPos(result.length <= maxLength, 422, 'INVALID_FIELD', `${field} is too long.`);
  return result;
}

function publicBranch(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    tradeNameAr: row.trade_name_ar,
    tradeNameEn: row.trade_name_en,
    addressAr: row.address_ar,
    addressEn: row.address_en,
    phone: row.phone,
    crLicenseNumber: row.cr_license_number,
    returnPolicyAr: row.return_policy_ar,
    returnPolicyEn: row.return_policy_en,
    isDefault: row.is_default,
    updatedAt: row.updated_at,
  };
}

/**
 * Same shape `pos_business_profile`'s `publicProfile()` used to return —
 * exactly the fields `PosBusinessProfile` on the client expects, and nothing
 * branch-specific (no `id`/`name`/`isDefault`). The till doesn't need to know
 * which branch it got; it just needs the printable fields. Keeping this
 * shape identical is what lets `pos.service.ts`, `pos-hardware.service.ts`
 * and the receipt renderer stay completely unchanged.
 *
 * footerStampAr/En are deliberately not included: they exist as columns for
 * schema parity with the old table but have had no template field, no i18n
 * key and no renderer usage since migration 017. Dropped at this boundary
 * rather than the schema, so a real future need can add them back without
 * another migration.
 */
function publicProfileFromBranch(row) {
  if (!row) return null;
  return {
    tradeNameAr: row.trade_name_ar,
    tradeNameEn: row.trade_name_en,
    addressAr: row.address_ar,
    addressEn: row.address_en,
    phone: row.phone,
    crLicenseNumber: row.cr_license_number,
    returnPolicyAr: row.return_policy_ar,
    returnPolicyEn: row.return_policy_en,
    updatedAt: row.updated_at,
  };
}

function requireOwnerOrAdmin(context, action) {
  assertPos(
    ['owner', 'admin'].includes(context.role),
    403,
    'INSUFFICIENT_PERMISSIONS',
    `Only owners and admins can ${action}.`,
  );
}

function validateBranchFields(body) {
  // Only what the receipt actually prints is required — same rule the old
  // single-profile service used (owner decision, 2026-08-01: receipt is
  // English-only). `name` is new: it is never printed, but it is the only
  // thing that tells branches apart in every dropdown/table in the admin UI,
  // so it gets the same strength of requirement as the printed English name.
  return {
    name: nonEmpty(body?.name, 'name', 120),
    trade_name_ar: optionalBlank(body?.tradeNameAr, 'tradeNameAr', 200),
    trade_name_en: nonEmpty(body?.tradeNameEn, 'tradeNameEn', 200),
    address_ar: optionalBlank(body?.addressAr, 'addressAr', MAX_TEXT),
    address_en: nonEmpty(body?.addressEn, 'addressEn', MAX_TEXT),
    phone: nonEmpty(body?.phone, 'phone', 40),
    cr_license_number: optionalText(body?.crLicenseNumber, 'crLicenseNumber', 80),
    return_policy_ar: optionalText(body?.returnPolicyAr, 'returnPolicyAr'),
    return_policy_en: optionalText(body?.returnPolicyEn, 'returnPolicyEn'),
  };
}

async function listBranches(context) {
  requireOwnerOrAdmin(context, 'view branches');
  return inTransaction(async (client) => {
    const result = await client.query(
      `SELECT * FROM pos_branches WHERE tenant_id = $1 ORDER BY is_default DESC, name ASC`,
      [context.tenantId],
    );
    return result.rows.map(publicBranch);
  });
}

async function createBranch(context, body) {
  requireOwnerOrAdmin(context, 'add a branch');
  const fields = validateBranchFields(body);

  return inTransaction(async (client) => {
    // Same reasoning as createEnrollmentToken's name pre-check: the bare
    // UNIQUE(tenant_id, name) constraint would surface as an unlabeled 409,
    // and by the time it reaches the UI the operator has lost which field
    // it was about.
    const nameTaken = await client.query(
      'SELECT 1 FROM pos_branches WHERE tenant_id = $1 AND lower(name) = lower($2)',
      [context.tenantId, fields.name],
    );
    assertPos(
      nameTaken.rowCount === 0,
      409,
      'BRANCH_NAME_TAKEN',
      `A branch named "${fields.name}" already exists. Choose a different name.`,
    );

    // is_default is never taken from the request body — creating a branch
    // never makes it the default. That is the one thing setDefaultBranch
    // owns, so there is exactly one code path that can ever change it.
    const result = await client.query(
      `INSERT INTO pos_branches
        (tenant_id, name, trade_name_ar, trade_name_en, address_ar, address_en, phone,
         cr_license_number, return_policy_ar, return_policy_en,
         created_by_user_id, updated_by_user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)
       RETURNING *`,
      [
        context.tenantId,
        fields.name,
        fields.trade_name_ar,
        fields.trade_name_en,
        fields.address_ar,
        fields.address_en,
        fields.phone,
        fields.cr_license_number,
        fields.return_policy_ar,
        fields.return_policy_en,
        context.userId,
      ],
    );
    const row = result.rows[0];
    await audit(client, context, 'pos.branch.created', 'pos_branch', row.id, { name: row.name });
    return publicBranch(row);
  });
}

async function updateBranch(context, branchId, body) {
  requireOwnerOrAdmin(context, 'edit branches');
  uuid(branchId, 'branchId');
  const fields = validateBranchFields(body);

  return inTransaction(async (client) => {
    const nameTaken = await client.query(
      'SELECT 1 FROM pos_branches WHERE tenant_id = $1 AND lower(name) = lower($2) AND id != $3',
      [context.tenantId, fields.name, branchId],
    );
    assertPos(
      nameTaken.rowCount === 0,
      409,
      'BRANCH_NAME_TAKEN',
      `A branch named "${fields.name}" already exists. Choose a different name.`,
    );

    // is_default is intentionally absent from both the SET list and the
    // validated fields above — a generic field edit can never flip it.
    const result = await client.query(
      `UPDATE pos_branches
       SET name = $3, trade_name_ar = $4, trade_name_en = $5, address_ar = $6,
           address_en = $7, phone = $8, cr_license_number = $9,
           return_policy_ar = $10, return_policy_en = $11,
           updated_by_user_id = $12, updated_at = now()
       WHERE tenant_id = $1 AND id = $2
       RETURNING *`,
      [
        context.tenantId,
        branchId,
        fields.name,
        fields.trade_name_ar,
        fields.trade_name_en,
        fields.address_ar,
        fields.address_en,
        fields.phone,
        fields.cr_license_number,
        fields.return_policy_ar,
        fields.return_policy_en,
        context.userId,
      ],
    );
    assertPos(result.rowCount === 1, 404, 'BRANCH_NOT_FOUND', 'Branch not found.');
    await audit(client, context, 'pos.branch.updated', 'pos_branch', branchId, { name: fields.name });
    return publicBranch(result.rows[0]);
  });
}

/**
 * Three guards, in order, and one invariant-preserving side effect.
 *
 * 1. Must exist for this tenant.
 * 2. Must not be the tenant's only branch — a register with no explicit
 *    assignment falls back to "the tenant's branches," and that set can
 *    never be empty or every unassigned register goes dark.
 * 3. Must have zero registers currently pointing at it. The FK is
 *    `ON DELETE SET NULL`, so the database would happily let this succeed
 *    and silently reassign those registers to whatever the default branch
 *    happens to be — which means a shop's receipts start printing a
 *    different shop's address with no admin action that looks like it did
 *    that. Blocking and asking for an explicit reassignment first is the
 *    honest version of this operation.
 *
 * If the deleted branch was the default, the next-oldest remaining branch
 * is promoted to default in the same transaction as the delete, so there is
 * never a moment — not even within one request — where a tenant has zero
 * default branches.
 */
async function deleteBranch(context, branchId) {
  requireOwnerOrAdmin(context, 'delete branches');
  uuid(branchId, 'branchId');

  return inTransaction(async (client) => {
    const branchResult = await client.query(
      `SELECT * FROM pos_branches WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
      [context.tenantId, branchId],
    );
    const branch = branchResult.rows[0];
    assertPos(branch, 404, 'BRANCH_NOT_FOUND', 'Branch not found.');

    const countResult = await client.query(
      `SELECT count(*)::int AS n FROM pos_branches WHERE tenant_id = $1`,
      [context.tenantId],
    );
    assertPos(
      countResult.rows[0].n > 1,
      409,
      'BRANCH_LAST_REMAINING',
      'This is the only branch on the account. Add another branch before deleting this one.',
    );

    const registerCount = await client.query(
      `SELECT count(*)::int AS n FROM pos_registers WHERE tenant_id = $1 AND branch_id = $2`,
      [context.tenantId, branchId],
    );
    const assignedCount = registerCount.rows[0].n;
    assertPos(
      assignedCount === 0,
      409,
      'BRANCH_HAS_REGISTERS',
      `${assignedCount} register(s) are assigned to this branch. Reassign them to another branch before deleting.`,
    );

    await client.query(`DELETE FROM pos_branches WHERE tenant_id = $1 AND id = $2`, [context.tenantId, branchId]);

    if (branch.is_default) {
      await client.query(
        `UPDATE pos_branches SET is_default = true, updated_at = now()
         WHERE tenant_id = $1 AND id = (
           SELECT id FROM pos_branches WHERE tenant_id = $1 ORDER BY created_at ASC LIMIT 1
         )`,
        [context.tenantId],
      );
    }

    await audit(client, context, 'pos.branch.deleted', 'pos_branch', branchId, {
      name: branch.name,
      wasDefault: branch.is_default,
    });
    return { branchId, deleted: true };
  });
}

/**
 * Clear-then-set, as two sequential statements in one transaction — not a
 * single UPDATE with a CASE. `pos_branches_one_default_per_tenant` (migration
 * 027) is a normal, immediately-checked unique index, not DEFERRABLE, so a
 * statement that tried to set the new default while the old one was still
 * `true` would violate it mid-transaction. Clearing first means the
 * constraint never sees two `true` rows for the same tenant at once.
 */
async function setDefaultBranch(context, branchId) {
  requireOwnerOrAdmin(context, 'change the default branch');
  uuid(branchId, 'branchId');

  return inTransaction(async (client) => {
    const targetResult = await client.query(
      `SELECT id, is_default FROM pos_branches WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
      [context.tenantId, branchId],
    );
    const target = targetResult.rows[0];
    assertPos(target, 404, 'BRANCH_NOT_FOUND', 'Branch not found.');
    if (target.is_default) return { branchId, isDefault: true };

    await client.query(
      `UPDATE pos_branches SET is_default = false, updated_at = now()
       WHERE tenant_id = $1 AND is_default = true`,
      [context.tenantId],
    );
    await client.query(
      `UPDATE pos_branches SET is_default = true, updated_at = now()
       WHERE tenant_id = $1 AND id = $2`,
      [context.tenantId, branchId],
    );
    await audit(client, context, 'pos.branch.default-changed', 'pos_branch', branchId, {
      newDefaultBranchId: branchId,
    });
    return { branchId, isDefault: true };
  });
}

/**
 * The till read path. Resolves, in one query with no N+1:
 *
 *   1. the calling register's assigned branch, if any;
 *   2. else the tenant's default branch;
 *   3. else the oldest branch by created_at — a tenant with branches but no
 *      flagged default shouldn't be reachable given the partial unique index
 *      plus the migration 027 backfill, but this must not 500 if it somehow
 *      happens;
 *   4. else `null` — no branches exist at all, matching the old
 *      "no profile configured yet" contract the till already handles.
 *
 * `context.registerId` may be null (an admin-portal session with no register
 * checked in, e.g. loading Settings) — `pos_registers.id = NULL` correctly
 * matches no row, so COALESCE falls straight through to the default branch.
 */
async function getEffectiveBranchProfile(context) {
  return inTransaction(async (client) => {
    const result = await client.query(
      `SELECT b.*
         FROM pos_branches b
        WHERE b.tenant_id = $1
          AND b.id = COALESCE(
            (SELECT r.branch_id FROM pos_registers r WHERE r.tenant_id = $1 AND r.id = $2),
            (SELECT bb.id FROM pos_branches bb WHERE bb.tenant_id = $1 AND bb.is_default = true),
            (SELECT bb.id FROM pos_branches bb WHERE bb.tenant_id = $1 ORDER BY bb.created_at ASC LIMIT 1)
          )`,
      [context.tenantId, context.registerId],
    );
    return publicProfileFromBranch(result.rows[0]);
  });
}

module.exports = {
  listBranches,
  createBranch,
  updateBranch,
  deleteBranch,
  setDefaultBranch,
  getEffectiveBranchProfile,
};
