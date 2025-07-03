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
import { protect, authorize } from '../middleware/authMiddleware.js';

const router = express.Router();

// Apply the 'protect' middleware to all routes in this file
router.use(protect);

// Define role-based access control groups
const salesAndManagementRoles = [
  'Business Head',
  'Sales Head',
  'Project Director',
  'Sales Manager',
  'Sales Executive',
  'Channel Partner Manager'
];

const managementRoles = [
  'Business Head',
  'Sales Head',
  'Project Director',
  'Sales Manager',
  'Channel Partner Manager'
];

const financeRoles = [
  'Business Head',
  'Finance Head',
  'Finance Manager',
  'Project Director'
];

const seniorManagementRoles = [
  'Business Head',
  'Sales Head',
  'Finance Head',
  'Project Director'
];

// =============================================================================
// COMMISSION STRUCTURE ROUTES
// =============================================================================

// @route   POST /api/commissions/structures
// @desc    Create a new commission structure
// @access  Private (Management roles)
router.post(
  '/structures',
  authorize(...managementRoles),
  createCommissionStructure
);

// @route   GET /api/commissions/structures
// @desc    Get all commission structures
// @access  Private (Management roles)
router.get(
  '/structures',
  authorize(...managementRoles),
  getCommissionStructures
);

// @route   GET /api/commissions/structures/:id
// @desc    Get commission structure by ID
// @access  Private (Management roles)
router.get(
  '/structures/:id',
  authorize(...managementRoles),
  getCommissionStructureById
);

// @route   PUT /api/commissions/structures/:id
// @desc    Update commission structure
// @access  Private (Management roles)
router.put(
  '/structures/:id',
  authorize(...managementRoles),
  updateCommissionStructure
);

// @route   DELETE /api/commissions/structures/:id
// @desc    Deactivate commission structure
// @access  Private (Senior Management roles)
router.delete(
  '/structures/:id',
  authorize(...seniorManagementRoles),
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
  authorize(...salesAndManagementRoles),
  createCommissionForSaleEndpoint
);

// @route   GET /api/commissions
// @desc    Get commissions with filters
// @access  Private (Sales/Management roles)
router.get(
  '/',
  authorize(...salesAndManagementRoles),
  getCommissions
);

// @route   GET /api/commissions/:id
// @desc    Get commission by ID
// @access  Private (Sales/Management roles)
router.get(
  '/:id',
  authorize(...salesAndManagementRoles),
  getCommissionById
);

// @route   POST /api/commissions/:id/approve
// @desc    Approve commission
// @access  Private (Management roles)
router.post(
  '/:id/approve',
  authorize(...managementRoles),
  approveCommission
);

// @route   POST /api/commissions/:id/reject
// @desc    Reject commission
// @access  Private (Management roles)
router.post(
  '/:id/reject',
  authorize(...managementRoles),
  rejectCommission
);

// @route   POST /api/commissions/:id/hold
// @desc    Put commission on hold
// @access  Private (Management roles)
router.post(
  '/:id/hold',
  authorize(...managementRoles),
  putCommissionOnHold
);

// @route   POST /api/commissions/:id/release
// @desc    Release commission from hold
// @access  Private (Management roles)
router.post(
  '/:id/release',
  authorize(...managementRoles),
  releaseCommissionHold
);

// @route   POST /api/commissions/bulk-approve
// @desc    Bulk approve commissions
// @access  Private (Management roles)
router.post(
  '/bulk-approve',
  authorize(...managementRoles),
  bulkApproveCommissionsEndpoint
);

// @route   POST /api/commissions/:id/recalculate
// @desc    Recalculate commission
// @access  Private (Management roles)
router.post(
  '/:id/recalculate',
  authorize(...managementRoles),
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
  authorize(...financeRoles),
  recordCommissionPayment
);

// @route   POST /api/commissions/bulk-payment
// @desc    Process bulk commission payments
// @access  Private (Finance roles)
router.post(
  '/bulk-payment',
  authorize(...financeRoles),
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
  authorize(...managementRoles),
  getCommissionReport
);

// @route   GET /api/commissions/analytics
// @desc    Get commission analytics
// @access  Private (Management roles)
router.get(
  '/analytics',
  authorize(...managementRoles),
  getCommissionAnalyticsEndpoint
);

// @route   GET /api/commissions/reports/overdue
// @desc    Get overdue commissions
// @access  Private (Management roles)
router.get(
  '/reports/overdue',
  authorize(...managementRoles),
  getOverdueCommissions
);

// @route   GET /api/commissions/partners/:partnerId/performance
// @desc    Get partner performance data
// @access  Private (Management roles)
router.get(
  '/partners/:partnerId/performance',
  authorize(...managementRoles),
  getPartnerPerformanceEndpoint
);

export default router;