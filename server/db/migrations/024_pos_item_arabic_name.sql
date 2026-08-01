-- Arabic product name on the printed receipt (owner decision, 2026-08-01).
--
-- The receipt itself stays English — headers, labels, totals — but each item
-- line shows the product's Arabic name stacked above its English name, so a
-- customer reading Arabic can recognise what they bought. Qatari commercial
-- law allows a receipt in either language; the Arabic-mandatory rule applies
-- to tax invoices, and Qatar has no sales tax, so this is a readability
-- decision rather than a compliance one.
--
-- Snapshotted onto the transaction item, not joined from product_translations
-- at print time, for the same reason `product_name` already is: a receipt
-- reprinted a year later must show what was actually sold, not what the
-- catalogue says today. Renaming or retranslating a product must never
-- retroactively rewrite a customer's receipt.

BEGIN;

ALTER TABLE pos_transaction_items
  ADD COLUMN IF NOT EXISTS product_name_ar text;

COMMIT;
