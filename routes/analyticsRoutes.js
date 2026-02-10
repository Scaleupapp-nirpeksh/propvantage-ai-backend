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
import { protect, hasPermission } from '../middleware/authMiddleware.js';
import { PERMISSIONS } from '../config/permissions.js';

const router = express.Router();

// Apply the 'protect' middleware to all routes in this file
router.use(protect);

// EXISTING ENDPOINTS - Maintained for backward compatibility
// @route   GET /api/analytics/sales-summary
// @desc    Get high-level sales summary
// @access  Private (Management/Finance roles)
router.get(
  '/sales-summary',
  hasPermission(PERMISSIONS.ANALYTICS.BASIC),
  getSalesSummary
);

// @route   GET /api/analytics/lead-funnel
// @desc    Get lead funnel analysis
// @access  Private (Management/Sales roles)
router.get(
  '/lead-funnel',
  hasPermission(PERMISSIONS.ANALYTICS.BASIC),
  getLeadFunnel
);

// NEW ADVANCED ENDPOINTS
// @route   GET /api/analytics/dashboard
// @desc    Get comprehensive dashboard analytics
// @access  Private (Management roles)
router.get(
  '/dashboard',
  hasPermission(PERMISSIONS.ANALYTICS.ADVANCED),
  getDashboardAnalytics
);

// @route   GET /api/analytics/sales-report
// @desc    Get detailed sales analytics report
// @access  Private (Senior Management roles)
router.get(
  '/sales-report',
  hasPermission(PERMISSIONS.ANALYTICS.REPORTS),
  getSalesReport
);

export default router;
