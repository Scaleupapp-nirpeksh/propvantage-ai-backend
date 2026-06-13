// File: controllers/reportController.js
// Description: Authenticated controllers for the Report Builder.

import asyncHandler from 'express-async-handler';
import { getCatalog as getBlockCatalog } from '../services/reports/blockRegistry.js';
import { uploadFileToS3 } from '../services/s3Service.js';

/**
 * @desc    Get the block catalog the current user may use, for the builder palette.
 * @route   GET /api/reports/catalog
 * @access  Private (reports:manage)
 */
export const getCatalog = asyncHandler(async (req, res) => {
  const catalog = getBlockCatalog(req.userPermissions || [], req.isOwner || false);
  res.json({ success: true, data: catalog });
});

/**
 * @desc    Upload an image for use in a report template/instance (hero, gallery, logo)
 * @route   POST /api/reports/uploads   (multipart/form-data, field name 'file')
 * @access  Private (reports:manage)
 */
export const uploadReportImage = asyncHandler(async (req, res) => {
  if (!req.file) { res.status(400); throw new Error('No file uploaded (expected form field "file")'); }
  const { url, s3Key } = await uploadFileToS3(req.file, `reports/${req.user.organization}`);
  res.status(201).json({ success: true, data: { url, s3Key } });
});
