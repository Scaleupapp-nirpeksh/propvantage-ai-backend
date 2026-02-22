// File: routes/approvalRoutes.js
// Description: API routes for the centralized approval system.

import express from 'express';
import { protect, hasPermission } from '../middleware/authMiddleware.js';
import { PERMISSIONS } from '../config/permissions.js';
import {
  getDashboard,
  getPendingApprovals,
  getApprovalRequests,
  getApprovalRequestById,
  approveRequest,
  rejectRequest,
  cancelRequest,
  getApprovalPolicies,
  getApprovalPolicyById,
  createApprovalPolicy,
  updateApprovalPolicy,
} from '../controllers/approvalController.js';

const router = express.Router();

// All routes require authentication
router.use(protect);

// ─── Dashboard & Listing ──────────────────────────────────────

router.get(
  '/dashboard',
  hasPermission(PERMISSIONS.APPROVALS.VIEW),
  getDashboard
);

router.get(
  '/pending',
  hasPermission(PERMISSIONS.APPROVALS.VIEW),
  getPendingApprovals
);

// ─── Policy Management (must come before /:id to avoid conflicts) ─

router
  .route('/policies')
  .get(hasPermission(PERMISSIONS.APPROVALS.MANAGE_POLICIES), getApprovalPolicies)
  .post(
    hasPermission(PERMISSIONS.APPROVALS.MANAGE_POLICIES),
    createApprovalPolicy
  );

router
  .route('/policies/:id')
  .get(
    hasPermission(PERMISSIONS.APPROVALS.MANAGE_POLICIES),
    getApprovalPolicyById
  )
  .put(
    hasPermission(PERMISSIONS.APPROVALS.MANAGE_POLICIES),
    updateApprovalPolicy
  );

// ─── All Requests ─────────────────────────────────────────────

router.get(
  '/',
  hasPermission(PERMISSIONS.APPROVALS.VIEW_ALL),
  getApprovalRequests
);

// ─── Single Request & Actions ─────────────────────────────────

router.get(
  '/:id',
  hasPermission(PERMISSIONS.APPROVALS.VIEW),
  getApprovalRequestById
);

router.post(
  '/:id/approve',
  hasPermission(PERMISSIONS.APPROVALS.APPROVE),
  approveRequest
);

router.post(
  '/:id/reject',
  hasPermission(PERMISSIONS.APPROVALS.REJECT),
  rejectRequest
);

router.post(
  '/:id/cancel',
  hasPermission(PERMISSIONS.APPROVALS.VIEW),
  cancelRequest
);

export default router;
