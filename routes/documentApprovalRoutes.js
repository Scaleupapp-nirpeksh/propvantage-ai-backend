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
import { protect, hasPermission } from '../middleware/authMiddleware.js';
import { PERMISSIONS } from '../config/permissions.js';

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

// =============================================================================
// DOCUMENT APPROVAL ROUTES
// =============================================================================

// @route   GET /api/documents/approvals/pending
// @desc    Get documents pending approval
// @access  Private (Management roles)
router.get(
  '/approvals/pending',
  hasPermission(PERMISSIONS.DOCUMENTS.APPROVE),
  getPendingApprovals
);

// @route   POST /api/documents/:id/approve
// @desc    Approve a document
// @access  Private (Management roles)
router.post(
  '/:id/approve',
  hasPermission(PERMISSIONS.DOCUMENTS.APPROVE),
  approveDocument
);

// @route   POST /api/documents/:id/reject
// @desc    Reject a document
// @access  Private (Management roles)
router.post(
  '/:id/reject',
  hasPermission(PERMISSIONS.DOCUMENTS.APPROVE),
  rejectDocument
);

// @route   GET /api/documents/:id/approval-history
// @desc    Get approval history for a document
// @access  Private (All roles)
router.get(
  '/:id/approval-history',
  hasPermission(PERMISSIONS.DOCUMENTS.VIEW),
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
  hasPermission(PERMISSIONS.DOCUMENTS.VERSION_CONTROL),
  upload.single('file'),
  uploadNewVersion
);

// @route   GET /api/documents/:id/versions
// @desc    Get version history for a document
// @access  Private (All roles)
router.get(
  '/:id/versions',
  hasPermission(PERMISSIONS.DOCUMENTS.VIEW),
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
  hasPermission(PERMISSIONS.DOCUMENTS.VIEW),
  addComment
);

// @route   GET /api/documents/:id/comments
// @desc    Get comments for a document
// @access  Private (All roles)
router.get(
  '/:id/comments',
  hasPermission(PERMISSIONS.DOCUMENTS.VIEW),
  getComments
);

// @route   POST /api/documents/:id/share
// @desc    Share document with users
// @access  Private (All roles)
router.post(
  '/:id/share',
  hasPermission(PERMISSIONS.DOCUMENTS.SHARE),
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
  hasPermission(PERMISSIONS.DOCUMENTS.ANALYTICS),
  getDocumentAnalytics
);

export default router;
