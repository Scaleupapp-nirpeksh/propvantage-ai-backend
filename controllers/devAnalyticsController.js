// File: controllers/devAnalyticsController.js
// Description: SP5 — thin asyncHandlers for /api/analytics/cp-scorecard,
//   /commission-payouts, /lead-quality. Developer-side analytics (Areas
//   6, 7, 8). Existing controllers/analyticsController.js is untouched.
//
//   Resolved Open Item §13(6): new controller, new routes file. Uses
//   the existing PERMISSIONS.ANALYTICS.ADVANCED ('analytics:advanced')
//   — there is no 'analytics:read' permission in the codebase; ADVANCED
//   is the closest semantic match for dev-side analytics access.

import asyncHandler from 'express-async-handler';
import * as devAnalytics from '../services/analytics/devAnalyticsService.js';

export const getCpScorecard = asyncHandler(async (req, res) => {
  const data = await devAnalytics.getChannelPartnerScorecard(req.user.organization, req.query, req.user);
  res.json({ success: true, data });
});

export const getCommissionPayoutsBreakdown = asyncHandler(async (req, res) => {
  const data = await devAnalytics.getCommissionPayouts(req.user.organization, req.query, req.user);
  res.json({ success: true, data });
});

export const getLeadQualityBreakdown = asyncHandler(async (req, res) => {
  const data = await devAnalytics.getLeadQuality(req.user.organization, req.query, req.user);
  res.json({ success: true, data });
});
