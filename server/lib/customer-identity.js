/**
 * Shared storefront/POS identity: match live customers by normalized phone
 * first, then email. Keep the oldest phone match when legacy duplicates exist.
 * Never overwrite an existing identifier or merge customer records.
 *
 * Identifier fills are guarded in the UPDATE itself. Email ownership includes
 * deleted rows (the table constraint is unconditional); phone ownership only
 * includes live rows (the phone index is partial). An INSERT blocked by a
 * deleted email holder attaches to that customer without restoring it.
 *
 * Call inside a transaction. Row locks protect matches; unique constraints and
 * one savepoint-based retry handle concurrent inserts/fills of new identifiers.
 */

/** Same digits-only definition as the generated customers.phone_key column. */
function normalizePhone(value) {
  const digits = String(value || '').replace(/[^0-9]/g, '');
  return digits.length >= 1 ? digits : null;
}

function customerIdentifierConflictField(error) {
  if (error.code !== '23505') return null;
  // Migration 001's unnamed UNIQUE gets the _tenant_id_ name from Postgres.
  // Also recognize the explicitly named variant in the incident specification.
  if (['customers_tenant_id_email_key', 'customers_tenant_email_key'].includes(error.constraint)) return 'email';
  if (error.constraint === 'customers_tenant_phone_key_idx') return 'phone';
  return null;
}

/** Must be called inside a transaction — takes FOR UPDATE on the match. */
async function findExistingCustomer(client, tenantId, { email, phone }, { includeDeletedEmail = false } = {}) {
  const cleanEmail = String(email || '').trim().toLowerCase() || null;
  const phoneKey = normalizePhone(phone);

  if (phoneKey) {
    const byPhone = await client.query(
      `SELECT * FROM customers
        WHERE tenant_id = $1 AND phone_key = $2 AND deleted_at IS NULL
        ORDER BY created_at, id
        LIMIT 1
        FOR UPDATE`,
      [tenantId, phoneKey],
    );
    if (byPhone.rowCount) return { customer: byPhone.rows[0], matchedOn: 'phone' };
  }

  if (cleanEmail) {
    const byEmail = await client.query(
      `SELECT * FROM customers
        WHERE tenant_id = $1 AND lower(email::text) = $2
          ${includeDeletedEmail ? '' : 'AND deleted_at IS NULL'}
        FOR UPDATE`,
      [tenantId, cleanEmail],
    );
    if (byEmail.rowCount) return { customer: byEmail.rows[0], matchedOn: 'email' };
  }

  return { customer: null, matchedOn: null };
}

/**
 * Returns { customerId, matchedOn, created, adopted: { email, phone } }.
 * An adopted flag means an incoming identifier was newly stored on this call;
 * existing, conflicting, or absent identifiers report false. Phone is true if
 * either previously-null phone column was filled. No identifying input means
 * a walk-in, with no customer row created.
 */
async function resolveCustomer(client, tenantId, input, { source = 'web' } = {}) {
  const cleanEmail = String(input?.email || '').trim().toLowerCase() || null;
  const phone = String(input?.phone || '').trim() || null;
  const phoneKey = normalizePhone(phone);
  const fullName = String(input?.fullName || input?.name || '').trim();
  const city = String(input?.city || '').trim() || null;
  const country = String(input?.country || '').trim() || null;
  const notAdopted = { email: false, phone: false };

  if (!cleanEmail && !phoneKey) {
    return { customerId: null, matchedOn: null, created: false, adopted: notAdopted };
  }

  async function attempt() {
    const { customer, matchedOn } = await findExistingCustomer(client, tenantId, { email: cleanEmail, phone });
    if (customer) {
      const updated = await client.query(
        `UPDATE customers
            SET full_name = COALESCE(NULLIF($3, ''), full_name),
                email = CASE
                  WHEN customers.email IS NOT NULL OR $4::citext IS NULL THEN customers.email
                  WHEN EXISTS (SELECT 1 FROM customers c
                    WHERE c.tenant_id = $1 AND c.id <> $2 AND c.email = $4::citext)
                    THEN customers.email
                  ELSE $4::citext END,
                phone_number = CASE
                  WHEN customers.phone_number IS NOT NULL OR $5::text IS NULL THEN customers.phone_number
                  WHEN EXISTS (SELECT 1 FROM customers c
                    WHERE c.tenant_id = $1 AND c.id <> $2
                      AND c.deleted_at IS NULL AND c.phone_key = $8)
                    THEN customers.phone_number
                  ELSE $5 END,
                phone = CASE
                  WHEN customers.phone IS NOT NULL OR $5::text IS NULL THEN customers.phone
                  WHEN EXISTS (SELECT 1 FROM customers c
                    WHERE c.tenant_id = $1 AND c.id <> $2
                      AND c.deleted_at IS NULL AND c.phone_key = $8)
                    THEN customers.phone
                  ELSE $5 END,
                city = COALESCE($6, city),
                country = COALESCE($7, country),
                last_order_at = now(),
                updated_at = now()
          WHERE tenant_id = $1 AND id = $2
          RETURNING email, phone_number, phone`,
        [tenantId, customer.id, fullName, cleanEmail, phone, city, country, phoneKey],
      );
      const row = updated.rows[0];
      return {
        customerId: customer.id, matchedOn, created: false,
        adopted: {
          email: customer.email == null && row.email != null,
          phone: (customer.phone_number == null && row.phone_number != null)
            || (customer.phone == null && row.phone != null),
        },
      };
    }

    const inserted = await client.query(
      `INSERT INTO customers (tenant_id, email, full_name, phone, phone_number, city, country, last_order_at, notes)
       VALUES ($1, $2::citext, $3, $4, $4, $5, $6, now(), $7)
       ON CONFLICT (tenant_id, email) DO NOTHING
       RETURNING id`,
      [tenantId, cleanEmail, fullName || 'Customer', phone, city, country,
        source === 'pos' ? 'Created at the till.' : ''],
    );
    if (inserted.rowCount) {
      return {
        customerId: inserted.rows[0].id, matchedOn: null, created: true,
        adopted: { email: cleanEmail != null, phone: phone != null },
      };
    }

    // A deleted or concurrently inserted customer owns the email. A new
    // statement sees the winning transaction; never silently undelete it.
    const existing = await findExistingCustomer(client, tenantId,
      { email: cleanEmail, phone }, { includeDeletedEmail: true });
    if (!existing.customer) throw new Error('Customer disappeared after identifier conflict.');
    return {
      customerId: existing.customer.id, matchedOn: existing.matchedOn,
      created: false, adopted: notAdopted,
    };
  }

  for (let number = 0; number < 2; number += 1) {
    await client.query('SAVEPOINT resolve_customer');
    try {
      const result = await attempt();
      await client.query('RELEASE SAVEPOINT resolve_customer');
      return result;
    } catch (error) {
      await client.query('ROLLBACK TO SAVEPOINT resolve_customer');
      await client.query('RELEASE SAVEPOINT resolve_customer');
      const identifierConflict = customerIdentifierConflictField(error);
      if (!identifierConflict || number === 1) throw error;
    }
  }
}

module.exports = { resolveCustomer, findExistingCustomer, normalizePhone, customerIdentifierConflictField };
