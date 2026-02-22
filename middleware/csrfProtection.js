// File: middleware/csrfProtection.js
// Description: Origin-based CSRF protection for cookie-bearing endpoints.
// Works alongside SameSite=Strict cookie flag for defense in depth.

/**
 * Middleware that validates the Origin or Referer header against allowed origins.
 * Applied to endpoints that rely on cookies (refresh, logout) to prevent CSRF.
 * Legitimate browser requests always send at least one of these headers.
 */
const verifyCsrfOrigin = (req, res, next) => {
  const origin = req.get('Origin');
  const referer = req.get('Referer');

  // Allow requests with no origin in non-production (curl, Postman, mobile)
  if (!origin && !referer && process.env.NODE_ENV !== 'production') {
    return next();
  }

  // In production, at least one header must be present
  if (!origin && !referer) {
    res.status(403);
    throw new Error('Forbidden: Missing Origin header');
  }

  const allowedOrigins = process.env.CLIENT_URL
    ? process.env.CLIENT_URL.split(',').map((o) => o.trim())
    : ['http://localhost:3000', 'http://localhost:3001'];

  let requestOrigin;
  try {
    requestOrigin = origin || new URL(referer).origin;
  } catch {
    res.status(403);
    throw new Error('Forbidden: Invalid Origin');
  }

  if (!allowedOrigins.includes(requestOrigin)) {
    res.status(403);
    throw new Error('Forbidden: Origin not allowed');
  }

  next();
};

export { verifyCsrfOrigin };
