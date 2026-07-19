const crypto = require('node:crypto');

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const TOKEN_COOKIE = 'elite.csrf';
const TOKEN_HEADER = 'x-csrf-token';

function originFromHeader(value) {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function readCookie(req, name) {
  const raw = req.headers.cookie;
  if (!raw) return null;
  const match = raw.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * Session-cookie CSRF protection without the unmaintained `csurf` package.
 *
 * Two independent checks, either of which blocks a forged cross-site request:
 *  1. Origin/Referer must match the same allow-list CORS already trusts.
 *     Covers browsers that send Origin/Sec-Fetch-Site (all current browsers).
 *  2. Double-submit token: a random value is set as a readable cookie and
 *     must be echoed back in the X-CSRF-Token header. A cross-site attacker
 *     can trigger the request but cannot read the cookie to copy its value.
 *
 * Only applies to mutating methods on cookie-authenticated requests; requests
 * with no session (e.g. public storefront reads, webhooks with their own
 * signature verification) are left alone.
 */
function csrfProtection({ allowedOriginCheck }) {
  return function csrfMiddleware(req, res, next) {
    // Issue/refresh the readable token cookie on every request so the SPA can
    // pick it up on first load, before any mutating call is made.
    let token = readCookie(req, TOKEN_COOKIE);
    if (!token) {
      token = crypto.randomBytes(32).toString('base64url');
      res.cookie(TOKEN_COOKIE, token, {
        httpOnly: false,
        sameSite: process.env.SESSION_COOKIE_SAMESITE || 'lax',
        secure: req.secure || req.get('x-forwarded-proto') === 'https',
        maxAge: 12 * 60 * 60 * 1000,
      });
    }

    if (SAFE_METHODS.has(req.method)) return next();
    // Webhooks authenticate via signature, not the session cookie — exempt.
    if (req.path.startsWith('/webhooks/')) return next();
    // No session cookie in play means nothing for CSRF to forge.
    if (!req.headers.cookie) return next();

    const origin = req.get('origin') || originFromHeader(req.get('referer') || '');
    if (origin && allowedOriginCheck(origin)) return next();

    const headerToken = req.get(TOKEN_HEADER);
    if (headerToken && token && headerToken === token) return next();

    return res.status(403).json({ success: false, message: 'CSRF validation failed.' });
  };
}

module.exports = { csrfProtection, TOKEN_COOKIE, TOKEN_HEADER };
