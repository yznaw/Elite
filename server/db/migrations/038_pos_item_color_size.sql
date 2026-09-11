BEGIN;

-- Keep the sold colour and size as receipt snapshots. A receipt must describe
-- the item as it was sold even if the catalogue or reference data changes.
ALTER TABLE pos_transaction_items
  ADD COLUMN IF NOT EXISTS color text,
  ADD COLUMN IF NOT EXISTS color_ar text,
  ADD COLUMN IF NOT EXISTS size text;

-- Older POS rows already have the structured values on their linked order
-- item, so make reprints useful without requiring a new sale.
UPDATE pos_transaction_items AS item
SET color = COALESCE(NULLIF(btrim(item.color), ''), NULLIF(btrim(order_item.metadata ->> 'color'), '')),
    size = COALESCE(NULLIF(btrim(item.size), ''), NULLIF(btrim(order_item.size), ''))
FROM order_items AS order_item
WHERE order_item.id = item.order_item_id
  AND (COALESCE(btrim(item.color), '') = '' OR COALESCE(btrim(item.size), '') = '');

-- Translate legacy colours from the reference list. Prefer the variant's
-- reference id and fall back to the English name for older unlinked colours.
UPDATE pos_transaction_items AS item
SET color_ar = (
  SELECT NULLIF(btrim(reference_color.name_ar), '')
  FROM ref_colors AS reference_color
  LEFT JOIN product_variants AS variant
    ON variant.id = item.variant_id
   AND variant.tenant_id = item.tenant_id
  WHERE reference_color.tenant_id = item.tenant_id
    AND NULLIF(btrim(reference_color.name_ar), '') IS NOT NULL
    AND (
      reference_color.id = variant.color_ref_id
      OR lower(btrim(reference_color.name_en)) = lower(btrim(item.color))
    )
  ORDER BY (reference_color.id = variant.color_ref_id) DESC
  LIMIT 1
)
WHERE COALESCE(btrim(item.color_ar), '') = ''
  AND COALESCE(btrim(item.color), '') <> '';

COMMIT;
