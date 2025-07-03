// File: routes/fileRoutes.js
// Description: Defines the API routes for file uploads and management.

import express from 'express';
import multer from 'multer';
import { uploadFile, getFilesForResource } from '../controllers/fileController.js';

// Import the security middleware
import { protect, authorize } from '../middleware/authMiddleware.js';

const router = express.Router();

// --- Multer Configuration ---
// Configure multer to use memory storage. This makes the file buffer
// available at req.file.buffer, which we can then stream to S3.
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // Limit file size to 10MB
});

// Apply the 'protect' middleware to all routes in this file
router.use(protect);

// Define roles that can upload/manage files
const fileManagementAccess = [
  'Business Head',
  'Project Director',
  'Sales Manager',
  'Sales Executive',
  'Finance Manager',
];

// @route   POST /api/files/upload
// @desc    Upload a file
// @access  Private
router.post(
  '/upload',
  authorize(...fileManagementAccess),
  upload.single('file'), // Multer middleware to process a single file upload with the field name 'file'
  uploadFile
);

// @route   GET /api/files/resource/:resourceId
// @desc    Get all files for a specific resource
// @access  Private
router.get(
    '/resource/:resourceId',
    authorize(...fileManagementAccess), // Or a broader view-only role
    getFilesForResource
);

export default router;
