BEGIN;

ALTER TABLE product_reviews
  ADD COLUMN IF NOT EXISTS contact_consent boolean NOT NULL DEFAULT false;

COMMIT;
