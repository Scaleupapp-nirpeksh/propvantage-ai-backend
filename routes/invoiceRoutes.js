// File: routes/invoiceRoutes.js
// Description: Invoice management routes for PropVantage AI - Production grade API endpoints
// Version: 1.0 - Complete invoice management routes with role-based access control
// Location: routes/invoiceRoutes.js

import express from 'express';
import {
  createInvoiceFromSale,
  getInvoices,
  getInvoice,
  updateInvoice,
  recordInvoicePayment,
  cancelInvoice,
  getInvoiceStatistics,
  getOverdueInvoices,
  exportInvoices
} from '../controllers/invoiceController.js';

// Import the security middleware
import { protect, hasPermission } from '../middleware/authMiddleware.js';
import { PERMISSIONS } from '../config/permissions.js';

const router = express.Router();

// Apply the 'protect' middleware to all routes in this file
router.use(protect);

// =============================================================================
// STATISTICS AND REPORTING ROUTES (placed first to avoid conflicts)
// =============================================================================

// @route   GET /api/invoices/statistics
// @desc    Get invoice statistics and analytics
// @access  Private (Management roles)
router.get(
  '/statistics',
  hasPermission(PERMISSIONS.INVOICES.STATISTICS),
  getInvoiceStatistics
);

// @route   GET /api/invoices/overdue
// @desc    Get all overdue invoices
// @access  Private (Management and Finance roles)
router.get(
  '/overdue',
  hasPermission(PERMISSIONS.INVOICES.VIEW),
  getOverdueInvoices
);

// @route   GET /api/invoices/export
// @desc    Export invoices to CSV
// @access  Private (Management and Finance roles)
router.get(
  '/export',
  hasPermission(PERMISSIONS.INVOICES.EXPORT),
  exportInvoices
);

// =============================================================================
// INVOICE CREATION ROUTES
// =============================================================================

// @route   POST /api/invoices/from-sale/:saleId
// @desc    Create invoice from an existing sale
// @access  Private (Sales and Finance roles)
router.post(
  '/from-sale/:saleId',
  hasPermission(PERMISSIONS.INVOICES.CREATE),
  createInvoiceFromSale
);

// =============================================================================
// MAIN INVOICE CRUD ROUTES
// =============================================================================

// @route   GET /api/invoices
// @route   POST /api/invoices (if we add direct invoice creation later)
// @desc    Get all invoices with filtering and pagination
// @access  Private (Management and Finance roles)
router.route('/')
  .get(hasPermission(PERMISSIONS.INVOICES.VIEW), getInvoices);
  // .post(hasPermission(PERMISSIONS.INVOICES.CREATE), createInvoice); // For future direct invoice creation

// =============================================================================
// INDIVIDUAL INVOICE ROUTES
// =============================================================================

// @route   GET /api/invoices/:id
// @route   PUT /api/invoices/:id
// @desc    Get, update a specific invoice by ID
// @access  Private (View: Management/Finance, Update: Finance roles)
router.route('/:id')
  .get(hasPermission(PERMISSIONS.INVOICES.VIEW), getInvoice)
  .put(hasPermission(PERMISSIONS.INVOICES.UPDATE), updateInvoice);

// =============================================================================
// INVOICE ACTION ROUTES
// =============================================================================

// @route   POST /api/invoices/:id/payment
// @desc    Record payment for a specific invoice
// @access  Private (Finance roles)
router.post(
  '/:id/payment',
  hasPermission(PERMISSIONS.INVOICES.RECORD_PAYMENT),
  recordInvoicePayment
);

// @route   PUT /api/invoices/:id/cancel
// @desc    Cancel a specific invoice
// @access  Private (Senior Management roles only)
router.put(
  '/:id/cancel',
  hasPermission(PERMISSIONS.INVOICES.CANCEL),
  cancelInvoice
);

// =============================================================================
// FUTURE ENHANCEMENT ROUTES (commented for now)
// =============================================================================

/*
// @route   POST /api/invoices/:id/duplicate
// @desc    Create a duplicate invoice from an existing one
// @access  Private (Finance roles)
router.post(
  '/:id/duplicate',
  hasPermission(PERMISSIONS.INVOICES.CREATE),
  duplicateInvoice
);

// @route   GET /api/invoices/:id/pdf
// @desc    Generate and download PDF for invoice
// @access  Private (Sales and Finance roles)
router.get(
  '/:id/pdf',
  hasPermission(PERMISSIONS.INVOICES.VIEW),
  generateInvoicePDF
);

// @route   POST /api/invoices/:id/send-email
// @desc    Send invoice via email
// @access  Private (Sales and Finance roles)
router.post(
  '/:id/send-email',
  hasPermission(PERMISSIONS.INVOICES.CREATE),
  sendInvoiceViaEmail
);

// @route   GET /api/invoices/templates
// @desc    Get available invoice templates
// @access  Private (Sales and Finance roles)
router.get(
  '/templates',
  hasPermission(PERMISSIONS.INVOICES.VIEW),
  getInvoiceTemplates
);

// @route   POST /api/invoices/bulk-create
// @desc    Create multiple invoices from a list of sales
// @access  Private (Finance roles)
router.post(
  '/bulk-create',
  hasPermission(PERMISSIONS.INVOICES.CREATE),
  bulkCreateInvoices
);

// @route   PUT /api/invoices/bulk-update
// @desc    Update multiple invoices
// @access  Private (Finance roles)
router.put(
  '/bulk-update',
  hasPermission(PERMISSIONS.INVOICES.UPDATE),
  bulkUpdateInvoices
);
*/

// =============================================================================
// ERROR HANDLING MIDDLEWARE (if needed for specific invoice routes)
// =============================================================================

// Custom error handler for invoice routes (optional)
router.use((error, req, res, next) => {
  console.error('Invoice Route Error:', error);

  // Invoice-specific error handling
  if (error.name === 'ValidationError') {
    const message = Object.values(error.errors).map(val => val.message).join(', ');
    return res.status(400).json({
      success: false,
      message: `Invoice validation error: ${message}`
    });
  }

  if (error.name === 'CastError') {
    return res.status(400).json({
      success: false,
      message: 'Invalid invoice ID format'
    });
  }

  // Pass to global error handler
  next(error);
});

export default router;
