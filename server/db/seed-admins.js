#!/usr/bin/env node
/**
 * Seed one admin user per role (owner / admin / manager / viewer) and write
 * the resulting credentials to `server/admins.local.txt` so a developer can
 * log in as any role without digging through the database.
 *
 * Re-runs are idempotent — if a user already exists for the email, the
 * password is *rotated* and the file is rewritten so the dev credentials
 * are always in sync with the database.
 *
 *   npm run db:seed:admins
 *
 * The output file is gitignored. Never commit it.
 */
require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');

const db = require('./client');
const { ensureDefaultTenant } = require('./tenant');

const ROLES = [
  {
    role: 'owner',
    email: 'owner@elite.local',
    name: 'Yusuf Hamad',
    notes: 'Founder. Full access including team management + dangerous ops.',
  },
  {
    role: 'admin',
    email: 'admin@elite.local',
    name: 'Mona Al-Sayed',
    notes: 'Day-to-day admin. Can manage catalog, orders, customers, settings.',
  },
  {
    role: 'manager',
    email: 'manager@elite.local',
    name: 'Salim Al-Hajri',
    notes: 'Floor manager. Can fulfil orders + edit catalog; cannot touch team.',
  },
  {
    role: 'viewer',
    email: 'viewer@elite.local',
    name: 'Layla Hassan',
    notes: 'Read-only. Useful for stakeholder demos.',
  },
];

/**
 * Generate a memorable but unique-per-run password.
 *
 *   <Role>!<6 hex>
 *
 * Example: `Owner!a3f9b1`. Hex suffix means re-runs rotate the password and
 * keep the credentials file fresh; the role prefix keeps it easy to type
 * during local testing.
 */
function generatePassword(role) {
  const suffix = crypto.randomBytes(3).toString('hex');
  return `${role[0].toUpperCase()}${role.slice(1)}!${suffix}`;
}

async function upsertAdmin(client, tenantId, spec, password) {
  const passwordHash = await bcrypt.hash(password, 10);
  const initials = spec.name
    .split(/\s+/)
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();

  await client.query(
    `
      INSERT INTO admin_users (
        tenant_id, email, password_hash, full_name, initials, role, status
      )
      VALUES ($1, $2, $3, $4, $5, $6, 'active')
      ON CONFLICT (tenant_id, email) DO UPDATE
      SET password_hash = EXCLUDED.password_hash,
          full_name = EXCLUDED.full_name,
          initials = EXCLUDED.initials,
          role = EXCLUDED.role,
          status = 'active'
    `,
    [tenantId, spec.email, passwordHash, spec.name, initials || 'AD', spec.role],
  );
}

function writeCredentialsFile(rows, tenantSlug) {
  const target = path.join(__dirname, '..', 'admins.local.txt');
  const stamp = new Date().toISOString();
  const lines = [
    'Elite admin portal — local development credentials',
    '====================================================',
    '',
    `Generated:    ${stamp}`,
    `Tenant:       ${tenantSlug}`,
    `Login URL:    http://localhost:4300/login`,
    '',
    'These accounts exist only in your local PostgreSQL. The file is',
    'gitignored — DO NOT commit it. Re-running `npm run db:seed:admins`',
    'rotates the passwords and rewrites this file.',
    '',
  ];

  for (const r of rows) {
    lines.push(`[${r.role.toUpperCase()}]`);
    lines.push(`  Name:     ${r.name}`);
    lines.push(`  Email:    ${r.email}`);
    lines.push(`  Password: ${r.password}`);
    lines.push(`  Notes:    ${r.notes}`);
    lines.push('');
  }

  fs.writeFileSync(target, lines.join('\n'), { mode: 0o600 });
  return target;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set — aborting.');
    process.exit(1);
  }

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const tenant = await ensureDefaultTenant(client);

    const rows = [];
    for (const spec of ROLES) {
      const password = generatePassword(spec.role);
      await upsertAdmin(client, tenant.id, spec, password);
      rows.push({ ...spec, password });
    }

    await client.query('COMMIT');

    const file = writeCredentialsFile(rows, tenant.slug);
    console.log('✅ Seeded admins:');
    for (const r of rows) {
      console.log(`   ${r.role.padEnd(7)}  ${r.email.padEnd(22)}  ${r.password}`);
    }
    console.log(`\n→ Credentials written to ${path.relative(process.cwd(), file)}`);
    console.log('  (gitignored — do not commit)');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Admin seed failed:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await db.pool.end();
  }
}

main();
