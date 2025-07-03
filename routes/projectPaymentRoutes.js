// File: routes/projectPaymentRoutes.js
// Description: Defines API routes for project-level payment configuration

import express from 'express';
import {
  getProjectPaymentConfig,
  updateProjectPaymentConfig,
  getPaymentPlanTemplates,
  createPaymentPlanTemplate,
  updatePaymentPlanTemplate,
  deactivatePaymentPlanTemplate,
  getAvailablePaymentMethods,
  calculateProjectCharges,
  getProjectBankAccounts,
  addProjectBankAccount
} from '../controllers/projectPaymentController.js';

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

// =============================================================================
// PROJECT PAYMENT CONFIGURATION ROUTES
// =============================================================================

// @route   GET /api/projects/:projectId/payment-config
// @desc    Get payment configuration for a project
// @access  Private (Management roles)
router.get(
  '/:projectId/payment-config',
  authorize(...managementRoles),
  getProjectPaymentConfig
);

// @route   PUT /api/projects/:projectId/payment-config
// @desc    Update payment configuration for a project
// @access  Private (Management roles)
router.put(
  '/:projectId/payment-config',
  authorize(...managementRoles),
  updateProjectPaymentConfig
);

// =============================================================================
// PAYMENT PLAN TEMPLATES ROUTES
// =============================================================================

// @route   GET /api/projects/:projectId/payment-templates
// @desc    Get payment plan templates for a project
// @access  Private (Sales/Management roles)
router.get(
  '/:projectId/payment-templates',
  authorize(...salesAndFinanceRoles),
  getPaymentPlanTemplates
);

// @route   POST /api/projects/:projectId/payment-templates
// @desc    Create a new payment plan template for a project
// @access  Private (Management roles)
router.post(
  '/:projectId/payment-templates',
  authorize(...managementRoles),
  createPaymentPlanTemplate
);

// @route   PUT /api/projects/:projectId/payment-templates/:templateId
// @desc    Update a payment plan template
// @access  Private (Management roles)
router.put(
  '/:projectId/payment-templates/:templateId',
  authorize(...managementRoles),
  updatePaymentPlanTemplate
);

// @route   DELETE /api/projects/:projectId/payment-templates/:templateId
// @desc    Deactivate a payment plan template
// @access  Private (Management roles)
router.delete(
  '/:projectId/payment-templates/:templateId',
  authorize(...managementRoles),
  deactivatePaymentPlanTemplate
);

// =============================================================================
// PAYMENT METHODS AND CALCULATIONS ROUTES
// =============================================================================

// @route   GET /api/projects/:projectId/payment-methods
// @desc    Get available payment methods for a project
// @access  Private (Sales/Finance roles)
router.get(
  '/:projectId/payment-methods',
  authorize(...salesAndFinanceRoles),
  getAvailablePaymentMethods
);

// @route   POST /api/projects/:projectId/calculate-charges
// @desc    Calculate project charges for a unit price
// @access  Private (Sales/Finance roles)
router.post(
  '/:projectId/calculate-charges',
  authorize(...salesAndFinanceRoles),
  calculateProjectCharges
);

// =============================================================================
// BANK ACCOUNT MANAGEMENT ROUTES
// =============================================================================

// @route   GET /api/projects/:projectId/bank-accounts
// @desc    Get bank account details for a project
// @access  Private (Sales/Finance roles)
router.get(
  '/:projectId/bank-accounts',
  authorize(...salesAndFinanceRoles),
  getProjectBankAccounts
);

// @route   POST /api/projects/:projectId/bank-accounts
// @desc    Add bank account to project
// @access  Private (Finance/Management roles)
router.post(
  '/:projectId/bank-accounts',
  authorize(...financeRoles),
  addProjectBankAccount
);

export default router;