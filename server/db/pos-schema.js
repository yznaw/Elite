const fs = require('node:fs');
const path = require('node:path');

const migrationPath = path.join(__dirname, 'migrations', '015_pos_foundation.sql');

async function ensurePosSchema(client) {
  const sql = fs.readFileSync(migrationPath, 'utf8');
  await client.query(sql);
}

module.exports = { ensurePosSchema };
