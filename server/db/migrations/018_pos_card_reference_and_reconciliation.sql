-- Card terminal at this shop is standalone (no cable/API link to the POS —
-- see docs/15 Phase 4). This captures the cashier-entered terminal reference
-- so a card sale has *some* paper trail, plus a daily reconciliation ledger
-- against the bank's own settlement export.

BEGIN;

ALTER TABLE payments ADD COLUMN IF NOT EXISTS terminal_reference text;

CREATE TABLE IF NOT EXISTS pos_card_reconciliation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  register_id uuid NOT NULL REFERENCES pos_registers(id) ON DELETE CASCADE,
  business_date date NOT NULL,
  pos_total_cents integer NOT NULL,
  settlement_total_cents integer,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','matched','exception','resolved')),
  resolved_by_user_id uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, register_id, business_date)
);

COMMIT;
