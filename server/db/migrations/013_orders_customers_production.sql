-- Migration 013 — Orders & Customers Production Hardening
-- Covers: soft-delete for customers, order idempotency, order public_number uniqueness,
--         phone_number on customers, v_customer_order_stats view.
-- Safe to run multiple times (all statements are idempotent).

-- ─── 1. Soft-delete column on customers ─────────────────────────────────────
ALTER TABLE customers ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL;

-- Index: fast lookup of non-deleted customers per tenant
CREATE INDEX IF NOT EXISTS idx_customers_active
  ON customers (tenant_id, deleted_at)
  WHERE deleted_at IS NULL;

-- ─── 2. Phone number on customers ───────────────────────────────────────────
ALTER TABLE customers ADD COLUMN IF NOT EXISTS phone_number TEXT NULL;

-- ─── 3. Order public_number uniqueness per tenant ───────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'orders_tenant_public_number_key'
  ) THEN
    ALTER TABLE orders ADD CONSTRAINT orders_tenant_public_number_key
      UNIQUE (tenant_id, public_number);
  END IF;
END $$;

-- ─── 4. Idempotency key on orders ───────────────────────────────────────────
ALTER TABLE orders ADD COLUMN IF NOT EXISTS idempotency_key TEXT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_idempotency
  ON orders (tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- ─── 5. v_customer_order_stats view ─────────────────────────────────────────
-- Computes live orders_count, ltv_cents, and last_order_at per customer.
-- Only counts PAID orders toward LTV; all orders toward count.
CREATE OR REPLACE VIEW v_customer_order_stats AS
SELECT
  customer_id,
  COUNT(*)::int                                            AS orders_count,
  COALESCE(SUM(CASE WHEN payment_status = 'paid' THEN total_cents ELSE 0 END), 0)::bigint
                                                           AS ltv_cents,
  MAX(placed_at)                                           AS last_order_at
FROM orders
WHERE customer_id IS NOT NULL
GROUP BY customer_id;
