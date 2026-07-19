const fs = require('node:fs');
const path = require('node:path');

const migrationPaths = [
  path.join(__dirname, 'migrations', '015_pos_foundation.sql'),
  path.join(__dirname, 'migrations', '016_pos_operations.sql'),
  path.join(__dirname, 'migrations', '017_pos_business_profile.sql'),
  path.join(__dirname, 'migrations', '018_pos_card_reference_and_reconciliation.sql'),
  path.join(__dirname, 'migrations', '019_cashier_role.sql'),
  path.join(__dirname, 'migrations', '020_pos_inventory_ledger.sql'),
];

async function ensurePosSchema(client) {
  for (const migrationPath of migrationPaths) {
    const sql = fs.readFileSync(migrationPath, 'utf8');
    await client.query(sql);
  }
}

module.exports = { ensurePosSchema };
