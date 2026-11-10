-- Cash movements: paid-in, paid-out, safe-drop, float-adjust, and no-sale
-- drawer-opens (docs/16-launch-roadmap.md Phase 3). Sales/refunds/voids
-- already flow through pos_transactions/pos_refunds and feed
-- shift-service.js's expected-cash calculation; this table is the other
-- half of a shift's cash trail — cash movements that happen *outside* a
-- sale (petty cash paid out, a manager pulling cash to the safe, a till
-- float top-up, or opening the drawer with no sale attached at all).
-- Without this, none of that cash movement was recorded anywhere, so a
-- shift's expected-cash-vs-physical-cash variance could never explain a
-- paid-out as anything other than unexplained shrinkage.

BEGIN;

CREATE TABLE IF NOT EXISTS pos_cash_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  shift_id uuid NOT NULL REFERENCES pos_shifts(id) ON DELETE RESTRICT,
  register_id uuid NOT NULL REFERENCES pos_registers(id) ON DELETE RESTRICT,
  cashier_id uuid NOT NULL REFERENCES admin_users(id) ON DELETE RESTRICT,
  manager_id uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('paid_in', 'paid_out', 'safe_drop', 'float_adjust', 'no_sale_drawer_open')),
  amount_cents bigint NOT NULL DEFAULT 0 CHECK (amount_cents >= 0),
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, idempotency_key),
  -- no_sale_drawer_open never moves cash (it's just an audited drawer pulse);
  -- every other kind must carry a nonzero amount, since a zero-amount
  -- paid-in/paid-out/safe-drop/float-adjust would be a meaningless record.
  CHECK (
    (kind = 'no_sale_drawer_open' AND amount_cents = 0)
    OR (kind <> 'no_sale_drawer_open' AND amount_cents > 0)
  ),
  -- paid_out, safe_drop, and no_sale_drawer_open remove cash from the
  -- drawer or require accountability beyond the cashier's own say-so —
  -- these require a manager override, same as void/refund. paid_in and
  -- float_adjust (topping the till up) do not need one.
  CHECK (
    (kind IN ('paid_out', 'safe_drop', 'no_sale_drawer_open') AND manager_id IS NOT NULL)
    OR (kind IN ('paid_in', 'float_adjust'))
  )
);

CREATE INDEX IF NOT EXISTS pos_cash_movements_shift_idx
  ON pos_cash_movements (tenant_id, shift_id, created_at);

-- Z-reports already snapshot the full shift summary into report_data jsonb,
-- but cash-in/cash-out get dedicated columns too so Phase 5 reporting can
-- query them directly without unpacking jsonb on every row.
ALTER TABLE pos_z_reports
  ADD COLUMN IF NOT EXISTS cash_in_cents bigint NOT NULL DEFAULT 0 CHECK (cash_in_cents >= 0),
  ADD COLUMN IF NOT EXISTS cash_out_cents bigint NOT NULL DEFAULT 0 CHECK (cash_out_cents >= 0);

COMMIT;
