-- Baseline snapshot for the inventory-movements consistency check
-- (docs/16-launch-roadmap.md Phase 1). inventory_movements (migration 001)
-- records every stock CHANGE, but has no record of what a variant's stock
-- was before its first change was ever logged - so "does current stock
-- equal the sum of its ledger deltas" is not checkable without one. This
-- table captures that starting point exactly once per variant, the moment
-- its first-ever movement is written (see server/lib/pos/inventory-ledger.js),
-- so the drift check has a fixed point to reconcile against.

BEGIN;

CREATE TABLE IF NOT EXISTS pos_inventory_baselines (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  variant_id uuid NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  baseline_stock integer NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, variant_id)
);

COMMIT;
