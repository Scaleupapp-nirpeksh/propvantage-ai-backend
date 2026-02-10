// File: routes/constructionRoutes.js
// Description: Defines API routes for construction management

import express from 'express';
import multer from 'multer';
import {
  createMilestone,
  getMilestones,
  getMilestoneById,
  updateMilestone,
  updateMilestoneProgress,
  addQualityCheck,
  updateQualityCheck,
  addIssue,
  uploadProgressPhotos,
  getProjectTimeline,
  getOverdueMilestones,
  getConstructionAnalytics
} from '../controllers/constructionController.js';

// Import security middleware
import { protect, hasPermission } from '../middleware/authMiddleware.js';
import { PERMISSIONS } from '../config/permissions.js';

const router = express.Router();

// Configure multer for photo uploads
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit per file
    files: 10 // Maximum 10 files per upload
  },
  fileFilter: (req, file, cb) => {
    // Allow only image files for progress photos
    const allowedMimeTypes = [
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp'
    ];

    if (allowedMimeTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`File type ${file.mimetype} is not allowed for progress photos`), false);
    }
  }
});

// Apply authentication to all routes
router.use(protect);

// =============================================================================
// CONSTRUCTION MILESTONE ROUTES
// =============================================================================

// @route   POST /api/construction/milestones
// @desc    Create a new construction milestone
// @access  Private (Management roles)
router.post(
  '/milestones',
  hasPermission(PERMISSIONS.CONSTRUCTION.CREATE),
  createMilestone
);

// @route   GET /api/construction/milestones
// @desc    Get construction milestones
// @access  Private (Construction roles)
router.get(
  '/milestones',
  hasPermission(PERMISSIONS.CONSTRUCTION.VIEW),
  getMilestones
);

// @route   GET /api/construction/milestones/overdue
// @desc    Get overdue milestones
// @access  Private (Management roles)
router.get(
  '/milestones/overdue',
  hasPermission(PERMISSIONS.CONSTRUCTION.VIEW),
  getOverdueMilestones
);

// @route   GET /api/construction/milestones/:id
// @desc    Get milestone by ID
// @access  Private (Construction roles)
router.get(
  '/milestones/:id',
  hasPermission(PERMISSIONS.CONSTRUCTION.VIEW),
  getMilestoneById
);

// @route   PUT /api/construction/milestones/:id
// @desc    Update milestone
// @access  Private (Management roles)
router.put(
  '/milestones/:id',
  hasPermission(PERMISSIONS.CONSTRUCTION.UPDATE),
  updateMilestone
);

// @route   PUT /api/construction/milestones/:id/progress
// @desc    Update milestone progress
// @access  Private (Construction roles)
router.put(
  '/milestones/:id/progress',
  hasPermission(PERMISSIONS.CONSTRUCTION.PROGRESS),
  updateMilestoneProgress
);

// =============================================================================
// QUALITY CONTROL ROUTES
// =============================================================================

// @route   POST /api/construction/milestones/:id/quality-checks
// @desc    Add quality check to milestone
// @access  Private (Management roles)
router.post(
  '/milestones/:id/quality-checks',
  hasPermission(PERMISSIONS.CONSTRUCTION.QUALITY_CONTROL),
  addQualityCheck
);

// @route   PUT /api/construction/milestones/:id/quality-checks/:checkId
// @desc    Update quality check status
// @access  Private (Management roles)
router.put(
  '/milestones/:id/quality-checks/:checkId',
  hasPermission(PERMISSIONS.CONSTRUCTION.QUALITY_CONTROL),
  updateQualityCheck
);

// =============================================================================
// ISSUE MANAGEMENT ROUTES
// =============================================================================

// @route   POST /api/construction/milestones/:id/issues
// @desc    Add issue to milestone
// @access  Private (Construction roles)
router.post(
  '/milestones/:id/issues',
  hasPermission(PERMISSIONS.CONSTRUCTION.ISSUES),
  addIssue
);

// =============================================================================
// PROGRESS DOCUMENTATION ROUTES
// =============================================================================

// @route   POST /api/construction/milestones/:id/photos
// @desc    Upload progress photos
// @access  Private (Construction roles)
router.post(
  '/milestones/:id/photos',
  hasPermission(PERMISSIONS.CONSTRUCTION.UPLOAD_PHOTOS),
  upload.array('photos', 10),
  uploadProgressPhotos
);

// =============================================================================
// PROJECT TIMELINE ROUTES
// =============================================================================

// @route   GET /api/construction/projects/:projectId/timeline
// @desc    Get project timeline
// @access  Private (All roles)
router.get(
  '/projects/:projectId/timeline',
  hasPermission(PERMISSIONS.CONSTRUCTION.TIMELINE),
  getProjectTimeline
);

// =============================================================================
// ANALYTICS ROUTES
// =============================================================================

// @route   GET /api/construction/analytics
// @desc    Get construction analytics
// @access  Private (Management roles)
router.get(
  '/analytics',
  hasPermission(PERMISSIONS.CONSTRUCTION.ANALYTICS),
  getConstructionAnalytics
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
        message: 'File size too large. Maximum allowed size is 10MB per file.'
      });
    }
    if (error.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({
        success: false,
        message: 'Too many files. Maximum 10 files allowed per upload.'
      });
    }
    if (error.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({
        success: false,
        message: 'Unexpected file field. Use "photos" as the field name.'
      });
    }
  }

  if (error.message.includes('File type') && error.message.includes('is not allowed')) {
    return res.status(400).json({
      success: false,
      message: 'Only image files (JPEG, PNG, GIF, WebP) are allowed for progress photos.'
    });
  }

  next(error);
});

export default router;
