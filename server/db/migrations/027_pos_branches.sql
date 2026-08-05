-- Multiple physical shop locations, each printing its own receipt header.
--
-- pos_business_profile (migration 017) is exactly one row per TENANT — every
-- register across every physical shop printed the identical address, which
-- breaks the moment a tenant opens a second location. That was flagged as a
-- known limitation in docs/12-pos-system.md §13.2 and is what this fixes.
--
-- A branch is the print identity: name/address/phone/CR/return policy. A
-- register is assigned to exactly one branch via pos_registers.branch_id. A
-- register with no branch assigned falls back to the tenant's default
-- branch (server/lib/pos/branch-service.js), so a tenant that never touches
-- any of this keeps working exactly as before with zero admin action
-- required — the backfill below guarantees that.

CREATE TABLE IF NOT EXISTS pos_branches (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- Internal label only (e.g. "The Pearl", "Lusail") — shown in the admin UI
  -- to pick a branch. Never printed; trade_name_en is what prints.
  name                text NOT NULL,
  trade_name_ar       text NOT NULL DEFAULT '',
  trade_name_en       text NOT NULL DEFAULT '',
  address_ar          text NOT NULL DEFAULT '',
  address_en          text NOT NULL DEFAULT '',
  phone               text NOT NULL DEFAULT '',
  cr_license_number   text,
  return_policy_ar    text,
  return_policy_en    text,
  footer_stamp_ar     text,
  footer_stamp_en     text,
  is_default          boolean NOT NULL DEFAULT false,
  created_by_user_id  uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  updated_by_user_id  uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

-- At most one default branch per tenant. This is the fallback target for any
-- register that hasn't been explicitly assigned a branch, so it must always
-- resolve unambiguously.
CREATE UNIQUE INDEX IF NOT EXISTS pos_branches_one_default_per_tenant
  ON pos_branches (tenant_id) WHERE is_default;

ALTER TABLE pos_registers
  ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES pos_branches(id) ON DELETE SET NULL;

-- One-time backfill, idempotent across every boot (this file re-runs on
-- every server start — see server/db/pos-schema.js). Guarded on "tenant has
-- zero branches", not on branch name, so it fires exactly once per tenant
-- and never resurrects a branch someone deliberately renamed or deleted
-- after real branches were set up.
--
-- Source 1: tenants with an existing pos_business_profile row carry its data
-- forward, so nothing changes for a single-shop tenant until they add a
-- second branch.
INSERT INTO pos_branches (
  tenant_id, name, trade_name_ar, trade_name_en, address_ar, address_en,
  phone, cr_license_number, return_policy_ar, return_policy_en,
  footer_stamp_ar, footer_stamp_en, is_default
)
SELECT
  p.tenant_id, 'Main', p.trade_name_ar, p.trade_name_en, p.address_ar,
  p.address_en, p.phone, p.cr_license_number, p.return_policy_ar,
  p.return_policy_en, p.footer_stamp_ar, p.footer_stamp_en, true
FROM pos_business_profile p
WHERE NOT EXISTS (SELECT 1 FROM pos_branches b WHERE b.tenant_id = p.tenant_id);

-- Source 2: tenants that have registers but never set up a business profile
-- at all still need a default branch to fall back to (starts blank, same as
-- the pre-branches behavior for an unconfigured profile).
INSERT INTO pos_branches (tenant_id, name, is_default)
SELECT DISTINCT r.tenant_id, 'Main', true
FROM pos_registers r
WHERE NOT EXISTS (SELECT 1 FROM pos_branches b WHERE b.tenant_id = r.tenant_id);
