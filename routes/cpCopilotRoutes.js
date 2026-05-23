// File: routes/cpCopilotRoutes.js
// Description: SP5 — CP Copilot chat endpoint. Rate-limited via aiRateLimit.

import express from 'express';
import { protect, hasPermission, requireOrgType } from '../middleware/authMiddleware.js';
import { CP_PERMISSIONS } from '../config/permissions.js';
import { aiRateLimit } from '../middleware/aiRateLimit.js';
import { cpCopilotMessage } from '../controllers/cpCopilotController.js';

const router = express.Router();

router.use(protect);
router.use(requireOrgType('channel_partner'));

router.post(
  '/message',
  hasPermission(CP_PERMISSIONS.ANALYTICS.VIEW),
  aiRateLimit,
  cpCopilotMessage
);

export default router;
