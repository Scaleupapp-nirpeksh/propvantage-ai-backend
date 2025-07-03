// File: routes/paymentRoutes.js
// Description: Defines API routes for payment system - plans, installments, transactions, and reports

import express from 'express';
import {
  createNewPaymentPlan,
  getPaymentPlanDetails,
  updatePaymentPlan,
  getInstallments,
  updateInstallment,
  waiveInstallment,
  recordPayment,
  updatePaymentTransactionAmount,
  getPaymentTransactions,
  verifyPaymentTransaction,
  getOverduePayments,
  getPaymentsDueToday,
  getPaymentStatistics
} from '../controllers/paymentController.js';

// Import security middleware
import { protect, authorize } from '../middleware/authMiddleware.js';

const router = express.Router();

// Apply the 'protect' middleware to all routes in this file
router.use(protect);

// Define role-based access control groups
const salesAndFinanceRoles = [
  'Business Head',
  'Sales Head',
  'Finance Head',
  'Project Director',
  'Finance Manager',
  'Sales Manager',
  'Sales Executive'
];

const managementRoles = [
  'Business Head',
  'Sales Head',
  'Finance Head',
  'Project Director',
  'Finance Manager',
  'Sales Manager'
];

const financeRoles = [
  'Business Head',
  'Finance Head',
  'Project Director',
  'Finance Manager'
];

const seniorManagementRoles = [
  'Business Head',
  'Sales Head',
  'Finance Head',
  'Project Director'
];

// =============================================================================
// PAYMENT PLAN ROUTES
// =============================================================================

// @route   POST /api/payments/plans
// @desc    Create a new payment plan for a sale
// @access  Private (Sales/Finance roles)
router.post(
  '/plans',
  authorize(...salesAndFinanceRoles),
  createNewPaymentPlan
);

// @route   GET /api/payments/plans/:saleId
// @desc    Get payment plan details with installments and transactions
// @access  Private (Sales/Finance roles)
router.get(
  '/plans/:saleId',
  authorize(...salesAndFinanceRoles),
  getPaymentPlanDetails
);

// @route   PUT /api/payments/plans/:planId
// @desc    Update payment plan details
// @access  Private (Management roles)
router.put(
  '/plans/:planId',
  authorize(...managementRoles),
  updatePaymentPlan
);

// =============================================================================
// INSTALLMENT ROUTES
// =============================================================================

// @route   GET /api/payments/installments/:planId
// @desc    Get all installments for a payment plan
// @access  Private (Sales/Finance roles)
router.get(
  '/installments/:planId',
  authorize(...salesAndFinanceRoles),
  getInstallments
);

// @route   PUT /api/payments/installments/:installmentId
// @desc    Update installment amount or due date (triggers recalculation)
// @access  Private (Management roles)
router.put(
  '/installments/:installmentId',
  authorize(...managementRoles),
  updateInstallment
);

// @route   POST /api/payments/installments/:installmentId/waive
// @desc    Waive an installment
// @access  Private (Senior Management roles)
router.post(
  '/installments/:installmentId/waive',
  authorize(...seniorManagementRoles),
  waiveInstallment
);

// =============================================================================
// PAYMENT TRANSACTION ROUTES
// =============================================================================

// @route   POST /api/payments/transactions
// @desc    Record a new payment transaction
// @access  Private (Sales/Finance roles)
router.post(
  '/transactions',
  authorize(...salesAndFinanceRoles),
  recordPayment
);

// @route   PUT /api/payments/transactions/:transactionId
// @desc    Update payment transaction amount (triggers recalculation)
// @access  Private (Finance/Management roles)
router.put(
  '/transactions/:transactionId',
  authorize(...financeRoles),
  updatePaymentTransactionAmount
);

// @route   GET /api/payments/transactions/:planId
// @desc    Get payment transactions for a payment plan
// @access  Private (Sales/Finance roles)
router.get(
  '/transactions/:planId',
  authorize(...salesAndFinanceRoles),
  getPaymentTransactions
);

// @route   POST /api/payments/transactions/:transactionId/verify
// @desc    Verify a payment transaction
// @access  Private (Finance roles)
router.post(
  '/transactions/:transactionId/verify',
  authorize(...financeRoles),
  verifyPaymentTransaction
);

// =============================================================================
// PAYMENT REPORTS ROUTES
// =============================================================================

// @route   GET /api/payments/reports/overdue
// @desc    Get overdue payments report
// @access  Private (Management/Finance roles)
router.get(
  '/reports/overdue',
  authorize(...managementRoles),
  getOverduePayments
);

// @route   GET /api/payments/reports/due-today
// @desc    Get payments due today
// @access  Private (Sales/Finance roles)
router.get(
  '/reports/due-today',
  authorize(...salesAndFinanceRoles),
  getPaymentsDueToday
);

// @route   GET /api/payments/reports/statistics
// @desc    Get payment statistics for organization
// @access  Private (Management roles)
router.get(
  '/reports/statistics',
  authorize(...managementRoles),
  getPaymentStatistics
);

export default router;