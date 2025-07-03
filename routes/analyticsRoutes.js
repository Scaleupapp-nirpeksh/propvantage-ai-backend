// File: routes/analyticsRoutes.js
// Description: Defines API routes for advanced analytics and dashboard functionality

import express from 'express';
import {
  getSalesSummary,
  getLeadFunnel,
  getDashboardAnalytics,
  getSalesReport
} from '../controllers/analyticsController.js';

// Import security middleware
import { protect, authorize } from '../middleware/authMiddleware.js';

const router = express.Router();

// Apply the 'protect' middleware to all routes in this file
router.use(protect);

// Define roles that have access to basic analytics (broader access)
const basicAnalyticsAccess = [
  'Business Head',
  'Sales Head',
  'Finance Head',
  'Project Director',
  'Finance Manager',
  'Sales Manager'
];

// Define roles that have access to advanced analytics (management and finance roles)
const advancedAnalyticsAccess = [
  'Business Head',
  'Sales Head',
  'Finance Head',
  'Project Director',
  'Finance Manager',
  'Sales Manager'
];

// Define roles with access to detailed reports (senior management)
const detailedReportsAccess = [
  'Business Head',
  'Sales Head',
  'Finance Head',
  'Project Director'
];

// EXISTING ENDPOINTS - Maintained for backward compatibility
// @route   GET /api/analytics/sales-summary
// @desc    Get high-level sales summary
// @access  Private (Management/Finance roles)
router.get(
  '/sales-summary',
  authorize(...basicAnalyticsAccess),
  getSalesSummary
);

// @route   GET /api/analytics/lead-funnel
// @desc    Get lead funnel analysis
// @access  Private (Management/Sales roles)
router.get(
  '/lead-funnel',
  authorize(...basicAnalyticsAccess),
  getLeadFunnel
);

// NEW ADVANCED ENDPOINTS
// @route   GET /api/analytics/dashboard
// @desc    Get comprehensive dashboard analytics
// @access  Private (Management roles)
router.get(
  '/dashboard',
  authorize(...advancedAnalyticsAccess),
  getDashboardAnalytics
);

// @route   GET /api/analytics/sales-report
// @desc    Get detailed sales analytics report
// @access  Private (Senior Management roles)
router.get(
  '/sales-report',
  authorize(...detailedReportsAccess),
  getSalesReport
);

export default router;