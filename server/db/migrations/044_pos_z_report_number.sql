-- 044_pos_z_report_number.sql (2026-09-22)
--
-- A readable closing number and business date for every Z-report, so the
-- printed Z, the Excel breakdown and the office all refer to a closing the
-- same way ("Z-2109-2026-001") instead of by UUID.
--
--   business_date  the Qatar calendar day the shift was OPENED. A shift closed
--                  after midnight, or through morning recovery, still belongs
--                  to the day it sold.
--   z_number       Z-DDMM-YYYY-NNN, NNN counting closings of that branch on
--                  that business date. No branch code in the number (the
--                  team's format), so it is unique per branch, not per tenant.
--
-- Affected tables: pos_z_reports (+ business_date, + z_number, unique index).
-- Runs on every boot via server/db/pos-schema.js; idempotent.

-- UP
BEGIN;

ALTER TABLE pos_z_reports ADD COLUMN IF NOT EXISTS business_date date;
ALTER TABLE pos_z_reports ADD COLUMN IF NOT EXISTS z_number text;

-- Backfill closings written before this migration.
UPDATE pos_z_reports z
   SET business_date = ((s.opened_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Qatar')::date
  FROM pos_shifts s
 WHERE s.id = z.shift_id AND z.business_date IS NULL;

WITH numbered AS (
  SELECT z.id,
         z.business_date,
         row_number() OVER (
           PARTITION BY z.tenant_id, z.branch_id, z.business_date
           ORDER BY z.created_at, z.id
         ) AS seq
    FROM pos_z_reports z
)
UPDATE pos_z_reports z
   SET z_number = 'Z-' || to_char(n.business_date, 'DDMM-YYYY') || '-' || lpad(n.seq::text, 3, '0')
  FROM numbered n
 WHERE n.id = z.id AND z.z_number IS NULL AND n.business_date IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS pos_z_reports_branch_number_uq
  ON pos_z_reports (tenant_id, branch_id, z_number)
  WHERE z_number IS NOT NULL;

COMMIT;

-- DOWN (manual):
-- BEGIN;
-- DROP INDEX IF EXISTS pos_z_reports_branch_number_uq;
-- ALTER TABLE pos_z_reports DROP COLUMN IF EXISTS z_number;
-- ALTER TABLE pos_z_reports DROP COLUMN IF EXISTS business_date;
-- COMMIT;
