// File: routes/analyticsRoutes.js
// Description: Defines the API routes for dashboard and analytics data.

import express from 'express';
import { getSalesSummary, getLeadFunnel } from '../controllers/analyticsController.js';

// Import the security middleware
import { protect, authorize } from '../middleware/authMiddleware.js';

const router = express.Router();

// Apply the 'protect' middleware to all routes in this file
router.use(protect);

// Define roles that can view high-level sales and financial data
const financeAndManagementAccess = [
  'Business Head',
  'Sales Head',
  'Finance Head',
  'Project Director',
  'Finance Manager',
];

// Define roles that can view lead and pipeline data
const salesManagementAccess = [
  'Business Head',
  'Sales Head',
  'Project Director',
  'Sales Manager',
];

// @route   GET /api/analytics/sales-summary
// @desc    Get a high-level sales summary
// @access  Private
router.get(
  '/sales-summary',
  authorize(...financeAndManagementAccess),
  getSalesSummary
);

// @route   GET /api/analytics/lead-funnel
// @desc    Get a lead funnel analysis
// @access  Private
router.get(
  '/lead-funnel',
  authorize(...salesManagementAccess),
  getLeadFunnel
);

export default router;
