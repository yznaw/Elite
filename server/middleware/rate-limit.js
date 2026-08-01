const rateLimit = require('express-rate-limit');

const jsonRateLimitHandler = (req, res) => {
  res.status(429).json({ success: false, message: 'Too many attempts. Please try again later.' });
};

// Login/reset: 10 attempts per 15 minutes per IP.
const authAttemptLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonRateLimitHandler,
});

// PIN verify/set + register enrollment: tighter, 8 per 5 minutes per IP.
// (PIN brute-force already has its own per-register/cashier DB lockout in
// manager-service.js; this is a second, IP-scoped layer in front of it.)
const posPinLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  // Browser E2E deliberately enrolls a fresh isolated register per test.
  // Keep production brute-force protection strict while preventing the test
  // runner's single loopback IP from rate-limiting its own independent cases.
  limit: process.env.NODE_ENV === 'test' ? 1000 : 8,
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonRateLimitHandler,
});

const reviewSubmissionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonRateLimitHandler,
});

// Client-side log ingestion. Generous enough for a register flushing a backlog
// after being offline (batches of up to 20 entries), tight enough that a
// crash-looping browser cannot turn the log endpoint into a self-inflicted
// denial of service against checkout.
const clientLogLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonRateLimitHandler,
});

// CSP violation reports are unauthenticated by necessity (the browser sends
// them, with no session and no CSRF header), so this one is stricter.
const cspReportLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  // A browser must not be encouraged to retry a rejected report.
  handler: (_req, res) => res.status(204).end(),
});

module.exports = {
  authAttemptLimiter,
  posPinLimiter,
  reviewSubmissionLimiter,
  clientLogLimiter,
  cspReportLimiter,
};
