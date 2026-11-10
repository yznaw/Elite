-- Customer identity shared between the till and the website
-- (docs/25-pos-readiness-master-plan.md Phase 5).
--
-- Two problems this fixes:
--
-- 1. `customers.email` was NOT NULL, so a walk-in identified only by a phone
--    number could not be recorded at all. The alternative — synthesising a
--    fake address like `+974...@pos.local` — would pollute the customer list
--    and, worse, become a real recipient for receipt email. Email becomes
--    optional instead. The UNIQUE (tenant_id, email) constraint is unaffected
--    for real addresses: Postgres treats NULLs as distinct, so any number of
--    phone-only customers can coexist.
--
-- 2. The two channels identified customers by different keys — the website
--    upserts on email (carts.route.js), the POS searches on phone — so the
--    same person buying online and at the till became two rows with split
--    history and split LTV. A normalized phone key gives both channels one
--    identity to match on.

BEGIN;

ALTER TABLE customers ALTER COLUMN email DROP NOT NULL;

-- Digits-only form of whichever phone column holds a value. `phone_number`
-- (migration 013) is the newer column the admin portal and POS write; `phone`
-- is the original one the storefront checkout writes. Normalising here means
-- neither channel has to know about the other's column choice, and formatting
-- differences ("+974 5551 2345" vs "97455512345") stop creating duplicates.
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS phone_key text
  GENERATED ALWAYS AS (
    NULLIF(regexp_replace(COALESCE(phone_number, phone, ''), '[^0-9]', '', 'g'), '')
  ) STORED;

-- Lookup index always. Cheap, and it is what the POS phone search uses.
CREATE INDEX IF NOT EXISTS customers_tenant_phone_lookup_idx
  ON customers (tenant_id, phone_key)
  WHERE deleted_at IS NULL;

-- One live customer per phone number — but only if the existing data already
-- satisfies it. Creating this unconditionally would fail on any tenant that
-- already has two rows sharing a phone, and because migrations run at boot
-- inside a try/catch that only warns, the failure would silently leave this
-- whole file unapplied. Deduplicating automatically is not an option either:
-- merging two customers means merging order history and LTV, which is a
-- decision for a human, not a migration.
--
-- So: enforce it where it holds, and leave a clear notice where it does not.
-- The application-level matcher in server/lib/customer-identity.js is the
-- primary guard in both cases; this index is defence in depth.
DO $$
DECLARE
  duplicate_count integer;
BEGIN
  SELECT count(*) INTO duplicate_count
    FROM (
      SELECT tenant_id, phone_key
        FROM customers
       WHERE phone_key IS NOT NULL AND deleted_at IS NULL
       GROUP BY tenant_id, phone_key
      HAVING count(*) > 1
    ) duplicates;

  IF duplicate_count = 0 THEN
    CREATE UNIQUE INDEX IF NOT EXISTS customers_tenant_phone_key_idx
      ON customers (tenant_id, phone_key)
      WHERE phone_key IS NOT NULL AND deleted_at IS NULL;
  ELSE
    RAISE NOTICE 'customers_tenant_phone_key_idx not created: % phone number(s) are shared by more than one live customer. Merge them by hand, then re-run this migration.', duplicate_count;
  END IF;
END
$$;

COMMIT;
