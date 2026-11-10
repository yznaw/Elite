require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('../db/client');
const { ensureDefaultTenant } = require('../db/tenant');
const { ensurePosSchema } = require('../db/pos-schema');

/**
 * Fixture for the browser release gate (docs/25 Phase 3).
 *
 * The variant shape here is **deliberately explicit**, not minimal. The POS
 * variant picker is conditional — the size step is hidden for colour-only
 * products (commit 138af93) and a single no-size variant is auto-selected — so
 * a spec written against a one-variant fixture silently exercises a different
 * code path than a real product with colours and sizes. Two colours with two
 * sizes each means the spec drives the picker the way a cashier actually does:
 * colour, then size, then add.
 *
 * Also seeds a second manager account, because approver separation
 * (docs/15 P0-7) forbids a user approving their own void or refund — the
 * browser spec needs a distinct approver's PIN to exercise those paths at all.
 */
const COLORS = ['Onyx', 'Sand'];
const SIZES = ['M', 'L'];
const APPROVER_EMAIL = 'browser-pos-approver@elite.local';
const APPROVER_PIN = '4417';

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
       VALUES ($1,'POS-BROWSER-E2E','Elite','POS Browser Product','pos-browser-product','active',2500,32)
       RETURNING id`,
      [tenant.id],
    );

    let sortOrder = 0;
    for (const color of COLORS) {
      for (const size of SIZES) {
        sortOrder += 1;
        // eslint-disable-next-line no-await-in-loop
        await client.query(
          `INSERT INTO product_variants
            (tenant_id, product_id, sku, barcode, color, size, price_cents, stock_quantity, is_active, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6,2500,8,true,$7)`,
          [
            tenant.id,
            product.rows[0].id,
            `POS-BROWSER-E2E-${color.toUpperCase()}-${size}`,
            `POSBROWSERE2E${color.toUpperCase()}${size}`,
            color,
            size,
            sortOrder,
          ],
        );
      }
    }

    // A second, distinct manager: the logged-in owner cannot approve their own
    // void or refund, so without this those paths are untestable in a browser.
    await client.query(
      `INSERT INTO admin_users
        (tenant_id, email, password_hash, full_name, initials, role, status, pos_pin_hash)
       VALUES ($1,$2,'unused','Browser E2E Approver','BA','manager','active',$3)
       ON CONFLICT (tenant_id, email) DO UPDATE SET pos_pin_hash = EXCLUDED.pos_pin_hash`,
      [tenant.id, APPROVER_EMAIL, await bcrypt.hash(APPROVER_PIN, 12)],
    );

    console.log(`[e2e-fixture] ${slug}: ${COLORS.length * SIZES.length} variants + approver PIN ready`);
  } finally {
    client.release();
    await db.pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
