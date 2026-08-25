-- Bilingual policy title and content.
--
-- policies had one title/content pair, English only, so the storefront's
-- Arabic locale fell back to showing English legal copy — the one page type
-- with no ar/en split, unlike products (descriptionEn/Ar) and variant notes
-- (migration 031). Two plain text columns to match that existing pattern.
--
-- Both nullable: existing rows fall back to title/content in Arabic until an
-- admin fills these in (see policy.component.ts on the storefront).

BEGIN;

ALTER TABLE policies
  ADD COLUMN IF NOT EXISTS title_ar   text,
  ADD COLUMN IF NOT EXISTS content_ar text;

COMMIT;
