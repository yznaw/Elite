-- Reliable restock requests, claims, consent and retention.
-- 2026-09-14; affects restock_notifications and privacy policies.
-- UP
BEGIN;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE OR REPLACE FUNCTION restock_color_key(value text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE lower(btrim(coalesce(value, '')))
    WHEN 'brwon' THEN 'brown' WHEN 'cezzane' THEN 'cezanne'
    WHEN 'greyserp' THEN 'grey serpentine' WHEN 'serpertine' THEN 'serpentine'
    ELSE lower(btrim(coalesce(value, ''))) END;
$$;
CREATE TABLE IF NOT EXISTS restock_notifications (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  email citext NOT NULL, name text, phone text, size text NOT NULL, color text,
  locale text NOT NULL DEFAULT 'en', status text NOT NULL DEFAULT 'pending',
  requested_at timestamptz NOT NULL DEFAULT now(), notified_at timestamptz,
  last_error text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE restock_notifications
  ADD COLUMN IF NOT EXISTS color_key text,
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS claim_token uuid,
  ADD COLUMN IF NOT EXISTS unsubscribe_token uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE restock_notifications DROP CONSTRAINT IF EXISTS restock_notifications_status_check;
ALTER TABLE restock_notifications ADD CONSTRAINT restock_notifications_status_check
  CHECK (status IN ('pending', 'sending', 'notified', 'failed', 'cancelled'));
DROP INDEX IF EXISTS restock_notifications_pending_unique_idx;
UPDATE restock_notifications SET color_key = restock_color_key(color) WHERE color_key IS NULL;
UPDATE restock_notifications rn SET size = 'ONE_SIZE'
WHERE size = '0' AND NOT EXISTS (
  SELECT 1 FROM product_variants pv WHERE pv.product_id = rn.product_id AND nullif(btrim(pv.size), '') IS NOT NULL
);
-- Aliases could previously create duplicate subscriptions. Keep the oldest consent.
WITH duplicates AS (
  SELECT id, row_number() OVER (PARTITION BY tenant_id, product_id, email, size, color_key ORDER BY requested_at, id) AS n
  FROM restock_notifications WHERE status IN ('pending', 'sending')
)
UPDATE restock_notifications SET status = 'cancelled', updated_at = now()
WHERE id IN (SELECT id FROM duplicates WHERE n > 1);
ALTER TABLE restock_notifications ALTER COLUMN color_key SET NOT NULL;
CREATE OR REPLACE FUNCTION set_restock_color_key() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.color_key := restock_color_key(NEW.color); RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS restock_notifications_color_key ON restock_notifications;
CREATE TRIGGER restock_notifications_color_key BEFORE INSERT OR UPDATE OF color
ON restock_notifications FOR EACH ROW EXECUTE FUNCTION set_restock_color_key();
CREATE UNIQUE INDEX IF NOT EXISTS restock_notifications_open_unique_idx
  ON restock_notifications (tenant_id, product_id, email, size, color_key) WHERE status IN ('pending', 'sending');
CREATE INDEX IF NOT EXISTS restock_notifications_due_idx
  ON restock_notifications (status, next_attempt_at) WHERE status IN ('pending', 'sending');
CREATE INDEX IF NOT EXISTS restock_notifications_product_idx ON restock_notifications (tenant_id, product_id, requested_at);
CREATE UNIQUE INDEX IF NOT EXISTS restock_notifications_unsubscribe_idx ON restock_notifications (unsubscribe_token);
DROP TRIGGER IF EXISTS restock_notifications_set_updated_at ON restock_notifications;
CREATE TRIGGER restock_notifications_set_updated_at BEFORE UPDATE ON restock_notifications
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
-- Archive cancels consent immediately, even if the product is reactivated before the next poll.
CREATE OR REPLACE FUNCTION cancel_archived_restock_requests() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status <> 'active' THEN
    UPDATE restock_notifications SET status = 'cancelled', claimed_at = NULL, claim_token = NULL
    WHERE product_id = NEW.id AND status IN ('pending', 'sending');
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS products_cancel_restock ON products;
CREATE TRIGGER products_cancel_restock AFTER UPDATE OF status ON products
FOR EACH ROW EXECUTE FUNCTION cancel_archived_restock_requests();
UPDATE policies SET content = content || '<p data-restock-consent="1">If you request a restock alert, we use your email only to tell you when the selected item returns. You can unsubscribe at any time.</p>'
WHERE policy_type = 'privacy_policy' AND content NOT LIKE '%data-restock-consent%';
UPDATE policies SET content_ar = coalesce(content_ar, '') || '<p data-restock-consent="1">إذا طلبت تنبيهاً بتوفر المنتج، نستخدم بريدك الإلكتروني فقط لإبلاغك بعودة القطعة التي اخترتها. يمكنك إلغاء الاشتراك في أي وقت.</p>'
WHERE policy_type = 'privacy_policy' AND coalesce(content_ar, '') NOT LIKE '%data-restock-consent%';
COMMIT;
-- DOWN (manual; preserve historical requests, cancel claims before deploying the old API):
-- BEGIN;
-- DROP TRIGGER IF EXISTS products_cancel_restock ON products;
-- DROP FUNCTION IF EXISTS cancel_archived_restock_requests();
-- DROP TRIGGER IF EXISTS restock_notifications_color_key ON restock_notifications;
-- DROP FUNCTION IF EXISTS set_restock_color_key();
-- DROP INDEX IF EXISTS restock_notifications_open_unique_idx;
-- DROP INDEX IF EXISTS restock_notifications_due_idx;
-- DROP INDEX IF EXISTS restock_notifications_product_idx;
-- DROP INDEX IF EXISTS restock_notifications_unsubscribe_idx;
-- ALTER TABLE restock_notifications DROP CONSTRAINT restock_notifications_status_check;
-- UPDATE restock_notifications SET status = 'cancelled' WHERE status IN ('sending', 'failed');
-- ALTER TABLE restock_notifications ADD CONSTRAINT restock_notifications_status_check CHECK (status IN ('pending', 'notified', 'cancelled'));
-- ALTER TABLE restock_notifications DROP COLUMN color_key, DROP COLUMN attempts, DROP COLUMN next_attempt_at, DROP COLUMN claimed_at, DROP COLUMN claim_token, DROP COLUMN unsubscribe_token;
-- CREATE UNIQUE INDEX restock_notifications_pending_unique_idx ON restock_notifications (tenant_id, product_id, email, size, lower(coalesce(color, ''))) WHERE status = 'pending';
-- DROP FUNCTION restock_color_key(text);
-- UPDATE policies SET content = regexp_replace(content, '<p data-restock-consent="1">.*?</p>', '', 'g'), content_ar = regexp_replace(content_ar, '<p data-restock-consent="1">.*?</p>', '', 'g');
-- COMMIT;
