require('dotenv').config();
const db = require('../db/client');

async function main() {
  const slug = process.env.DEFAULT_TENANT_SLUG;
  if (!slug?.startsWith('pos-browser-e2e')) throw new Error('Refusing to clean a non-E2E tenant.');
  await db.query('DELETE FROM tenants WHERE slug = $1', [slug]);
  await db.pool.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
