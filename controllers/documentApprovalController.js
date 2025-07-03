// File: controllers/documentApprovalController.js
// Description: Handles document approval workflows and version control

import asyncHandler from 'express-async-handler';
import File from '../models/fileModel.js';
import DocumentCategory from '../models/documentCategoryModel.js';
import { uploadFileToS3 } from '../services/s3Service.js';
import mongoose from 'mongoose';

/**
 * @desc    Get documents pending approval
 * @route   GET /api/documents/approvals/pending
 * @access  Private (Management roles)
 */
const getPendingApprovals = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, category, priority = 'all' } = req.query;

  const query = {
    organization: req.user.organization,
    approvalStatus: 'pending',
    'approvalWorkflow.approvals.approver': req.user._id
  };

  if (category) {
    query.category = category;
  }

  // Priority filter based on file age
  if (priority !== 'all') {
    const now = new Date();
    let dayThreshold;
    
    switch (priority) {
      case 'high':
        dayThreshold = 1; // Files older than 1 day
        break;
      case 'medium':
        dayThreshold = 3; // Files older than 3 days
        break;
      case 'low':
        dayThreshold = 7; // Files older than 7 days
        break;
      default:
        dayThreshold = null;
    }
    
    if (dayThreshold) {
      const thresholdDate = new Date(now.getTime() - dayThreshold * 24 * 60 * 60 * 1000);
      query.createdAt = { $lte: thresholdDate };
    }
  }

  const pendingDocuments = await File.find(query)
    .populate('uploadedBy', 'firstName lastName email')
    .populate('category', 'name type color')
    .populate('approvalWorkflow.approvals.approver', 'firstName lastName')
    .sort({ createdAt: 1 }) // Oldest first
    .limit(limit * 1)
    .skip((page - 1) * limit);

  const total = await File.countDocuments(query);

  res.json({
    success: true,
    data: {
      documents: pendingDocuments,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / limit),
        total,
        limit: parseInt(limit),
        hasNextPage: page < Math.ceil(total / limit),
        hasPrevPage: page > 1
      }
    }
  });
});

/**
 * @desc    Approve a document
 * @route   POST /api/documents/:id/approve
 * @access  Private (Management roles)
 */
const approveDocument = asyncHandler(async (req, res) => {
  const { comment = '' } = req.body;
  
  const document = await File.findOne({
    _id: req.params.id,
    organization: req.user.organization
  });

  if (!document) {
    res.status(404);
    throw new Error('Document not found');
  }

  if (document.approvalStatus !== 'pending') {
    res.status(400);
    throw new Error('Document is not pending approval');
  }

  // Check if user is in the approvers list
  const approvalEntry = document.approvalWorkflow.approvals.find(
    approval => approval.approver.toString() === req.user._id.toString()
  );

  if (!approvalEntry) {
    res.status(403);
    throw new Error('You are not authorized to approve this document');
  }

  if (approvalEntry.status !== 'pending') {
    res.status(400);
    throw new Error('You have already provided your approval decision');
  }

  // Update approval entry
  approvalEntry.status = 'approved';
  approvalEntry.comment = comment;
  approvalEntry.timestamp = new Date();

  // Check if all required approvals are met
  const approvedCount = document.approvalWorkflow.approvals.filter(
    approval => approval.status === 'approved'
  ).length;

  if (approvedCount >= document.approvalWorkflow.requiredApprovals) {
    document.approvalStatus = 'approved';
    document.approvalWorkflow.finalApprovalDate = new Date();
    document.approvalWorkflow.finalApprovalBy = req.user._id;
  }

  await document.save();

  // Log the approval action
  document.logAccess(req.user, 'approve', req.ip, req.get('User-Agent'));
  await document.save();

  res.json({
    success: true,
    data: {
      document,
      approvalStatus: document.approvalStatus,
      approvedCount,
      requiredApprovals: document.approvalWorkflow.requiredApprovals
    },
    message: document.approvalStatus === 'approved' ? 
      'Document fully approved' : 
      'Your approval has been recorded'
  });
});

/**
 * @desc    Reject a document
 * @route   POST /api/documents/:id/reject
 * @access  Private (Management roles)
 */
const rejectDocument = asyncHandler(async (req, res) => {
  const { comment = '' } = req.body;
  
  if (!comment.trim()) {
    res.status(400);
    throw new Error('Comment is required when rejecting a document');
  }

  const document = await File.findOne({
    _id: req.params.id,
    organization: req.user.organization
  });

  if (!document) {
    res.status(404);
    throw new Error('Document not found');
  }

  if (document.approvalStatus !== 'pending') {
    res.status(400);
    throw new Error('Document is not pending approval');
  }

  // Check if user is in the approvers list
  const approvalEntry = document.approvalWorkflow.approvals.find(
    approval => approval.approver.toString() === req.user._id.toString()
  );

  if (!approvalEntry) {
    res.status(403);
    throw new Error('You are not authorized to reject this document');
  }

  if (approvalEntry.status !== 'pending') {
    res.status(400);
    throw new Error('You have already provided your approval decision');
  }

  // Update approval entry
  approvalEntry.status = 'rejected';
  approvalEntry.comment = comment;
  approvalEntry.timestamp = new Date();

  // Mark document as rejected
  document.approvalStatus = 'rejected';
  document.approvalWorkflow.finalApprovalDate = new Date();
  document.approvalWorkflow.finalApprovalBy = req.user._id;

  await document.save();

  // Log the rejection action
  document.logAccess(req.user, 'reject', req.ip, req.get('User-Agent'));
  await document.save();

  res.json({
    success: true,
    data: document,
    message: 'Document rejected successfully'
  });
});

/**
 * @desc    Get approval history for a document
 * @route   GET /api/documents/:id/approval-history
 * @access  Private
 */
const getApprovalHistory = asyncHandler(async (req, res) => {
  const document = await File.findOne({
    _id: req.params.id,
    organization: req.user.organization
  })
    .populate('approvalWorkflow.approvals.approver', 'firstName lastName email')
    .populate('approvalWorkflow.finalApprovalBy', 'firstName lastName email');

  if (!document) {
    res.status(404);
    throw new Error('Document not found');
  }

  if (!document.hasUserAccess(req.user)) {
    res.status(403);
    throw new Error('You do not have access to this document');
  }

  const approvalHistory = {
    documentId: document._id,
    currentStatus: document.approvalStatus,
    requiresApproval: document.approvalStatus !== 'not_required',
    requiredApprovals: document.approvalWorkflow?.requiredApprovals || 0,
    approvals: document.approvalWorkflow?.approvals || [],
    finalApprovalDate: document.approvalWorkflow?.finalApprovalDate,
    finalApprovalBy: document.approvalWorkflow?.finalApprovalBy,
    uploadedBy: document.uploadedBy,
    uploadedAt: document.createdAt
  };

  res.json({
    success: true,
    data: approvalHistory
  });
});

/**
 * @desc    Upload new version of document
 * @route   POST /api/documents/:id/new-version
 * @access  Private
 */
const uploadNewVersion = asyncHandler(async (req, res) => {
  const { changeLog = 'New version uploaded' } = req.body;
  const file = req.file;

  if (!file) {
    res.status(400);
    throw new Error('No file uploaded');
  }

  const originalDocument = await File.findOne({
    _id: req.params.id,
    organization: req.user.organization
  });

  if (!originalDocument) {
    res.status(404);
    throw new Error('Original document not found');
  }

  if (!originalDocument.hasUserAccess(req.user, 'edit')) {
    res.status(403);
    throw new Error('You do not have permission to upload a new version');
  }

  // Get the category to validate file type and size
  const category = await DocumentCategory.findById(originalDocument.category);
  if (!category) {
    res.status(404);
    throw new Error('Document category not found');
  }

  // Validate file type and size
  const fileExtension = file.originalname.split('.').pop().toLowerCase();
  
  if (!category.isFileTypeAllowed(fileExtension)) {
    res.status(400);
    throw new Error(`File type '${fileExtension}' is not allowed in this category`);
  }

  if (!category.isFileSizeAllowed(file.size)) {
    res.status(400);
    throw new Error(`File size exceeds maximum allowed size`);
  }

  // Upload new file to S3
  const folder = `documents/${originalDocument.resourceType.toLowerCase()}s/${originalDocument.associatedResource}`;
  const { url, s3Key } = await uploadFileToS3(file, folder);

  // Mark current version as not latest
  originalDocument.isLatestVersion = false;
  await originalDocument.save();

  // Create new version document
  const newVersionDoc = await File.create({
    organization: originalDocument.organization,
    uploadedBy: req.user._id,
    category: originalDocument.category,
    associatedResource: originalDocument.associatedResource,
    resourceType: originalDocument.resourceType,
    originalName: file.originalname,
    fileName: originalDocument.fileName,
    title: originalDocument.title,
    description: originalDocument.description,
    tags: originalDocument.tags,
    mimeType: file.mimetype,
    size: file.size,
    url,
    s3Key,
    accessLevel: originalDocument.accessLevel,
    expiryDate: originalDocument.expiryDate,
    customFields: originalDocument.customFields,
    version: originalDocument.version + 1,
    isLatestVersion: true,
    parentFile: originalDocument.parentFile || originalDocument._id,
    versionHistory: [...originalDocument.versionHistory, {
      version: originalDocument.version,
      fileId: originalDocument._id,
      uploadedBy: originalDocument.uploadedBy,
      uploadedAt: originalDocument.createdAt,
      changeLog,
      size: originalDocument.size
    }],
    // Reset approval status for new version
    approvalStatus: category.requiresApproval ? 'pending' : 'not_required',
    approvalWorkflow: category.requiresApproval ? {
      requiredApprovals: category.approvalWorkflow.requiredApprovals,
      approvals: category.approvalWorkflow.approvers.map(approver => ({
        approver,
        status: 'pending'
      }))
    } : undefined
  });

  // Log the version upload
  newVersionDoc.logAccess(req.user, 'upload', req.ip, req.get('User-Agent'));
  await newVersionDoc.save();

  res.status(201).json({
    success: true,
    data: newVersionDoc,
    message: `New version ${newVersionDoc.version} uploaded successfully`
  });
});

/**
 * @desc    Get version history for a document
 * @route   GET /api/documents/:id/versions
 * @access  Private
 */
const getVersionHistory = asyncHandler(async (req, res) => {
  const document = await File.findOne({
    _id: req.params.id,
    organization: req.user.organization
  });

  if (!document) {
    res.status(404);
    throw new Error('Document not found');
  }

  if (!document.hasUserAccess(req.user)) {
    res.status(403);
    throw new Error('You do not have access to this document');
  }

  // Get all versions of this document
  const parentFileId = document.parentFile || document._id;
  
  const allVersions = await File.find({
    $or: [
      { _id: parentFileId },
      { parentFile: parentFileId }
    ],
    organization: req.user.organization
  })
    .populate('uploadedBy', 'firstName lastName')
    .sort({ version: -1 });

  const versionHistory = allVersions.map(version => ({
    _id: version._id,
    version: version.version,
    fileName: version.fileName,
    size: version.size,
    uploadedBy: version.uploadedBy,
    uploadedAt: version.createdAt,
    isLatestVersion: version.isLatestVersion,
    url: version.url,
    approvalStatus: version.approvalStatus
  }));

  res.json({
    success: true,
    data: {
      documentId: document._id,
      currentVersion: document.version,
      totalVersions: versionHistory.length,
      versions: versionHistory
    }
  });
});

/**
 * @desc    Add comment to document
 * @route   POST /api/documents/:id/comments
 * @access  Private
 */
const addComment = asyncHandler(async (req, res) => {
  const { comment } = req.body;

  if (!comment || !comment.trim()) {
    res.status(400);
    throw new Error('Comment is required');
  }

  const document = await File.findOne({
    _id: req.params.id,
    organization: req.user.organization
  });

  if (!document) {
    res.status(404);
    throw new Error('Document not found');
  }

  if (!document.hasUserAccess(req.user)) {
    res.status(403);
    throw new Error('You do not have access to this document');
  }

  const newComment = document.addComment(req.user, comment.trim());
  await document.save();

  // Populate the comment with user info
  await document.populate('comments.user', 'firstName lastName');

  res.status(201).json({
    success: true,
    data: newComment,
    message: 'Comment added successfully'
  });
});

/**
 * @desc    Get comments for a document
 * @route   GET /api/documents/:id/comments
 * @access  Private
 */
const getComments = asyncHandler(async (req, res) => {
  const document = await File.findOne({
    _id: req.params.id,
    organization: req.user.organization
  }).populate('comments.user', 'firstName lastName');

  if (!document) {
    res.status(404);
    throw new Error('Document not found');
  }

  if (!document.hasUserAccess(req.user)) {
    res.status(403);
    throw new Error('You do not have access to this document');
  }

  const comments = document.comments.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  res.json({
    success: true,
    data: {
      documentId: document._id,
      comments,
      totalComments: comments.length
    }
  });
});

/**
 * @desc    Share document with users
 * @route   POST /api/documents/:id/share
 * @access  Private
 */
const shareDocument = asyncHandler(async (req, res) => {
  const { userIds, permissions = ['view'], expiresAt } = req.body;

  if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
    res.status(400);
    throw new Error('User IDs are required');
  }

  const document = await File.findOne({
    _id: req.params.id,
    organization: req.user.organization
  });

  if (!document) {
    res.status(404);
    throw new Error('Document not found');
  }

  if (!document.hasUserAccess(req.user, 'share')) {
    res.status(403);
    throw new Error('You do not have permission to share this document');
  }

  // Validate that all users exist and belong to the same organization
  const User = mongoose.model('User');
  const users = await User.find({
    _id: { $in: userIds },
    organization: req.user.organization
  });

  if (users.length !== userIds.length) {
    res.status(400);
    throw new Error('Some users not found or not in your organization');
  }

  // Share with each user
  const shares = [];
  for (const user of users) {
    const share = document.shareWith(
      user,
      req.user,
      permissions,
      expiresAt ? new Date(expiresAt) : null
    );
    shares.push(share);
  }

  await document.save();

  res.json({
    success: true,
    data: {
      documentId: document._id,
      shares,
      message: `Document shared with ${users.length} user(s)`
    }
  });
});

/**
 * @desc    Get document analytics
 * @route   GET /api/documents/analytics
 * @access  Private (Management roles)
 */
const getDocumentAnalytics = asyncHandler(async (req, res) => {
  const { period = 30, category } = req.query;
  
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - parseInt(period));
  
  const matchConditions = {
    organization: req.user.organization,
    createdAt: { $gte: startDate }
  };
  
  if (category) {
    matchConditions.category = new mongoose.Types.ObjectId(category);
  }

  const analytics = await File.aggregate([
    { $match: matchConditions },
    {
      $facet: {
        // Document counts by status
        statusDistribution: [
          {
            $group: {
              _id: '$status',
              count: { $sum: 1 },
              totalSize: { $sum: '$size' }
            }
          }
        ],
        
        // Document counts by category
        categoryDistribution: [
          {
            $lookup: {
              from: 'documentcategories',
              localField: 'category',
              foreignField: '_id',
              as: 'categoryInfo'
            }
          },
          { $unwind: '$categoryInfo' },
          {
            $group: {
              _id: '$category',
              categoryName: { $first: '$categoryInfo.name' },
              count: { $sum: 1 },
              totalSize: { $sum: '$size' }
            }
          }
        ],
        
        // Approval status distribution
        approvalDistribution: [
          {
            $group: {
              _id: '$approvalStatus',
              count: { $sum: 1 }
            }
          }
        ],
        
        // Upload trends over time
        uploadTrends: [
          {
            $group: {
              _id: {
                year: { $year: '$createdAt' },
                month: { $month: '$createdAt' },
                day: { $dayOfMonth: '$createdAt' }
              },
              count: { $sum: 1 },
              totalSize: { $sum: '$size' }
            }
          },
          { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } }
        ],
        
        // Top uploaders
        topUploaders: [
          {
            $group: {
              _id: '$uploadedBy',
              count: { $sum: 1 },
              totalSize: { $sum: '$size' }
            }
          },
          {
            $lookup: {
              from: 'users',
              localField: '_id',
              foreignField: '_id',
              as: 'userInfo'
            }
          },
          { $unwind: '$userInfo' },
          {
            $project: {
              userName: { $concat: ['$userInfo.firstName', ' ', '$userInfo.lastName'] },
              count: 1,
              totalSize: 1
            }
          },
          { $sort: { count: -1 } },
          { $limit: 10 }
        ]
      }
    }
  ]);

  res.json({
    success: true,
    data: {
      period: `${period} days`,
      analytics: analytics[0]
    }
  });
});

export {
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
};