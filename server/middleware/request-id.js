const crypto = require('node:crypto');

const HEADER = 'x-request-id';
// 12 hex chars: short enough that a cashier can read the last 6 of it aloud
// over the phone, long enough that same-day collisions are not a concern.
const ID_PATTERN = /^[a-zA-Z0-9_-]{8,64}$/;

/**
 * Assigns one correlation id per request and makes it visible everywhere a
 * fault can be observed later: the response header, the JSON error body
 * (see the global error handler in index.js), the pino request line, the
 * `app_errors` row, and the `audit_events` row.
 *
 * This is the single thread that ties "the cashier says it broke at 3pm" to
 * an actual request, transaction, register and shift. Without it, every
 * investigation starts by guessing which log line belongs to which sale.
 *
 * An inbound `X-Request-Id` is honoured when it looks safe, so a reverse
 * proxy or the admin portal's own log shipper can carry its id through
 * instead of the server minting an unrelated second one. Anything
 * malformed (or long enough to be a header-injection attempt) is replaced.
 */
function requestId() {
  return function requestIdMiddleware(req, res, next) {
    const inbound = req.get(HEADER);
    req.requestId = inbound && ID_PATTERN.test(inbound)
      ? inbound
      : crypto.randomBytes(6).toString('hex');
    res.setHeader('X-Request-Id', req.requestId);
    next();
  };
}

module.exports = { requestId, REQUEST_ID_HEADER: HEADER };
