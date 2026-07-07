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

// Footwear size chart from brand size guide (UK base, all sandals)
const FOOTWEAR_CHART = [
  { uk: '5',    eu: '39',   us: '6'    },
  { uk: '5.5',  eu: '39.5', us: '6.5'  },
  { uk: '6',    eu: '40',   us: '7'    },
  { uk: '6.5',  eu: '40.5', us: '7.5'  },
  { uk: '7',    eu: '41',   us: '8'    },
  { uk: '7.5',  eu: '41.5', us: '8.5'  },
  { uk: '8',    eu: '42',   us: '9'    },
  { uk: '8.5',  eu: '42.5', us: '9.5'  },
  { uk: '9',    eu: '43',   us: '10'   },
  { uk: '9.5',  eu: '43.5', us: '10.5' },
  { uk: '10',   eu: '44',   us: '11'   },
  { uk: '10.5', eu: '44.5', us: '11.5' },
  { uk: '11',   eu: '45',   us: '12'   },
  { uk: '11.5', eu: '45.5', us: '12.5' },
  { uk: '12',   eu: '46',   us: '13'   },
  { uk: '12.5', eu: '46.5', us: '13.5' },
  { uk: '13',   eu: '47',   us: '14'   },
  { uk: '13.5', eu: '47.5', us: '14.5' },
  { uk: '14',   eu: '48',   us: '15'   },
  { uk: '14.5', eu: '48.5', us: '15.5' },
  { uk: '15',   eu: '49',   us: '16'   },
];

const FOOTWEAR_TIP = 'If between sizes, we recommend selecting the larger size.';

const DEFAULT_SIZE_SETS = [
  ['Footwear', ['39', '39.5', '40', '40.5', '41', '41.5', '42', '42.5', '43', '43.5', '44', '44.5', '45', '45.5', '46', '46.5', '47', '47.5', '48', '48.5', '49'], FOOTWEAR_CHART, FOOTWEAR_TIP, 0],
  ['Belts (cm)', ['85', '90', '95', '100', '105', '110', '115', '120'], [], null, 1],
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
        size_chart jsonb NOT NULL DEFAULT '[]',
        tip text,
        sort_order int NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    // Add columns if table already exists (idempotent upgrade)
    await client.query(`ALTER TABLE ref_size_sets ADD COLUMN IF NOT EXISTS size_chart jsonb NOT NULL DEFAULT '[]'`);
    await client.query(`ALTER TABLE ref_size_sets ADD COLUMN IF NOT EXISTS tip text`);
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

  for (const [name, sizes, sizeChart, tip, sortOrder] of DEFAULT_SIZE_SETS) {
    await client.query(
      `
        INSERT INTO ref_size_sets (tenant_id, name, sizes, size_chart, tip, sort_order)
        SELECT $1, $2, $3::jsonb, $4::jsonb, $5, $6
        WHERE NOT EXISTS (
          SELECT 1 FROM ref_size_sets WHERE tenant_id = $1 AND lower(name) = lower($2)
        )
      `,
      [tenantId, name, JSON.stringify(sizes), JSON.stringify(sizeChart ?? []), tip ?? null, sortOrder],
    );
  }
}

module.exports = {
  ensureReferenceSchema,
};
