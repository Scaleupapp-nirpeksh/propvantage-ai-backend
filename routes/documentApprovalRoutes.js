// File: routes/documentApprovalRoutes.js
// Description: Defines API routes for document approval workflows and version control

import express from 'express';
import multer from 'multer';
import {
  getPendingApprovals,
  approveDocument,
  rejectDocument,
  getApprovalHistory,
  uploadNewVersion,
  getVersionHistory,
  addComment,
  getComments,
  shareDocument,
  getDocumentAnalytics
} from '../controllers/documentApprovalController.js';

// Import security middleware
import { protect, authorize } from '../middleware/authMiddleware.js';

const router = express.Router();

// Configure multer for version uploads
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: { 
    fileSize: 50 * 1024 * 1024, // 50MB limit
    files: 1 // Single file upload
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

// =============================================================================
// DOCUMENT APPROVAL ROUTES
// =============================================================================

// @route   GET /api/documents/approvals/pending
// @desc    Get documents pending approval
// @access  Private (Management roles)
router.get(
  '/approvals/pending',
  authorize(...managementRoles),
  getPendingApprovals
);

// @route   POST /api/documents/:id/approve
// @desc    Approve a document
// @access  Private (Management roles)
router.post(
  '/:id/approve',
  authorize(...managementRoles),
  approveDocument
);

// @route   POST /api/documents/:id/reject
// @desc    Reject a document
// @access  Private (Management roles)
router.post(
  '/:id/reject',
  authorize(...managementRoles),
  rejectDocument
);

// @route   GET /api/documents/:id/approval-history
// @desc    Get approval history for a document
// @access  Private (All roles)
router.get(
  '/:id/approval-history',
  authorize(...allRoles),
  getApprovalHistory
);

// =============================================================================
// VERSION CONTROL ROUTES
// =============================================================================

// @route   POST /api/documents/:id/new-version
// @desc    Upload new version of document
// @access  Private (All roles)
router.post(
  '/:id/new-version',
  authorize(...allRoles),
  upload.single('file'),
  uploadNewVersion
);

// @route   GET /api/documents/:id/versions
// @desc    Get version history for a document
// @access  Private (All roles)
router.get(
  '/:id/versions',
  authorize(...allRoles),
  getVersionHistory
);

// =============================================================================
// COLLABORATION ROUTES
// =============================================================================

// @route   POST /api/documents/:id/comments
// @desc    Add comment to document
// @access  Private (All roles)
router.post(
  '/:id/comments',
  authorize(...allRoles),
  addComment
);

// @route   GET /api/documents/:id/comments
// @desc    Get comments for a document
// @access  Private (All roles)
router.get(
  '/:id/comments',
  authorize(...allRoles),
  getComments
);

// @route   POST /api/documents/:id/share
// @desc    Share document with users
// @access  Private (All roles)
router.post(
  '/:id/share',
  authorize(...allRoles),
  shareDocument
);

// =============================================================================
// ANALYTICS ROUTES
// =============================================================================

// @route   GET /api/documents/analytics
// @desc    Get document analytics
// @access  Private (Management roles)
router.get(
  '/analytics',
  authorize(...managementRoles),
  getDocumentAnalytics
);

export default router;