// File: routes/documentRoutes.js
// Description: Defines API routes for document management system

import express from 'express';
import multer from 'multer';
import {
  // Category management
  createDocumentCategory,
  getDocumentCategories,
  getCategoryTree,
  updateDocumentCategory,
  deleteDocumentCategory,
  
  // Document management
  uploadDocument,
  getDocuments,
  getDocumentById,
  updateDocument,
  deleteDocument
} from '../controllers/documentController.js';

// Import security middleware
import { protect, authorize } from '../middleware/authMiddleware.js';

const router = express.Router();

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: { 
    fileSize: 50 * 1024 * 1024, // 50MB limit
    files: 1 // Single file upload
  },
  fileFilter: (req, file, cb) => {
    // Allow most common file types
    const allowedMimeTypes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'text/plain',
      'text/csv',
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
      'video/mp4',
      'video/quicktime',
      'video/avi',
      'application/zip',
      'application/x-rar-compressed'
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
  'Finance Head',
  'Marketing Head',
  'Sales Manager',
  'Finance Manager',
  'Channel Partner Manager'
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

const seniorManagementRoles = [
  'Business Head',
  'Project Director',
  'Sales Head',
  'Finance Head',
  'Marketing Head'
];

// =============================================================================
// DOCUMENT CATEGORY ROUTES
// =============================================================================

// @route   POST /api/documents/categories
// @desc    Create a new document category
// @access  Private (Management roles)
router.post(
  '/categories',
  authorize(...managementRoles),
  createDocumentCategory
);

// @route   GET /api/documents/categories
// @desc    Get all document categories
// @access  Private (All roles)
router.get(
  '/categories',
  authorize(...allRoles),
  getDocumentCategories
);

// @route   GET /api/documents/categories/tree
// @desc    Get category tree structure
// @access  Private (All roles)
router.get(
  '/categories/tree',
  authorize(...allRoles),
  getCategoryTree
);

// @route   PUT /api/documents/categories/:id
// @desc    Update document category
// @access  Private (Management roles)
router.put(
  '/categories/:id',
  authorize(...managementRoles),
  updateDocumentCategory
);

// @route   DELETE /api/documents/categories/:id
// @desc    Delete document category
// @access  Private (Senior Management roles)
router.delete(
  '/categories/:id',
  authorize(...seniorManagementRoles),
  deleteDocumentCategory
);

// =============================================================================
// DOCUMENT UPLOAD AND MANAGEMENT ROUTES
// =============================================================================

// @route   POST /api/documents/upload
// @desc    Upload a document
// @access  Private (All roles)
router.post(
  '/upload',
  authorize(...allRoles),
  upload.single('file'),
  uploadDocument
);

// @route   GET /api/documents
// @desc    Get documents with filtering and pagination
// @access  Private (All roles)
router.get(
  '/',
  authorize(...allRoles),
  getDocuments
);

// @route   GET /api/documents/:id
// @desc    Get document by ID
// @access  Private (All roles)
router.get(
  '/:id',
  authorize(...allRoles),
  getDocumentById
);

// @route   PUT /api/documents/:id
// @desc    Update document metadata
// @access  Private (All roles)
router.put(
  '/:id',
  authorize(...allRoles),
  updateDocument
);

// @route   DELETE /api/documents/:id
// @desc    Delete document
// @access  Private (All roles - with permission check in controller)
router.delete(
  '/:id',
  authorize(...allRoles),
  deleteDocument
);

// =============================================================================
// DOCUMENT SEARCH AND ADVANCED FEATURES
// =============================================================================

// @route   GET /api/documents/search
// @desc    Search documents
// @access  Private (All roles)
router.get(
  '/search',
  authorize(...allRoles),
  async (req, res) => {
    // This will be handled by the main getDocuments function with search parameter
    req.query.search = req.query.q || req.query.search;
    await getDocuments(req, res);
  }
);

// @route   GET /api/documents/category/:categoryId
// @desc    Get documents by category
// @access  Private (All roles)
router.get(
  '/category/:categoryId',
  authorize(...allRoles),
  async (req, res) => {
    req.query.category = req.params.categoryId;
    await getDocuments(req, res);
  }
);

// @route   GET /api/documents/resource/:resourceType/:resourceId
// @desc    Get documents for specific resource
// @access  Private (All roles)
router.get(
  '/resource/:resourceType/:resourceId',
  authorize(...allRoles),
  async (req, res) => {
    req.query.resourceType = req.params.resourceType;
    req.query.associatedResource = req.params.resourceId;
    await getDocuments(req, res);
  }
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
        message: 'File size too large. Maximum allowed size is 50MB.'
      });
    }
    if (error.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({
        success: false,
        message: 'Too many files. Only one file allowed per upload.'
      });
    }
    if (error.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({
        success: false,
        message: 'Unexpected file field. Use "file" as the field name.'
      });
    }
  }
  
  if (error.message.includes('File type') && error.message.includes('is not allowed')) {
    return res.status(400).json({
      success: false,
      message: error.message
    });
  }
  
  next(error);
});

export default router;