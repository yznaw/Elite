const crypto = require('node:crypto');

/**
 * The device-level "which till is this machine?" binding.
 *
 * `req.session.posRegisterId` alone tied the binding to the *login session*,
 * so every logout, every 12-hour session expiry, and every second admin who
 * signed in on the same counter machine landed on the "Which till is this?"
 * picker — on a terminal that had been enrolled for weeks. Square and Shopify
 * both treat the device pairing as independent of who is signed in, and this
 * cookie is that: set once when the browser binds to a register, read back on
 * every request whose session has no register of its own.
 *
 * httpOnly so page scripts (and anything injected into them) cannot read or
 * forge it, and HMAC-signed with the session secret so a hand-edited cookie is
 * rejected rather than trusted. It only names a register — every check that
 * the register still exists, belongs to this tenant and is active still runs
 * in requireRegister().
 */
const COOKIE_NAME = 'elite.pos_device';
const MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;

function secret() {
  return process.env.SESSION_SECRET || 'elite-dev-session-secret';
}

function sign(registerId, leaseId) {
  return crypto.createHmac('sha256', secret()).update(`${registerId}.${leaseId}`).digest('base64url');
}

function serialize(registerId, leaseId) {
  return `${registerId}.${leaseId}.${sign(registerId, leaseId)}`;
}

// This app deliberately runs without cookie-parser (see middleware/csrf.js,
// which reads the header the same way), so parse the one cookie we need.
function readCookie(req, name) {
  const raw = req.headers.cookie;
  if (!raw) return null;
  const match = raw.match(new RegExp(`(?:^|;\\s*)${name.replace('.', '\\.')}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}

/** The register + current lease named by a valid, untampered cookie — or null. */
function readDeviceBinding(req) {
  const raw = readCookie(req, COOKIE_NAME);
  if (!raw) return null;
  const parts = raw.split('.');
  // Register-id-only cookies from releases before migration 036 are not
  // accepted. The client will fall back to credential check-in and be issued a
  // current lease without forcing the operator to create a new register.
  if (parts.length !== 3) return null;
  const [registerId, leaseId, signature] = parts;
  if (!registerId || !leaseId || !signature) return null;
  const expected = Buffer.from(sign(registerId, leaseId));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return null;
  return { registerId, leaseId };
}

function cookieOptions(req) {
  return {
    httpOnly: true,
    sameSite: process.env.SESSION_COOKIE_SAMESITE || 'lax',
    secure: req.secure || req.get('x-forwarded-proto') === 'https',
    path: '/',
  };
}

function setDeviceRegisterCookie(req, res, registerId, leaseId) {
  res.cookie(COOKIE_NAME, serialize(registerId, leaseId), { ...cookieOptions(req), maxAge: MAX_AGE_MS });
}

function clearDeviceRegisterCookie(req, res) {
  res.clearCookie(COOKIE_NAME, cookieOptions(req));
}

module.exports = {
  COOKIE_NAME,
  readDeviceBinding,
  setDeviceRegisterCookie,
  clearDeviceRegisterCookie,
};
