const rateLimit = require('express-rate-limit');
const env = require('../config/env');

// Basic IP-based rate limiting on the upload endpoint only -- read APIs
// (status/results) are left unthrottled since they're cheap DB reads and
// polling them is an expected client pattern.
const uploadRateLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many uploads, please slow down and try again shortly.' },
});

module.exports = { uploadRateLimiter };
