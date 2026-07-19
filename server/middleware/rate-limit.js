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
  limit: 8,
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonRateLimitHandler,
});

module.exports = { authAttemptLimiter, posPinLimiter };
