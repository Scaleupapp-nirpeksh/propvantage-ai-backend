// File: routes/contractorRoutes.js
// Description: Defines API routes for contractor management

import express from 'express';
import multer from 'multer';
import {
  createContractor,
  getContractors,
  getContractorById,
  updateContractor,
  uploadContractorDocument,
  addContractorReview,
  getContractorsBySpecialization,
  getAvailableContractors,
  updateContractorStatus,
  togglePreferredStatus,
  addInternalNote,
  getContractorAnalytics
} from '../controllers/contractorController.js';

// Import security middleware
import { protect, hasPermission } from '../middleware/authMiddleware.js';
import { PERMISSIONS } from '../config/permissions.js';

const router = express.Router();

// Configure multer for document uploads
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
    files: 1 // Single file upload
  },
  fileFilter: (req, file, cb) => {
    // Allow common document types
    const allowedMimeTypes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'image/jpeg',
      'image/png',
      'image/gif'
    ];

    if (allowedMimeTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`File type ${file.mimetype} is not allowed`), false);
    }
  }
});

// Apply authentication to all routes
router.use(protect);

// =============================================================================
// CONTRACTOR CRUD ROUTES
// =============================================================================

// @route   POST /api/contractors
// @desc    Create a new contractor
// @access  Private (Management roles)
router.post(
  '/',
  hasPermission(PERMISSIONS.CONTRACTORS.CREATE),
  createContractor
);

// @route   GET /api/contractors
// @desc    Get all contractors
// @access  Private (View roles)
router.get(
  '/',
  hasPermission(PERMISSIONS.CONTRACTORS.VIEW),
  getContractors
);

// @route   GET /api/contractors/analytics
// @desc    Get contractor analytics
// @access  Private (Management roles)
router.get(
  '/analytics',
  hasPermission(PERMISSIONS.CONTRACTORS.ANALYTICS),
  getContractorAnalytics
);

// @route   GET /api/contractors/available
// @desc    Get available contractors
// @access  Private (View roles)
router.get(
  '/available',
  hasPermission(PERMISSIONS.CONTRACTORS.VIEW),
  getAvailableContractors
);

// @route   GET /api/contractors/by-specialization/:specialization
// @desc    Get contractors by specialization
// @access  Private (View roles)
router.get(
  '/by-specialization/:specialization',
  hasPermission(PERMISSIONS.CONTRACTORS.VIEW),
  getContractorsBySpecialization
);

// @route   GET /api/contractors/:id
// @desc    Get contractor by ID
// @access  Private (View roles)
router.get(
  '/:id',
  hasPermission(PERMISSIONS.CONTRACTORS.VIEW),
  getContractorById
);

// @route   PUT /api/contractors/:id
// @desc    Update contractor
// @access  Private (Management roles)
router.put(
  '/:id',
  hasPermission(PERMISSIONS.CONTRACTORS.UPDATE),
  updateContractor
);

// =============================================================================
// CONTRACTOR DOCUMENT MANAGEMENT
// =============================================================================

// @route   POST /api/contractors/:id/documents
// @desc    Upload contractor document
// @access  Private (Management roles)
router.post(
  '/:id/documents',
  hasPermission(PERMISSIONS.CONTRACTORS.DOCUMENTS),
  upload.single('document'),
  uploadContractorDocument
);

// =============================================================================
// CONTRACTOR REVIEWS AND RATINGS
// =============================================================================

// @route   POST /api/contractors/:id/reviews
// @desc    Add contractor review
// @access  Private (View roles)
router.post(
  '/:id/reviews',
  hasPermission(PERMISSIONS.CONTRACTORS.REVIEWS),
  addContractorReview
);

// =============================================================================
// CONTRACTOR STATUS MANAGEMENT
// =============================================================================

// @route   PUT /api/contractors/:id/status
// @desc    Update contractor status
// @access  Private (Management roles)
router.put(
  '/:id/status',
  hasPermission(PERMISSIONS.CONTRACTORS.MANAGE),
  updateContractorStatus
);

// @route   PUT /api/contractors/:id/preferred
// @desc    Toggle contractor preferred status
// @access  Private (Management roles)
router.put(
  '/:id/preferred',
  hasPermission(PERMISSIONS.CONTRACTORS.MANAGE),
  togglePreferredStatus
);

// =============================================================================
// CONTRACTOR NOTES
// =============================================================================

// @route   POST /api/contractors/:id/notes
// @desc    Add internal note to contractor
// @access  Private (Management roles)
router.post(
  '/:id/notes',
  hasPermission(PERMISSIONS.CONTRACTORS.MANAGE),
  addInternalNote
);

// =============================================================================
// ERROR HANDLING MIDDLEWARE
// =============================================================================

// Handle multer errors
router.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        message: 'File size too large. Maximum allowed size is 10MB.'
      });
    }
    if (error.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({
        success: false,
        message: 'Unexpected file field. Use "document" as the field name.'
      });
    }
  }

  if (error.message.includes('File type') && error.message.includes('is not allowed')) {
    return res.status(400).json({
      success: false,
      message: 'File type not allowed. Please upload PDF, DOC, DOCX, or image files.'
    });
  }

  next(error);
});

export default router;
