// File: routes/budgetVarianceRoutes.js
// Description: Routes for real-time budget variance tracking
// Location: routes/budgetVarianceRoutes.js

import express from 'express';
import { 
  getProjectBudgetVariance, 
  getMultiProjectBudgetSummary,
  updateProjectBudgetTarget 
} from '../controllers/projectBudgetController.js';

// Import authentication middleware
import { protect, authorize } from '../middleware/authMiddleware.js';

const router = express.Router();

// Apply authentication to all routes
router.use(protect);

// Define role-based access control groups
const managementRoles = [
  'Business Head',
  'Project Director',
  'Sales Head',
  'Finance Head',
  'Sales Manager',
  'Finance Manager',
  'Channel Partner Manager'
];

const salesRoles = [
  'Business Head',
  'Project Director', 
  'Sales Head',
  'Sales Manager',
  'Sales Executive',
  'Channel Partner Manager',
  'Channel Partner Admin'
];

const seniorManagementRoles = [
    'Business Head',
    'Project Director',
    'Sales Head',
    'Marketing Head',
    'Sales Manager'
];

// =============================================================================
// BUDGET VARIANCE TRACKING ROUTES
// =============================================================================

/**
 * @route   GET /api/projects/:id/budget-variance
 * @desc    Get real-time budget variance analysis for a specific project
 * @access  Private (Management and Sales roles)
 * @example GET /api/projects/507f1f77bcf86cd799439011/budget-variance
 */
router.get(
  '/:id/budget-variance',
  authorize(...managementRoles),
  getProjectBudgetVariance
);

/**
 * @route   GET /api/projects/budget-variance-summary  
 * @desc    Get budget variance summary for all projects
 * @access  Private (Management roles only)
 * @example GET /api/projects/budget-variance-summary?limit=5
 */
router.get(
  '/budget-variance-summary',
  authorize(...managementRoles),
  getMultiProjectBudgetSummary
);

/**
 * @route   PUT /api/projects/:id/budget-target
 * @desc    Update project budget target
 * @access  Private (Senior Management roles only)
 * @example PUT /api/projects/507f1f77bcf86cd799439011/budget-target
 */
router.put(
  '/:id/budget-target',
  authorize(...managementRoles),
  updateProjectBudgetTarget
);

export default router;