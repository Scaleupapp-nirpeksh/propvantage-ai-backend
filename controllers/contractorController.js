// File: controllers/contractorController.js
// Description: Handles contractor and vendor management operations

import asyncHandler from 'express-async-handler';
import Contractor from '../models/contractorModel.js';
import File from '../models/fileModel.js';
import { uploadFileToS3 } from '../services/s3Service.js';
import mongoose from 'mongoose';

/**
 * @desc    Create a new contractor
 * @route   POST /api/contractors
 * @access  Private (Management roles)
 */
const createContractor = asyncHandler(async (req, res) => {
  const {
    name,
    companyName,
    type,
    specialization,
    contactInfo,
    address,
    businessInfo
  } = req.body;

  // Validate required fields
  if (!name || !type || !contactInfo?.primaryContact?.name || 
      !contactInfo?.primaryContact?.phone || !address?.street || 
      !address?.city || !address?.state || !address?.pincode) {
    res.status(400);
    throw new Error('All required fields must be provided');
  }

  // Check for duplicate phone number
  const existingContractor = await Contractor.findOne({
    organization: req.user.organization,
    'contactInfo.primaryContact.phone': contactInfo.primaryContact.phone
  });

  if (existingContractor) {
    res.status(400);
    throw new Error('Contractor with this phone number already exists');
  }

  // Check for duplicate GST number if provided
  if (businessInfo?.gstNumber) {
    const existingGST = await Contractor.findOne({
      organization: req.user.organization,
      'businessInfo.gstNumber': businessInfo.gstNumber
    });

    if (existingGST) {
      res.status(400);
      throw new Error('Contractor with this GST number already exists');
    }
  }

  const contractor = await Contractor.create({
    ...req.body,
    organization: req.user.organization,
    createdBy: req.user._id,
    workHistory: {
      totalProjects: 0,
      completedProjects: 0,
      ongoingProjects: 0,
      cancelledProjects: 0,
      totalContractValue: 0,
      averageProjectDuration: 0,
      onTimeCompletionRate: 0
    }
  });

  res.status(201).json({
    success: true,
    data: contractor,
    message: 'Contractor created successfully'
  });
});

/**
 * @desc    Get all contractors
 * @route   GET /api/contractors
 * @access  Private
 */
const getContractors = asyncHandler(async (req, res) => {
  const {
    page = 1,
    limit = 20,
    type,
    specialization,
    status = 'Active',
    isPreferred,
    minRating,
    search,
    sortBy = 'name',
    sortOrder = 'asc'
  } = req.query;

  const query = { organization: req.user.organization };

  // Apply filters
  if (type) query.type = type;
  if (specialization) query.specialization = specialization;
  if (status) query.status = status;
  if (isPreferred !== undefined) query.isPreferred = isPreferred === 'true';
  if (minRating) query['rating.overall'] = { $gte: parseFloat(minRating) };

  // Search functionality
  if (search) {
    query.$text = { $search: search };
  }

  // Build sort object
  const sort = {};
  sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

  const contractors = await Contractor.find(query)
    .sort(sort)
    .limit(limit * 1)
    .skip((page - 1) * limit)
    .select('name companyName type specialization contactInfo.primaryContact rating status isPreferred workHistory.totalProjects workHistory.completedProjects');

  const total = await Contractor.countDocuments(query);

  res.json({
    success: true,
    data: {
      contractors,
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
 * @desc    Get contractor by ID
 * @route   GET /api/contractors/:id
 * @access  Private
 */
const getContractorById = asyncHandler(async (req, res) => {
  const contractor = await Contractor.findOne({
    _id: req.params.id,
    organization: req.user.organization
  })
    .populate('documents.file', 'originalName url size')
    .populate('reviews.reviewedBy', 'firstName lastName')
    .populate('reviews.project', 'name')
    .populate('createdBy', 'firstName lastName');

  if (!contractor) {
    res.status(404);
    throw new Error('Contractor not found');
  }

  res.json({
    success: true,
    data: {
      ...contractor.toObject(),
      virtualFields: {
        fullAddress: contractor.fullAddress,
        completionRate: contractor.completionRate,
        availabilityStatus: contractor.availabilityStatus
      }
    }
  });
});

/**
 * @desc    Update contractor
 * @route   PUT /api/contractors/:id
 * @access  Private (Management roles)
 */
const updateContractor = asyncHandler(async (req, res) => {
  const contractor = await Contractor.findOne({
    _id: req.params.id,
    organization: req.user.organization
  });

  if (!contractor) {
    res.status(404);
    throw new Error('Contractor not found');
  }

  // Check for duplicate phone if being updated
  if (req.body.contactInfo?.primaryContact?.phone && 
      req.body.contactInfo.primaryContact.phone !== contractor.contactInfo.primaryContact.phone) {
    const existingPhone = await Contractor.findOne({
      organization: req.user.organization,
      'contactInfo.primaryContact.phone': req.body.contactInfo.primaryContact.phone,
      _id: { $ne: contractor._id }
    });

    if (existingPhone) {
      res.status(400);
      throw new Error('Another contractor with this phone number already exists');
    }
  }

  // Check for duplicate GST if being updated
  if (req.body.businessInfo?.gstNumber && 
      req.body.businessInfo.gstNumber !== contractor.businessInfo?.gstNumber) {
    const existingGST = await Contractor.findOne({
      organization: req.user.organization,
      'businessInfo.gstNumber': req.body.businessInfo.gstNumber,
      _id: { $ne: contractor._id }
    });

    if (existingGST) {
      res.status(400);
      throw new Error('Another contractor with this GST number already exists');
    }
  }

  // Update contractor
  Object.assign(contractor, req.body);
  contractor.lastModifiedBy = req.user._id;

  await contractor.save();

  res.json({
    success: true,
    data: contractor,
    message: 'Contractor updated successfully'
  });
});

/**
 * @desc    Upload contractor documents
 * @route   POST /api/contractors/:id/documents
 * @access  Private (Management roles)
 */
const uploadContractorDocument = asyncHandler(async (req, res) => {
  const { type, name, expiryDate } = req.body;
  const file = req.file;

  if (!file) {
    res.status(400);
    throw new Error('No file uploaded');
  }

  if (!type || !name) {
    res.status(400);
    throw new Error('Document type and name are required');
  }

  const contractor = await Contractor.findOne({
    _id: req.params.id,
    organization: req.user.organization
  });

  if (!contractor) {
    res.status(404);
    throw new Error('Contractor not found');
  }

  // Upload file to S3
  const folder = `contractors/${contractor._id}/documents`;
  const { url, s3Key } = await uploadFileToS3(file, folder);

  // Create file record
  const fileRecord = await File.create({
    organization: req.user.organization,
    uploadedBy: req.user._id,
    category: 'contractor-documents', // You might need to create this category
    associatedResource: contractor._id,
    resourceType: 'Contractor',
    originalName: file.originalname,
    fileName: name,
    title: `${type} - ${contractor.name}`,
    description: `${type} document for contractor ${contractor.name}`,
    tags: ['contractor', 'document', type.toLowerCase().replace(/\s+/g, '-')],
    mimeType: file.mimetype,
    size: file.size,
    url,
    s3Key,
    accessLevel: 'organization',
    expiryDate: expiryDate ? new Date(expiryDate) : null
  });

  // Add document to contractor
  contractor.documents.push({
    type,
    name,
    file: fileRecord._id,
    uploadedAt: new Date(),
    expiryDate: expiryDate ? new Date(expiryDate) : null,
    verified: false
  });

  await contractor.save();

  res.status(201).json({
    success: true,
    data: {
      document: contractor.documents[contractor.documents.length - 1],
      file: fileRecord
    },
    message: 'Document uploaded successfully'
  });
});

/**
 * @desc    Add contractor review
 * @route   POST /api/contractors/:id/reviews
 * @access  Private
 */
const addContractorReview = asyncHandler(async (req, res) => {
  const {
    project,
    rating,
    comment,
    wouldRecommend,
    projectDuration,
    contractValue
  } = req.body;

  // Validate required fields
  if (!rating?.overall || !comment || wouldRecommend === undefined) {
    res.status(400);
    throw new Error('Rating, comment, and recommendation are required');
  }

  // Validate rating values
  const ratingFields = ['overall', 'quality', 'timeliness', 'communication', 'costEffectiveness'];
  for (const field of ratingFields) {
    if (rating[field] !== undefined && (rating[field] < 1 || rating[field] > 5)) {
      res.status(400);
      throw new Error(`${field} rating must be between 1 and 5`);
    }
  }

  const contractor = await Contractor.findOne({
    _id: req.params.id,
    organization: req.user.organization
  });

  if (!contractor) {
    res.status(404);
    throw new Error('Contractor not found');
  }

  // Check if user already reviewed this contractor for this project
  if (project) {
    const existingReview = contractor.reviews.find(
      review => review.project?.toString() === project && 
                review.reviewedBy.toString() === req.user._id.toString()
    );

    if (existingReview) {
      res.status(400);
      throw new Error('You have already reviewed this contractor for this project');
    }
  }

  const review = contractor.addReview({
    project,
    reviewedBy: req.user._id,
    rating,
    comment,
    wouldRecommend,
    projectDuration,
    contractValue
  });

  await contractor.save();

  res.status(201).json({
    success: true,
    data: review,
    message: 'Review added successfully'
  });
});

/**
 * @desc    Get contractors by specialization
 * @route   GET /api/contractors/by-specialization/:specialization
 * @access  Private
 */
const getContractorsBySpecialization = asyncHandler(async (req, res) => {
  const { specialization } = req.params;
  const { preferredOnly, minRating, available } = req.query;

  const options = {};
  if (preferredOnly === 'true') options.preferredOnly = true;
  if (minRating) options.minRating = parseFloat(minRating);

  let contractors = await Contractor.findBySpecialization(
    req.user.organization,
    specialization,
    options
  );

  // Filter for availability if requested
  if (available === 'true') {
    contractors = contractors.filter(contractor => 
      contractor.availabilityStatus === 'Available'
    );
  }

  res.json({
    success: true,
    data: {
      specialization,
      count: contractors.length,
      contractors: contractors.map(contractor => ({
        _id: contractor._id,
        name: contractor.name,
        companyName: contractor.companyName,
        contactInfo: contractor.contactInfo.primaryContact,
        rating: contractor.rating,
        isPreferred: contractor.isPreferred,
        availabilityStatus: contractor.availabilityStatus,
        workHistory: {
          totalProjects: contractor.workHistory.totalProjects,
          completedProjects: contractor.workHistory.completedProjects,
          completionRate: contractor.completionRate
        }
      }))
    }
  });
});

/**
 * @desc    Get available contractors
 * @route   GET /api/contractors/available
 * @access  Private
 */
const getAvailableContractors = asyncHandler(async (req, res) => {
  const { startDate, endDate, specialization } = req.query;

  if (!startDate || !endDate) {
    res.status(400);
    throw new Error('Start date and end date are required');
  }

  const contractors = await Contractor.getAvailableContractors(
    req.user.organization,
    new Date(startDate),
    new Date(endDate),
    specialization
  );

  res.json({
    success: true,
    data: {
      period: {
        startDate,
        endDate
      },
      specialization: specialization || 'All',
      count: contractors.length,
      contractors: contractors.map(contractor => ({
        _id: contractor._id,
        name: contractor.name,
        companyName: contractor.companyName,
        type: contractor.type,
        specialization: contractor.specialization,
        contactInfo: contractor.contactInfo.primaryContact,
        rating: contractor.rating,
        capacity: contractor.capacity,
        availabilityStatus: contractor.availabilityStatus
      }))
    }
  });
});

/**
 * @desc    Update contractor status
 * @route   PUT /api/contractors/:id/status
 * @access  Private (Management roles)
 */
const updateContractorStatus = asyncHandler(async (req, res) => {
  const { status, reason } = req.body;

  if (!status || !['Active', 'Inactive', 'Blacklisted', 'Under Review'].includes(status)) {
    res.status(400);
    throw new Error('Valid status is required');
  }

  if (status === 'Blacklisted' && !reason) {
    res.status(400);
    throw new Error('Reason is required when blacklisting a contractor');
  }

  const contractor = await Contractor.findOne({
    _id: req.params.id,
    organization: req.user.organization
  });

  if (!contractor) {
    res.status(404);
    throw new Error('Contractor not found');
  }

  contractor.status = status;
  contractor.lastModifiedBy = req.user._id;

  if (status === 'Blacklisted') {
    contractor.blacklistReason = reason;
    contractor.blacklistedBy = req.user._id;
    contractor.blacklistedAt = new Date();
    contractor.isPreferred = false;
  } else {
    contractor.blacklistReason = undefined;
    contractor.blacklistedBy = undefined;
    contractor.blacklistedAt = undefined;
  }

  await contractor.save();

  res.json({
    success: true,
    data: {
      contractorId: contractor._id,
      status: contractor.status,
      updatedAt: new Date()
    },
    message: `Contractor status updated to ${status}`
  });
});

/**
 * @desc    Toggle contractor preferred status
 * @route   PUT /api/contractors/:id/preferred
 * @access  Private (Management roles)
 */
const togglePreferredStatus = asyncHandler(async (req, res) => {
  const contractor = await Contractor.findOne({
    _id: req.params.id,
    organization: req.user.organization
  });

  if (!contractor) {
    res.status(404);
    throw new Error('Contractor not found');
  }

  if (contractor.status !== 'Active') {
    res.status(400);
    throw new Error('Only active contractors can be marked as preferred');
  }

  contractor.isPreferred = !contractor.isPreferred;
  contractor.lastModifiedBy = req.user._id;

  await contractor.save();

  res.json({
    success: true,
    data: {
      contractorId: contractor._id,
      isPreferred: contractor.isPreferred
    },
    message: `Contractor ${contractor.isPreferred ? 'added to' : 'removed from'} preferred list`
  });
});

/**
 * @desc    Add internal note to contractor
 * @route   POST /api/contractors/:id/notes
 * @access  Private (Management roles)
 */
const addInternalNote = asyncHandler(async (req, res) => {
  const { note, isPrivate = false } = req.body;

  if (!note || !note.trim()) {
    res.status(400);
    throw new Error('Note content is required');
  }

  const contractor = await Contractor.findOne({
    _id: req.params.id,
    organization: req.user.organization
  });

  if (!contractor) {
    res.status(404);
    throw new Error('Contractor not found');
  }

  contractor.internalNotes.push({
    note: note.trim(),
    addedBy: req.user._id,
    addedAt: new Date(),
    isPrivate
  });

  await contractor.save();

  const addedNote = contractor.internalNotes[contractor.internalNotes.length - 1];

  res.status(201).json({
    success: true,
    data: addedNote,
    message: 'Internal note added successfully'
  });
});

/**
 * @desc    Get contractor analytics
 * @route   GET /api/contractors/analytics
 * @access  Private (Management roles)
 */
const getContractorAnalytics = asyncHandler(async (req, res) => {
  const analytics = await Contractor.aggregate([
    { $match: { organization: req.user.organization } },
    {
      $facet: {
        // Status distribution
        statusDistribution: [
          {
            $group: {
              _id: '$status',
              count: { $sum: 1 }
            }
          }
        ],
        
        // Type distribution
        typeDistribution: [
          {
            $group: {
              _id: '$type',
              count: { $sum: 1 },
              avgRating: { $avg: '$rating.overall' }
            }
          }
        ],
        
        // Specialization distribution
        specializationDistribution: [
          { $unwind: '$specialization' },
          {
            $group: {
              _id: '$specialization',
              count: { $sum: 1 },
              avgRating: { $avg: '$rating.overall' }
            }
          }
        ],
        
        // Rating distribution
        ratingDistribution: [
          {
            $bucket: {
              groupBy: '$rating.overall',
              boundaries: [0, 1, 2, 3, 4, 5],
              default: 'unrated',
              output: {
                count: { $sum: 1 }
              }
            }
          }
        ],
        
        // Top performing contractors
        topPerformers: [
          { $match: { 'rating.overall': { $gte: 4 } } },
          {
            $project: {
              name: 1,
              companyName: 1,
              rating: 1,
              workHistory: 1,
              isPreferred: 1
            }
          },
          { $sort: { 'rating.overall': -1 } },
          { $limit: 10 }
        ]
      }
    }
  ]);

  res.json({
    success: true,
    data: analytics[0]
  });
});

export {
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
};