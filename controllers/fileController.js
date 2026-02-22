// File: controllers/fileController.js
// Description: Handles the business logic for file uploads and management.

import asyncHandler from 'express-async-handler';
import { uploadFileToS3, getPresignedDownloadUrl } from '../services/s3Service.js';
import File from '../models/fileModel.js';
import mongoose from 'mongoose';

/**
 * @desc    Upload a file and associate it with a resource
 * @route   POST /api/files/upload
 * @access  Private
 */
const uploadFile = asyncHandler(async (req, res) => {
  const { associatedResource, resourceType, category } = req.body;
  const file = req.file;

  // 1. Validate input
  if (!file) {
    res.status(400);
    throw new Error('No file uploaded.');
  }
  if (!associatedResource || !resourceType || !category) {
    res.status(400);
    throw new Error('Associated resource, resource type, and category are required.');
  }

  // 2. Verify the associated resource exists and belongs to the user's organization
  const ResourceModel = mongoose.model(resourceType);
  const resource = await ResourceModel.findOne({
    _id: associatedResource,
    organization: req.user.organization,
  });

  if (!resource) {
    res.status(404);
    throw new Error(`${resourceType} not found or you do not have permission to access it.`);
  }

  // 3. Define a folder structure for S3 based on resource type
  const folder = `${resourceType.toLowerCase()}s/${associatedResource}`; // e.g., 'projects/...' or 'leads/...'

  // 4. Upload the file to S3 using the service
  const { url, s3Key } = await uploadFileToS3(file, folder);

  // 5. Save the file metadata to our database
  const fileMetadata = await File.create({
    organization: req.user.organization,
    uploadedBy: req.user._id,
    associatedResource,
    resourceType,
    category,
    originalName: file.originalname,
    mimeType: file.mimetype,
    size: file.size,
    url,
    s3Key,
  });

  res.status(201).json(fileMetadata);
});

/**
 * @desc    Get all files for a specific resource (with pre-signed URLs)
 * @route   GET /api/files/resource/:resourceId
 * @access  Private
 */
const getFilesForResource = asyncHandler(async (req, res) => {
  const { resourceId } = req.params;

  const files = await File.find({
    organization: req.user.organization,
    associatedResource: resourceId,
  }).populate('uploadedBy', 'firstName lastName');

  // Generate pre-signed URLs for each file
  const filesWithPresignedUrls = await Promise.all(
    files.map(async (file) => {
      const fileObj = file.toObject();
      if (file.s3Key) {
        fileObj.url = await getPresignedDownloadUrl(file.s3Key);
        fileObj.urlExpiresAt = new Date(Date.now() + 3600 * 1000);
      }
      return fileObj;
    })
  );

  res.json(filesWithPresignedUrls);
});

/**
 * @desc    Get a pre-signed download URL for a single file
 * @route   GET /api/files/:fileId/download
 * @access  Private
 */
const getFileDownloadUrl = asyncHandler(async (req, res) => {
  const file = await File.findOne({
    _id: req.params.fileId,
    organization: req.user.organization,
  });

  if (!file) {
    res.status(404);
    throw new Error('File not found');
  }

  if (!file.s3Key) {
    res.status(400);
    throw new Error('File has no S3 key');
  }

  const url = await getPresignedDownloadUrl(file.s3Key);

  res.json({
    url,
    expiresAt: new Date(Date.now() + 3600 * 1000),
    fileName: file.originalName,
  });
});

export { uploadFile, getFilesForResource, getFileDownloadUrl };
