// File: routes/marketplaceRoutes.js
// Marketplace discovery — each route is single-sided, so org-type and permission
// gating is applied as route middleware.
import express from 'express';
import { protect, hasPermission, requireOrgType } from '../middleware/authMiddleware.js';
import { CP_PERMISSIONS, PERMISSIONS } from '../config/permissions.js';
import { browseDevelopers, browseChannelPartners } from '../controllers/marketplaceController.js';

const router = express.Router();

router.use(protect);

// A CP browses developers and their published portfolios.
router.get(
  '/developers',
  requireOrgType('channel_partner'),
  hasPermission(CP_PERMISSIONS.PARTNERSHIPS.VIEW),
  browseDevelopers
);

// A developer browses the directory of channel-partner organizations.
router.get(
  '/channel-partners',
  requireOrgType('builder'),
  hasPermission(PERMISSIONS.CHANNEL_PARTNERS.VIEW),
  browseChannelPartners
);

export default router;
