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
import { protect, authorize } from '../middleware/authMiddleware.js';

const router = express.Router();

// Apply authentication to all routes
router.use(protect);

// Define role-based access control groups
const salesRoles = [
  'Business Head',
  'Project Director',
  'Sales Head',
  'Marketing Head',
  'Sales Manager',
  'Sales Executive',
  'Channel Partner Manager',
  'Channel Partner Admin',
  'Channel Partner Agent'
];

const managementRoles = [
  'Business Head',
  'Project Director',
  'Sales Head',
  'Marketing Head',
  'Sales Manager',
  'Finance Head',
  'Channel Partner Manager'
];

// =============================================================================
// CONVERSATION ANALYSIS ROUTES
// =============================================================================

// @route   POST /api/ai/conversation/analyze
// @desc    Analyze conversation text with AI
// @access  Private (Sales roles)
router.post(
  '/analyze',
  authorize(...salesRoles),
  analyzeConversationText
);

// @route   POST /api/ai/conversation/recommendations
// @desc    Generate follow-up recommendations
// @access  Private (Sales roles)
router.post(
  '/recommendations',
  authorize(...salesRoles),
  getFollowUpRecommendations
);

// @route   POST /api/ai/conversation/bulk-analyze
// @desc    Bulk analyze conversations for multiple leads
// @access  Private (Management roles)
router.post(
  '/bulk-analyze',
  authorize(...managementRoles),
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
  authorize(...salesRoles),
  getInteractionPatterns
);

// @route   GET /api/ai/leads/:id/conversation-summary
// @desc    Generate conversation summary for a lead
// @access  Private (Sales roles)
router.get(
  '/leads/:id/conversation-summary',
  authorize(...salesRoles),
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
  authorize(...salesRoles),
  getInteractionInsights
);

export default router;