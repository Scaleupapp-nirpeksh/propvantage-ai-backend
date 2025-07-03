// File: controllers/constructionController.js
// Description: Handles construction management operations including milestones, progress tracking, and contractor management

import asyncHandler from 'express-async-handler';
import ConstructionMilestone from '../models/constructionMilestoneModel.js';
import Contractor from '../models/contractorModel.js';
import Project from '../models/projectModel.js';
import File from '../models/fileModel.js';
import { uploadFileToS3 } from '../services/s3Service.js';
import mongoose from 'mongoose';

// =============================================================================
// CONSTRUCTION MILESTONE MANAGEMENT
// =============================================================================

/**
 * @desc    Create a new construction milestone
 * @route   POST /api/construction/milestones
 * @access  Private (Management roles)
 */
const createMilestone = asyncHandler(async (req, res) => {
  const {
    project,
    name,
    description,
    type,
    category,
    phase,
    plannedStartDate,
    plannedEndDate,
    assignedTo,
    contractor,
    priority,
    budget,
    dependencies
  } = req.body;

  // Validate required fields
  if (!project || !name || !type || !category || !phase || !plannedStartDate || !plannedEndDate || !assignedTo) {
    res.status(400);
    throw new Error('All required fields must be provided');
  }

  // Verify project exists and belongs to organization
  const projectExists = await Project.findOne({
    _id: project,
    organization: req.user.organization
  });

  if (!projectExists) {
    res.status(404);
    throw new Error('Project not found or access denied');
  }

  // Validate date ranges
  if (new Date(plannedStartDate) >= new Date(plannedEndDate)) {
    res.status(400);
    throw new Error('Planned end date must be after start date');
  }

  // Verify assigned user exists
  const User = mongoose.model('User');
  const assignedUser = await User.findOne({
    _id: assignedTo,
    organization: req.user.organization
  });

  if (!assignedUser) {
    res.status(404);
    throw new Error('Assigned user not found');
  }

  // Verify contractor if provided
  if (contractor) {
    const contractorExists = await Contractor.findOne({
      _id: contractor,
      organization: req.user.organization,
      status: 'Active'
    });

    if (!contractorExists) {
      res.status(404);
      throw new Error('Contractor not found or inactive');
    }
  }

  const milestone = await ConstructionMilestone.create({
    ...req.body,
    organization: req.user.organization,
    createdBy: req.user._id,
    progress: {
      percentage: 0,
      lastUpdated: new Date(),
      updatedBy: req.user._id
    }
  });

  await milestone.populate('assignedTo', 'firstName lastName');
  await milestone.populate('contractor', 'name companyName');

  res.status(201).json({
    success: true,
    data: milestone,
    message: 'Construction milestone created successfully'
  });
});

/**
 * @desc    Get construction milestones
 * @route   GET /api/construction/milestones
 * @access  Private
 */
const getMilestones = asyncHandler(async (req, res) => {
  const {
    page = 1,
    limit = 20,
    project,
    phase,
    status,
    assignedTo,
    priority,
    sortBy = 'plannedStartDate',
    sortOrder = 'asc'
  } = req.query;

  const query = { organization: req.user.organization };

  // Apply filters
  if (project) query.project = project;
  if (phase) query.phase = phase;
  if (status) query.status = status;
  if (assignedTo) query.assignedTo = assignedTo;
  if (priority) query.priority = priority;

  // Build sort object
  const sort = {};
  sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

  const milestones = await ConstructionMilestone.find(query)
    .populate('project', 'name location')
    .populate('assignedTo', 'firstName lastName')
    .populate('contractor', 'name companyName')
    .populate('supervisor', 'firstName lastName')
    .sort(sort)
    .limit(limit * 1)
    .skip((page - 1) * limit);

  const total = await ConstructionMilestone.countDocuments(query);

  res.json({
    success: true,
    data: {
      milestones,
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
 * @desc    Get milestone by ID
 * @route   GET /api/construction/milestones/:id
 * @access  Private
 */
const getMilestoneById = asyncHandler(async (req, res) => {
  const milestone = await ConstructionMilestone.findOne({
    _id: req.params.id,
    organization: req.user.organization
  })
    .populate('project', 'name location')
    .populate('assignedTo', 'firstName lastName email')
    .populate('contractor', 'name companyName contactInfo rating')
    .populate('supervisor', 'firstName lastName email')
    .populate('dependencies.milestone', 'name status')
    .populate('qualityChecks.checkedBy', 'firstName lastName')
    .populate('issues.reportedBy', 'firstName lastName')
    .populate('issues.resolvedBy', 'firstName lastName');

  if (!milestone) {
    res.status(404);
    throw new Error('Milestone not found');
  }

  res.json({
    success: true,
    data: {
      ...milestone.toObject(),
      virtualFields: {
        plannedDuration: milestone.plannedDuration,
        actualDuration: milestone.actualDuration,
        delayDays: milestone.delayDays,
        costVariancePercentage: milestone.costVariancePercentage,
        healthScore: milestone.healthScore
      }
    }
  });
});

/**
 * @desc    Update milestone
 * @route   PUT /api/construction/milestones/:id
 * @access  Private (Management roles)
 */
const updateMilestone = asyncHandler(async (req, res) => {
  const milestone = await ConstructionMilestone.findOne({
    _id: req.params.id,
    organization: req.user.organization
  });

  if (!milestone) {
    res.status(404);
    throw new Error('Milestone not found');
  }

  // Validate date ranges if being updated
  if (req.body.plannedStartDate && req.body.plannedEndDate) {
    if (new Date(req.body.plannedStartDate) >= new Date(req.body.plannedEndDate)) {
      res.status(400);
      throw new Error('Planned end date must be after start date');
    }
  }

  // Update milestone
  Object.assign(milestone, req.body);
  milestone.lastModifiedBy = req.user._id;

  await milestone.save();

  res.json({
    success: true,
    data: milestone,
    message: 'Milestone updated successfully'
  });
});

/**
 * @desc    Update milestone progress
 * @route   PUT /api/construction/milestones/:id/progress
 * @access  Private
 */
const updateMilestoneProgress = asyncHandler(async (req, res) => {
  const { percentage, notes } = req.body;

  if (percentage === undefined || percentage < 0 || percentage > 100) {
    res.status(400);
    throw new Error('Progress percentage must be between 0 and 100');
  }

  const milestone = await ConstructionMilestone.findOne({
    _id: req.params.id,
    organization: req.user.organization
  });

  if (!milestone) {
    res.status(404);
    throw new Error('Milestone not found');
  }

  // Check if user has permission to update this milestone
  if (milestone.assignedTo.toString() !== req.user._id.toString() && 
      !['Business Head', 'Project Director', 'Sales Manager'].includes(req.user.role)) {
    res.status(403);
    throw new Error('You do not have permission to update this milestone');
  }

  milestone.updateProgress(percentage, req.user._id);
  
  if (notes) {
    milestone.completionDetails.completionNotes = notes;
  }

  await milestone.save();

  res.json({
    success: true,
    data: {
      milestoneId: milestone._id,
      progress: milestone.progress,
      status: milestone.status,
      healthScore: milestone.healthScore
    },
    message: `Progress updated to ${percentage}%`
  });
});

/**
 * @desc    Add quality check to milestone
 * @route   POST /api/construction/milestones/:id/quality-checks
 * @access  Private
 */
const addQualityCheck = asyncHandler(async (req, res) => {
  const { checkName, description, isRequired = true, status = 'Pending' } = req.body;

  if (!checkName) {
    res.status(400);
    throw new Error('Quality check name is required');
  }

  const milestone = await ConstructionMilestone.findOne({
    _id: req.params.id,
    organization: req.user.organization
  });

  if (!milestone) {
    res.status(404);
    throw new Error('Milestone not found');
  }

  const qualityCheck = milestone.addQualityCheck({
    checkName,
    description,
    isRequired,
    status
  });

  await milestone.save();

  res.status(201).json({
    success: true,
    data: qualityCheck,
    message: 'Quality check added successfully'
  });
});

/**
 * @desc    Update quality check status
 * @route   PUT /api/construction/milestones/:id/quality-checks/:checkId
 * @access  Private
 */
const updateQualityCheck = asyncHandler(async (req, res) => {
  const { status, notes } = req.body;

  if (!status || !['Pending', 'Passed', 'Failed', 'Not Applicable'].includes(status)) {
    res.status(400);
    throw new Error('Valid status is required');
  }

  const milestone = await ConstructionMilestone.findOne({
    _id: req.params.id,
    organization: req.user.organization
  });

  if (!milestone) {
    res.status(404);
    throw new Error('Milestone not found');
  }

  const qualityCheck = milestone.qualityChecks.id(req.params.checkId);
  if (!qualityCheck) {
    res.status(404);
    throw new Error('Quality check not found');
  }

  qualityCheck.status = status;
  qualityCheck.checkedBy = req.user._id;
  qualityCheck.checkedAt = new Date();
  if (notes) qualityCheck.notes = notes;

  await milestone.save();

  res.json({
    success: true,
    data: qualityCheck,
    message: 'Quality check updated successfully'
  });
});

/**
 * @desc    Add issue to milestone
 * @route   POST /api/construction/milestones/:id/issues
 * @access  Private
 */
const addIssue = asyncHandler(async (req, res) => {
  const { issueType, severity, title, description } = req.body;

  if (!issueType || !severity || !title || !description) {
    res.status(400);
    throw new Error('All issue fields are required');
  }

  const milestone = await ConstructionMilestone.findOne({
    _id: req.params.id,
    organization: req.user.organization
  });

  if (!milestone) {
    res.status(404);
    throw new Error('Milestone not found');
  }

  const issue = milestone.addIssue({
    issueType,
    severity,
    title,
    description
  }, req.user._id);

  await milestone.save();

  res.status(201).json({
    success: true,
    data: issue,
    message: 'Issue reported successfully'
  });
});

/**
 * @desc    Upload progress photos
 * @route   POST /api/construction/milestones/:id/photos
 * @access  Private
 */
const uploadProgressPhotos = asyncHandler(async (req, res) => {
  const { description, location, isBeforePhoto = false, isAfterPhoto = false } = req.body;
  const files = req.files;

  if (!files || files.length === 0) {
    res.status(400);
    throw new Error('No photos uploaded');
  }

  const milestone = await ConstructionMilestone.findOne({
    _id: req.params.id,
    organization: req.user.organization
  });

  if (!milestone) {
    res.status(404);
    throw new Error('Milestone not found');
  }

  const uploadedPhotos = [];

  for (const file of files) {
    // Upload to S3
    const folder = `construction/milestones/${milestone._id}/photos`;
    const { url, s3Key } = await uploadFileToS3(file, folder);

    // Create file record
    const fileRecord = await File.create({
      organization: req.user.organization,
      uploadedBy: req.user._id,
      category: milestone.category, // You might want to create a specific category for progress photos
      associatedResource: milestone._id,
      resourceType: 'ConstructionMilestone',
      originalName: file.originalname,
      fileName: file.originalname,
      title: `Progress Photo - ${milestone.name}`,
      description: description || `Progress photo for ${milestone.name}`,
      tags: ['progress-photo', 'construction', milestone.type.toLowerCase()],
      mimeType: file.mimetype,
      size: file.size,
      url,
      s3Key,
      accessLevel: 'organization'
    });

    // Add to milestone progress photos
    milestone.progressPhotos.push({
      photo: fileRecord._id,
      takenAt: new Date(),
      takenBy: req.user._id,
      description,
      location,
      isBeforePhoto,
      isAfterPhoto
    });

    uploadedPhotos.push({
      fileId: fileRecord._id,
      url: fileRecord.url,
      description,
      takenAt: new Date()
    });
  }

  await milestone.save();

  res.status(201).json({
    success: true,
    data: {
      milestoneId: milestone._id,
      uploadedPhotos,
      totalPhotos: milestone.progressPhotos.length
    },
    message: `${uploadedPhotos.length} progress photos uploaded successfully`
  });
});

/**
 * @desc    Get project timeline
 * @route   GET /api/construction/projects/:projectId/timeline
 * @access  Private
 */
const getProjectTimeline = asyncHandler(async (req, res) => {
  const { projectId } = req.params;
  const { phase, status } = req.query;

  // Verify project access
  const project = await Project.findOne({
    _id: projectId,
    organization: req.user.organization
  });

  if (!project) {
    res.status(404);
    throw new Error('Project not found');
  }

  const query = { project: projectId };
  if (phase) query.phase = phase;
  if (status) query.status = status;

  const timeline = await ConstructionMilestone.find(query)
    .populate('assignedTo', 'firstName lastName')
    .populate('contractor', 'name companyName')
    .sort({ plannedStartDate: 1 });

  // Calculate project statistics
  const stats = {
    totalMilestones: timeline.length,
    completed: timeline.filter(m => m.status === 'Completed').length,
    inProgress: timeline.filter(m => m.status === 'In Progress').length,
    delayed: timeline.filter(m => m.delayDays > 0).length,
    overallProgress: timeline.length > 0 ? 
      timeline.reduce((sum, m) => sum + m.progress.percentage, 0) / timeline.length : 0
  };

  res.json({
    success: true,
    data: {
      project: {
        _id: project._id,
        name: project.name,
        status: project.status
      },
      timeline,
      statistics: stats
    }
  });
});

/**
 * @desc    Get overdue milestones
 * @route   GET /api/construction/milestones/overdue
 * @access  Private (Management roles)
 */
const getOverdueMilestones = asyncHandler(async (req, res) => {
  const overdueMilestones = await ConstructionMilestone.getOverdueMilestones(req.user.organization);

  const milestoneDetails = overdueMilestones.map(milestone => ({
    _id: milestone._id,
    name: milestone.name,
    project: milestone.project,
    assignedTo: milestone.assignedTo,
    plannedEndDate: milestone.plannedEndDate,
    delayDays: milestone.delayDays,
    status: milestone.status,
    progress: milestone.progress.percentage,
    priority: milestone.priority,
    healthScore: milestone.healthScore
  }));

  res.json({
    success: true,
    data: {
      count: milestoneDetails.length,
      milestones: milestoneDetails
    }
  });
});

/**
 * @desc    Get construction analytics
 * @route   GET /api/construction/analytics
 * @access  Private (Management roles)
 */
const getConstructionAnalytics = asyncHandler(async (req, res) => {
  const { period = 30, projectId } = req.query;
  
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - parseInt(period));
  
  const matchConditions = {
    organization: req.user.organization,
    createdAt: { $gte: startDate }
  };
  
  if (projectId) {
    matchConditions.project = new mongoose.Types.ObjectId(projectId);
  }

  const analytics = await ConstructionMilestone.aggregate([
    { $match: matchConditions },
    {
      $facet: {
        // Status distribution
        statusDistribution: [
          {
            $group: {
              _id: '$status',
              count: { $sum: 1 },
              avgProgress: { $avg: '$progress.percentage' }
            }
          }
        ],
        
        // Phase distribution
        phaseDistribution: [
          {
            $group: {
              _id: '$phase',
              count: { $sum: 1 },
              avgProgress: { $avg: '$progress.percentage' },
              totalBudget: { $sum: '$budget.plannedCost' },
              actualCost: { $sum: '$budget.actualCost' }
            }
          }
        ],
        
        // Priority distribution
        priorityDistribution: [
          {
            $group: {
              _id: '$priority',
              count: { $sum: 1 },
              avgDelayDays: { 
                $avg: {
                  $cond: [
                    { $lt: ['$plannedEndDate', new Date()] },
                    { 
                      $divide: [
                        { $subtract: [new Date(), '$plannedEndDate'] },
                        1000 * 60 * 60 * 24
                      ]
                    },
                    0
                  ]
                }
              }
            }
          }
        ],
        
        // Monthly progress
        monthlyProgress: [
          {
            $group: {
              _id: {
                year: { $year: '$createdAt' },
                month: { $month: '$createdAt' }
              },
              milestonesCreated: { $sum: 1 },
              avgProgress: { $avg: '$progress.percentage' },
              totalBudget: { $sum: '$budget.plannedCost' }
            }
          },
          { $sort: { '_id.year': 1, '_id.month': 1 } }
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
};