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
import { protect, hasPermission } from '../middleware/authMiddleware.js';
import { PERMISSIONS } from '../config/permissions.js';

const router = express.Router();

// Apply the 'protect' middleware to all routes in this file
router.use(protect);

// ============================================================================
// LEAD SCORING ROUTES
// ============================================================================

// @route   GET /api/leads/high-priority
// @desc    Get high-priority leads based on scores
// @access  Private (Sales roles)
router.get(
  '/high-priority',
  hasPermission(PERMISSIONS.LEADS.SCORING_VIEW),
  getHighPriorityLeads
);

// @route   GET /api/leads/needs-attention
// @desc    Get leads needing attention (low scores, overdue follow-ups)
// @access  Private (Sales roles)
router.get(
  '/needs-attention',
  hasPermission(PERMISSIONS.LEADS.SCORING_VIEW),
  getLeadsNeedingAttention
);

// @route   GET /api/leads/score-analytics
// @desc    Get score distribution analytics
// @access  Private (Management roles)
router.get(
  '/score-analytics',
  hasPermission(PERMISSIONS.LEADS.SCORING_VIEW),
  getScoreAnalytics
);

// @route   POST /api/leads/score/bulk-recalculate
// @desc    Bulk recalculate scores for multiple leads
// @access  Private (Management roles)
router.post(
  '/score/bulk-recalculate',
  hasPermission(PERMISSIONS.LEADS.BULK_OPERATIONS),
  bulkRecalculateScores
);

// @route   GET /api/leads/scoring-config
// @desc    Get scoring configuration
// @access  Private (Management roles)
router.get(
  '/scoring-config',
  hasPermission(PERMISSIONS.LEADS.SCORING_CONFIG),
  getScoringConfig
);

// @route   PUT /api/leads/scoring-config
// @desc    Update scoring configuration
// @access  Private (Senior Management roles)
router.put(
  '/scoring-config',
  hasPermission(PERMISSIONS.LEADS.SCORING_CONFIG),
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
  hasPermission(PERMISSIONS.LEADS.SCORING_VIEW),
  getLeadScore
);

// @route   POST /api/leads/:id/score/recalculate
// @desc    Recalculate lead score for a specific lead
// @access  Private (Sales roles)
router.post(
  '/:id/score/recalculate',
  hasPermission(PERMISSIONS.LEADS.SCORING_VIEW),
  recalculateLeadScore
);

// @route   GET /api/leads/:id/score-history
// @desc    Get lead score history
// @access  Private (Sales roles)
router.get(
  '/:id/score-history',
  hasPermission(PERMISSIONS.LEADS.SCORING_VIEW),
  getLeadScoreHistory
);

export default router;
