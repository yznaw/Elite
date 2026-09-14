-- 040_ref_color_arabic_names.sql
-- Date: 2026-09-14
-- Tables: ref_colors, pos_transaction_items
--
-- POS receipts print a colour's Arabic name from ref_colors. Many variant
-- colours were typed on products but never added to Reference Data (or were
-- added without Arabic), so receipts fell back to English. This file:
--   1. fills a blank name_ar on existing reference colours,
--   2. adds the reference colour for tenants whose variants use it,
--   3. re-translates POS sale lines already stored without color_ar.
--
-- Runs at every boot from db/pos-schema.js, so every step is idempotent and
-- never overwrites an Arabic name staff already entered. Supplier codes and
-- trade names with no clear meaning (Accadue, Cosmo, Tonka, N10, ...) are
-- deliberately left out; add those in Reference Data by hand.
--
-- DOWN (manual; not executed): translations are data, not schema. To undo,
--   DELETE FROM ref_colors WHERE created_at >= '<deploy time>' AND name_en IN (...);
-- pos_transaction_items.color_ar is a receipt snapshot and is left as is.

BEGIN;

CREATE TEMP TABLE color_ar_seed (name_en text, name_ar text, hex text) ON COMMIT DROP;

INSERT INTO color_ar_seed (name_en, name_ar, hex) VALUES
  ('Abette',                     'أخضر التنوب',              '#3B5A40'),
  ('Alloro',                     'أخضر الغار',               '#6B7B3A'),
  ('Aloe',                       'أخضر الصبار',              '#8A9A5B'),
  ('Ash Grey',                   'رمادي الرماد',             '#B2BEB5'),
  ('Avio',                       'أزرق رمادي',               '#5D8AA8'),
  ('Beige',                      'بيج',                      '#D9C3A0'),
  ('Beige Croco Leather',        'بيج جلد تمساح',            '#D9C3A0'),
  ('Black Croco Leather',        'أسود جلد تمساح',           '#1A1A1A'),
  ('Bottiglia',                  'أخضر زجاجي',               '#1E4D2B'),
  ('Bourbon',                    'بني بوربون',               '#6F3B1F'),
  ('Brown Ostrich Leather',      'بني جلد نعام',             '#8B4513'),
  ('Camello',                    'جملي',                     '#C19A6B'),
  ('Cappuccino',                 'كابتشينو',                 '#A67B5B'),
  ('Cardamomo',                  'لون الهيل',                '#9A9A5A'),
  ('Castoro',                    'بني القندس',               '#705040'),
  ('Chestnut',                   'كستنائي',                  '#954535'),
  ('Cinder',                     'رمادي فحمي',               '#5A5A5A'),
  ('Copper',                     'نحاسي',                    '#B87333'),
  ('Copper Brown',               'بني نحاسي',                '#9A5B3A'),
  ('Dark Blue',                  'أزرق داكن',                '#1F3A68'),
  ('Dark Brown Ostrich Leather', 'بني داكن جلد نعام',        '#5C2E00'),
  ('Deep Brown',                 'بني غامق',                 '#4A2A17'),
  ('Green',                      'أخضر',                     '#2E7D4F'),
  ('Grey Croco Leather',         'رمادي جلد تمساح',          '#808080'),
  ('Grey Ostrich Leather',       'رمادي جلد نعام',           '#808080'),
  ('GreySerp',                   'رمادي جلد ثعبان',          '#808080'),
  ('Grigioliva',                 'رمادي زيتي',               '#7A7A5E'),
  ('Irish Blue - Chocolate',     'أزرق إيرلندي - شوكولاتة', '#2E4A7A'),
  ('Irish Blue -Navy',           'أزرق إيرلندي - كحلي',     '#2E4A7A'),
  ('Latte',                      'لاتيه',                    '#C8A882'),
  ('Light Beige',                'بيج فاتح',                 '#EDE0C8'),
  ('Light Beige Croco Leather',  'بيج فاتح جلد تمساح',       '#EDE0C8'),
  ('Light Blue',                 'أزرق فاتح',                '#9CC3E0'),
  ('Light Brown',                'بني فاتح',                 '#A67B5B'),
  ('Light Grey',                 'رمادي فاتح',               '#D3D3D3'),
  ('Military',                   'زيتي عسكري',               '#4B5320'),
  ('Milk',                       'حليبي',                    '#F5F0E6'),
  ('Milk-Offwhite',              'حليبي - أوف وايت',         '#F5F0E6'),
  ('Mou',                        'توفي',                     '#A0673A'),
  ('Mustard',                    'خردلي',                    '#C9A227'),
  ('Navy Blue',                  'كحلي',                     '#1A1A2E'),
  ('Navy Croco Leather',         'كحلي جلد تمساح',           '#1A1A2E'),
  ('Navy Ostrich Leather',       'كحلي جلد نعام',            '#1A1A2E'),
  ('Navy-Brown',                 'كحلي - بني',               '#1A1A2E'),
  ('Nero',                       'أسود',                     '#1A1A1A'),
  ('Nicotine',                   'تبغي',                     '#8B6F3E'),
  ('Noce',                       'جوزي',                     '#5D4030'),
  ('Notte',                      'كحلي داكن',                '#1C2233'),
  ('Nube',                       'رمادي سحابي',              '#C9C9C4'),
  ('Nut Cream',                  'كريمي بندقي',              '#D8C3A5'),
  ('Olive Beige',                'بيج زيتي',                 '#B5A882'),
  ('Olive Green',                'أخضر زيتي',                '#6B7C47'),
  ('Perla',                      'لؤلؤي',                    '#EAE0C8'),
  ('Plaster',                    'لون الجبس',                '#E8E2D6'),
  ('Salvia',                     'أخضر المريمية',            '#8A9A7B'),
  ('Sandy Brown',                'بني رملي',                 '#C49A6C'),
  ('Seppia',                     'بني سيبيا',                '#704214'),
  ('Serpertine',                 'جلد ثعبان',                '#7A7A6A'),
  ('Silver',                     'فضي',                      '#C0C0C0'),
  ('T.Moro',                     'بني غامق',                 '#3D2B1F'),
  ('Taupe',                      'رمادي مائل للبني',         '#8B7D6B'),
  ('White Ostrich Leather',      'أبيض جلد نعام',            '#F5F5F0'),
  ('Zinc',                       'رمادي زنكي',               '#7D7F7D');

-- 1. Existing reference colours with a blank Arabic name.
UPDATE ref_colors AS rc
SET name_ar = seed.name_ar
FROM color_ar_seed AS seed
WHERE lower(btrim(rc.name_en)) = lower(seed.name_en)
  AND COALESCE(btrim(rc.name_ar), '') = '';

-- 2. Colours used on a tenant's variants but missing from its reference list.
--    Scoped to tenants that actually use the colour so other brands' lists
--    are not padded with names they never sell.
INSERT INTO ref_colors (tenant_id, name_en, name_ar, hex, sort_order)
SELECT used.tenant_id, seed.name_en, seed.name_ar, seed.hex,
       COALESCE((SELECT max(sort_order) FROM ref_colors WHERE tenant_id = used.tenant_id), 0)
         + 10 * row_number() OVER (PARTITION BY used.tenant_id ORDER BY seed.name_en)
FROM color_ar_seed AS seed
JOIN (
  SELECT DISTINCT tenant_id, lower(btrim(color)) AS color_key
  FROM product_variants
  WHERE COALESCE(btrim(color), '') <> ''
) AS used ON used.color_key = lower(seed.name_en)
WHERE NOT EXISTS (
  SELECT 1 FROM ref_colors AS rc
  WHERE rc.tenant_id = used.tenant_id
    AND lower(btrim(rc.name_en)) = lower(seed.name_en)
);

-- 3. Sale lines stored before their colour had an Arabic name. Same lookup
--    the sale path uses: linked reference colour first, then English name.
UPDATE pos_transaction_items AS item
SET color_ar = (
  SELECT btrim(reference_color.name_ar)
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
  ORDER BY (reference_color.id = variant.color_ref_id) DESC NULLS LAST
  LIMIT 1
)
WHERE COALESCE(btrim(item.color_ar), '') = ''
  AND COALESCE(btrim(item.color), '') <> '';

COMMIT;
