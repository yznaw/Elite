-- POS operations hardening: durable void idempotency, local sync reporting,
-- and database-enforced non-overlapping receipt reservations.

BEGIN;

CREATE EXTENSION IF NOT EXISTS btree_gist;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'pos_receipt_number_blocks_no_overlap'
  ) THEN
    ALTER TABLE pos_receipt_number_blocks
      ADD CONSTRAINT pos_receipt_number_blocks_no_overlap
      EXCLUDE USING gist (
        tenant_id WITH =,
        int8range(range_start, range_end, '[]') WITH &&
      );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS pos_voids (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  transaction_id uuid NOT NULL UNIQUE REFERENCES pos_transactions(id) ON DELETE RESTRICT,
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  payment_id uuid NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
  register_id uuid NOT NULL REFERENCES pos_registers(id) ON DELETE RESTRICT,
  shift_id uuid NOT NULL REFERENCES pos_shifts(id) ON DELETE RESTRICT,
  cashier_id uuid NOT NULL REFERENCES admin_users(id) ON DELETE RESTRICT,
  manager_id uuid NOT NULL REFERENCES admin_users(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL,
  amount_cents bigint NOT NULL CHECK (amount_cents >= 0),
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS pos_voids_shift_idx
  ON pos_voids (tenant_id, shift_id, created_at);

CREATE TABLE IF NOT EXISTS pos_sync_states (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  register_id uuid NOT NULL REFERENCES pos_registers(id) ON DELETE CASCADE,
  shift_id uuid NOT NULL REFERENCES pos_shifts(id) ON DELETE CASCADE,
  pending_count integer NOT NULL DEFAULT 0 CHECK (pending_count >= 0),
  rejected_count integer NOT NULL DEFAULT 0 CHECK (rejected_count >= 0),
  last_reported_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, register_id, shift_id)
);

DROP TRIGGER IF EXISTS pos_sync_states_set_updated_at ON pos_sync_states;
CREATE TRIGGER pos_sync_states_set_updated_at
BEFORE UPDATE ON pos_sync_states
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS pos_parked_carts_cashier_idx
  ON pos_parked_carts (tenant_id, cashier_id, updated_at DESC);

-- Supports SSE replay-buffer retention pruning by age.
CREATE INDEX IF NOT EXISTS pos_events_created_at_idx
  ON pos_events (created_at);

DROP VIEW IF EXISTS v_customer_order_stats;

CREATE VIEW v_customer_order_stats AS
WITH refund_totals AS (
  SELECT
    p.order_id,
    COALESCE(sum(pr.amount_cents) FILTER (WHERE pr.status = 'completed'), 0)::bigint AS refunded_cents
  FROM payments p
  LEFT JOIN payment_refunds pr ON pr.payment_id = p.id
  GROUP BY p.order_id
), order_values AS (
  SELECT
    o.id,
    o.customer_id,
    o.placed_at,
    CASE
      WHEN o.status <> 'cancelled'
       AND o.payment_status IN ('paid', 'partially_refunded', 'refunded')
        THEN GREATEST(o.total_cents::bigint - COALESCE(rt.refunded_cents, 0), 0)
      ELSE 0
    END AS net_paid_cents
  FROM orders o
  LEFT JOIN refund_totals rt ON rt.order_id = o.id
)
SELECT
  c.id AS customer_id,
  count(ov.id)::integer AS orders_count,
  COALESCE(sum(ov.net_paid_cents), 0)::bigint AS ltv_cents,
  max(ov.placed_at) AS last_order_at
FROM customers c
LEFT JOIN order_values ov ON ov.customer_id = c.id
GROUP BY c.id;

COMMIT;
