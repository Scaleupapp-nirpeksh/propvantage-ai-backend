// File: routes/budgetVsActualRoutes.js
// Description: Budget vs Actual tracking routes with role-based access
// Version: 1.0 - Complete routing structure
// Location: routes/budgetVsActualRoutes.js

import express from 'express';
import {
  getBudgetVsActualReport,
  getRevenueAnalysis,
  getSalesAnalysis,
  getLeadAnalysis,
  getProjectComparison,
  getMarketingROI,
  getBudgetDashboard
} from '../controllers/budgetVsActualController.js';

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
  'Marketing Head',
  'Sales Manager',
  'Finance Manager',
  'Channel Partner Manager'
];

const salesRoles = [
  'Business Head',
  'Project Director',
  'Sales Head',
  'Marketing Head',
  'Sales Manager',
  'Sales Executive',
  'Channel Partner Manager'
];

const financeRoles = [
  'Business Head',
  'Project Director',
  'Finance Head',
  'Finance Manager'
];

const seniorManagementRoles = [
  'Business Head',
  'Project Director',
  'Sales Head',
  'Finance Head',
  'Marketing Head'
];

// =============================================================================
// COMPREHENSIVE BUDGET VS ACTUAL ROUTES
// =============================================================================

// @route   GET /api/analytics/budget-vs-actual
// @desc    Get comprehensive budget vs actual report
// @access  Private (Management roles)
router.get(
  '/budget-vs-actual',
  authorize(...managementRoles),
  getBudgetVsActualReport
);

// @route   GET /api/analytics/budget-dashboard
// @desc    Get budget vs actual dashboard summary
// @access  Private (Management roles)
router.get(
  '/budget-dashboard',
  authorize(...managementRoles),
  getBudgetDashboard
);

// =============================================================================
// SPECIFIC ANALYSIS ROUTES
// =============================================================================

// @route   GET /api/analytics/revenue-analysis
// @desc    Get revenue budget vs actual analysis
// @access  Private (Management roles)
router.get(
  '/revenue-analysis',
  authorize(...managementRoles),
  getRevenueAnalysis
);

// @route   GET /api/analytics/sales-analysis
// @desc    Get sales performance vs targets
// @access  Private (Management roles)
router.get(
  '/sales-analysis',
  authorize(...managementRoles),
  getSalesAnalysis
);

// @route   GET /api/analytics/lead-analysis
// @desc    Get lead generation vs targets
// @access  Private (Sales & Management roles)
router.get(
  '/lead-analysis',
  authorize(...salesRoles),
  getLeadAnalysis
);

// @route   GET /api/analytics/project-comparison
// @desc    Get project-wise performance comparison
// @access  Private (Management roles)
router.get(
  '/project-comparison',
  authorize(...managementRoles),
  getProjectComparison
);

// @route   GET /api/analytics/marketing-roi
// @desc    Get marketing ROI analysis
// @access  Private (Senior Management roles)
router.get(
  '/marketing-roi',
  authorize(...seniorManagementRoles),
  getMarketingROI
);

// =============================================================================
// QUICK ACCESS ROUTES FOR SPECIFIC METRICS
// =============================================================================

// @route   GET /api/analytics/revenue-kpis
// @desc    Get quick revenue KPIs
// @access  Private (Management roles)
router.get(
  '/revenue-kpis',
  authorize(...managementRoles),
  async (req, res) => {
    try {
      // Quick revenue metrics for dashboards
      const { getRevenueAnalysis } = await import('../controllers/budgetVsActualController.js');
      
      // Set format to summary for quick response
      req.query.format = 'summary';
      
      await getRevenueAnalysis(req, res);
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to fetch revenue KPIs',
        error: error.message
      });
    }
  }
);

// @route   GET /api/analytics/sales-kpis
// @desc    Get quick sales KPIs
// @access  Private (Management roles)
router.get(
  '/sales-kpis',
  authorize(...managementRoles),
  async (req, res) => {
    try {
      const { getSalesAnalysis } = await import('../controllers/budgetVsActualController.js');
      
      // Disable velocity data for quick response
      req.query.includeVelocity = 'false';
      
      await getSalesAnalysis(req, res);
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to fetch sales KPIs',
        error: error.message
      });
    }
  }
);

// @route   GET /api/analytics/lead-kpis
// @desc    Get quick lead generation KPIs
// @access  Private (Sales & Management roles)
router.get(
  '/lead-kpis',
  authorize(...salesRoles),
  async (req, res) => {
    try {
      const { getLeadAnalysis } = await import('../controllers/budgetVsActualController.js');
      
      // Disable detailed breakdowns for quick response
      req.query.includeSourceBreakdown = 'false';
      req.query.includeConversionFunnel = 'false';
      
      await getLeadAnalysis(req, res);
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to fetch lead KPIs',
        error: error.message
      });
    }
  }
);

// =============================================================================
// EXPORT ROUTES
// =============================================================================

export default router;