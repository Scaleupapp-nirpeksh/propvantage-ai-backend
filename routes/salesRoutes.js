// File: routes/salesRoutes.js
// Description: Defines the API routes for creating and managing sales records.
// Version: 2.0 - Added routes for get, update, and cancel single sale
// Location: routes/salesRoutes.js

import express from 'express';
import { 
  createSale, 
  getSales,
  getSale,
  updateSale,
  cancelSale
} from '../controllers/salesController.js';

// Import the security middleware
import { protect, authorize } from '../middleware/authMiddleware.js';

const router = express.Router();

// Apply the 'protect' middleware to all routes in this file
router.use(protect);

// --- Define Role-Based Access Control Lists ---

// Roles that are allowed to book or update a new sale
const canManageSaleAccess = [
  'Business Head',
  'Sales Head',
  'Project Director',
  'Sales Manager',
  'Sales Executive',
];

// Roles that can view all sales records (management & finance)
const canViewAllSalesAccess = [
  'Business Head',
  'Sales Head',
  'Finance Head',
  'Project Director',
  'Finance Manager',
  'Sales Manager',
];

// Roles that can cancel a sale (restricted to senior management)
const canCancelSaleAccess = [
    'Business Head',
    'Sales Head',
    'Project Director',
];


// --- Define API Routes ---

// @route   GET /api/sales
// @route   POST /api/sales
// @desc    Create a new sale or get all sales records
router.route('/')
  .post(authorize(...canManageSaleAccess), createSale)
  .get(authorize(...canViewAllSalesAccess), getSales);

// @route   GET /api/sales/:id
// @route   PUT /api/sales/:id
// @route   DELETE /api/sales/:id
// @desc    Get, update, or cancel a specific sale by its ID
router.route('/:id')
  .get(authorize(...canViewAllSalesAccess), getSale)
  .put(authorize(...canManageSaleAccess), updateSale)
  .delete(authorize(...canCancelSaleAccess), cancelSale);

export default router;
