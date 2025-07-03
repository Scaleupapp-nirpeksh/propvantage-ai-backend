// File: routes/leadScoringRoutes.js
// Description: Defines API routes for lead scoring functionality

import express from 'express';
import {
  getLeadScore,
  recalculateLeadScore,
  getHighPriorityLeads,
  getLeadsNeedingAttention,
  getScoreAnalytics,
  bulkRecalculateScores,
  getLeadScoreHistory,
  getScoringConfig,
  updateScoringConfig
} from '../controllers/leadScoringController.js';

// Import security middleware
import { protect, authorize } from '../middleware/authMiddleware.js';

const router = express.Router();

// Apply the 'protect' middleware to all routes in this file
router.use(protect);

// Define role-based access control groups
const salesRoles = [
  'Business Head',
  'Sales Head',
  'Project Director',
  'Sales Manager',
  'Sales Executive',
  'Channel Partner Manager'
];

const managementRoles = [
  'Business Head',
  'Sales Head',
  'Project Director',
  'Sales Manager',
  'Channel Partner Manager'
];

const seniorManagementRoles = [
  'Business Head',
  'Sales Head',
  'Project Director'
];

// ============================================================================
// LEAD SCORING ROUTES
// ============================================================================

// @route   GET /api/leads/high-priority
// @desc    Get high-priority leads based on scores
// @access  Private (Sales roles)
router.get(
  '/high-priority',
  authorize(...salesRoles),
  getHighPriorityLeads
);

// @route   GET /api/leads/needs-attention
// @desc    Get leads needing attention (low scores, overdue follow-ups)
// @access  Private (Sales roles)
router.get(
  '/needs-attention',
  authorize(...salesRoles),
  getLeadsNeedingAttention
);

// @route   GET /api/leads/score-analytics
// @desc    Get score distribution analytics
// @access  Private (Management roles)
router.get(
  '/score-analytics',
  authorize(...managementRoles),
  getScoreAnalytics
);

// @route   POST /api/leads/score/bulk-recalculate
// @desc    Bulk recalculate scores for multiple leads
// @access  Private (Management roles)
router.post(
  '/score/bulk-recalculate',
  authorize(...managementRoles),
  bulkRecalculateScores
);

// @route   GET /api/leads/scoring-config
// @desc    Get scoring configuration
// @access  Private (Management roles)
router.get(
  '/scoring-config',
  authorize(...managementRoles),
  getScoringConfig
);

// @route   PUT /api/leads/scoring-config
// @desc    Update scoring configuration
// @access  Private (Senior Management roles)
router.put(
  '/scoring-config',
  authorize(...seniorManagementRoles),
  updateScoringConfig
);

// ============================================================================
// INDIVIDUAL LEAD SCORING ROUTES
// ============================================================================

// @route   GET /api/leads/:id/score
// @desc    Get lead score for a specific lead
// @access  Private (Sales roles)
router.get(
  '/:id/score',
  authorize(...salesRoles),
  getLeadScore
);

// @route   POST /api/leads/:id/score/recalculate
// @desc    Recalculate lead score for a specific lead
// @access  Private (Sales roles)
router.post(
  '/:id/score/recalculate',
  authorize(...salesRoles),
  recalculateLeadScore
);

// @route   GET /api/leads/:id/score-history
// @desc    Get lead score history
// @access  Private (Sales roles)
router.get(
  '/:id/score-history',
  authorize(...salesRoles),
  getLeadScoreHistory
);

export default router;