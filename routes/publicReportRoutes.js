// File: routes/publicReportRoutes.js
// Description: Unauthenticated, rate-limited routes for viewing a shared report.
// NO `protect` — access is controlled by the unguessable slug + email gate + expiry.

import express from 'express';
import rateLimit from 'express-rate-limit';
import { getPublicReportMeta, accessPublicReport } from '../controllers/publicReportController.js';

const router = express.Router();

const reportViewLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 60, // generous: legitimate viewers may refresh; throttles slug-guessing
  message: {
    success: false,
    message: 'Too many requests. Please try again later.',
    code: 'REPORT_VIEW_RATE_LIMITED',
    retryAfter: 900,
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `${req.params.slug || 'unknown'}_${req.ip}`,
});

router.get('/:slug', reportViewLimiter, getPublicReportMeta);
router.post('/:slug/access', reportViewLimiter, accessPublicReport);

export default router;
