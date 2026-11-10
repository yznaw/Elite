-- Inventory operations: stocktake (docs/25 Phase 8).
--
-- Manual adjustments need no table of their own — they are a single signed
-- movement and `inventory_movements` already records the delta, the reason,
-- the actor and a metadata blob. Adding a parallel `stock_adjustments` table
-- would create a second place where stock history lives, which is exactly the
-- problem Phase 1 spent its effort removing.
--
-- A stocktake does need tables, because it is a *process* with states: a count
-- is started, filled in over time (possibly by several people), reviewed, and
-- only then posted. Until it posts it must not touch stock at all.

BEGIN;

CREATE TABLE IF NOT EXISTS stocktakes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  reference text NOT NULL,
  status text NOT NULL DEFAULT 'counting' CHECK (status IN ('counting', 'review', 'posted', 'cancelled')),
  -- Blind by default: the counter cannot see the expected quantity. A count
  -- taken while looking at the number the system expects tends to agree with
  -- it, which makes the whole exercise worthless.
  blind boolean NOT NULL DEFAULT true,
  note text,
  started_by_user_id uuid NOT NULL REFERENCES admin_users(id) ON DELETE RESTRICT,
  posted_by_user_id uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  posted_at timestamptz,
  UNIQUE (tenant_id, reference)
);

CREATE INDEX IF NOT EXISTS stocktakes_tenant_status_idx
  ON stocktakes (tenant_id, status, started_at DESC);

CREATE TABLE IF NOT EXISTS stocktake_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stocktake_id uuid NOT NULL REFERENCES stocktakes(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  variant_id uuid NOT NULL REFERENCES product_variants(id) ON DELETE RESTRICT,
  -- Stock as it stood when the count was started. This is the baseline the
  -- discrepancy is measured against — NOT the value written back at posting
  -- time. Sales continue while a count is in progress, so posting the counted
  -- number as an absolute would silently reverse every sale made during the
  -- count. What gets applied is (counted - expected), added to whatever stock
  -- actually is at the moment of posting.
  expected_quantity integer NOT NULL,
  counted_quantity integer CHECK (counted_quantity >= 0),
  recount_quantity integer CHECK (recount_quantity >= 0),
  counted_by_user_id uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  counted_at timestamptz,
  note text,
  UNIQUE (stocktake_id, variant_id)
);

CREATE INDEX IF NOT EXISTS stocktake_lines_stocktake_idx
  ON stocktake_lines (stocktake_id);

COMMIT;
