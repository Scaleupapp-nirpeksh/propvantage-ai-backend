// File: controllers/aiController.js
// Description: Handles business logic related to AI-powered features.

import asyncHandler from 'express-async-handler';
import Lead from '../models/leadModel.js';
import { getSalesInsightsForLead } from '../services/openAIService.js';

/**
 * @desc    Generate sales insights for a specific lead
 * @route   GET /api/ai/leads/:id/insights
 * @access  Private (Requires authentication and role check)
 */
const generateLeadInsights = asyncHandler(async (req, res) => {
  // 1. Find the lead and ensure it belongs to the user's organization
  const lead = await Lead.findOne({
    _id: req.params.id,
    organization: req.user.organization,
  });

  if (!lead) {
    res.status(404);
    throw new Error('Lead not found');
  }

  // 2. Call the OpenAI service to get insights
  const insights = await getSalesInsightsForLead(lead);

  // 3. Send the AI-generated insights back to the client
  res.json({
    leadId: lead._id,
    insights,
  });
});

export { generateLeadInsights };
