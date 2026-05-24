const DEFAULT_COLORS = [
  ['White', 'أبيض', '#FFFFFF', 0],
  ['Cream', 'كريمي', '#FFFDD0', 1],
  ['Camel', 'جملي', '#C19A6B', 2],
  ['Tan', 'أسمر', '#D2B48C', 3],
  ['Brown', 'بني', '#8B4513', 4],
  ['Dark Brown', 'بني داكن', '#5C2E00', 5],
  ['Black', 'أسود', '#1A1A1A', 6],
  ['Navy', 'كحلي', '#1A1A2E', 7],
  ['Dark Green', 'أخضر داكن', '#1B4332', 8],
  ['Olive', 'زيتي', '#6B7C47', 9],
  ['Grey', 'رمادي', '#808080', 10],
  ['Burgundy', 'عنابي', '#800020', 11],
  ['Gold', 'ذهبي', '#C9A84C', 12],
];

const DEFAULT_MATERIALS = [
  ['Full-Grain Leather', 'جلد كامل الحبيبات', 0],
  ['Calf Leather', 'جلد العجل', 1],
  ['Suede', 'سويد', 2],
  ['Nubuck', 'نوبوك', 3],
  ['Patent Leather', 'جلد مصقول', 4],
  ['Velvet', 'مخمل', 5],
  ['Canvas', 'قماش', 6],
  ['Exotic Leather', 'جلد نادر', 7],
];

const DEFAULT_SIZE_SETS = [
  ['Men\'s Footwear', ['39', '40', '41', '42', '43', '44', '45', '46', '47'], 0],
  ['Women\'s Footwear', ['35', '36', '37', '38', '39', '40', '41'], 1],
  ['Kids Footwear', ['25', '26', '27', '28', '29', '30', '31', '32', '33', '34', '35'], 2],
  ['Sunglasses', ['One Size', 'Small', 'Medium', 'Large'], 3],
  ['Belts (cm)', ['85', '90', '95', '100', '105', '110', '115', '120'], 4],
];

async function ensureReferenceSchema(client, tenantId) {
  await client.query('BEGIN');
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS ref_colors (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        name_en text NOT NULL,
        name_ar text NOT NULL DEFAULT '',
        hex text NOT NULL DEFAULT '#000000',
        sort_order int NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await client.query('CREATE INDEX IF NOT EXISTS ref_colors_tenant ON ref_colors(tenant_id)');
    await ensureUpdatedAtTrigger(client, 'ref_colors');

    await client.query(`
      CREATE TABLE IF NOT EXISTS ref_materials (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        name_en text NOT NULL,
        name_ar text NOT NULL DEFAULT '',
        sort_order int NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await client.query('CREATE INDEX IF NOT EXISTS ref_materials_tenant ON ref_materials(tenant_id)');
    await ensureUpdatedAtTrigger(client, 'ref_materials');

    await client.query(`
      CREATE TABLE IF NOT EXISTS ref_size_sets (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        name text NOT NULL,
        sizes jsonb NOT NULL DEFAULT '[]',
        sort_order int NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await client.query('CREATE INDEX IF NOT EXISTS ref_size_sets_tenant ON ref_size_sets(tenant_id)');
    await ensureUpdatedAtTrigger(client, 'ref_size_sets');

    await seedDefaults(client, tenantId);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}

async function ensureUpdatedAtTrigger(client, tableName) {
  const triggerName = `${tableName}_set_updated_at`;
  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgname = '${triggerName}'
      ) THEN
        CREATE TRIGGER ${triggerName}
        BEFORE UPDATE ON ${tableName}
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
      END IF;
    END
    $$;
  `);
}

async function seedDefaults(client, tenantId) {
  for (const [nameEn, nameAr, hex, sortOrder] of DEFAULT_COLORS) {
    await client.query(
      `
        INSERT INTO ref_colors (tenant_id, name_en, name_ar, hex, sort_order)
        SELECT $1, $2, $3, $4, $5
        WHERE NOT EXISTS (
          SELECT 1 FROM ref_colors WHERE tenant_id = $1 AND lower(name_en) = lower($2)
        )
      `,
      [tenantId, nameEn, nameAr, hex, sortOrder],
    );
  }

  for (const [nameEn, nameAr, sortOrder] of DEFAULT_MATERIALS) {
    await client.query(
      `
        INSERT INTO ref_materials (tenant_id, name_en, name_ar, sort_order)
        SELECT $1, $2, $3, $4
        WHERE NOT EXISTS (
          SELECT 1 FROM ref_materials WHERE tenant_id = $1 AND lower(name_en) = lower($2)
        )
      `,
      [tenantId, nameEn, nameAr, sortOrder],
    );
  }

  for (const [name, sizes, sortOrder] of DEFAULT_SIZE_SETS) {
    await client.query(
      `
        INSERT INTO ref_size_sets (tenant_id, name, sizes, sort_order)
        SELECT $1, $2, $3::jsonb, $4
        WHERE NOT EXISTS (
          SELECT 1 FROM ref_size_sets WHERE tenant_id = $1 AND lower(name) = lower($2)
        )
      `,
      [tenantId, name, JSON.stringify(sizes), sortOrder],
    );
  }
}

module.exports = {
  ensureReferenceSchema,
};
