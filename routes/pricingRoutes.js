// File: routes/pricingRoutes.js
// Description: Defines the API routes for the pricing engine and cost sheet generator.

import express from 'express';
import { getCostSheet, getDynamicPricing } from '../controllers/pricingController.js';

// Import the security middleware
import { protect, authorize } from '../middleware/authMiddleware.js';

const router = express.Router();

// Apply the 'protect' middleware to all routes in this file
router.use(protect);

// Define roles that have access to generate cost sheets (all sales-related roles)
const costSheetAccess = [
  'Business Head',
  'Sales Head',
  'Project Director',
  'Sales Manager',
  'Sales Executive',
  'Channel Partner Manager',
  'Channel Partner Admin',
  'Channel Partner Agent',
];

// Define roles with access to strategic dynamic pricing (management/admin roles)
const dynamicPricingAccess = [
  'Business Head',
  'Sales Head',
  'Finance Head',
  'Project Director',
  'Finance Manager',
];

// @route   POST /api/pricing/cost-sheet/:unitId
// @desc    Generate a cost sheet for a specific unit
// @access  Private
router.post(
  '/cost-sheet/:unitId',
  authorize(...costSheetAccess),
  getCostSheet
);

// @route   GET /api/pricing/dynamic/:projectId
// @desc    Get dynamic pricing suggestions for a project
// @access  Private
router.get(
  '/dynamic/:projectId',
  authorize(...dynamicPricingAccess),
  getDynamicPricing
);

export default router;
