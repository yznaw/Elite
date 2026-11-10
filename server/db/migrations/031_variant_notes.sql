-- Per-variant note, bilingual (owner request, 2026-08-23).
--
-- The same product can differ in a construction detail between size ranges:
-- the 2-4 sizes ship with a back zipper, the 6-10 sizes do not. Re-shooting
-- the whole gallery per size range is not affordable, and burning the text
-- onto the photo does not translate. So the difference is carried as copy on
-- the variant instead, and the storefront surfaces it next to the size the
-- customer actually picked.
--
-- Stored on product_variants (not products) because the note is a property of
-- the specific size/colour combination. Two plain text columns rather than a
-- jsonb blob so the values stay queryable and mirror the ar/en split already
-- used by product_translations.

BEGIN;

ALTER TABLE product_variants
  ADD COLUMN IF NOT EXISTS note_en text,
  ADD COLUMN IF NOT EXISTS note_ar text;

COMMIT;
