// File: routes/pricingRoutes.js
// Description: Defines the API routes for the pricing engine and cost sheet generator.

import express from 'express';
import { getCostSheet, getDynamicPricing } from '../controllers/pricingController.js';

// Import the security middleware
import { protect, hasPermission } from '../middleware/authMiddleware.js';
import { PERMISSIONS } from '../config/permissions.js';

const router = express.Router();

// Apply the 'protect' middleware to all routes in this file
router.use(protect);

// @route   POST /api/pricing/cost-sheet/:unitId
// @desc    Generate a cost sheet for a specific unit
// @access  Private
router.post(
  '/cost-sheet/:unitId',
  hasPermission(PERMISSIONS.PRICING.COST_SHEET),
  getCostSheet
);

// @route   GET /api/pricing/dynamic/:projectId
// @desc    Get dynamic pricing suggestions for a project
// @access  Private
router.get(
  '/dynamic/:projectId',
  hasPermission(PERMISSIONS.PRICING.DYNAMIC_PRICING),
  getDynamicPricing
);

export default router;
