// File: controllers/leadController.js
// Description: Fixed Lead Controller with proper exports
// Version: 1.5 - FIXED export list to include all functions
// Location: controllers/leadController.js

import asyncHandler from 'express-async-handler';
import Lead from '../models/leadModel.js';
import Interaction from '../models/interactionModel.js';
import Project from '../models/projectModel.js';
import mongoose from 'mongoose';
import {
  verifyProjectAccess,
  projectAccessFilter,
} from '../utils/projectAccessHelper.js';

// Import background job service if it exists, otherwise provide fallback
let addLeadScoreUpdateJob, addEngagementMetricsUpdateJob;
try {
  const jobService = await import('../services/backgroundJobService.js');
  addLeadScoreUpdateJob = jobService.addLeadScoreUpdateJob || (() => console.log('Background job service not available'));
  addEngagementMetricsUpdateJob = jobService.addEngagementMetricsUpdateJob || (() => console.log('Background job service not available'));
} catch (error) {
  console.log('Background job service not found, using fallback');
  addLeadScoreUpdateJob = () => console.log('Score update job triggered (fallback)');
  addEngagementMetricsUpdateJob = () => console.log('Engagement update job triggered (fallback)');
}

// Import lead scoring service if available
let updateLeadScore;
try {
  const scoringService = await import('../services/leadScoringService.js');
  updateLeadScore = scoringService.updateLeadScore;
} catch (error) {
  console.log('Lead scoring service not found');
  updateLeadScore = () => Promise.resolve({ message: 'Scoring service not available' });
}

/**
 * @desc    Create a new lead
 * @route   POST /api/leads
 * @access  Private (Requires authentication and role check)
 */
const createLead = asyncHandler(async (req, res) => {
  const { project, firstName, lastName, email, phone, source, status, assignedTo, budget, requirements } = req.body;

  // Basic validation
  if (!project || !firstName || !phone) {
    res.status(400);
    throw new Error('Project, first name, and phone are required fields.');
  }

  // Verify the project exists and belongs to the user's organization
  const projectExists = await Project.findOne({
    _id: project,
    organization: req.user.organization,
  });

  if (!projectExists) {
    res.status(404);
    throw new Error('Project not found or you do not have permission to access it.');
  }

  verifyProjectAccess(req, res, project);

  // Create the lead with enhanced fields
  const lead = new Lead({
    ...req.body,
    organization: req.user.organization, // Set organization from logged-in user
    // Initialize scoring fields
    score: 0,
    scoreGrade: 'D',
    priority: 'Very Low',
    lastScoreUpdate: new Date(),
    engagementMetrics: {
      totalInteractions: 0,
      responseRate: 0
    },
    // Initialize budget validation if budget provided
    ...(budget && {
      budget: {
        ...budget,
        isValidated: false,
        budgetSource: 'self_reported'
      }
    })
  });

  const createdLead = await lead.save();

  // Trigger initial score calculation in background with delay
  addLeadScoreUpdateJob(createdLead._id, { delay: 2000 }); // 2 second delay

  res.status(201).json({
    success: true,
    data: createdLead,
    message: 'Lead created successfully. Score calculation in progress.'
  });
});

/**
 * @desc    Get all leads for the user's organization with enhanced filtering
 * @route   GET /api/leads
 * @access  Private
 */
const getLeads = asyncHandler(async (req, res) => {
  const { 
    page = 1, 
    limit = 10, 
    status, 
    source, 
    assignedTo, 
    project,
    minScore,
    maxScore,
    priority,
    qualificationStatus,
    sortBy = 'score',
    sortOrder = 'desc',
    search
  } = req.query;

  // --- V1.1 Enhancement: Advanced RBAC Filtering ---
  const query = { organization: req.user.organization, ...projectAccessFilter(req) };

  // Apply filters
  if (status) query.status = status;
  if (source) query.source = source;
  if (assignedTo) query.assignedTo = assignedTo;
  if (project) query.project = project;
  if (priority) query.priority = priority;
  if (qualificationStatus) query.qualificationStatus = qualificationStatus;

  // Score range filter
  if (minScore || maxScore) {
    query.score = {};
    if (minScore) query.score.$gte = parseInt(minScore);
    if (maxScore) query.score.$lte = parseInt(maxScore);
  }

  // Search functionality
  if (search) {
    query.$or = [
      { firstName: { $regex: search, $options: 'i' } },
      { lastName: { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } },
      { phone: { $regex: search, $options: 'i' } }
    ];
  }

  // If the user is a Sales Executive, they should only see leads assigned to them.
  if (req.user.role === 'Sales Executive') {
    query.assignedTo = req.user._id;
  }
  
  // Note: For a Sales Manager, a more advanced query would find all users on their team.
  // For V1.1, managers and heads can see all leads within the organization.

  // Build sort object
  const sort = {};
  sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

  // If sorting by score, add secondary sort by update date
  if (sortBy === 'score') {
    sort.lastScoreUpdate = -1;
  }

  const leads = await Lead.find(query)
    .populate('project', 'name location')
    .populate('assignedTo', 'firstName lastName')
    .sort(sort)
    .limit(limit * 1)
    .skip((page - 1) * limit)
    .select('firstName lastName phone email score scoreGrade priority confidence qualificationStatus status source createdAt lastScoreUpdate assignedTo project engagementMetrics followUpSchedule');

  const total = await Lead.countDocuments(query);

  res.json({
    success: true,
    data: {
      leads,
      pagination: {
        totalPages: Math.ceil(total / limit),
        currentPage: parseInt(page),
        total,
        hasNextPage: page < Math.ceil(total / limit),
        hasPrevPage: page > 1,
        limit: parseInt(limit)
      }
    }
  });
});

/**
 * @desc    Get a single lead by ID with complete details
 * @route   GET /api/leads/:id
 * @access  Private
 */
const getLeadById = asyncHandler(async (req, res) => {
  const lead = await Lead.findOne({
    _id: req.params.id,
    organization: req.user.organization,
  })
    .populate('project', 'name targetRevenue location')
    .populate('assignedTo', 'firstName lastName email');

  if (!lead) {
    res.status(404);
    throw new Error('Lead not found');
  }

  verifyProjectAccess(req, res, lead.project?._id || lead.project);

  // Add logic here to ensure a Sales Executive can only view their own lead details
  if (
    req.user.role === 'Sales Executive' &&
    lead.assignedTo && 
    lead.assignedTo._id.toString() !== req.user._id.toString()
  ) {
    res.status(403);
    throw new Error('You are not authorized to view this lead.');
  }

  // Get recent interactions count
  const recentInteractionsCount = await Interaction.countDocuments({
    lead: lead._id,
    createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } // Last 7 days
  });

  res.json({
    success: true,
    data: {
      ...lead.toObject(),
      recentInteractionsCount,
      virtualFields: {
        fullName: lead.fullName,
        scoreStatus: lead.scoreStatus,
        followUpUrgency: lead.followUpUrgency,
        engagementLevel: lead.engagementLevel
      }
    }
  });
});

/**
 * @desc    Update a lead
 * @route   PUT /api/leads/:id
 * @access  Private
 */
const updateLead = asyncHandler(async (req, res) => {
  const lead = await Lead.findOne({
    _id: req.params.id,
    organization: req.user.organization,
  });

  if (!lead) {
    res.status(404);
    throw new Error('Lead not found');
  }

  verifyProjectAccess(req, res, lead.project);

  // Add logic here to ensure a Sales Executive can only update their own lead
  if (
    req.user.role === 'Sales Executive' &&
    lead.assignedTo && 
    lead.assignedTo.toString() !== req.user._id.toString()
  ) {
    res.status(403);
    throw new Error('You are not authorized to update this lead.');
  }

  // Track what fields are being updated
  const updatedFields = Object.keys(req.body);
  const scoreAffectingFields = ['budget', 'requirements', 'status', 'qualificationStatus'];
  const shouldRecalculateScore = updatedFields.some(field => scoreAffectingFields.includes(field));

  // Update the lead
  const updatedLead = await Lead.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
    runValidators: true,
  }).populate('project', 'name location').populate('assignedTo', 'firstName lastName');

  // If score-affecting fields were updated, trigger recalculation
  if (shouldRecalculateScore) {
    addLeadScoreUpdateJob(updatedLead._id, { delay: 1000 });
  }

  res.json({
    success: true,
    data: updatedLead,
    message: shouldRecalculateScore ? 
      'Lead updated successfully. Score recalculation in progress.' : 
      'Lead updated successfully.'
  });
});

/**
 * @desc    Delete a lead
 * @route   DELETE /api/leads/:id
 * @access  Private (Management roles only)
 */
const deleteLead = asyncHandler(async (req, res) => {
  const lead = await Lead.findOne({
    _id: req.params.id,
    organization: req.user.organization,
  });

  if (!lead) {
    res.status(404);
    throw new Error('Lead not found');
  }

  verifyProjectAccess(req, res, lead.project);

  // Only allow deletion if lead is not booked
  if (lead.status === 'Booked') {
    res.status(400);
    throw new Error('Cannot delete a booked lead. Please change status first.');
  }

  // Delete associated interactions first
  await Interaction.deleteMany({ lead: req.params.id });

  // Delete the lead
  await lead.deleteOne();

  res.json({
    success: true,
    message: 'Lead and associated interactions deleted successfully'
  });
});

/**
 * @desc    Add an interaction to a lead
 * @route   POST /api/leads/:id/interactions
 * @access  Private
 */
const addInteractionToLead = asyncHandler(async (req, res) => {
  const { type, content, outcome, direction, nextAction, scheduledAt } = req.body;
  const leadId = req.params.id;

  // Validate required fields
  if (!type || !content) {
    res.status(400);
    throw new Error('Interaction type and content are required');
  }

  const lead = await Lead.findOne({
    _id: leadId,
    organization: req.user.organization,
  });

  if (!lead) {
    res.status(404);
    throw new Error('Lead not found');
  }

  verifyProjectAccess(req, res, lead.project);

  // Check if Sales Executive can add interactions to this lead
  if (
    req.user.role === 'Sales Executive' &&
    lead.assignedTo && 
    lead.assignedTo.toString() !== req.user._id.toString()
  ) {
    res.status(403);
    throw new Error('You can only add interactions to your assigned leads');
  }

  const interaction = new Interaction({
    ...req.body,
    lead: leadId,
    user: req.user._id, // Logged-in user
    organization: req.user.organization,
  });

  const createdInteraction = await interaction.save();

  // Update follow-up schedule if nextAction is provided
  if (nextAction && scheduledAt) {
    lead.followUpSchedule = {
      nextFollowUpDate: new Date(scheduledAt),
      followUpType: type,
      notes: nextAction,
      isOverdue: false
    };
    await lead.save();
  }

  // Update engagement metrics
  lead.engagementMetrics.totalInteractions += 1;
  lead.engagementMetrics.lastInteractionDate = new Date();
  lead.engagementMetrics.lastInteractionType = type;
  
  // Update activity summary if the method exists
  if (typeof lead.updateActivitySummary === 'function') {
    lead.updateActivitySummary(type.toLowerCase().replace(' ', '_'));
  }
  
  await lead.save();

  // Trigger score recalculation in background
  addLeadScoreUpdateJob(leadId, { delay: 2000 });

  res.status(201).json({
    success: true,
    data: createdInteraction,
    message: 'Interaction added successfully'
  });
});

/**
 * @desc    Get all interactions for a lead
 * @route   GET /api/leads/:id/interactions
 * @access  Private
 */
const getLeadInteractions = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, type, startDate, endDate } = req.query;
  
  const lead = await Lead.findOne({
    _id: req.params.id,
    organization: req.user.organization,
  });

  if (!lead) {
    res.status(404);
    throw new Error('Lead not found');
  }

  verifyProjectAccess(req, res, lead.project);

  // Check if Sales Executive can view interactions for this lead
  if (
    req.user.role === 'Sales Executive' &&
    lead.assignedTo && 
    lead.assignedTo.toString() !== req.user._id.toString()
  ) {
    res.status(403);
    throw new Error('You can only view interactions for your assigned leads');
  }

  const query = { lead: req.params.id };
  
  // Apply filters
  if (type) query.type = type;
  if (startDate && endDate) {
    query.createdAt = {
      $gte: new Date(startDate),
      $lte: new Date(endDate)
    };
  }

  const interactions = await Interaction.find(query)
    .populate('user', 'firstName lastName')
    .sort({ createdAt: -1 }) // Show most recent first
    .limit(limit * 1)
    .skip((page - 1) * limit);

  const total = await Interaction.countDocuments(query);

  res.json({
    success: true,
    data: {
      interactions,
      pagination: {
        totalPages: Math.ceil(total / limit),
        currentPage: parseInt(page),
        total,
        hasNextPage: page < Math.ceil(total / limit),
        hasPrevPage: page > 1
      }
    }
  });
});

/**
 * @desc    Assign lead to sales executive
 * @route   PUT /api/leads/:id/assign
 * @access  Private (Management roles)
 */
const assignLead = asyncHandler(async (req, res) => {
  const { assignedTo } = req.body;
  
  if (!assignedTo) {
    res.status(400);
    throw new Error('Assigned user ID is required');
  }

  const lead = await Lead.findOne({
    _id: req.params.id,
    organization: req.user.organization,
  });

  if (!lead) {
    res.status(404);
    throw new Error('Lead not found');
  }

  verifyProjectAccess(req, res, lead.project);

  // Update the assignment
  lead.assignedTo = assignedTo;
  await lead.save();

  // Trigger score recalculation since assignment affects prioritization
  addLeadScoreUpdateJob(lead._id, { delay: 1000 });

  const updatedLead = await Lead.findById(lead._id)
    .populate('assignedTo', 'firstName lastName email')
    .populate('project', 'name');

  res.json({
    success: true,
    data: updatedLead,
    message: 'Lead assigned successfully'
  });
});

/**
 * @desc    Bulk update leads
 * @route   PUT /api/leads/bulk-update
 * @access  Private (Management roles)
 */
const bulkUpdateLeads = asyncHandler(async (req, res) => {
  const { leadIds, updateData } = req.body;

  if (!leadIds || !Array.isArray(leadIds) || leadIds.length === 0) {
    res.status(400);
    throw new Error('Lead IDs array is required');
  }

  if (!updateData || Object.keys(updateData).length === 0) {
    res.status(400);
    throw new Error('Update data is required');
  }

  // Ensure leads belong to user's organization and accessible projects
  const leads = await Lead.find({
    _id: { $in: leadIds },
    organization: req.user.organization,
    ...projectAccessFilter(req),
  });

  if (leads.length !== leadIds.length) {
    res.status(400);
    throw new Error('Some leads not found or you do not have permission to update them');
  }

  // Perform bulk update
  const result = await Lead.updateMany(
    { 
      _id: { $in: leadIds },
      organization: req.user.organization 
    },
    { 
      ...updateData,
      lastScoreUpdate: new Date() // Update score timestamp
    }
  );

  // Check if score-affecting fields were updated
  const scoreAffectingFields = ['budget', 'requirements', 'status', 'qualificationStatus'];
  const shouldRecalculateScores = Object.keys(updateData).some(field => 
    scoreAffectingFields.includes(field)
  );

  // Trigger score recalculation for all updated leads if needed
  if (shouldRecalculateScores) {
    leadIds.forEach(leadId => {
      addLeadScoreUpdateJob(leadId, { delay: Math.random() * 5000 }); // Random delay 0-5 seconds
    });
  }

  res.json({
    success: true,
    message: `${result.modifiedCount} leads updated successfully`,
    data: {
      matchedCount: result.matchedCount,
      modifiedCount: result.modifiedCount,
      scoreRecalculationTriggered: shouldRecalculateScores
    }
  });
});

/**
 * @desc    Get lead statistics for dashboard
 * @route   GET /api/leads/stats
 * @access  Private (Management roles)
 */
const getLeadStats = asyncHandler(async (req, res) => {
  const { period = 30 } = req.query;
  
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - parseInt(period));
  
  const query = {
    organization: req.user.organization,
    ...projectAccessFilter(req),
    createdAt: { $gte: startDate }
  };

  // Sales Executives can only see their own stats
  if (req.user.role === 'Sales Executive') {
    query.assignedTo = req.user._id;
  }

  const stats = await Lead.aggregate([
    { $match: query },
    {
      $group: {
        _id: null,
        totalLeads: { $sum: 1 },
        avgScore: { $avg: '$score' },
        highPriorityLeads: {
          $sum: { $cond: [{ $eq: ['$priority', 'High'] }, 1, 0] }
        },
        criticalPriorityLeads: {
          $sum: { $cond: [{ $eq: ['$priority', 'Critical'] }, 1, 0] }
        },
        qualifiedLeads: {
          $sum: { $cond: [{ $eq: ['$qualificationStatus', 'Qualified'] }, 1, 0] }
        },
        bookedLeads: {
          $sum: { $cond: [{ $eq: ['$status', 'Booked'] }, 1, 0] }
        },
        lostLeads: {
          $sum: { $cond: [{ $eq: ['$status', 'Lost'] }, 1, 0] }
        }
      }
    }
  ]);

  const result = stats[0] || {
    totalLeads: 0,
    avgScore: 0,
    highPriorityLeads: 0,
    criticalPriorityLeads: 0,
    qualifiedLeads: 0,
    bookedLeads: 0,
    lostLeads: 0
  };

  // Calculate conversion rate
  result.conversionRate = result.totalLeads > 0 ? 
    ((result.bookedLeads / result.totalLeads) * 100).toFixed(2) : 0;

  res.json({
    success: true,
    data: {
      period: `${period} days`,
      stats: result
    }
  });
});

// ====================================================================
// FIXED EXPORTS - ALL FUNCTIONS PROPERLY EXPORTED
// ====================================================================

export {
  createLead,
  getLeads,
  getLeadById,
  updateLead,
  deleteLead,
  addInteractionToLead,      // FIXED: Now properly exported
  getLeadInteractions,       // FIXED: Now properly exported
  assignLead,
  bulkUpdateLeads,
  getLeadStats
};