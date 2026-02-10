// File: routes/aiConversationRoutes.js
// Description: AI conversation analysis routes
// Version: 1.0 - Complete conversation intelligence
// Location: routes/aiConversationRoutes.js

import express from 'express';
import {
  analyzeConversationText,
  getFollowUpRecommendations,
  getInteractionPatterns,
  getConversationSummary,
  getInteractionInsights,
  bulkAnalyzeConversations
} from '../controllers/aiConversationController.js';

// Import authentication middleware
import { protect, hasPermission } from '../middleware/authMiddleware.js';
import { PERMISSIONS } from '../config/permissions.js';

const router = express.Router();

// Apply authentication to all routes
router.use(protect);

// =============================================================================
// CONVERSATION ANALYSIS ROUTES
// =============================================================================

// @route   POST /api/ai/conversation/analyze
// @desc    Analyze conversation text with AI
// @access  Private (Sales roles)
router.post(
  '/analyze',
  hasPermission(PERMISSIONS.AI.CONVERSATION),
  analyzeConversationText
);

// @route   POST /api/ai/conversation/recommendations
// @desc    Generate follow-up recommendations
// @access  Private (Sales roles)
router.post(
  '/recommendations',
  hasPermission(PERMISSIONS.AI.CONVERSATION),
  getFollowUpRecommendations
);

// @route   POST /api/ai/conversation/bulk-analyze
// @desc    Bulk analyze conversations for multiple leads
// @access  Private (Management roles)
router.post(
  '/bulk-analyze',
  hasPermission(PERMISSIONS.AI.CONVERSATION),
  bulkAnalyzeConversations
);

// =============================================================================
// LEAD-SPECIFIC ANALYSIS ROUTES
// =============================================================================

// @route   GET /api/ai/leads/:id/interaction-patterns
// @desc    Analyze interaction patterns for a lead
// @access  Private (Sales roles)
router.get(
  '/leads/:id/interaction-patterns',
  hasPermission(PERMISSIONS.AI.CONVERSATION),
  getInteractionPatterns
);

// @route   GET /api/ai/leads/:id/conversation-summary
// @desc    Generate conversation summary for a lead
// @access  Private (Sales roles)
router.get(
  '/leads/:id/conversation-summary',
  hasPermission(PERMISSIONS.AI.CONVERSATION),
  getConversationSummary
);

// =============================================================================
// INTERACTION-SPECIFIC ANALYSIS ROUTES
// =============================================================================

// @route   GET /api/ai/interactions/:id/insights
// @desc    Get AI insights for a specific interaction
// @access  Private (Sales roles)
router.get(
  '/interactions/:id/insights',
  hasPermission(PERMISSIONS.AI.CONVERSATION),
  getInteractionInsights
);

export default router;
