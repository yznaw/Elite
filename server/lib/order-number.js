const crypto = require('node:crypto');

// The column this collides on when two callers land on the same number.
// insertWithRetry only retries this specific conflict — any other error
// (including an idempotency-key collision, which means "this exact request
// already succeeded" and is handled by the caller returning the existing
// row) is rethrown as-is.
const ORDER_NUMBER_CONSTRAINT = 'orders_tenant_public_number_key';
const MAX_ATTEMPTS = 5;

/**
 * Generates a public order number. Deliberately not sequential — a
 * customer or a curious admin should not be able to infer order volume or
 * guess another customer's number from their own. Not guaranteed unique by
 * itself (two calls in the same millisecond both draw from the same
 * `crypto.randomInt` space); insertWithRetry below is what actually
 * guarantees uniqueness, this just makes the retry path rare in practice.
 */
function generateOrderNumber() {
  const year = new Date().getFullYear().toString().slice(2);
  const msTail = Date.now().toString().slice(-6);
  const random = crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
  return `EC-${year}-${msTail}${random}`;
}

/**
 * Runs `insertFn(publicNumber)` — expected to INSERT a row using the given
 * number and return it — retrying with a freshly generated number on a
 * public_number collision instead of failing the caller's whole request.
 *
 * Wraps each attempt in a SAVEPOINT: a duplicate-key error aborts the
 * enclosing transaction in Postgres, so without this the caller's already
 *-completed work earlier in the transaction (e.g. resolving the customer)
 * would have to be redone from BEGIN. Rolling back to the savepoint instead
 * discards only the failed insert attempt.
 *
 * `client` must already be inside a transaction (BEGIN before, COMMIT/
 * ROLLBACK after, same as every other multi-statement write in this repo).
 */
async function insertWithRetry(client, insertFn) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const publicNumber = generateOrderNumber();
    await client.query('SAVEPOINT before_order_insert');
    try {
      const row = await insertFn(publicNumber);
      await client.query('RELEASE SAVEPOINT before_order_insert');
      return row;
    } catch (err) {
      await client.query('ROLLBACK TO SAVEPOINT before_order_insert');
      const isNumberConflict = err.code === '23505' && err.constraint === ORDER_NUMBER_CONSTRAINT;
      if (!isNumberConflict) throw err;
      lastError = err;
    }
  }
  // Astronomically unlikely at MAX_ATTEMPTS with a 10^12 number space per
  // millisecond-tail bucket — surfaces as a real error rather than looping
  // forever if it ever does happen.
  throw lastError;
}

module.exports = { generateOrderNumber, insertWithRetry };
