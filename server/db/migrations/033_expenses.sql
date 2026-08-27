-- Business expense ledger. Until now the only cost the system knew about was
-- the cost of goods themselves (product_variants.cost_price_cents plus
-- shipping_cost_cents), so the Analytics page could show gross margin on a
-- product but never actual profitability. Rent, salaries, utilities, marketing
-- spend, and software subscriptions were invisible to the business entirely.
-- pos_cash_movements is not a substitute: it is a per-shift cash-drawer trail
-- that explains till variance, scoped to a register, with no category, vendor,
-- or recurrence — it cannot answer "what did we spend on marketing last
-- quarter". This table is the missing half, and it is what lets Analytics
-- compute a real net profit: revenue minus cost of goods sold minus operating
-- expenses.

BEGIN;

CREATE TABLE IF NOT EXISTS expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  expense_date date NOT NULL,
  category text NOT NULL CHECK (category IN (
    'rent', 'salaries', 'utilities', 'marketing', 'logistics',
    'supplies', 'software', 'fees', 'maintenance', 'other'
  )),
  amount_cents bigint NOT NULL CHECK (amount_cents >= 0),
  vendor text,
  payment_method text NOT NULL DEFAULT 'cash' CHECK (payment_method IN (
    'cash', 'card', 'bank_transfer', 'cheque', 'other'
  )),
  note text,
  receipt_media_id uuid REFERENCES media_assets(id) ON DELETE SET NULL,
  -- A recurring bill is stored once and expanded forward on read (see
  -- admin-expenses.route.js), so there is no scheduler to keep alive and no
  -- drift between what was scheduled and what the ledger says.
  recurrence text NOT NULL DEFAULT 'none' CHECK (recurrence IN ('none', 'monthly', 'yearly')),
  -- Set only when the user edits one occurrence of a recurring bill, which
  -- materialises that month as its own row pointing back at the template.
  recurrence_parent_id uuid REFERENCES expenses(id) ON DELETE SET NULL,
  -- 'pos_cash_out' rows are mirrored from pos_cash_movements paid-outs so
  -- petty cash is not tracked in two places or counted twice.
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'pos_cash_out')),
  source_ref_id uuid,
  created_by_user_id uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- An imported row must say what it came from; a manual row must not claim to.
  CHECK (
    (source = 'pos_cash_out' AND source_ref_id IS NOT NULL)
    OR (source = 'manual' AND source_ref_id IS NULL)
  )
);

-- The ledger is always read as "this tenant, newest first, within a range".
CREATE INDEX IF NOT EXISTS expenses_tenant_date_idx
  ON expenses (tenant_id, expense_date DESC);

-- Analytics groups by category over a date window.
CREATE INDEX IF NOT EXISTS expenses_tenant_category_idx
  ON expenses (tenant_id, category, expense_date DESC);

-- Makes the POS paid-out import idempotent: re-running it can never
-- double-count a cash movement that was already mirrored.
CREATE UNIQUE INDEX IF NOT EXISTS expenses_pos_source_idx
  ON expenses (tenant_id, source_ref_id)
  WHERE source = 'pos_cash_out';

COMMIT;
