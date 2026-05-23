// File: routes/cpAiUsageRoutes.js
// Description: SP5 — GET /api/cp/ai/usage. Not rate-limited (it's the
//   indicator the rate limit drives, so it must always respond).

import express from 'express';
import { protect, hasPermission, requireOrgType } from '../middleware/authMiddleware.js';
import { CP_PERMISSIONS } from '../config/permissions.js';
import { getUsage } from '../controllers/cpAiUsageController.js';

const router = express.Router();

router.use(protect);
router.use(requireOrgType('channel_partner'));

router.get('/usage', hasPermission(CP_PERMISSIONS.ANALYTICS.VIEW), getUsage);

export default router;
