// File: middleware/copilotRateLimit.js
// Description: Rate limiting middleware for AI Copilot — 20 requests per minute per user

import rateLimit from 'express-rate-limit';

const copilotRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute window
  max: 20, // 20 requests per minute per user
  message: {
    success: false,
    message: 'Too many requests to AI Copilot. Please wait a moment before trying again.',
    code: 'COPILOT_RATE_LIMITED',
    retryAfter: 60,
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    // Rate limit by authenticated user ID
    return `copilot_${req.user?._id || 'anonymous'}_${req.ip}`;
  },
});

export default copilotRateLimiter;
