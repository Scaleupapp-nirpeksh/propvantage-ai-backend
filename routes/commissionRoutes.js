// File: routes/commissionRoutes.js
// Description: Defines API routes for commission management system

import express from 'express';
import {
  // Commission Structure Management
  createCommissionStructure,
  getCommissionStructures,
  getCommissionStructureById,
  updateCommissionStructure,
  deactivateCommissionStructure,

  // Commission Management
  createCommissionForSaleEndpoint,
  getCommissions,
  getCommissionById,
  approveCommission,
  rejectCommission,
  putCommissionOnHold,
  releaseCommissionHold,
  bulkApproveCommissionsEndpoint,

  // Commission Payments
  recordCommissionPayment,
  processBulkCommissionPayments,

  // Reports & Analytics
  getCommissionReport,
  getCommissionAnalyticsEndpoint,
  getOverdueCommissions,
  getPartnerPerformanceEndpoint,
  recalculateCommissionEndpoint
} from '../controllers/commissionController.js';

// Import security middleware
import { protect, hasPermission } from '../middleware/authMiddleware.js';
import { PERMISSIONS } from '../config/permissions.js';

const router = express.Router();

// Apply the 'protect' middleware to all routes in this file
router.use(protect);

// =============================================================================
// COMMISSION STRUCTURE ROUTES
// =============================================================================

// @route   POST /api/commissions/structures
// @desc    Create a new commission structure
// @access  Private (Management roles)
router.post(
  '/structures',
  hasPermission(PERMISSIONS.COMMISSIONS.MANAGE_STRUCTURES),
  createCommissionStructure
);

// @route   GET /api/commissions/structures
// @desc    Get all commission structures
// @access  Private (Management roles)
router.get(
  '/structures',
  hasPermission(PERMISSIONS.COMMISSIONS.MANAGE_STRUCTURES),
  getCommissionStructures
);

// @route   GET /api/commissions/structures/:id
// @desc    Get commission structure by ID
// @access  Private (Management roles)
router.get(
  '/structures/:id',
  hasPermission(PERMISSIONS.COMMISSIONS.MANAGE_STRUCTURES),
  getCommissionStructureById
);

// @route   PUT /api/commissions/structures/:id
// @desc    Update commission structure
// @access  Private (Management roles)
router.put(
  '/structures/:id',
  hasPermission(PERMISSIONS.COMMISSIONS.MANAGE_STRUCTURES),
  updateCommissionStructure
);

// @route   DELETE /api/commissions/structures/:id
// @desc    Deactivate commission structure
// @access  Private (Senior Management roles)
router.delete(
  '/structures/:id',
  hasPermission(PERMISSIONS.COMMISSIONS.MANAGE_STRUCTURES),
  deactivateCommissionStructure
);

// =============================================================================
// COMMISSION MANAGEMENT ROUTES
// =============================================================================

// @route   POST /api/commissions/create-for-sale
// @desc    Create commission for a sale
// @access  Private (Sales/Management roles)
router.post(
  '/create-for-sale',
  hasPermission(PERMISSIONS.COMMISSIONS.CREATE),
  createCommissionForSaleEndpoint
);

// @route   GET /api/commissions
// @desc    Get commissions with filters
// @access  Private (Sales/Management roles)
router.get(
  '/',
  hasPermission(PERMISSIONS.COMMISSIONS.VIEW),
  getCommissions
);

// @route   GET /api/commissions/:id
// @desc    Get commission by ID
// @access  Private (Sales/Management roles)
router.get(
  '/:id',
  hasPermission(PERMISSIONS.COMMISSIONS.VIEW),
  getCommissionById
);

// @route   POST /api/commissions/:id/approve
// @desc    Approve commission
// @access  Private (Management roles)
router.post(
  '/:id/approve',
  hasPermission(PERMISSIONS.COMMISSIONS.APPROVE),
  approveCommission
);

// @route   POST /api/commissions/:id/reject
// @desc    Reject commission
// @access  Private (Management roles)
router.post(
  '/:id/reject',
  hasPermission(PERMISSIONS.COMMISSIONS.REJECT),
  rejectCommission
);

// @route   POST /api/commissions/:id/hold
// @desc    Put commission on hold
// @access  Private (Management roles)
router.post(
  '/:id/hold',
  hasPermission(PERMISSIONS.COMMISSIONS.HOLD),
  putCommissionOnHold
);

// @route   POST /api/commissions/:id/release
// @desc    Release commission from hold
// @access  Private (Management roles)
router.post(
  '/:id/release',
  hasPermission(PERMISSIONS.COMMISSIONS.HOLD),
  releaseCommissionHold
);

// @route   POST /api/commissions/bulk-approve
// @desc    Bulk approve commissions
// @access  Private (Management roles)
router.post(
  '/bulk-approve',
  hasPermission(PERMISSIONS.COMMISSIONS.APPROVE),
  bulkApproveCommissionsEndpoint
);

// @route   POST /api/commissions/:id/recalculate
// @desc    Recalculate commission
// @access  Private (Management roles)
router.post(
  '/:id/recalculate',
  hasPermission(PERMISSIONS.COMMISSIONS.RECALCULATE),
  recalculateCommissionEndpoint
);

// =============================================================================
// COMMISSION PAYMENT ROUTES
// =============================================================================

// @route   POST /api/commissions/:id/payment
// @desc    Record commission payment
// @access  Private (Finance roles)
router.post(
  '/:id/payment',
  hasPermission(PERMISSIONS.COMMISSIONS.RECORD_PAYMENT),
  recordCommissionPayment
);

// @route   POST /api/commissions/bulk-payment
// @desc    Process bulk commission payments
// @access  Private (Finance roles)
router.post(
  '/bulk-payment',
  hasPermission(PERMISSIONS.COMMISSIONS.RECORD_PAYMENT),
  processBulkCommissionPayments
);

// =============================================================================
// COMMISSION REPORTS & ANALYTICS ROUTES
// =============================================================================

// @route   GET /api/commissions/reports/detailed
// @desc    Generate commission report
// @access  Private (Management roles)
router.get(
  '/reports/detailed',
  hasPermission(PERMISSIONS.COMMISSIONS.REPORTS),
  getCommissionReport
);

// @route   GET /api/commissions/analytics
// @desc    Get commission analytics
// @access  Private (Management roles)
router.get(
  '/analytics',
  hasPermission(PERMISSIONS.COMMISSIONS.REPORTS),
  getCommissionAnalyticsEndpoint
);

// @route   GET /api/commissions/reports/overdue
// @desc    Get overdue commissions
// @access  Private (Management roles)
router.get(
  '/reports/overdue',
  hasPermission(PERMISSIONS.COMMISSIONS.REPORTS),
  getOverdueCommissions
);

// @route   GET /api/commissions/partners/:partnerId/performance
// @desc    Get partner performance data
// @access  Private (Management roles)
router.get(
  '/partners/:partnerId/performance',
  hasPermission(PERMISSIONS.COMMISSIONS.REPORTS),
  getPartnerPerformanceEndpoint
);

export default router;
