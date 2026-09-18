-- Read-only baseline for docs/36-customer-identity-collision-fix.md.
-- Run after the production snapshot, before deploying, and save the output.
BEGIN READ ONLY;

SELECT now() AS captured_at, current_database() AS database;

-- NULL means migration 023 skipped the index. Repairing existing duplicates
-- and creating the index require a separate, deliberate change.
SELECT to_regclass('customers_tenant_phone_key_idx') AS phone_unique_index;
SELECT indexrelid::regclass AS index_name, indisvalid, indisready
  FROM pg_index
 WHERE indexrelid = to_regclass('customers_tenant_phone_key_idx');

-- Record the actual constraint names: unnamed UNIQUE(tenant_id, email) in
-- migration 001 is normally customers_tenant_id_email_key.
SELECT conname, pg_get_constraintdef(oid) AS definition
  FROM pg_constraint
 WHERE conrelid = 'customers'::regclass AND contype = 'u';

SELECT count(*) AS duplicate_live_phone_groups
  FROM (SELECT tenant_id, phone_key FROM customers
         WHERE phone_key IS NOT NULL AND deleted_at IS NULL
         GROUP BY tenant_id, phone_key HAVING count(*) > 1) duplicates;
SELECT tenant_id, phone_key, count(*) AS customers,
       array_agg(id ORDER BY created_at, id) AS customer_ids
  FROM customers WHERE phone_key IS NOT NULL AND deleted_at IS NULL
 GROUP BY tenant_id, phone_key HAVING count(*) > 1;

SELECT count(*) AS deleted_email_holders
  FROM customers WHERE deleted_at IS NOT NULL AND email IS NOT NULL;

-- Heuristic only; matching names do not prove that two people are the same.
-- No UUID ordering filter: the email-only/phone-only predicates already
-- distinguish the sides, and ordering UUIDs would miss half the candidates.
WITH candidates AS (
  SELECT a.tenant_id, a.id AS email_customer_id, b.id AS phone_customer_id,
         a.email, b.phone_key
    FROM customers a JOIN customers b ON a.tenant_id = b.tenant_id
   WHERE a.deleted_at IS NULL AND b.deleted_at IS NULL
     AND a.email IS NOT NULL AND a.phone_key IS NULL
     AND b.email IS NULL AND b.phone_key IS NOT NULL
     AND lower(a.full_name) = lower(b.full_name)
)
SELECT *, count(*) OVER () AS candidate_pairs FROM candidates;

COMMIT;
