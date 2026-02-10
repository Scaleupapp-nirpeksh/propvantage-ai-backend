// File: routes/aiRoutes.js
// Description: Defines the API routes for AI-powered features.

import express from 'express';
import { generateLeadInsights } from '../controllers/aiController.js';

// Import the security middleware
import { protect, hasPermission } from '../middleware/authMiddleware.js';
import { PERMISSIONS } from '../config/permissions.js';

const router = express.Router();

// Apply the 'protect' middleware to all routes in this file
router.use(protect);

// @route   GET /api/ai/leads/:id/insights
// @desc    Generate sales insights for a specific lead
// @access  Private
router.get(
  '/leads/:id/insights',
  hasPermission(PERMISSIONS.AI.INSIGHTS),
  generateLeadInsights
);

export default router;
