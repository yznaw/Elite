-- 047_pos_card_terminal.sql (2026-10-01)
--
-- Integrated QNB card terminal (ECR semi-integration, Ideal Solutions DLL).
--
-- The till drives the terminal through the local Elite Card Bridge
-- (tools/elite-card-bridge). Every charge, void and refund sent to the
-- terminal is recorded here by its ECR unique transaction number (UTN), so an
-- approval is never lost if the browser, the network or the bridge dies
-- between the terminal approving and the sale being written.
--
-- No card data beyond what the terminal prints is stored: a masked PAN
-- (first 6 + X mask + last 4, enforced by a CHECK), expiry, scheme name and
-- the terminal's own masked e-receipt text. Never add a column for a full PAN,
-- track data, PIN or CVV.
--
-- Affected tables:
--   pos_card_attempts   new: one row per terminal operation (sale/void/refund)
--   pos_registers       + card_mode, card_manual_fallback
--   payments            unique UTN per tenant for integrated card payments
--   pos_z_reports       + card batch (CloseBatch) result
--   pos_manager_overrides  action 'card-resolve' allowed
--
-- Runs on every boot via server/db/pos-schema.js, so every step is idempotent.

-- UP
BEGIN;

CREATE TABLE IF NOT EXISTS pos_card_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  register_id uuid NOT NULL REFERENCES pos_registers(id) ON DELETE RESTRICT,
  shift_id uuid REFERENCES pos_shifts(id) ON DELETE SET NULL,
  utn text NOT NULL,
  kind text NOT NULL,
  amount_cents bigint NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  error_code text,
  message text,
  host_response_code text,
  auth_code text,
  masked_pan text,
  card_expiry text,
  issuer text,
  tid text,
  mid text,
  seq_no text,
  invoice_no text,
  host_trace text,
  txn_at timestamptz,
  entry_method text,
  pin_verified boolean,
  receipt_text text,
  original_attempt_id uuid REFERENCES pos_card_attempts(id) ON DELETE RESTRICT,
  pos_transaction_id uuid REFERENCES pos_transactions(id) ON DELETE RESTRICT,
  pos_refund_id uuid REFERENCES pos_refunds(id) ON DELETE RESTRICT,
  pos_void_id uuid REFERENCES pos_voids(id) ON DELETE RESTRICT,
  resolved_by_user_id uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  resolution_note text,
  created_by_user_id uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pos_card_attempts_utn_key UNIQUE (tenant_id, utn),
  CONSTRAINT pos_card_attempts_utn_format CHECK (utn ~ '^[A-Z0-9]{8,23}$'),
  CONSTRAINT pos_card_attempts_kind_valid CHECK (kind IN ('sale', 'void', 'refund')),
  CONSTRAINT pos_card_attempts_status_valid
    CHECK (status IN ('pending', 'approved', 'declined', 'cancelled', 'unknown', 'reversed')),
  CONSTRAINT pos_card_attempts_amount_positive CHECK (amount_cents > 0),
  CONSTRAINT pos_card_attempts_masked_pan_format
    CHECK (masked_pan IS NULL OR masked_pan ~ '^[0-9]{6}X{2,9}[0-9]{4}$'),
  CONSTRAINT pos_card_attempts_expiry_format
    CHECK (card_expiry IS NULL OR card_expiry ~ '^[0-9]{4}$'),
  CONSTRAINT pos_card_attempts_receipt_size CHECK (receipt_text IS NULL OR length(receipt_text) <= 16000)
);

-- One approved terminal charge pays at most one sale.
CREATE UNIQUE INDEX IF NOT EXISTS pos_card_attempts_transaction_uq
  ON pos_card_attempts (pos_transaction_id) WHERE pos_transaction_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS pos_card_attempts_register_status_idx
  ON pos_card_attempts (tenant_id, register_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS pos_card_attempts_created_idx
  ON pos_card_attempts (tenant_id, created_at DESC);

DROP TRIGGER IF EXISTS pos_card_attempts_set_updated_at ON pos_card_attempts;
CREATE TRIGGER pos_card_attempts_set_updated_at
BEFORE UPDATE ON pos_card_attempts
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 'manual' keeps today's flow (cashier keys the amount and types the approval
-- code). 'integrated' is the till cabled to a QNB terminal through the bridge.
ALTER TABLE pos_registers
  ADD COLUMN IF NOT EXISTS card_mode text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS card_manual_fallback boolean NOT NULL DEFAULT true;

ALTER TABLE pos_z_reports
  ADD COLUMN IF NOT EXISTS card_batch_status text,
  ADD COLUMN IF NOT EXISTS card_batch_closed_at timestamptz,
  ADD COLUMN IF NOT EXISTS card_batch_receipt_text text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_registers_card_mode_valid') THEN
    ALTER TABLE pos_registers
      ADD CONSTRAINT pos_registers_card_mode_valid CHECK (card_mode IN ('manual', 'integrated'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_z_reports_card_batch_status_valid') THEN
    ALTER TABLE pos_z_reports
      ADD CONSTRAINT pos_z_reports_card_batch_status_valid
        CHECK (card_batch_status IS NULL OR card_batch_status IN ('closed', 'empty', 'failed', 'skipped'));
  END IF;
  -- Manager approval for settling a card payment the terminal could not
  -- (card-terminal-service.js resolveAttempt). The 015 check was unnamed.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_manager_overrides_action_valid') THEN
    ALTER TABLE pos_manager_overrides DROP CONSTRAINT IF EXISTS pos_manager_overrides_action_check;
    ALTER TABLE pos_manager_overrides
      ADD CONSTRAINT pos_manager_overrides_action_valid
        CHECK (action IN ('refund', 'void', 'z-report', 'drawer-open', 'sync-conflict-override', 'card-resolve'));
  END IF;
END $$;

-- An integrated payment carries its UTN; one UTN backs one payment.
CREATE UNIQUE INDEX IF NOT EXISTS payments_qnb_ecr_utn_uq
  ON payments (tenant_id, provider_payment_id)
  WHERE provider = 'qnb-ecr';

COMMIT;

-- DOWN (manual):
-- BEGIN;
-- DROP INDEX IF EXISTS payments_qnb_ecr_utn_uq;
-- ALTER TABLE pos_manager_overrides DROP CONSTRAINT IF EXISTS pos_manager_overrides_action_valid;
-- ALTER TABLE pos_manager_overrides ADD CONSTRAINT pos_manager_overrides_action_check
--   CHECK (action IN ('refund', 'void', 'z-report', 'drawer-open', 'sync-conflict-override'));
-- ALTER TABLE pos_z_reports DROP CONSTRAINT IF EXISTS pos_z_reports_card_batch_status_valid;
-- ALTER TABLE pos_z_reports DROP COLUMN IF EXISTS card_batch_receipt_text;
-- ALTER TABLE pos_z_reports DROP COLUMN IF EXISTS card_batch_closed_at;
-- ALTER TABLE pos_z_reports DROP COLUMN IF EXISTS card_batch_status;
-- ALTER TABLE pos_registers DROP CONSTRAINT IF EXISTS pos_registers_card_mode_valid;
-- ALTER TABLE pos_registers DROP COLUMN IF EXISTS card_manual_fallback;
-- ALTER TABLE pos_registers DROP COLUMN IF EXISTS card_mode;
-- DROP TABLE IF EXISTS pos_card_attempts;
-- COMMIT;
