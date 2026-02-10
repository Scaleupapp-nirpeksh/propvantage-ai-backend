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
import { protect, hasPermission } from '../middleware/authMiddleware.js';
import { PERMISSIONS } from '../config/permissions.js';

const router = express.Router();

// Apply authentication to all routes
router.use(protect);

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
  hasPermission(PERMISSIONS.BUDGETS.VARIANCE_VIEW),
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
  hasPermission(PERMISSIONS.BUDGETS.VARIANCE_VIEW),
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
  hasPermission(PERMISSIONS.BUDGETS.UPDATE_TARGET),
  updateProjectBudgetTarget
);

export default router;
