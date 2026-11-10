-- 043_pos_sadad_payment.sql (2026-09-22)
--
-- Adds Sadad as a third POS tender next to cash and card.
--
-- The customer pays by Sadad QR, link or app on their own phone; there is no
-- API link between Sadad and the till, so the cashier confirms the payment in
-- the Sadad merchant app and types its transaction ID. It is stored where the
-- card terminal reference already lives (payments.terminal_reference) and is
-- required by server/lib/pos/sale-service.js, same trust model as card.
--
-- Affected tables:
--   pos_transactions        + sadad_amount_cents, payment_method/shape checks widened
--   pos_refunds             method check widened
--   payment_refunds         method check widened
--   pos_z_reports           + sadad_sales_cents
--   payments                unique Sadad reference per tenant (anti-reuse)
--   pos_card_reconciliation + method, unique key now per method
--
-- Runs on every boot via server/db/pos-schema.js, so every step is idempotent
-- and the constraint swaps only fire once (guarded on the new names), which
-- avoids re-validating pos_transactions on each restart.

-- UP
BEGIN;

ALTER TABLE pos_transactions
  ADD COLUMN IF NOT EXISTS sadad_amount_cents bigint NOT NULL DEFAULT 0;

ALTER TABLE pos_z_reports
  ADD COLUMN IF NOT EXISTS sadad_sales_cents bigint NOT NULL DEFAULT 0;

ALTER TABLE pos_card_reconciliation
  ADD COLUMN IF NOT EXISTS method text NOT NULL DEFAULT 'card';

DO $$
DECLARE
  c record;
BEGIN
  -- pos_transactions: the 015 checks were unnamed; find them by definition.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_transactions_payment_shape_check') THEN
    FOR c IN
      SELECT conname FROM pg_constraint
      WHERE conrelid = 'pos_transactions'::regclass AND contype = 'c'
        AND (pg_get_constraintdef(oid) LIKE '%payment_method%')
    LOOP
      EXECUTE format('ALTER TABLE pos_transactions DROP CONSTRAINT %I', c.conname);
    END LOOP;

    ALTER TABLE pos_transactions
      ADD CONSTRAINT pos_transactions_payment_method_valid
        CHECK (payment_method IN ('cash', 'card', 'sadad')),
      ADD CONSTRAINT pos_transactions_sadad_amount_nonnegative
        CHECK (sadad_amount_cents >= 0),
      ADD CONSTRAINT pos_transactions_payment_shape_check CHECK (
        (payment_method = 'cash'
          AND cash_amount_cents = total_cents
          AND card_amount_cents = 0
          AND sadad_amount_cents = 0
          AND amount_tendered_cents >= total_cents
          AND change_given_cents = amount_tendered_cents - total_cents)
        OR
        (payment_method = 'card'
          AND card_amount_cents = total_cents
          AND cash_amount_cents = 0
          AND sadad_amount_cents = 0
          AND amount_tendered_cents = 0
          AND change_given_cents = 0)
        OR
        (payment_method = 'sadad'
          AND sadad_amount_cents = total_cents
          AND cash_amount_cents = 0
          AND card_amount_cents = 0
          AND amount_tendered_cents = 0
          AND change_given_cents = 0)
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_refunds_method_valid') THEN
    ALTER TABLE pos_refunds DROP CONSTRAINT IF EXISTS pos_refunds_method_check;
    ALTER TABLE pos_refunds
      ADD CONSTRAINT pos_refunds_method_valid CHECK (method IN ('cash', 'card', 'sadad'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_refunds_method_valid') THEN
    ALTER TABLE payment_refunds DROP CONSTRAINT IF EXISTS payment_refunds_method_check;
    ALTER TABLE payment_refunds
      ADD CONSTRAINT payment_refunds_method_valid CHECK (method IN ('cash', 'card', 'sadad'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_z_reports_sadad_sales_nonnegative') THEN
    ALTER TABLE pos_z_reports
      ADD CONSTRAINT pos_z_reports_sadad_sales_nonnegative CHECK (sadad_sales_cents >= 0);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_card_reconciliation_method_valid') THEN
    ALTER TABLE pos_card_reconciliation
      ADD CONSTRAINT pos_card_reconciliation_method_valid CHECK (method IN ('card', 'sadad'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_card_reconciliation_day_method_key') THEN
    ALTER TABLE pos_card_reconciliation
      DROP CONSTRAINT IF EXISTS pos_card_reconciliation_tenant_id_register_id_business_date_key;
    ALTER TABLE pos_card_reconciliation
      ADD CONSTRAINT pos_card_reconciliation_day_method_key
        UNIQUE (tenant_id, register_id, business_date, method);
  END IF;
END $$;

-- One Sadad confirmation can back exactly one sale. Scoped to Sadad so
-- historical card references (never checked for reuse) cannot collide.
CREATE UNIQUE INDEX IF NOT EXISTS payments_pos_sadad_reference_uq
  ON payments (tenant_id, terminal_reference)
  WHERE provider = 'pos-manual' AND method = 'sadad';

COMMIT;

-- DOWN (manual; only once no Sadad rows exist, otherwise the old checks fail):
-- BEGIN;
-- DROP INDEX IF EXISTS payments_pos_sadad_reference_uq;
-- ALTER TABLE pos_card_reconciliation DROP CONSTRAINT IF EXISTS pos_card_reconciliation_day_method_key;
-- ALTER TABLE pos_card_reconciliation DROP CONSTRAINT IF EXISTS pos_card_reconciliation_method_valid;
-- ALTER TABLE pos_card_reconciliation DROP COLUMN IF EXISTS method;
-- ALTER TABLE pos_card_reconciliation ADD CONSTRAINT pos_card_reconciliation_tenant_id_register_id_business_date_key
--   UNIQUE (tenant_id, register_id, business_date);
-- ALTER TABLE pos_z_reports DROP CONSTRAINT IF EXISTS pos_z_reports_sadad_sales_nonnegative;
-- ALTER TABLE pos_z_reports DROP COLUMN IF EXISTS sadad_sales_cents;
-- ALTER TABLE payment_refunds DROP CONSTRAINT IF EXISTS payment_refunds_method_valid;
-- ALTER TABLE payment_refunds ADD CONSTRAINT payment_refunds_method_check CHECK (method IN ('cash', 'card'));
-- ALTER TABLE pos_refunds DROP CONSTRAINT IF EXISTS pos_refunds_method_valid;
-- ALTER TABLE pos_refunds ADD CONSTRAINT pos_refunds_method_check CHECK (method IN ('cash', 'card'));
-- ALTER TABLE pos_transactions DROP CONSTRAINT IF EXISTS pos_transactions_payment_shape_check;
-- ALTER TABLE pos_transactions DROP CONSTRAINT IF EXISTS pos_transactions_sadad_amount_nonnegative;
-- ALTER TABLE pos_transactions DROP CONSTRAINT IF EXISTS pos_transactions_payment_method_valid;
-- ALTER TABLE pos_transactions DROP COLUMN IF EXISTS sadad_amount_cents;
-- ALTER TABLE pos_transactions ADD CONSTRAINT pos_transactions_payment_method_check CHECK (payment_method IN ('cash', 'card'));
-- ALTER TABLE pos_transactions ADD CONSTRAINT pos_transactions_check1 CHECK (
--   (payment_method = 'cash' AND cash_amount_cents = total_cents AND card_amount_cents = 0
--     AND amount_tendered_cents >= total_cents AND change_given_cents = amount_tendered_cents - total_cents)
--   OR (payment_method = 'card' AND card_amount_cents = total_cents AND cash_amount_cents = 0
--     AND amount_tendered_cents = 0 AND change_given_cents = 0));
-- COMMIT;
