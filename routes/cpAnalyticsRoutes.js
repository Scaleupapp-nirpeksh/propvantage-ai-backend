// File: routes/cpAnalyticsRoutes.js
// Description: SP5 — CP-side analytics endpoints (Areas 1–5 of the spec).
//   Mounted at /api/cp/analytics. All routes: protect + requireOrgType +
//   per-route permission gate per spec §5.5 table.

import express from 'express';
import {
  protect,
  hasPermission,
  requireOrgType,
} from '../middleware/authMiddleware.js';
import { CP_PERMISSIONS } from '../config/permissions.js';
import {
  getPipeline,
  getCommission,
  getAgents,
  getDevelopers,
  getReconciliation,
  getReconciliationDetail,
  markReconciliationReviewed,
} from '../controllers/cpAnalyticsController.js';

const router = express.Router();

router.use(protect);
router.use(requireOrgType('channel_partner'));

// Area 1 — Pipeline Health
router.get(
  '/pipeline',
  hasPermission(CP_PERMISSIONS.ANALYTICS.VIEW),
  getPipeline
);

// Area 2 — Commission Overview
router.get(
  '/commission',
  hasPermission(CP_PERMISSIONS.ANALYTICS.VIEW),
  getCommission
);

// Area 3 — Agent Performance (Owner / Manager only)
router.get(
  '/agents',
  hasPermission(CP_PERMISSIONS.ANALYTICS.VIEW_TEAM),
  getAgents
);

// Area 4 — Developer Performance
router.get(
  '/developers',
  hasPermission(CP_PERMISSIONS.ANALYTICS.VIEW),
  getDevelopers
);

// Area 5 — Commission Reconciliation
router.get(
  '/reconciliation',
  hasPermission(CP_PERMISSIONS.ANALYTICS.VIEW),
  getReconciliation
);
router.get(
  '/reconciliation/:prospectId',
  hasPermission(CP_PERMISSIONS.ANALYTICS.VIEW),
  getReconciliationDetail
);
router.post(
  '/reconciliation/:prospectId/reviewed',
  hasPermission(CP_PERMISSIONS.ANALYTICS.VIEW),
  markReconciliationReviewed
);

export default router;
