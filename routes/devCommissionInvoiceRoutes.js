// File: routes/devCommissionInvoiceRoutes.js
// Description: SP5+ — Dev-side commission invoice endpoints.
//   No requireOrgType('builder') because the service-layer scoping already
//   prevents a CP from acting via these routes (it asserts inv.developerOrg
//   === user.organization). Permission gates cover the rest.

import express from 'express';
import { protect, hasPermission } from '../middleware/authMiddleware.js';
import { PERMISSIONS } from '../config/permissions.js';
import {
  list, get, approve, reject, recordPayment,
} from '../controllers/devCommissionInvoiceController.js';

const router = express.Router();

router.use(protect);

router.get('/',                hasPermission(PERMISSIONS.COMMISSION_INVOICES.VIEW),    list);
router.get('/:id',             hasPermission(PERMISSIONS.COMMISSION_INVOICES.VIEW),    get);
router.post('/:id/approve',    hasPermission(PERMISSIONS.COMMISSION_INVOICES.APPROVE), approve);
router.post('/:id/reject',     hasPermission(PERMISSIONS.COMMISSION_INVOICES.APPROVE), reject);
router.post('/:id/payment',    hasPermission(PERMISSIONS.COMMISSION_INVOICES.PAY),     recordPayment);

export default router;
