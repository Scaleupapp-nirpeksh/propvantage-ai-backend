// File: routes/salesRoutes.js
// Description: Defines the API routes for creating and managing sales records.

import express from 'express';
import { createSale, getSales } from '../controllers/salesController.js';

// Import the security middleware
import { protect, authorize } from '../middleware/authMiddleware.js';

const router = express.Router();

// Apply the 'protect' middleware to all routes in this file
router.use(protect);

// Define roles that are allowed to book a new sale
const canBookSaleAccess = [
  'Business Head',
  'Sales Head',
  'Project Director',
  'Sales Manager',
  'Sales Executive',
];

// Define roles that can view all sales records (management & finance)
const canViewAllSalesAccess = [
  'Business Head',
  'Sales Head',
  'Finance Head',
  'Project Director',
  'Finance Manager',
];

// @route   /api/sales
// @desc    Create a new sale or get all sales records
router.route('/')
  .post(authorize(...canBookSaleAccess), createSale)
  .get(authorize(...canViewAllSalesAccess), getSales);

export default router;
