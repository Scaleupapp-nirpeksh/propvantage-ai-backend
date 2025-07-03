// File: controllers/leadScoringController.js
// Description: Handles API endpoints for lead scoring functionality

import asyncHandler from 'express-async-handler';
import Lead from '../models/leadModel.js';
import {
  calculateLeadScore,
  updateLeadScore,
  bulkUpdateLeadScores,
  DEFAULT_SCORING_CONFIG
} from '../services/leadScoringService.js';
import mongoose from 'mongoose';

/**
 * @desc    Get lead score for a specific lead
 * @route   GET /api/leads/:id/score
 * @access  Private (Sales roles)
 */
const getLeadScore = asyncHandler(async (req, res) => {
  const lead = await Lead.findOne({
    _id: req.params.id,
    organization: req.user.organization,
  });

  if (!lead) {
    res.status(404);
    throw new Error('Lead not found');
  }

  // Check if user has permission to view this lead
  if (req.user.role === 'Sales Executive' && 
      lead.assignedTo && 
      lead.assignedTo.toString() !== req.user._id.toString()) {
    res.status(403);
    throw new Error('You can only view scores for your assigned leads');
  }

  res.json({
    leadId: lead._id,
    leadName: lead.fullName,
    currentScore: lead.score,
    scoreGrade: lead.scoreGrade,
    priority: lead.priority,
    qualificationStatus: lead.qualificationStatus,
    scoreBreakdown: lead.scoreBreakdown,
    lastScoreUpdate: lead.lastScoreUpdate,
    needsRecalculation: lead.needsScoreRecalculation()
  });
});

/**
 * @desc    Recalculate lead score for a specific lead
 * @route   POST /api/leads/:id/score/recalculate
 * @access  Private (Sales roles)
 */
const recalculateLeadScore = asyncHandler(async (req, res) => {
  const lead = await Lead.findOne({
    _id: req.params.id,
    organization: req.user.organization,
  });

  if (!lead) {
    res.status(404);
    throw new Error('Lead not found');
  }

  // Check if user has permission to update this lead
  if (req.user.role === 'Sales Executive' && 
      lead.assignedTo && 
      lead.assignedTo.toString() !== req.user._id.toString()) {
    res.status(403);
    throw new Error('You can only update scores for your assigned leads');
  }

  try {
    const scoreResult = await updateLeadScore(lead._id);
    
    res.json({
      success: true,
      message: 'Lead score recalculated successfully',
      data: scoreResult
    });
  } catch (error) {
    res.status(400);
    throw new Error(`Failed to recalculate lead score: ${error.message}`);
  }
});

/**
 * @desc    Get high-priority leads based on scores
 * @route   GET /api/leads/high-priority
 * @access  Private (Management/Sales roles)
 */
const getHighPriorityLeads = asyncHandler(async (req, res) => {
  const { limit = 50, minScore = 70, projectId } = req.query;
  
  const query = {
    organization: req.user.organization,
    score: { $gte: parseInt(minScore) },
    status: { $nin: ['Booked', 'Lost', 'Unqualified'] }
  };
  
  // Filter by project if specified
  if (projectId) {
    query.project = projectId;
  }
  
  // Sales Executives can only see their assigned leads
  if (req.user.role === 'Sales Executive') {
    query.assignedTo = req.user._id;
  }
  
  const highPriorityLeads = await Lead.find(query)
    .sort({ score: -1, lastScoreUpdate: -1 })
    .limit(parseInt(limit))
    .populate('assignedTo', 'firstName lastName')
    .populate('project', 'name')
    .select('firstName lastName phone email score scoreGrade priority qualificationStatus lastScoreUpdate assignedTo project');
  
  res.json({
    count: highPriorityLeads.length,
    leads: highPriorityLeads
  });
});

/**
 * @desc    Get leads needing attention (low scores, overdue follow-ups)
 * @route   GET /api/leads/needs-attention
 * @access  Private (Management/Sales roles)
 */
const getLeadsNeedingAttention = asyncHandler(async (req, res) => {
  const { limit = 50 } = req.query;
  
  const threeDaysAgo = new Date();
  threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
  
  const query = {
    organization: req.user.organization,
    status: { $nin: ['Booked', 'Lost', 'Unqualified'] },
    $or: [
      { 'engagementMetrics.lastInteractionDate': { $lt: threeDaysAgo } },
      { 'followUpSchedule.nextFollowUpDate': { $lt: new Date() } },
      { score: { $lt: 40 } }
    ]
  };
  
  // Sales Executives can only see their assigned leads
  if (req.user.role === 'Sales Executive') {
    query.assignedTo = req.user._id;
  }
  
  const leadsNeedingAttention = await Lead.find(query)
    .sort({ score: -1, 'engagementMetrics.lastInteractionDate': 1 })
    .limit(parseInt(limit))
    .populate('assignedTo', 'firstName lastName')
    .populate('project', 'name')
    .select('firstName lastName phone email score scoreGrade priority qualificationStatus engagementMetrics followUpSchedule assignedTo project');
  
  res.json({
    count: leadsNeedingAttention.length,
    leads: leadsNeedingAttention
  });
});

/**
 * @desc    Get score distribution analytics
 * @route   GET /api/leads/score-analytics
 * @access  Private (Management roles)
 */
const getScoreAnalytics = asyncHandler(async (req, res) => {
  const { projectId, assignedTo, period = 30 } = req.query;
  
  const periodDays = parseInt(period);
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - periodDays);
  
  const matchConditions = {
    organization: req.user.organization,
    createdAt: { $gte: startDate }
  };
  
  if (projectId) {
    matchConditions.project = new mongoose.Types.ObjectId(projectId);
  }
  
  if (assignedTo) {
    matchConditions.assignedTo = new mongoose.Types.ObjectId(assignedTo);
  }
  
  // Sales Executives can only see their own analytics
  if (req.user.role === 'Sales Executive') {
    matchConditions.assignedTo = req.user._id;
  }
  
  const analytics = await Lead.aggregate([
    { $match: matchConditions },
    {
      $facet: {
        // Score distribution
        scoreDistribution: [
          {
            $bucket: {
              groupBy: '$score',
              boundaries: [0, 20, 40, 60, 80, 100],
              default: 'other',
              output: {
                count: { $sum: 1 },
                leads: { $push: { _id: '$_id', firstName: '$firstName', lastName: '$lastName', score: '$score' } }
              }
            }
          }
        ],
        
        // Grade distribution
        gradeDistribution: [
          {
            $group: {
              _id: '$scoreGrade',
              count: { $sum: 1 },
              avgScore: { $avg: '$score' }
            }
          },
          { $sort: { _id: 1 } }
        ],
        
        // Priority distribution
        priorityDistribution: [
          {
            $group: {
              _id: '$priority',
              count: { $sum: 1 },
              avgScore: { $avg: '$score' }
            }
          },
          { $sort: { _id: 1 } }
        ],
        
        // Qualification status distribution
        qualificationDistribution: [
          {
            $group: {
              _id: '$qualificationStatus',
              count: { $sum: 1 },
              avgScore: { $avg: '$score' }
            }
          },
          { $sort: { _id: 1 } }
        ],
        
        // Score trends over time
        scoreTrends: [
          {
            $group: {
              _id: {
                year: { $year: '$createdAt' },
                month: { $month: '$createdAt' },
                week: { $week: '$createdAt' }
              },
              avgScore: { $avg: '$score' },
              count: { $sum: 1 },
              highPriorityCount: {
                $sum: { $cond: [{ $gte: ['$score', 70] }, 1, 0] }
              }
            }
          },
          { $sort: { '_id.year': 1, '_id.month': 1, '_id.week': 1 } }
        ],
        
        // Top performing criteria
        criteriaPerformance: [
          {
            $group: {
              _id: null,
              avgBudgetScore: { $avg: '$scoreBreakdown.budgetAlignment.rawScore' },
              avgEngagementScore: { $avg: '$scoreBreakdown.engagementLevel.rawScore' },
              avgTimelineScore: { $avg: '$scoreBreakdown.timelineUrgency.rawScore' },
              avgSourceScore: { $avg: '$scoreBreakdown.sourceQuality.rawScore' },
              avgRecencyScore: { $avg: '$scoreBreakdown.recencyFactor.rawScore' },
              totalLeads: { $sum: 1 }
            }
          }
        ]
      }
    }
  ]);
  
  res.json({
    period: `${periodDays} days`,
    analytics: analytics[0]
  });
});

/**
 * @desc    Bulk recalculate scores for multiple leads
 * @route   POST /api/leads/score/bulk-recalculate
 * @access  Private (Management roles)
 */
const bulkRecalculateScores = asyncHandler(async (req, res) => {
  const { leadIds, projectId, assignedTo, minDaysOld = 7 } = req.body;
  
  let targetLeadIds;
  
  if (leadIds && leadIds.length > 0) {
    // Use provided lead IDs
    targetLeadIds = leadIds;
  } else {
    // Find leads that need score recalculation
    const query = {
      organization: req.user.organization,
      status: { $nin: ['Booked', 'Lost', 'Unqualified'] }
    };
    
    if (projectId) {
      query.project = projectId;
    }
    
    if (assignedTo) {
      query.assignedTo = assignedTo;
    }
    
    // Find leads with old score calculations
    const oldScoreDate = new Date();
    oldScoreDate.setDate(oldScoreDate.getDate() - minDaysOld);
    query.lastScoreUpdate = { $lt: oldScoreDate };
    
    const leadsToUpdate = await Lead.find(query).select('_id');
    targetLeadIds = leadsToUpdate.map(lead => lead._id.toString());
  }
  
  if (targetLeadIds.length === 0) {
    res.status(400);
    throw new Error('No leads found for score recalculation');
  }
  
  try {
    const bulkResult = await bulkUpdateLeadScores(targetLeadIds);
    
    res.json({
      success: true,
      message: `Bulk score recalculation completed`,
      data: bulkResult
    });
  } catch (error) {
    res.status(400);
    throw new Error(`Failed to bulk recalculate scores: ${error.message}`);
  }
});

/**
 * @desc    Get lead score history (for future implementation)
 * @route   GET /api/leads/:id/score-history
 * @access  Private (Sales roles)
 */
const getLeadScoreHistory = asyncHandler(async (req, res) => {
  const lead = await Lead.findOne({
    _id: req.params.id,
    organization: req.user.organization,
  });

  if (!lead) {
    res.status(404);
    throw new Error('Lead not found');
  }

  // Check if user has permission to view this lead
  if (req.user.role === 'Sales Executive' && 
      lead.assignedTo && 
      lead.assignedTo.toString() !== req.user._id.toString()) {
    res.status(403);
    throw new Error('You can only view score history for your assigned leads');
  }

  // For now, return current score data
  // In future versions, this could include historical score changes
  res.json({
    leadId: lead._id,
    currentScore: lead.score,
    scoreGrade: lead.scoreGrade,
    lastUpdate: lead.lastScoreUpdate,
    breakdown: lead.scoreBreakdown,
    // Future: Add historical score data
    history: []
  });
});

/**
 * @desc    Get scoring configuration
 * @route   GET /api/leads/scoring-config
 * @access  Private (Management roles)
 */
const getScoringConfig = asyncHandler(async (req, res) => {
  // Return the current scoring configuration
  res.json({
    config: DEFAULT_SCORING_CONFIG,
    description: 'Current lead scoring configuration with weights and rules',
    lastUpdated: new Date(),
    version: '1.0'
  });
});

/**
 * @desc    Update scoring configuration (for future implementation)
 * @route   PUT /api/leads/scoring-config
 * @access  Private (Senior Management roles)
 */
const updateScoringConfig = asyncHandler(async (req, res) => {
  // For future implementation - allow customization of scoring rules
  res.status(501).json({
    message: 'Scoring configuration updates will be available in future versions',
    currentConfig: DEFAULT_SCORING_CONFIG
  });
});

export {
  getLeadScore,
  recalculateLeadScore,
  getHighPriorityLeads,
  getLeadsNeedingAttention,
  getScoreAnalytics,
  bulkRecalculateScores,
  getLeadScoreHistory,
  getScoringConfig,
  updateScoringConfig
};