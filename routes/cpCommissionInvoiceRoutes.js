// File: routes/cpCommissionInvoiceRoutes.js
// Description: SP5+ — CP-side commission invoice endpoints.

import express from 'express';
import {
  protect, hasPermission, requireOrgType,
} from '../middleware/authMiddleware.js';
import { CP_PERMISSIONS } from '../config/permissions.js';
import {
  list, get, create, update, submit, cancel,
} from '../controllers/cpCommissionInvoiceController.js';

const router = express.Router();

router.use(protect);
router.use(requireOrgType('channel_partner'));

router.get('/',                hasPermission(CP_PERMISSIONS.COMMISSION_INVOICES.VIEW),   list);
router.post('/',               hasPermission(CP_PERMISSIONS.COMMISSION_INVOICES.MANAGE), create);
router.get('/:id',             hasPermission(CP_PERMISSIONS.COMMISSION_INVOICES.VIEW),   get);
router.put('/:id',             hasPermission(CP_PERMISSIONS.COMMISSION_INVOICES.MANAGE), update);
router.post('/:id/submit',     hasPermission(CP_PERMISSIONS.COMMISSION_INVOICES.MANAGE), submit);
router.post('/:id/cancel',     hasPermission(CP_PERMISSIONS.COMMISSION_INVOICES.MANAGE), cancel);

export default router;
