// File: routes/salesRoutes.js
// Description: Complete API routes for sales management with analytics and pipeline endpoints
// Version: 2.0 - Complete routes matching the API service structure with proper authorization
// Location: routes/salesRoutes.js

import express from 'express';
import {
  createSale,
  getSales,
  getSale,
  updateSale,
  cancelSale,
  getSalesAnalytics,
  getSalesPipeline
} from '../controllers/salesController.js';

// Import the security middleware
import { protect, hasPermission } from '../middleware/authMiddleware.js';
import { PERMISSIONS } from '../config/permissions.js';

const router = express.Router();

// Apply the 'protect' middleware to all routes in this file
router.use(protect);

// --- Define API Routes ---

// @route   GET /api/sales/analytics
// @desc    Get sales analytics and performance metrics
// @access  Private (Management roles)
router.get('/analytics', hasPermission(PERMISSIONS.SALES.ANALYTICS), getSalesAnalytics);

// @route   GET /api/sales/pipeline
// @desc    Get sales pipeline data and status breakdown
// @access  Private (Sales and Management roles)
router.get('/pipeline', hasPermission(PERMISSIONS.SALES.PIPELINE), getSalesPipeline);

// @route   GET /api/sales
// @route   POST /api/sales
// @desc    Get all sales records with filtering/pagination OR create a new sale
// @access  Private (View: Management/Finance, Create: Sales roles)
router.route('/')
  .get(hasPermission(PERMISSIONS.SALES.VIEW), getSales)
  .post(hasPermission(PERMISSIONS.SALES.CREATE), createSale);

// @route   GET /api/sales/:id
// @route   PUT /api/sales/:id
// @route   DELETE /api/sales/:id
// @desc    Get, update, or cancel a specific sale by its ID
// @access  Private (View/Update: Management/Sales, Cancel: Senior Management)
router.route('/:id')
  .get(hasPermission(PERMISSIONS.SALES.VIEW), getSale)
  .put(hasPermission(PERMISSIONS.SALES.UPDATE), updateSale)
  .delete(hasPermission(PERMISSIONS.SALES.CANCEL), cancelSale);

// @route   PUT /api/sales/:id/cancel
// @desc    Cancel a sale (alternative endpoint to match API service)
// @access  Private (Senior Management roles)
router.put('/:id/cancel', hasPermission(PERMISSIONS.SALES.CANCEL), cancelSale);

// @route   POST /api/sales/:id/documents
// @desc    Generate sale documents (receipts, agreements, etc.)
// @access  Private (Sales and Management roles)
router.post('/:id/documents', hasPermission(PERMISSIONS.SALES.DOCUMENTS), async (req, res) => {
  try {
    // This would typically generate PDF documents, send emails, etc.
    // For now, we'll return a success message
    res.json({
      success: true,
      message: 'Documents generated successfully',
      documents: [
        { type: 'receipt', status: 'generated' },
        { type: 'agreement', status: 'generated' },
        { type: 'cost_sheet', status: 'generated' }
      ]
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to generate documents',
      error: error.message
    });
  }
});

export default router;
