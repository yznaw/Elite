const fs = require('node:fs');
const path = require('node:path');

const migrationPaths = [
  path.join(__dirname, 'migrations', '015_pos_foundation.sql'),
  path.join(__dirname, 'migrations', '016_pos_operations.sql'),
  path.join(__dirname, 'migrations', '017_pos_business_profile.sql'),
  path.join(__dirname, 'migrations', '018_pos_card_reference_and_reconciliation.sql'),
  path.join(__dirname, 'migrations', '019_cashier_role.sql'),
  path.join(__dirname, 'migrations', '020_pos_inventory_ledger.sql'),
  path.join(__dirname, 'migrations', '021_pos_cash_movements.sql'),
  // Not POS-specific, but applied here for the same reason the others are:
  // this project has no formal migration runner, so each file is executed
  // directly at boot and must be idempotent (IF NOT EXISTS everywhere).
  path.join(__dirname, 'migrations', '022_observability.sql'),
  path.join(__dirname, 'migrations', '023_pos_customer_link.sql'),
  path.join(__dirname, 'migrations', '024_pos_item_arabic_name.sql'),
  path.join(__dirname, 'migrations', '025_inventory_operations.sql'),
  path.join(__dirname, 'migrations', '026_pos_self_close_shift.sql'),
  path.join(__dirname, 'migrations', '027_pos_branches.sql'),
  path.join(__dirname, 'migrations', '028_team_member_lifecycle.sql'),
  path.join(__dirname, 'migrations', '029_remove_3d_fields.sql'),
];

async function ensurePosSchema(client) {
  for (const migrationPath of migrationPaths) {
    const sql = fs.readFileSync(migrationPath, 'utf8');
    // eslint-disable-next-line no-await-in-loop -- migrations are ordered.
    await client.query(sql);
  }
}

module.exports = { ensurePosSchema };
