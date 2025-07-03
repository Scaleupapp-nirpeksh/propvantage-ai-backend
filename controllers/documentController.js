// File: controllers/documentController.js
// Description: Handles document management operations including categories, uploads, approvals, and version control

import asyncHandler from 'express-async-handler';
import DocumentCategory from '../models/documentCategoryModel.js';
import File from '../models/fileModel.js';
import { uploadFileToS3 } from '../services/s3Service.js';
import mongoose from 'mongoose';

// =============================================================================
// DOCUMENT CATEGORY MANAGEMENT
// =============================================================================

/**
 * @desc    Create a new document category
 * @route   POST /api/documents/categories
 * @access  Private (Management roles)
 */
const createDocumentCategory = asyncHandler(async (req, res) => {
  const {
    name,
    description,
    type,
    parentCategory,
    color,
    icon,
    allowedFileTypes,
    maxFileSize,
    requiresApproval,
    approvalWorkflow,
    accessControl,
    retentionPolicy
  } = req.body;

  // Validate required fields
  if (!name || !type) {
    res.status(400);
    throw new Error('Category name and type are required');
  }

  // Check for duplicate category name within organization
  const existingCategory = await DocumentCategory.findOne({
    organization: req.user.organization,
    name,
    parentCategory: parentCategory || null
  });

  if (existingCategory) {
    res.status(400);
    throw new Error('Category with this name already exists at this level');
  }

  // Validate parent category if provided
  if (parentCategory) {
    const parentExists = await DocumentCategory.findOne({
      _id: parentCategory,
      organization: req.user.organization
    });

    if (!parentExists) {
      res.status(404);
      throw new Error('Parent category not found');
    }
  }

  const category = await DocumentCategory.create({
    ...req.body,
    organization: req.user.organization,
    createdBy: req.user._id
  });

  res.status(201).json({
    success: true,
    data: category,
    message: 'Document category created successfully'
  });
});

/**
 * @desc    Get all document categories
 * @route   GET /api/documents/categories
 * @access  Private
 */
const getDocumentCategories = asyncHandler(async (req, res) => {
  const { type, parentCategory, includeStats = false } = req.query;

  const query = {
    organization: req.user.organization,
    isActive: true
  };

  if (type) query.type = type;
  if (parentCategory) query.parentCategory = parentCategory;

  let categories = await DocumentCategory.find(query)
    .populate('parentCategory', 'name type')
    .populate('createdBy', 'firstName lastName')
    .sort({ displayOrder: 1, name: 1 });

  // Filter categories based on user access
  categories = categories.filter(category => category.hasUserAccess(req.user));

  // Include document statistics if requested
  if (includeStats === 'true') {
    for (let category of categories) {
      const stats = await File.aggregate([
        {
          $match: {
            organization: req.user.organization,
            category: category._id,
            status: 'active'
          }
        },
        {
          $group: {
            _id: null,
            totalDocuments: { $sum: 1 },
            totalSize: { $sum: '$size' }
          }
        }
      ]);

      category.statistics = stats[0] || { totalDocuments: 0, totalSize: 0 };
    }
  }

  res.json({
    success: true,
    data: categories,
    count: categories.length
  });
});

/**
 * @desc    Get category tree structure
 * @route   GET /api/documents/categories/tree
 * @access  Private
 */
const getCategoryTree = asyncHandler(async (req, res) => {
  const categoryTree = await DocumentCategory.getCategoryTree(req.user.organization);
  
  // Filter based on user access
  const filterTreeByAccess = (tree) => {
    return tree.filter(category => {
      const hasAccess = category.hasUserAccess ? category.hasUserAccess(req.user) : true;
      if (hasAccess && category.subcategories) {
        category.subcategories = filterTreeByAccess(category.subcategories);
      }
      return hasAccess;
    });
  };

  const accessibleTree = filterTreeByAccess(categoryTree);

  res.json({
    success: true,
    data: accessibleTree
  });
});

/**
 * @desc    Update document category
 * @route   PUT /api/documents/categories/:id
 * @access  Private (Management roles)
 */
const updateDocumentCategory = asyncHandler(async (req, res) => {
  const category = await DocumentCategory.findOne({
    _id: req.params.id,
    organization: req.user.organization
  });

  if (!category) {
    res.status(404);
    throw new Error('Document category not found');
  }

  // Check for duplicate name if name is being changed
  if (req.body.name && req.body.name !== category.name) {
    const existingCategory = await DocumentCategory.findOne({
      organization: req.user.organization,
      name: req.body.name,
      parentCategory: req.body.parentCategory || category.parentCategory,
      _id: { $ne: category._id }
    });

    if (existingCategory) {
      res.status(400);
      throw new Error('Category with this name already exists at this level');
    }
  }

  // Update category
  Object.assign(category, req.body);
  category.lastModifiedBy = req.user._id;

  await category.save();

  res.json({
    success: true,
    data: category,
    message: 'Document category updated successfully'
  });
});

/**
 * @desc    Delete document category
 * @route   DELETE /api/documents/categories/:id
 * @access  Private (Management roles)
 */
const deleteDocumentCategory = asyncHandler(async (req, res) => {
  const category = await DocumentCategory.findOne({
    _id: req.params.id,
    organization: req.user.organization
  });

  if (!category) {
    res.status(404);
    throw new Error('Document category not found');
  }

  await category.deleteOne();

  res.json({
    success: true,
    message: 'Document category deleted successfully'
  });
});

// =============================================================================
// DOCUMENT UPLOAD AND MANAGEMENT
// =============================================================================

/**
 * @desc    Upload a document
 * @route   POST /api/documents/upload
 * @access  Private
 */
const uploadDocument = asyncHandler(async (req, res) => {
  const { 
    associatedResource, 
    resourceType, 
    categoryId, 
    title, 
    description, 
    tags, 
    customFields,
    accessLevel = 'organization',
    expiryDate
  } = req.body;
  
  const file = req.file;

  // Validate input
  if (!file) {
    res.status(400);
    throw new Error('No file uploaded');
  }

  if (!associatedResource || !resourceType || !categoryId) {
    res.status(400);
    throw new Error('Associated resource, resource type, and category are required');
  }

  // Verify category exists and user has access
  const category = await DocumentCategory.findOne({
    _id: categoryId,
    organization: req.user.organization
  });

  if (!category) {
    res.status(404);
    throw new Error('Document category not found');
  }

  if (!category.hasUserAccess(req.user)) {
    res.status(403);
    throw new Error('You do not have access to this category');
  }

  // Validate file type and size
  const fileExtension = file.originalname.split('.').pop().toLowerCase();
  
  if (!category.isFileTypeAllowed(fileExtension)) {
    res.status(400);
    throw new Error(`File type '${fileExtension}' is not allowed in this category`);
  }

  if (!category.isFileSizeAllowed(file.size)) {
    res.status(400);
    throw new Error(`File size exceeds maximum allowed size of ${category.maxFileSize} bytes`);
  }

  // Verify associated resource exists
  const ResourceModel = mongoose.model(resourceType);
  const resource = await ResourceModel.findOne({
    _id: associatedResource,
    organization: req.user.organization
  });

  if (!resource) {
    res.status(404);
    throw new Error(`${resourceType} not found or you do not have permission to access it`);
  }

  // Upload file to S3
  const folder = `documents/${resourceType.toLowerCase()}s/${associatedResource}`;
  const { url, s3Key } = await uploadFileToS3(file, folder);

  // Get approval workflow
  const approvalWorkflow = category.getApprovalWorkflow(req.user);

  // Create file document
  const fileDoc = await File.create({
    organization: req.user.organization,
    uploadedBy: req.user._id,
    category: categoryId,
    associatedResource,
    resourceType,
    originalName: file.originalname,
    fileName: title || file.originalname,
    title: title || file.originalname,
    description,
    tags: tags ? tags.split(',').map(tag => tag.trim()) : [],
    mimeType: file.mimetype,
    size: file.size,
    url,
    s3Key,
    accessLevel,
    expiryDate: expiryDate ? new Date(expiryDate) : null,
    customFields: customFields ? new Map(Object.entries(customFields)) : new Map(),
    approvalStatus: approvalWorkflow.requiresApproval ? 
      (approvalWorkflow.hasAutoApproval ? 'approved' : 'pending') : 'not_required',
    approvalWorkflow: approvalWorkflow.requiresApproval ? {
      requiredApprovals: approvalWorkflow.requiredApprovals,
      approvals: approvalWorkflow.hasAutoApproval ? [{
        approver: req.user._id,
        status: 'approved',
        comment: 'Auto-approved based on user role',
        timestamp: new Date()
      }] : []
    } : undefined
  });

  // Log access
  fileDoc.logAccess(req.user, 'upload', req.ip, req.get('User-Agent'));
  await fileDoc.save();

  // Update category statistics
  await updateCategoryStatistics(categoryId);

  res.status(201).json({
    success: true,
    data: fileDoc,
    message: 'Document uploaded successfully',
    requiresApproval: approvalWorkflow.requiresApproval && !approvalWorkflow.hasAutoApproval
  });
});

/**
 * @desc    Get documents with filtering and pagination
 * @route   GET /api/documents
 * @access  Private
 */
const getDocuments = asyncHandler(async (req, res) => {
  const {
    page = 1,
    limit = 20,
    category,
    resourceType,
    associatedResource,
    status = 'active',
    approvalStatus,
    search,
    tags,
    sortBy = 'createdAt',
    sortOrder = 'desc'
  } = req.query;

  const query = {
    organization: req.user.organization,
    status
  };

  // Apply filters
  if (category) query.category = category;
  if (resourceType) query.resourceType = resourceType;
  if (associatedResource) query.associatedResource = associatedResource;
  if (approvalStatus) query.approvalStatus = approvalStatus;
  if (tags) {
    const tagArray = tags.split(',').map(tag => tag.trim());
    query.tags = { $in: tagArray };
  }

  // Search functionality
  if (search) {
    query.$text = { $search: search };
  }

  // Build sort object
  const sort = {};
  sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

  const documents = await File.find(query)
    .populate('uploadedBy', 'firstName lastName')
    .populate('category', 'name type color')
    .sort(sort)
    .limit(limit * 1)
    .skip((page - 1) * limit)
    .select('-accessLog -versionHistory'); // Exclude large fields

  // Filter documents based on user access
  const accessibleDocuments = documents.filter(doc => doc.hasUserAccess(req.user));

  const total = await File.countDocuments(query);

  res.json({
    success: true,
    data: {
      documents: accessibleDocuments,
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
 * @desc    Get document by ID
 * @route   GET /api/documents/:id
 * @access  Private
 */
const getDocumentById = asyncHandler(async (req, res) => {
  const document = await File.findOne({
    _id: req.params.id,
    organization: req.user.organization
  })
    .populate('uploadedBy', 'firstName lastName email')
    .populate('category', 'name type color description')
    .populate('comments.user', 'firstName lastName')
    .populate('approvalWorkflow.approvals.approver', 'firstName lastName')
    .populate('shares.sharedWith', 'firstName lastName')
    .populate('shares.sharedBy', 'firstName lastName');

  if (!document) {
    res.status(404);
    throw new Error('Document not found');
  }

  if (!document.hasUserAccess(req.user)) {
    res.status(403);
    throw new Error('You do not have access to this document');
  }

  // Log access
  document.logAccess(req.user, 'view', req.ip, req.get('User-Agent'));
  await document.save();

  res.json({
    success: true,
    data: document
  });
});

/**
 * @desc    Update document metadata
 * @route   PUT /api/documents/:id
 * @access  Private
 */
const updateDocument = asyncHandler(async (req, res) => {
  const document = await File.findOne({
    _id: req.params.id,
    organization: req.user.organization
  });

  if (!document) {
    res.status(404);
    throw new Error('Document not found');
  }

  if (!document.hasUserAccess(req.user, 'edit')) {
    res.status(403);
    throw new Error('You do not have permission to edit this document');
  }

  // Update allowed fields
  const allowedFields = ['title', 'description', 'tags', 'customFields', 'accessLevel', 'expiryDate'];
  const updates = {};

  allowedFields.forEach(field => {
    if (req.body[field] !== undefined) {
      updates[field] = req.body[field];
    }
  });

  // Handle tags as array
  if (updates.tags && typeof updates.tags === 'string') {
    updates.tags = updates.tags.split(',').map(tag => tag.trim());
  }

  // Handle customFields as Map
  if (updates.customFields) {
    updates.customFields = new Map(Object.entries(updates.customFields));
  }

  Object.assign(document, updates);
  await document.save();

  res.json({
    success: true,
    data: document,
    message: 'Document updated successfully'
  });
});

/**
 * @desc    Delete document
 * @route   DELETE /api/documents/:id
 * @access  Private
 */
const deleteDocument = asyncHandler(async (req, res) => {
  const document = await File.findOne({
    _id: req.params.id,
    organization: req.user.organization
  });

  if (!document) {
    res.status(404);
    throw new Error('Document not found');
  }

  // Check permissions
  if (document.uploadedBy.toString() !== req.user._id.toString() && 
      !['Business Head', 'Project Director'].includes(req.user.role)) {
    res.status(403);
    throw new Error('You do not have permission to delete this document');
  }

  // Soft delete
  document.status = 'deleted';
  await document.save();

  // Update category statistics
  await updateCategoryStatistics(document.category);

  res.json({
    success: true,
    message: 'Document deleted successfully'
  });
});

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Update category statistics
 */
const updateCategoryStatistics = async (categoryId) => {
  try {
    const stats = await File.aggregate([
      {
        $match: {
          category: new mongoose.Types.ObjectId(categoryId),
          status: 'active'
        }
      },
      {
        $group: {
          _id: null,
          totalDocuments: { $sum: 1 },
          totalSize: { $sum: '$size' }
        }
      }
    ]);

    await DocumentCategory.findByIdAndUpdate(categoryId, {
      'statistics.totalDocuments': stats[0]?.totalDocuments || 0,
      'statistics.totalSize': stats[0]?.totalSize || 0,
      'statistics.lastUpdated': new Date()
    });
  } catch (error) {
    console.error('Error updating category statistics:', error);
  }
};

export {
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
};