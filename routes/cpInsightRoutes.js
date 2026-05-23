// File: routes/cpInsightRoutes.js
// Description: SP5 — /api/cp/insights/* routes.

import express from 'express';
import { protect, hasPermission, requireOrgType } from '../middleware/authMiddleware.js';
import { CP_PERMISSIONS } from '../config/permissions.js';
import { aiRateLimit } from '../middleware/aiRateLimit.js';
import { getInsight, generateInsight } from '../controllers/cpInsightController.js';

const router = express.Router();

router.use(protect);
router.use(requireOrgType('channel_partner'));

router.get(
  '/:surface',
  hasPermission(CP_PERMISSIONS.ANALYTICS.VIEW),
  aiRateLimit,
  getInsight
);
router.post(
  '/:surface/generate',
  hasPermission(CP_PERMISSIONS.ANALYTICS.VIEW),
  aiRateLimit,
  generateInsight
);

export default router;
