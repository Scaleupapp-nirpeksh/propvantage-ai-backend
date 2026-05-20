// File: routes/channelPartnerRoutes.js
// Description: Channel Partner module routes — registry + commission rules.

import express from 'express';
import { protect, hasPermission } from '../middleware/authMiddleware.js';
import { PERMISSIONS } from '../config/permissions.js';
import {
  createChannelPartner,
  getChannelPartners,
  getChannelPartnerById,
  updateChannelPartner,
  createAgent,
  getAgents,
  updateAgent,
  createCommissionRule,
  getCommissionRules,
  getCommissionRuleById,
  updateCommissionRule,
} from '../controllers/channelPartnerController.js';

const router = express.Router();

router.use(protect);

// ─── Commission rules (before /:id to avoid path capture) ────
router
  .route('/commission-rules')
  .get(hasPermission(PERMISSIONS.CHANNEL_PARTNERS.VIEW), getCommissionRules)
  .post(
    hasPermission(PERMISSIONS.CHANNEL_PARTNERS.MANAGE_COMMISSION_RULES),
    createCommissionRule
  );

router
  .route('/commission-rules/:id')
  .get(hasPermission(PERMISSIONS.CHANNEL_PARTNERS.VIEW), getCommissionRuleById)
  .put(
    hasPermission(PERMISSIONS.CHANNEL_PARTNERS.MANAGE_COMMISSION_RULES),
    updateCommissionRule
  );

// ─── Agents ──────────────────────────────────────────────────
router.put(
  '/agents/:agentId',
  hasPermission(PERMISSIONS.CHANNEL_PARTNERS.UPDATE),
  updateAgent
);

// ─── Channel partner firms ───────────────────────────────────
router
  .route('/')
  .get(hasPermission(PERMISSIONS.CHANNEL_PARTNERS.VIEW), getChannelPartners)
  .post(hasPermission(PERMISSIONS.CHANNEL_PARTNERS.CREATE), createChannelPartner);

router
  .route('/:id')
  .get(hasPermission(PERMISSIONS.CHANNEL_PARTNERS.VIEW), getChannelPartnerById)
  .put(hasPermission(PERMISSIONS.CHANNEL_PARTNERS.UPDATE), updateChannelPartner);

router
  .route('/:id/agents')
  .get(hasPermission(PERMISSIONS.CHANNEL_PARTNERS.VIEW), getAgents)
  .post(hasPermission(PERMISSIONS.CHANNEL_PARTNERS.UPDATE), createAgent);

export default router;
