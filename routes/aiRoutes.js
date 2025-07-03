// File: routes/aiRoutes.js
// Description: Defines the API routes for AI-powered features.

import express from 'express';
import { generateLeadInsights } from '../controllers/aiController.js';

// Import the security middleware
import { protect, authorize } from '../middleware/authMiddleware.js';

const router = express.Router();

// Apply the 'protect' middleware to all routes in this file
router.use(protect);

// Define roles that should have access to AI sales insights
const salesInsightAccess = [
  'Business Head',
  'Sales Head',
  'Project Director',
  'Sales Manager',
  'Sales Executive',
  'Channel Partner Manager',
  'Channel Partner Admin',
  'Channel Partner Agent',
];

// @route   GET /api/ai/leads/:id/insights
// @desc    Generate sales insights for a specific lead
// @access  Private
router.get(
  '/leads/:id/insights',
  authorize(...salesInsightAccess),
  generateLeadInsights
);

export default router;
