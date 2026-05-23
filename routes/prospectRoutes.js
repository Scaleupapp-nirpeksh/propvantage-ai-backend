// File: routes/prospectRoutes.js
// SP4 — CP-side Prospect endpoints. Router-level guards: protect +
// requireOrgType('channel_partner'). Per-route permissions per spec §4.2.
import express from 'express';
import {
  protect,
  hasPermission,
  requireOrgType,
} from '../middleware/authMiddleware.js';
import { CP_PERMISSIONS } from '../config/permissions.js';
import {
  listProspects,
  createProspect,
  getProspect,
  updateProspect,
  deleteProspect,
  addProspectActivity,
  recordProspectBooking,
  addProspectCommissionPayment,
  updateProspectCommission,
} from '../controllers/prospectController.js';

const router = express.Router();

router.use(protect);
router.use(requireOrgType('channel_partner'));

router.get(
  '/',
  hasPermission(CP_PERMISSIONS.PROSPECTS.VIEW),
  listProspects
);
router.post(
  '/',
  hasPermission(CP_PERMISSIONS.PROSPECTS.MANAGE),
  createProspect
);
router.get(
  '/:id',
  hasPermission(CP_PERMISSIONS.PROSPECTS.VIEW),
  getProspect
);
router.put(
  '/:id',
  hasPermission(CP_PERMISSIONS.PROSPECTS.MANAGE),
  updateProspect
);
router.delete(
  '/:id',
  hasPermission(CP_PERMISSIONS.PROSPECTS.MANAGE),
  deleteProspect
);
router.post(
  '/:id/activities',
  hasPermission(CP_PERMISSIONS.PROSPECTS.MANAGE),
  addProspectActivity
);

// SP4 Phase D — commission tracking (manual ledger; works on/off platform)
router.post(
  '/:id/booking',
  hasPermission(CP_PERMISSIONS.PROSPECTS.MANAGE),
  recordProspectBooking
);
router.post(
  '/:id/commission/payments',
  hasPermission(CP_PERMISSIONS.PROSPECTS.MANAGE),
  addProspectCommissionPayment
);
router.put(
  '/:id/commission',
  hasPermission(CP_PERMISSIONS.PROSPECTS.MANAGE),
  updateProspectCommission
);

export default router;
