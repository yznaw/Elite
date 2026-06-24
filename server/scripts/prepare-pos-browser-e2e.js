require('dotenv').config();
const db = require('../db/client');
const { ensureDefaultTenant } = require('../db/tenant');
const { ensurePosSchema } = require('../db/pos-schema');

async function main() {
  const slug = process.env.DEFAULT_TENANT_SLUG;
  if (!slug?.startsWith('pos-browser-e2e')) throw new Error('Refusing to prepare a non-E2E tenant.');
  await db.query('DELETE FROM tenants WHERE slug = $1', [slug]);
  const client = await db.pool.connect();
  try {
    const tenant = await ensureDefaultTenant(client);
    await ensurePosSchema(client);
    const product = await client.query(
      `INSERT INTO products
        (tenant_id, sku, brand, name, slug, status, base_price_cents, stock_quantity)
       VALUES ($1,'POS-BROWSER-E2E','Elite','POS Browser Product','pos-browser-product','active',2500,8)
       RETURNING id`,
      [tenant.id],
    );
    await client.query(
      `INSERT INTO product_variants
        (tenant_id, product_id, sku, barcode, size, price_cents, stock_quantity, is_active)
       VALUES ($1,$2,'POS-BROWSER-E2E-M','POSBROWSERE2E','M',2500,8,true)`,
      [tenant.id, product.rows[0].id],
    );
  } finally {
    client.release();
    await db.pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
