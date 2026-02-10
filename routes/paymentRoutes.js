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
import { protect, hasPermission } from '../middleware/authMiddleware.js';
import { PERMISSIONS } from '../config/permissions.js';

const router = express.Router();

// Apply the 'protect' middleware to all routes in this file
router.use(protect);

// =============================================================================
// PAYMENT PLAN ROUTES
// =============================================================================

// @route   POST /api/payments/plans
// @desc    Create a new payment plan for a sale
// @access  Private (Sales/Finance roles)
router.post(
  '/plans',
  hasPermission(PERMISSIONS.PAYMENTS.CREATE_PLAN),
  createNewPaymentPlan
);

// @route   GET /api/payments/plans/:saleId
// @desc    Get payment plan details with installments and transactions
// @access  Private (Sales/Finance roles)
router.get(
  '/plans/:saleId',
  hasPermission(PERMISSIONS.PAYMENTS.VIEW),
  getPaymentPlanDetails
);

// @route   PUT /api/payments/plans/:planId
// @desc    Update payment plan details
// @access  Private (Management roles)
router.put(
  '/plans/:planId',
  hasPermission(PERMISSIONS.PAYMENTS.UPDATE_PLAN),
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
  hasPermission(PERMISSIONS.PAYMENTS.VIEW),
  getInstallments
);

// @route   PUT /api/payments/installments/:installmentId
// @desc    Update installment amount or due date (triggers recalculation)
// @access  Private (Management roles)
router.put(
  '/installments/:installmentId',
  hasPermission(PERMISSIONS.PAYMENTS.UPDATE_PLAN),
  updateInstallment
);

// @route   POST /api/payments/installments/:installmentId/waive
// @desc    Waive an installment
// @access  Private (Senior Management roles)
router.post(
  '/installments/:installmentId/waive',
  hasPermission(PERMISSIONS.PAYMENTS.WAIVE),
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
  hasPermission(PERMISSIONS.PAYMENTS.RECORD),
  recordPayment
);

// @route   PUT /api/payments/transactions/:transactionId
// @desc    Update payment transaction amount (triggers recalculation)
// @access  Private (Finance/Management roles)
router.put(
  '/transactions/:transactionId',
  hasPermission(PERMISSIONS.PAYMENTS.UPDATE_TRANSACTION),
  updatePaymentTransactionAmount
);

// @route   GET /api/payments/transactions/:planId
// @desc    Get payment transactions for a payment plan
// @access  Private (Sales/Finance roles)
router.get(
  '/transactions/:planId',
  hasPermission(PERMISSIONS.PAYMENTS.VIEW),
  getPaymentTransactions
);

// @route   POST /api/payments/transactions/:transactionId/verify
// @desc    Verify a payment transaction
// @access  Private (Finance roles)
router.post(
  '/transactions/:transactionId/verify',
  hasPermission(PERMISSIONS.PAYMENTS.VERIFY),
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
  hasPermission(PERMISSIONS.PAYMENTS.REPORTS),
  getOverduePayments
);

// @route   GET /api/payments/reports/due-today
// @desc    Get payments due today
// @access  Private (Sales/Finance roles)
router.get(
  '/reports/due-today',
  hasPermission(PERMISSIONS.PAYMENTS.VIEW),
  getPaymentsDueToday
);

// @route   GET /api/payments/reports/statistics
// @desc    Get payment statistics for organization
// @access  Private (Management roles)
router.get(
  '/reports/statistics',
  hasPermission(PERMISSIONS.PAYMENTS.REPORTS),
  getPaymentStatistics
);

export default router;
