// File: routes/devAnalyticsRoutes.js
// Description: SP5 — developer-side analytics endpoints (Areas 6–8).
//   Mounted at /api/analytics alongside the existing analyticsRoutes.js;
//   the new paths (cp-scorecard / commission-payouts / lead-quality) do
//   not collide with the existing four endpoints. All routes:
//   protect + hasPermission(PERMISSIONS.ANALYTICS.ADVANCED).

import express from 'express';
import { protect, hasPermission } from '../middleware/authMiddleware.js';
import { PERMISSIONS } from '../config/permissions.js';
import {
  getCpScorecard,
  getCommissionPayoutsBreakdown,
  getLeadQualityBreakdown,
} from '../controllers/devAnalyticsController.js';

const router = express.Router();

router.use(protect);

router.get(
  '/cp-scorecard',
  hasPermission(PERMISSIONS.ANALYTICS.ADVANCED),
  getCpScorecard
);
router.get(
  '/commission-payouts',
  hasPermission(PERMISSIONS.ANALYTICS.ADVANCED),
  getCommissionPayoutsBreakdown
);
router.get(
  '/lead-quality',
  hasPermission(PERMISSIONS.ANALYTICS.ADVANCED),
  getLeadQualityBreakdown
);

export default router;
