-- Elite POS foundation
-- Additive, idempotent schema for registers, shifts, receipts, sales, refunds,
-- reports, offline reconciliation, and replayable register events.

BEGIN;

ALTER TABLE admin_users
  ADD COLUMN IF NOT EXISTS pos_pin_hash text;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM product_variants
    WHERE barcode IS NOT NULL AND btrim(barcode) <> ''
    GROUP BY tenant_id, barcode
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate product variant barcodes must be resolved before enabling POS';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS product_variants_tenant_barcode_uq
  ON product_variants (tenant_id, barcode)
  WHERE barcode IS NOT NULL AND btrim(barcode) <> '';

CREATE TABLE IF NOT EXISTS pos_registers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  display_name text NOT NULL,
  credential_hash text NOT NULL,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'disabled', 'revoked')),
  signing_certificate_fingerprint text,
  signing_certificate_status text NOT NULL DEFAULT 'pending'
    CHECK (signing_certificate_status IN ('pending', 'active', 'revoked', 'expired')),
  last_seen_at timestamptz,
  created_by_user_id uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, display_name),
  UNIQUE (tenant_id, id)
);

CREATE INDEX IF NOT EXISTS pos_registers_tenant_status_idx
  ON pos_registers (tenant_id, status, display_name);

CREATE TABLE IF NOT EXISTS pos_register_enrollment_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  display_name text NOT NULL,
  created_by_user_id uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  register_id uuid REFERENCES pos_registers(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pos_register_enrollment_tokens_active_idx
  ON pos_register_enrollment_tokens (tenant_id, expires_at)
  WHERE consumed_at IS NULL;

CREATE TABLE IF NOT EXISTS pos_receipt_sequences (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  next_value bigint NOT NULL DEFAULT 1 CHECK (next_value > 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pos_receipt_number_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  register_id uuid NOT NULL REFERENCES pos_registers(id) ON DELETE CASCADE,
  range_start bigint NOT NULL CHECK (range_start > 0),
  range_end bigint NOT NULL CHECK (range_end >= range_start),
  allocated_at timestamptz NOT NULL DEFAULT now(),
  exhausted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, range_start),
  UNIQUE (tenant_id, range_end)
);

CREATE INDEX IF NOT EXISTS pos_receipt_number_blocks_register_idx
  ON pos_receipt_number_blocks (tenant_id, register_id, allocated_at DESC);

CREATE TABLE IF NOT EXISTS pos_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  register_id uuid NOT NULL REFERENCES pos_registers(id) ON DELETE RESTRICT,
  block_id uuid NOT NULL REFERENCES pos_receipt_number_blocks(id) ON DELETE RESTRICT,
  receipt_number bigint NOT NULL CHECK (receipt_number > 0),
  kind text NOT NULL CHECK (kind IN ('sale', 'refund')),
  entity_id uuid,
  issued_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, receipt_number),
  UNIQUE (tenant_id, kind, entity_id)
);

CREATE TABLE IF NOT EXISTS pos_shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  register_id uuid NOT NULL REFERENCES pos_registers(id) ON DELETE RESTRICT,
  cashier_id uuid NOT NULL REFERENCES admin_users(id) ON DELETE RESTRICT,
  opening_float_cents bigint NOT NULL CHECK (opening_float_cents >= 0),
  state text NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'closing', 'closed')),
  opened_at timestamptz NOT NULL DEFAULT now(),
  closing_started_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS pos_shifts_active_register_uq
  ON pos_shifts (tenant_id, register_id)
  WHERE state IN ('open', 'closing');

CREATE INDEX IF NOT EXISTS pos_shifts_tenant_time_idx
  ON pos_shifts (tenant_id, opened_at DESC);

CREATE TABLE IF NOT EXISTS pos_manager_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  register_id uuid NOT NULL REFERENCES pos_registers(id) ON DELETE CASCADE,
  cashier_id uuid NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  manager_id uuid NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('refund', 'void', 'z-report', 'drawer-open', 'sync-conflict-override')),
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pos_manager_overrides_active_idx
  ON pos_manager_overrides (tenant_id, register_id, action, expires_at)
  WHERE used_at IS NULL;

CREATE TABLE IF NOT EXISTS pos_pin_failures (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  register_id uuid NOT NULL REFERENCES pos_registers(id) ON DELETE CASCADE,
  cashier_id uuid NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  failed_count integer NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
  locked_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, register_id, cashier_id)
);

CREATE TABLE IF NOT EXISTS pos_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_id uuid NOT NULL UNIQUE REFERENCES orders(id) ON DELETE RESTRICT,
  receipt_id uuid NOT NULL UNIQUE REFERENCES pos_receipts(id) ON DELETE RESTRICT,
  register_id uuid NOT NULL REFERENCES pos_registers(id) ON DELETE RESTRICT,
  shift_id uuid NOT NULL REFERENCES pos_shifts(id) ON DELETE RESTRICT,
  cashier_id uuid NOT NULL REFERENCES admin_users(id) ON DELETE RESTRICT,
  customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  idempotency_key text NOT NULL,
  payment_method text NOT NULL CHECK (payment_method IN ('cash', 'card')),
  subtotal_cents bigint NOT NULL CHECK (subtotal_cents >= 0),
  tax_cents bigint NOT NULL DEFAULT 0 CHECK (tax_cents >= 0),
  total_cents bigint NOT NULL CHECK (total_cents >= 0),
  cash_amount_cents bigint NOT NULL DEFAULT 0 CHECK (cash_amount_cents >= 0),
  card_amount_cents bigint NOT NULL DEFAULT 0 CHECK (card_amount_cents >= 0),
  amount_tendered_cents bigint NOT NULL DEFAULT 0 CHECK (amount_tendered_cents >= 0),
  change_given_cents bigint NOT NULL DEFAULT 0 CHECK (change_given_cents >= 0),
  status text NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'voided')),
  void_reason text,
  voided_at timestamptz,
  voided_by_user_id uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  client_created_at timestamptz,
  server_received_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, idempotency_key),
  CHECK (total_cents = subtotal_cents + tax_cents),
  CHECK (
    (payment_method = 'cash'
      AND cash_amount_cents = total_cents
      AND card_amount_cents = 0
      AND amount_tendered_cents >= total_cents
      AND change_given_cents = amount_tendered_cents - total_cents)
    OR
    (payment_method = 'card'
      AND card_amount_cents = total_cents
      AND cash_amount_cents = 0
      AND amount_tendered_cents = 0
      AND change_given_cents = 0)
  )
);

CREATE INDEX IF NOT EXISTS pos_transactions_shift_idx
  ON pos_transactions (tenant_id, shift_id, server_received_at);
CREATE INDEX IF NOT EXISTS pos_transactions_customer_idx
  ON pos_transactions (tenant_id, customer_id, server_received_at DESC)
  WHERE customer_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS pos_transaction_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  transaction_id uuid NOT NULL REFERENCES pos_transactions(id) ON DELETE RESTRICT,
  order_item_id uuid NOT NULL UNIQUE REFERENCES order_items(id) ON DELETE RESTRICT,
  product_id uuid REFERENCES products(id) ON DELETE SET NULL,
  variant_id uuid REFERENCES product_variants(id) ON DELETE SET NULL,
  sku text NOT NULL,
  barcode text,
  product_name text NOT NULL,
  variant_title text,
  quantity integer NOT NULL CHECK (quantity > 0),
  unit_price_cents bigint NOT NULL CHECK (unit_price_cents >= 0),
  tax_rate numeric(8,5) NOT NULL DEFAULT 0 CHECK (tax_rate >= 0),
  tax_amount_cents bigint NOT NULL DEFAULT 0 CHECK (tax_amount_cents >= 0),
  line_total_cents bigint NOT NULL CHECK (line_total_cents >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pos_transaction_items_transaction_idx
  ON pos_transaction_items (transaction_id);
CREATE INDEX IF NOT EXISTS pos_transaction_items_variant_idx
  ON pos_transaction_items (tenant_id, variant_id);

CREATE TABLE IF NOT EXISTS pos_refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  original_transaction_id uuid NOT NULL REFERENCES pos_transactions(id) ON DELETE RESTRICT,
  original_order_id uuid NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  original_payment_id uuid NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
  receipt_id uuid NOT NULL UNIQUE REFERENCES pos_receipts(id) ON DELETE RESTRICT,
  register_id uuid NOT NULL REFERENCES pos_registers(id) ON DELETE RESTRICT,
  shift_id uuid NOT NULL REFERENCES pos_shifts(id) ON DELETE RESTRICT,
  cashier_id uuid NOT NULL REFERENCES admin_users(id) ON DELETE RESTRICT,
  manager_id uuid NOT NULL REFERENCES admin_users(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL,
  method text NOT NULL CHECK (method IN ('cash', 'card')),
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  status text NOT NULL DEFAULT 'completed' CHECK (status IN ('pending', 'completed', 'failed')),
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS pos_refunds_original_idx
  ON pos_refunds (tenant_id, original_transaction_id, created_at);
CREATE INDEX IF NOT EXISTS pos_refunds_shift_idx
  ON pos_refunds (tenant_id, shift_id, created_at);

CREATE TABLE IF NOT EXISTS pos_refund_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  refund_id uuid NOT NULL REFERENCES pos_refunds(id) ON DELETE RESTRICT,
  original_transaction_item_id uuid NOT NULL REFERENCES pos_transaction_items(id) ON DELETE RESTRICT,
  quantity integer NOT NULL CHECK (quantity > 0),
  refund_amount_cents bigint NOT NULL CHECK (refund_amount_cents > 0),
  restocked boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (refund_id, original_transaction_item_id)
);

CREATE TABLE IF NOT EXISTS payment_refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  payment_id uuid NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
  pos_refund_id uuid NOT NULL UNIQUE REFERENCES pos_refunds(id) ON DELETE RESTRICT,
  provider_refund_id text,
  method text NOT NULL CHECK (method IN ('cash', 'card')),
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  status text NOT NULL DEFAULT 'completed' CHECK (status IN ('pending', 'completed', 'failed')),
  processed_at timestamptz,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS payment_refunds_payment_idx
  ON payment_refunds (tenant_id, payment_id, created_at);

CREATE TABLE IF NOT EXISTS pos_z_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  shift_id uuid NOT NULL UNIQUE REFERENCES pos_shifts(id) ON DELETE RESTRICT,
  register_id uuid NOT NULL REFERENCES pos_registers(id) ON DELETE RESTRICT,
  manager_id uuid NOT NULL REFERENCES admin_users(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL,
  opening_float_cents bigint NOT NULL CHECK (opening_float_cents >= 0),
  gross_sales_cents bigint NOT NULL CHECK (gross_sales_cents >= 0),
  cash_sales_cents bigint NOT NULL CHECK (cash_sales_cents >= 0),
  card_sales_cents bigint NOT NULL CHECK (card_sales_cents >= 0),
  refund_total_cents bigint NOT NULL CHECK (refund_total_cents >= 0),
  cash_refund_cents bigint NOT NULL CHECK (cash_refund_cents >= 0),
  void_total_cents bigint NOT NULL CHECK (void_total_cents >= 0),
  voided_cash_cents bigint NOT NULL CHECK (voided_cash_cents >= 0),
  net_sales_cents bigint NOT NULL,
  expected_cash_cents bigint NOT NULL,
  physical_cash_cents bigint NOT NULL CHECK (physical_cash_cents >= 0),
  variance_cents bigint GENERATED ALWAYS AS (physical_cash_cents - expected_cash_cents) STORED,
  transaction_count integer NOT NULL CHECK (transaction_count >= 0),
  refund_count integer NOT NULL CHECK (refund_count >= 0),
  void_count integer NOT NULL CHECK (void_count >= 0),
  report_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, idempotency_key)
);

ALTER TABLE pos_shifts
  ADD COLUMN IF NOT EXISTS z_report_id uuid REFERENCES pos_z_reports(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS pos_parked_carts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  register_id uuid NOT NULL REFERENCES pos_registers(id) ON DELETE CASCADE,
  cashier_id uuid NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  label text,
  cart_payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pos_parked_carts_register_idx
  ON pos_parked_carts (tenant_id, register_id, created_at);

CREATE TABLE IF NOT EXISTS pos_sync_conflicts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  transaction_id uuid NOT NULL REFERENCES pos_transactions(id) ON DELETE RESTRICT,
  variant_id uuid REFERENCES product_variants(id) ON DELETE SET NULL,
  conflict_type text NOT NULL CHECK (conflict_type IN ('insufficient_stock', 'price_changed')),
  expected_value bigint,
  actual_value bigint,
  shortage_quantity integer,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed')),
  resolution text,
  resolved_by_user_id uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pos_sync_conflicts_open_idx
  ON pos_sync_conflicts (tenant_id, status, created_at)
  WHERE status = 'open';

CREATE TABLE IF NOT EXISTS pos_events (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  register_id uuid REFERENCES pos_registers(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pos_events_tenant_id_idx
  ON pos_events (tenant_id, id);

DROP TRIGGER IF EXISTS pos_registers_set_updated_at ON pos_registers;
CREATE TRIGGER pos_registers_set_updated_at
BEFORE UPDATE ON pos_registers
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS pos_shifts_set_updated_at ON pos_shifts;
CREATE TRIGGER pos_shifts_set_updated_at
BEFORE UPDATE ON pos_shifts
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS pos_transactions_set_updated_at ON pos_transactions;
CREATE TRIGGER pos_transactions_set_updated_at
BEFORE UPDATE ON pos_transactions
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS payment_refunds_set_updated_at ON payment_refunds;
CREATE TRIGGER payment_refunds_set_updated_at
BEFORE UPDATE ON payment_refunds
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS pos_parked_carts_set_updated_at ON pos_parked_carts;
CREATE TRIGGER pos_parked_carts_set_updated_at
BEFORE UPDATE ON pos_parked_carts
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

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
      WHEN o.payment_status IN ('paid', 'partially_refunded', 'refunded')
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
