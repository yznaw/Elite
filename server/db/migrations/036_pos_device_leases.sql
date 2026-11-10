-- One live browser lease per POS register.
--
-- Existing installations receive a fresh lease id at deploy time. Their next
-- POS request is deliberately rejected as a stale lease; the client then uses
-- its already-stored register credential to check in once and receives the new
-- signed lease cookie. This upgrades genuine terminals without trusting old
-- register-id-only cookies, which could not prove which device owned a till.

BEGIN;

ALTER TABLE pos_registers
  ADD COLUMN IF NOT EXISTS device_lease_id uuid DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS device_lease_claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS device_lease_claimed_by_user_id uuid REFERENCES admin_users(id) ON DELETE SET NULL;

ALTER TABLE pos_register_enrollment_tokens
  ADD COLUMN IF NOT EXISTS replacement_register_id uuid REFERENCES pos_registers(id) ON DELETE SET NULL;

UPDATE pos_registers
   SET device_lease_id = gen_random_uuid()
 WHERE device_lease_id IS NULL;

ALTER TABLE pos_registers
  ALTER COLUMN device_lease_id SET DEFAULT gen_random_uuid(),
  ALTER COLUMN device_lease_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS pos_registers_device_lease_idx
  ON pos_registers (tenant_id, id, device_lease_id)
  WHERE status = 'active';

COMMIT;
