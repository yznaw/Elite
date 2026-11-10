const { createHash } = require('node:crypto');

// An order UUID is a reference, not authorization. Only the signed, HttpOnly
// session cookie grants access. Persist a one-way binding, never the session ID.
function checkoutOwnerHash(req) {
  if (!req.session || !req.sessionID) {
    throw Object.assign(new Error('A shopping session is required.'), { status: 401 });
  }
  return createHash('sha256').update(`elite-checkout-owner:v1:${req.sessionID}`).digest('hex');
}

async function persistCheckoutSession(req) {
  const ownerHash = checkoutOwnerHash(req);
  req.session.checkoutInitialized = true;
  await new Promise((resolve, reject) => req.session.save(err => err ? reject(err) : resolve()));
  return ownerHash;
}

function scopedIdempotencyKey(ownerHash, key) {
  if (key == null || key === '') return null;
  if (typeof key !== 'string' || !key.trim() || key.length > 128) {
    throw Object.assign(new Error('Invalid checkout retry key.'), { status: 422 });
  }
  return createHash('sha256').update(JSON.stringify([ownerHash, key])).digest('hex');
}

module.exports = { checkoutOwnerHash, persistCheckoutSession, scopedIdempotencyKey };
