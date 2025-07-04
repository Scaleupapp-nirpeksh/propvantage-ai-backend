// File: controllers/aiConversationController.js
// Description: AI conversation analysis and insights controller
// Version: 1.0 - Complete conversation intelligence
// Location: controllers/aiConversationController.js

import asyncHandler from 'express-async-handler';
import {
  analyzeConversation,
  generateFollowUpRecommendations,
  analyzeInteractionPatterns,
  generateConversationSummary
} from '../services/aiConversationService.js';

// Import models
import Lead from '../models/leadModel.js';
import Interaction from '../models/interactionModel.js';

/**
 * @desc    Analyze a conversation text and provide AI insights
 * @route   POST /api/ai/conversation/analyze
 * @access  Private (Sales roles)
 */
const analyzeConversationText = asyncHandler(async (req, res) => {
  const { conversationText, leadId, context = {} } = req.body;

  if (!conversationText) {
    res.status(400);
    throw new Error('Conversation text is required');
  }

  try {
    // Get lead context if leadId provided
    let leadContext = {};
    if (leadId) {
      const lead = await Lead.findOne({
        _id: leadId,
        organization: req.user.organization
      }).populate('project', 'name');

      if (lead) {
        leadContext = {
          leadName: `${lead.firstName} ${lead.lastName || ''}`,
          projectName: lead.project?.name,
          budgetRange: lead.budget ? `₹${lead.budget.min || 0} - ₹${lead.budget.max || 0}` : 'Not specified',
          timeline: lead.requirements?.timeline || 'Not specified'
        };
      }
    }

    // Merge with provided context
    const fullContext = { ...leadContext, ...context };

    // Analyze conversation
    const analysis = await analyzeConversation(conversationText, fullContext);

    res.json({
      success: true,
      data: {
        analysis,
        context: fullContext,
        leadId
      },
      message: 'Conversation analyzed successfully'
    });

  } catch (error) {
    console.error('❌ Conversation analysis failed:', error);
    res.status(500);
    throw new Error(`Failed to analyze conversation: ${error.message}`);
  }
});

/**
 * @desc    Generate follow-up recommendations based on conversation analysis
 * @route   POST /api/ai/conversation/recommendations
 * @access  Private (Sales roles)
 */
const getFollowUpRecommendations = asyncHandler(async (req, res) => {
  const { leadId, analysis } = req.body;

  if (!analysis) {
    res.status(400);
    throw new Error('Conversation analysis is required');
  }

  try {
    let lead = null;
    let leadInfo = {
      id: leadId || 'demo',
      name: 'Demo Lead',
      status: 'New',
      project: 'Demo Project'
    };

    // Try to get lead data if leadId provided
    if (leadId) {
      try {
        lead = await Lead.findOne({
          _id: leadId,
          organization: req.user.organization
        }).populate('project', 'name location');

        if (lead) {
          leadInfo = {
            id: lead._id,
            name: `${lead.firstName} ${lead.lastName || ''}`,
            status: lead.status,
            project: lead.project?.name || 'Unknown Project'
          };
        } else {
          console.log('⚠️ Lead not found, using demo data for recommendations');
        }
      } catch (leadError) {
        console.log('⚠️ Error fetching lead, using demo data:', leadError.message);
      }
    }

    // Create demo lead data if no real lead found
    const leadData = lead || {
      _id: leadId || 'demo',
      firstName: 'Demo',
      lastName: 'Lead',
      status: 'Qualified',
      source: 'Website',
      budget: { min: 5000000, max: 8000000 },
      requirements: { timeline: 'Within 6 months' },
      project: { name: 'Demo Project' }
    };

    // Generate recommendations
    const recommendations = await generateFollowUpRecommendations(analysis, leadData);

    res.json({
      success: true,
      data: {
        recommendations,
        leadInfo,
        note: lead ? 'Based on actual lead data' : 'Generated with demo data - no lead found'
      },
      message: 'Follow-up recommendations generated successfully'
    });

  } catch (error) {
    console.error('❌ Follow-up recommendations failed:', error);
    res.status(500);
    throw new Error(`Failed to generate recommendations: ${error.message}`);
  }
});

/**
 * @desc    Analyze interaction patterns for a lead
 * @route   GET /api/ai/leads/:id/interaction-patterns
 * @access  Private (Sales roles)
 */
const getInteractionPatterns = asyncHandler(async (req, res) => {
  const { id: leadId } = req.params;

  try {
    // Verify lead exists and belongs to organization
    const lead = await Lead.findOne({
      _id: leadId,
      organization: req.user.organization
    });

    if (!lead) {
      res.status(404);
      throw new Error('Lead not found');
    }

    // Analyze interaction patterns
    const patterns = await analyzeInteractionPatterns(leadId);

    res.json({
      success: true,
      data: {
        leadId,
        leadName: `${lead.firstName} ${lead.lastName || ''}`,
        patterns
      },
      message: 'Interaction patterns analyzed successfully'
    });

  } catch (error) {
    console.error('❌ Interaction pattern analysis failed:', error);
    res.status(500);
    throw new Error(`Failed to analyze interaction patterns: ${error.message}`);
  }
});

/**
 * @desc    Generate conversation summary for a lead
 * @route   GET /api/ai/leads/:id/conversation-summary
 * @access  Private (Sales roles)
 */
const getConversationSummary = asyncHandler(async (req, res) => {
  const { id: leadId } = req.params;
  const { days = 30 } = req.query;

  try {
    // Verify lead exists and belongs to organization
    const lead = await Lead.findOne({
      _id: leadId,
      organization: req.user.organization
    }).populate('project', 'name');

    if (!lead) {
      res.status(404);
      throw new Error('Lead not found');
    }

    // Generate conversation summary
    const summary = await generateConversationSummary(leadId, parseInt(days));

    res.json({
      success: true,
      data: {
        leadId,
        leadInfo: {
          name: `${lead.firstName} ${lead.lastName || ''}`,
          project: lead.project?.name,
          currentStatus: lead.status
        },
        summary,
        period: `Last ${days} days`
      },
      message: 'Conversation summary generated successfully'
    });

  } catch (error) {
    console.error('❌ Conversation summary failed:', error);
    res.status(500);
    throw new Error(`Failed to generate conversation summary: ${error.message}`);
  }
});

/**
 * @desc    Get AI insights for a specific interaction
 * @route   GET /api/ai/interactions/:id/insights
 * @access  Private (Sales roles)
 */
const getInteractionInsights = asyncHandler(async (req, res) => {
  const { id: interactionId } = req.params;

  try {
    // Get interaction and verify access
    const interaction = await Interaction.findOne({
      _id: interactionId,
      organization: req.user.organization
    }).populate('lead', 'firstName lastName project')
      .populate('lead.project', 'name');

    if (!interaction) {
      res.status(404);
      throw new Error('Interaction not found');
    }

    // Prepare conversation text
    const conversationText = interaction.notes || interaction.summary || 'No conversation details available';
    
    // Prepare context
    const context = {
      leadName: `${interaction.lead.firstName} ${interaction.lead.lastName || ''}`,
      projectName: interaction.lead.project?.name,
      interactionType: interaction.type,
      outcome: interaction.outcome
    };

    // Analyze conversation
    const analysis = await analyzeConversation(conversationText, context);

    res.json({
      success: true,
      data: {
        interactionId,
        leadId: interaction.lead._id,
        analysis,
        interactionInfo: {
          type: interaction.type,
          date: interaction.createdAt,
          outcome: interaction.outcome,
          duration: interaction.duration
        }
      },
      message: 'Interaction insights generated successfully'
    });

  } catch (error) {
    console.error('❌ Interaction insights failed:', error);
    res.status(500);
    throw new Error(`Failed to generate interaction insights: ${error.message}`);
  }
});

/**
 * @desc    Bulk analyze conversations for multiple leads
 * @route   POST /api/ai/conversation/bulk-analyze
 * @access  Private (Management roles)
 */
const bulkAnalyzeConversations = asyncHandler(async (req, res) => {
  const { leadIds, days = 7 } = req.body;

  if (!leadIds || !Array.isArray(leadIds) || leadIds.length === 0) {
    res.status(400);
    throw new Error('Lead IDs array is required');
  }

  if (leadIds.length > 50) {
    res.status(400);
    throw new Error('Maximum 50 leads can be analyzed at once');
  }

  try {
    console.log(`🔄 Bulk analyzing conversations for ${leadIds.length} leads...`);

    // Verify all leads belong to organization
    const leads = await Lead.find({
      _id: { $in: leadIds },
      organization: req.user.organization
    }).populate('project', 'name');

    if (leads.length !== leadIds.length) {
      res.status(400);
      throw new Error('Some leads were not found or do not belong to your organization');
    }

    // Analyze conversations for each lead
    const results = await Promise.allSettled(
      leads.map(async (lead) => {
        try {
          const summary = await generateConversationSummary(lead._id, days);
          const patterns = await analyzeInteractionPatterns(lead._id);
          
          return {
            leadId: lead._id,
            leadName: `${lead.firstName} ${lead.lastName || ''}`,
            project: lead.project?.name,
            status: 'success',
            summary,
            patterns
          };
        } catch (error) {
          return {
            leadId: lead._id,
            leadName: `${lead.firstName} ${lead.lastName || ''}`,
            status: 'error',
            error: error.message
          };
        }
      })
    );

    // Separate successful and failed analyses
    const successful = results
      .filter(result => result.status === 'fulfilled' && result.value.status === 'success')
      .map(result => result.value);
    
    const failed = results
      .filter(result => result.status === 'rejected' || result.value.status === 'error')
      .map(result => result.status === 'rejected' ? result.reason : result.value);

    res.json({
      success: true,
      data: {
        analyzed: successful.length,
        failed: failed.length,
        results: successful,
        errors: failed,
        summary: {
          totalLeads: leadIds.length,
          successRate: `${((successful.length / leadIds.length) * 100).toFixed(1)}%`,
          analyzedPeriod: `Last ${days} days`
        }
      },
      message: `Bulk analysis completed: ${successful.length}/${leadIds.length} successful`
    });

  } catch (error) {
    console.error('❌ Bulk conversation analysis failed:', error);
    res.status(500);
    throw new Error(`Failed to perform bulk analysis: ${error.message}`);
  }
});

// Export all functions
export {
  analyzeConversationText,
  getFollowUpRecommendations,
  getInteractionPatterns,
  getConversationSummary,
  getInteractionInsights,
  bulkAnalyzeConversations
};