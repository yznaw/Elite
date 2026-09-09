-- Branch reporting snapshots + location-labelled stocktake counts.
--
-- This intentionally does NOT create per-location inventory balances. Stock
-- remains one shared quantity on product_variants. Locations are only used to
-- attribute POS activity and to split a physical count before its combined
-- total is posted once.

BEGIN;

ALTER TABLE pos_transactions
  ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES pos_branches(id) ON DELETE SET NULL;
ALTER TABLE pos_refunds
  ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES pos_branches(id) ON DELETE SET NULL;
ALTER TABLE pos_z_reports
  ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES pos_branches(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sold_item_quantity integer NOT NULL DEFAULT 0 CHECK (sold_item_quantity >= 0),
  ADD COLUMN IF NOT EXISTS returned_item_quantity integer NOT NULL DEFAULT 0 CHECK (returned_item_quantity >= 0);

-- Existing rows predate snapshots. Capture the register's current branch once;
-- all new rows are written explicitly by the POS services.
UPDATE pos_transactions t
SET branch_id = r.branch_id
FROM pos_registers r
WHERE r.id = t.register_id AND t.branch_id IS NULL;

UPDATE pos_refunds rf
SET branch_id = r.branch_id
FROM pos_registers r
WHERE r.id = rf.register_id AND rf.branch_id IS NULL;

UPDATE pos_z_reports z
SET branch_id = r.branch_id
FROM pos_registers r
WHERE r.id = z.register_id AND z.branch_id IS NULL;

CREATE INDEX IF NOT EXISTS pos_transactions_branch_report_idx
  ON pos_transactions (tenant_id, branch_id, server_received_at DESC);
CREATE INDEX IF NOT EXISTS pos_refunds_branch_report_idx
  ON pos_refunds (tenant_id, branch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS pos_z_reports_branch_report_idx
  ON pos_z_reports (tenant_id, branch_id, created_at DESC);

CREATE TABLE IF NOT EXISTS stocktake_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- Preserve historical counts even if a branch is later removed.
  branch_id uuid REFERENCES pos_branches(id) ON DELETE SET NULL,
  name text NOT NULL,
  location_type text NOT NULL CHECK (location_type IN ('store', 'warehouse')),
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, location_type, name)
);

CREATE UNIQUE INDEX IF NOT EXISTS stocktake_locations_branch_unique
  ON stocktake_locations (tenant_id, branch_id) WHERE branch_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS stocktake_locations_one_warehouse
  ON stocktake_locations (tenant_id) WHERE location_type = 'warehouse';

-- Each configured POS branch is a physical count location. The warehouse is a
-- count-only location and is not a sales channel.
INSERT INTO stocktake_locations (tenant_id, branch_id, name, location_type, sort_order)
SELECT b.tenant_id, b.id, b.name, 'store', row_number() OVER (PARTITION BY b.tenant_id ORDER BY b.created_at)::integer - 1
FROM pos_branches b
ON CONFLICT DO NOTHING;

INSERT INTO stocktake_locations (tenant_id, name, location_type, sort_order)
SELECT t.id, 'Warehouse', 'warehouse', 100
FROM tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM stocktake_locations l WHERE l.tenant_id = t.id AND l.location_type = 'warehouse'
);

CREATE TABLE IF NOT EXISTS stocktake_location_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stocktake_id uuid NOT NULL REFERENCES stocktakes(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES stocktake_locations(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'counting' CHECK (status IN ('counting', 'completed')),
  completed_by_user_id uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  completed_at timestamptz,
  UNIQUE (stocktake_id, location_id)
);

CREATE INDEX IF NOT EXISTS stocktake_location_runs_stocktake_idx
  ON stocktake_location_runs (stocktake_id, status);

CREATE TABLE IF NOT EXISTS stocktake_location_counts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stocktake_id uuid NOT NULL REFERENCES stocktakes(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  location_run_id uuid NOT NULL REFERENCES stocktake_location_runs(id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES stocktake_locations(id) ON DELETE RESTRICT,
  variant_id uuid NOT NULL REFERENCES product_variants(id) ON DELETE RESTRICT,
  quantity integer NOT NULL CHECK (quantity >= 0),
  counted_by_user_id uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  counted_at timestamptz NOT NULL DEFAULT now(),
  note text,
  UNIQUE (location_run_id, variant_id)
);

CREATE INDEX IF NOT EXISTS stocktake_location_counts_stocktake_idx
  ON stocktake_location_counts (stocktake_id, variant_id);

COMMIT;
