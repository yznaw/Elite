const fs = require('node:fs');
const path = require('node:path');

const migrationPaths = [
  path.join(__dirname, 'migrations', '015_pos_foundation.sql'),
  path.join(__dirname, 'migrations', '016_pos_operations.sql'),
];

async function ensurePosSchema(client) {
  for (const migrationPath of migrationPaths) {
    const sql = fs.readFileSync(migrationPath, 'utf8');
    await client.query(sql);
  }
}

module.exports = { ensurePosSchema };
