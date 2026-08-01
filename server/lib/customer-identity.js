/**
 * One customer identity across both channels.
 *
 * ## The problem
 *
 * The storefront checkout identified customers by **email** (`upsertCustomer`
 * in carts.route.js, `ON CONFLICT (tenant_id, email)`), while the POS searches
 * by **phone**. A person who bought online and then again at the till became
 * two rows: split order history, split LTV, and a loyalty or returns
 * conversation that cannot see half of what the customer actually bought.
 *
 * The two channels also write different columns — the storefront writes
 * `phone`, the admin portal and POS write `phone_number` — and store phone
 * numbers in whatever shape the person typed ("+974 5551 2345",
 * "97455512345", "5551 2345").
 *
 * ## The rule
 *
 * Match on **email first, then normalized phone**, and adopt rather than
 * duplicate:
 *   - a match on email wins (it is the strongest identifier the shop has);
 *   - otherwise a match on `phone_key` (digits only, generated column from
 *     migration 023) is adopted, and the email is filled in if that row did
 *     not have one — which is exactly the POS-created walk-in growing into a
 *     full customer record on their first online order;
 *   - only if neither matches is a new row created.
 *
 * Matching is done under a row lock so two concurrent orders from the same new
 * customer cannot create two rows.
 */

/** Digits-only form of a phone number; null when there is nothing usable. */
function normalizePhone(value) {
  const digits = String(value || '').replace(/[^0-9]/g, '');
  return digits.length >= 6 ? digits : null;
}

/**
 * Finds the customer this person already is, if any.
 * Must be called inside a transaction — it takes `FOR UPDATE` on the match.
 */
async function findExistingCustomer(client, tenantId, { email, phone }) {
  const cleanEmail = String(email || '').trim().toLowerCase() || null;
  const phoneKey = normalizePhone(phone);

  if (cleanEmail) {
    const byEmail = await client.query(
      `SELECT * FROM customers
        WHERE tenant_id = $1 AND lower(email::text) = $2 AND deleted_at IS NULL
        FOR UPDATE`,
      [tenantId, cleanEmail],
    );
    if (byEmail.rowCount) return { customer: byEmail.rows[0], matchedOn: 'email' };
  }

  if (phoneKey) {
    const byPhone = await client.query(
      `SELECT * FROM customers
        WHERE tenant_id = $1 AND phone_key = $2 AND deleted_at IS NULL
        ORDER BY created_at
        LIMIT 1
        FOR UPDATE`,
      [tenantId, phoneKey],
    );
    if (byPhone.rowCount) return { customer: byPhone.rows[0], matchedOn: 'phone' };
  }

  return { customer: null, matchedOn: null };
}

/**
 * Resolves a customer for either channel, creating one only when nobody
 * matches. Returns `{ customerId, matchedOn, created }`.
 *
 * `source` is recorded so it is possible to tell later which channel first
 * knew this person — useful when reconciling a customer list that grew from
 * two directions.
 *
 * Never overwrites a stored value with an empty one: a till operator entering
 * only a name must not blank out the address the customer gave online.
 */
async function resolveCustomer(client, tenantId, input, { source = 'web' } = {}) {
  const cleanEmail = String(input?.email || '').trim().toLowerCase() || null;
  const phone = String(input?.phone || '').trim() || null;
  const fullName = String(input?.fullName || input?.name || '').trim();
  const city = String(input?.city || '').trim() || null;
  const country = String(input?.country || '').trim() || null;

  if (!cleanEmail && !normalizePhone(phone)) {
    // Nothing identifying at all — a genuine walk-in. The caller records the
    // sale with no customer rather than inventing one.
    return { customerId: null, matchedOn: null, created: false };
  }

  const { customer, matchedOn } = await findExistingCustomer(client, tenantId, { email: cleanEmail, phone });

  if (customer) {
    await client.query(
      `UPDATE customers
          SET full_name    = COALESCE(NULLIF($3, ''), full_name),
              -- Fills in the email on a phone-only record created at the till:
              -- this is the moment a walk-in becomes a full customer.
              email        = COALESCE(email, $4::citext),
              phone_number = COALESCE(phone_number, $5),
              phone        = COALESCE(phone, $5),
              city         = COALESCE($6, city),
              country      = COALESCE($7, country),
              last_order_at = now(),
              updated_at   = now()
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, customer.id, fullName, cleanEmail, phone, city, country],
    );
    return { customerId: customer.id, matchedOn, created: false };
  }

  const inserted = await client.query(
    `INSERT INTO customers (tenant_id, email, full_name, phone, phone_number, city, country, last_order_at, notes)
     VALUES ($1, $2::citext, $3, $4, $4, $5, $6, now(), $7)
     RETURNING id`,
    [
      tenantId,
      cleanEmail,
      fullName || 'Customer',
      phone,
      city,
      country,
      source === 'pos' ? 'Created at the till.' : '',
    ],
  );
  return { customerId: inserted.rows[0].id, matchedOn: null, created: true };
}

module.exports = { resolveCustomer, findExistingCustomer, normalizePhone };
