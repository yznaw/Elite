-- Migration 003: Reference data tables
-- Colors, Materials, and Size Sets used as dropdowns across the admin portal.
BEGIN;

CREATE TABLE ref_colors (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name_en      text NOT NULL,
  name_ar      text NOT NULL DEFAULT '',
  hex          text NOT NULL DEFAULT '#000000',
  sort_order   int  NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ref_colors_tenant ON ref_colors(tenant_id);
CREATE TRIGGER ref_colors_set_updated_at
  BEFORE UPDATE ON ref_colors FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE ref_materials (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name_en      text NOT NULL,
  name_ar      text NOT NULL DEFAULT '',
  sort_order   int  NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ref_materials_tenant ON ref_materials(tenant_id);
CREATE TRIGGER ref_materials_set_updated_at
  BEFORE UPDATE ON ref_materials FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Size sets hold named groups of sizes (e.g. "Men's Footwear" → ["39","40","41",...])
CREATE TABLE ref_size_sets (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name         text NOT NULL,
  sizes        jsonb NOT NULL DEFAULT '[]',
  sort_order   int  NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ref_size_sets_tenant ON ref_size_sets(tenant_id);
CREATE TRIGGER ref_size_sets_set_updated_at
  BEFORE UPDATE ON ref_size_sets FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Seed sensible defaults for the elite-collection tenant
INSERT INTO ref_colors (tenant_id, name_en, name_ar, hex, sort_order)
SELECT id, 'White',       'أبيض',       '#FFFFFF', 0 FROM tenants WHERE slug = 'elite-collection'
UNION ALL
SELECT id, 'Cream',       'كريمي',      '#FFFDD0', 1 FROM tenants WHERE slug = 'elite-collection'
UNION ALL
SELECT id, 'Camel',       'جملي',       '#C19A6B', 2 FROM tenants WHERE slug = 'elite-collection'
UNION ALL
SELECT id, 'Tan',         'أسمر',       '#D2B48C', 3 FROM tenants WHERE slug = 'elite-collection'
UNION ALL
SELECT id, 'Brown',       'بني',        '#8B4513', 4 FROM tenants WHERE slug = 'elite-collection'
UNION ALL
SELECT id, 'Dark Brown',  'بني داكن',   '#5C2E00', 5 FROM tenants WHERE slug = 'elite-collection'
UNION ALL
SELECT id, 'Black',       'أسود',       '#1A1A1A', 6 FROM tenants WHERE slug = 'elite-collection'
UNION ALL
SELECT id, 'Navy',        'كحلي',       '#1A1A2E', 7 FROM tenants WHERE slug = 'elite-collection'
UNION ALL
SELECT id, 'Dark Green',  'أخضر داكن',  '#1B4332', 8 FROM tenants WHERE slug = 'elite-collection'
UNION ALL
SELECT id, 'Olive',       'زيتي',       '#6B7C47', 9 FROM tenants WHERE slug = 'elite-collection'
UNION ALL
SELECT id, 'Grey',        'رمادي',      '#808080', 10 FROM tenants WHERE slug = 'elite-collection'
UNION ALL
SELECT id, 'Burgundy',    'عنابي',      '#800020', 11 FROM tenants WHERE slug = 'elite-collection'
UNION ALL
SELECT id, 'Gold',        'ذهبي',       '#C9A84C', 12 FROM tenants WHERE slug = 'elite-collection';

INSERT INTO ref_materials (tenant_id, name_en, name_ar, sort_order)
SELECT id, 'Full-Grain Leather', 'جلد كامل الحبيبات',  0 FROM tenants WHERE slug = 'elite-collection'
UNION ALL
SELECT id, 'Calf Leather',       'جلد العجل',          1 FROM tenants WHERE slug = 'elite-collection'
UNION ALL
SELECT id, 'Suede',              'سويد',                2 FROM tenants WHERE slug = 'elite-collection'
UNION ALL
SELECT id, 'Nubuck',             'نوبوك',               3 FROM tenants WHERE slug = 'elite-collection'
UNION ALL
SELECT id, 'Patent Leather',     'جلد مصقول',          4 FROM tenants WHERE slug = 'elite-collection'
UNION ALL
SELECT id, 'Velvet',             'مخمل',                5 FROM tenants WHERE slug = 'elite-collection'
UNION ALL
SELECT id, 'Canvas',             'قماش',                6 FROM tenants WHERE slug = 'elite-collection'
UNION ALL
SELECT id, 'Exotic Leather',     'جلد نادر',            7 FROM tenants WHERE slug = 'elite-collection';

INSERT INTO ref_size_sets (tenant_id, name, sizes, sort_order)
SELECT id, 'Men''s Footwear',   '["39","40","41","42","43","44","45","46","47"]'::jsonb, 0 FROM tenants WHERE slug = 'elite-collection'
UNION ALL
SELECT id, 'Women''s Footwear', '["35","36","37","38","39","40","41"]'::jsonb,           1 FROM tenants WHERE slug = 'elite-collection'
UNION ALL
SELECT id, 'Kids Footwear',     '["25","26","27","28","29","30","31","32","33","34","35"]'::jsonb, 2 FROM tenants WHERE slug = 'elite-collection'
UNION ALL
SELECT id, 'Sunglasses',        '["One Size","Small","Medium","Large"]'::jsonb,          3 FROM tenants WHERE slug = 'elite-collection'
UNION ALL
SELECT id, 'Belts (cm)',        '["85","90","95","100","105","110","115","120"]'::jsonb,  4 FROM tenants WHERE slug = 'elite-collection';

COMMIT;
