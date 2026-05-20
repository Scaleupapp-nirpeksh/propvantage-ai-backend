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
  getCommissionRecords,
  markPayoutPaid,
  editSaleAttribution,
  getChannelPartnerDashboard,
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

// ─── Commission records ─────────────────────────────────────
router.get(
  '/commission-records',
  hasPermission(PERMISSIONS.CHANNEL_PARTNERS.VIEW),
  getCommissionRecords
);

router.put(
  '/commission-records/:id/payouts/:index/pay',
  hasPermission(PERMISSIONS.CHANNEL_PARTNERS.MANAGE_COMMISSIONS),
  markPayoutPaid
);

// ─── Performance dashboard ──────────────────────────────────
router.get(
  '/dashboard',
  hasPermission(PERMISSIONS.CHANNEL_PARTNERS.VIEW),
  getChannelPartnerDashboard
);

// ─── Booking attribution edit ───────────────────────────────
router.put(
  '/sales/:saleId/attribution',
  hasPermission(PERMISSIONS.CHANNEL_PARTNERS.EDIT_BOOKING_ATTRIBUTION),
  editSaleAttribution
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
