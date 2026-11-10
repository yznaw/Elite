-- POS legal receipt profile: bilingual business identity printed on every
-- receipt (Qatar MOCI requires Arabic content — see docs/14 P0-4, docs/15
-- Phase 3). One row per tenant; owners/admins edit it, the receipt renderer
-- reads it read-only.

BEGIN;

CREATE TABLE IF NOT EXISTS pos_business_profile (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  trade_name_ar text NOT NULL DEFAULT '',
  trade_name_en text NOT NULL DEFAULT '',
  address_ar text NOT NULL DEFAULT '',
  address_en text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  cr_license_number text,
  return_policy_ar text,
  return_policy_en text,
  footer_stamp_ar text,
  footer_stamp_en text,
  updated_by_user_id uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id)
);

COMMIT;
