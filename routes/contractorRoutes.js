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
import { protect, authorize } from '../middleware/authMiddleware.js';

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

// Define role-based access control groups
const managementRoles = [
  'Business Head',
  'Project Director',
  'Sales Head',
  'Sales Manager',
  'Channel Partner Manager'
];

const viewRoles = [
  'Business Head',
  'Project Director',
  'Sales Head',
  'Finance Head',
  'Sales Manager',
  'Finance Manager',
  'Channel Partner Manager',
  'Sales Executive'
];

const allRoles = [
  'Business Head',
  'Project Director',
  'Sales Head',
  'Finance Head',
  'Marketing Head',
  'Sales Manager',
  'Finance Manager',
  'Channel Partner Manager',
  'Sales Executive',
  'Channel Partner Admin',
  'Channel Partner Agent'
];

// =============================================================================
// CONTRACTOR CRUD ROUTES
// =============================================================================

// @route   POST /api/contractors
// @desc    Create a new contractor
// @access  Private (Management roles)
router.post(
  '/',
  authorize(...managementRoles),
  createContractor
);

// @route   GET /api/contractors
// @desc    Get all contractors
// @access  Private (View roles)
router.get(
  '/',
  authorize(...viewRoles),
  getContractors
);

// @route   GET /api/contractors/analytics
// @desc    Get contractor analytics
// @access  Private (Management roles)
router.get(
  '/analytics',
  authorize(...managementRoles),
  getContractorAnalytics
);

// @route   GET /api/contractors/available
// @desc    Get available contractors
// @access  Private (View roles)
router.get(
  '/available',
  authorize(...viewRoles),
  getAvailableContractors
);

// @route   GET /api/contractors/by-specialization/:specialization
// @desc    Get contractors by specialization
// @access  Private (View roles)
router.get(
  '/by-specialization/:specialization',
  authorize(...viewRoles),
  getContractorsBySpecialization
);

// @route   GET /api/contractors/:id
// @desc    Get contractor by ID
// @access  Private (View roles)
router.get(
  '/:id',
  authorize(...viewRoles),
  getContractorById
);

// @route   PUT /api/contractors/:id
// @desc    Update contractor
// @access  Private (Management roles)
router.put(
  '/:id',
  authorize(...managementRoles),
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
  authorize(...managementRoles),
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
  authorize(...viewRoles),
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
  authorize(...managementRoles),
  updateContractorStatus
);

// @route   PUT /api/contractors/:id/preferred
// @desc    Toggle contractor preferred status
// @access  Private (Management roles)
router.put(
  '/:id/preferred',
  authorize(...managementRoles),
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
  authorize(...managementRoles),
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