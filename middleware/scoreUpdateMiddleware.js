// File: middleware/scoreUpdateMiddleware.js
// Description: Middleware to automatically trigger lead score updates when relevant changes occur

import { updateLeadScore } from '../services/leadScoringService.js';
import Lead from '../models/leadModel.js';
import asyncHandler from 'express-async-handler';

/**
 * Middleware to automatically recalculate lead scores when lead data changes
 * This middleware should be called after lead creation or updates
 */
const autoUpdateLeadScore = asyncHandler(async (req, res, next) => {
  // Check if this is a lead-related operation
  if (req.originalUrl.includes('/api/leads') && (req.method === 'POST' || req.method === 'PUT')) {
    try {
      let leadId = null;
      
      // For POST requests (lead creation), get the lead ID from the response
      if (req.method === 'POST' && res.locals.createdLead) {
        leadId = res.locals.createdLead._id;
      }
      
      // For PUT requests (lead updates), get the lead ID from the URL
      if (req.method === 'PUT' && req.params.id) {
        leadId = req.params.id;
      }
      
      if (leadId) {
        // Check if the lead needs score recalculation
        const lead = await Lead.findById(leadId);
        
        if (lead && lead.needsScoreRecalculation()) {
          // Trigger score update asynchronously (don't block the response)
          setImmediate(async () => {
            try {
              await updateLeadScore(leadId);
              console.log(`✅ Lead score updated for lead ${leadId}`);
            } catch (error) {
              console.error(`❌ Failed to update lead score for lead ${leadId}:`, error.message);
            }
          });
        }
      }
    } catch (error) {
      console.error('Error in autoUpdateLeadScore middleware:', error.message);
      // Don't block the main request if score update fails
    }
  }
  
  next();
});

/**
 * Middleware to trigger score updates when interactions are created
 * This should be called after interaction creation
 */
const autoUpdateLeadScoreOnInteraction = asyncHandler(async (req, res, next) => {
  // Check if this is an interaction creation
  if (req.originalUrl.includes('/interactions') && req.method === 'POST') {
    try {
      let leadId = null;
      
      // Get lead ID from the URL parameter or request body
      if (req.params.id) {
        leadId = req.params.id; // From /api/leads/:id/interactions
      } else if (req.body.lead) {
        leadId = req.body.lead;
      }
      
      if (leadId) {
        // Update engagement metrics and trigger score recalculation
        setImmediate(async () => {
          try {
            const lead = await Lead.findById(leadId);
            if (lead) {
              await lead.updateEngagementMetrics();
              await lead.save();
              await updateLeadScore(leadId);
              console.log(`✅ Lead score updated after interaction for lead ${leadId}`);
            }
          } catch (error) {
            console.error(`❌ Failed to update lead score after interaction for lead ${leadId}:`, error.message);
          }
        });
      }
    } catch (error) {
      console.error('Error in autoUpdateLeadScoreOnInteraction middleware:', error.message);
    }
  }
  
  next();
});

/**
 * Middleware to handle bulk score updates during off-peak hours
 * This can be called periodically to update scores for stale leads
 */
const scheduledScoreUpdate = asyncHandler(async (req, res, next) => {
  // Only run during specific maintenance windows or when explicitly called
  if (req.query.runScheduledUpdate === 'true' && req.user.role === 'Business Head') {
    try {
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      
      // Find leads that haven't been scored in the last 7 days
      const staleLeads = await Lead.find({
        lastScoreUpdate: { $lt: sevenDaysAgo },
        status: { $nin: ['Booked', 'Lost', 'Unqualified'] }
      }).select('_id').limit(100); // Limit to avoid overwhelming the system
      
      if (staleLeads.length > 0) {
        console.log(`🔄 Updating scores for ${staleLeads.length} stale leads`);
        
        // Update scores in background
        setImmediate(async () => {
          try {
            const leadIds = staleLeads.map(lead => lead._id.toString());
            const { bulkUpdateLeadScores } = await import('../services/leadScoringService.js');
            const result = await bulkUpdateLeadScores(leadIds);
            console.log(`✅ Bulk score update completed: ${result.summary.successful} successful, ${result.summary.failed} failed`);
          } catch (error) {
            console.error('❌ Bulk score update failed:', error.message);
          }
        });
      }
    } catch (error) {
      console.error('Error in scheduledScoreUpdate middleware:', error.message);
    }
  }
  
  next();
});

/**
 * Middleware to validate score-related operations
 * Ensures that scoring operations are performed on valid leads
 */
const validateScoringOperation = asyncHandler(async (req, res, next) => {
  // Only validate scoring-specific routes
  if (req.originalUrl.includes('/score')) {
    try {
      const leadId = req.params.id;
      
      if (leadId) {
        const lead = await Lead.findOne({
          _id: leadId,
          organization: req.user.organization
        });
        
        if (!lead) {
          res.status(404);
          throw new Error('Lead not found or you do not have permission to access it');
        }
        
        // Check if lead is in a valid state for scoring
        if (lead.status === 'Booked' || lead.status === 'Lost') {
          res.status(400);
          throw new Error('Cannot update scores for booked or lost leads');
        }
        
        // Store lead in res.locals for use in controller
        res.locals.lead = lead;
      }
    } catch (error) {
      throw error;
    }
  }
  
  next();
});

/**
 * Middleware to log scoring operations for audit purposes
 */
const logScoringOperation = (req, res, next) => {
  if (req.originalUrl.includes('/score')) {
    const operation = req.method;
    const endpoint = req.originalUrl;
    const userId = req.user._id;
    const userRole = req.user.role;
    
    console.log(`📊 Scoring Operation: ${operation} ${endpoint} by user ${userId} (${userRole})`);
  }
  
  next();
};

/**
 * Middleware to handle score update errors gracefully
 * This wraps async operations and provides consistent error handling
 */
const handleScoringErrors = (err, req, res, next) => {
  if (req.originalUrl.includes('/score')) {
    console.error('Scoring operation error:', err.message);
    
    // Provide user-friendly error messages
    if (err.message.includes('Lead not found')) {
      res.status(404).json({
        success: false,
        message: 'Lead not found or you do not have permission to access it'
      });
    } else if (err.message.includes('Failed to calculate')) {
      res.status(500).json({
        success: false,
        message: 'Unable to calculate lead score at this time. Please try again later.'
      });
    } else if (err.message.includes('Permission denied')) {
      res.status(403).json({
        success: false,
        message: 'You do not have permission to perform this scoring operation'
      });
    } else {
      res.status(500).json({
        success: false,
        message: 'An error occurred while processing the scoring operation'
      });
    }
  } else {
    next(err);
  }
};

/**
 * Middleware to add score-related response headers
 * Provides additional context about scoring operations
 */
const addScoringHeaders = (req, res, next) => {
  if (req.originalUrl.includes('/score')) {
    res.setHeader('X-Scoring-Version', '1.0');
    res.setHeader('X-Scoring-Timestamp', new Date().toISOString());
    res.setHeader('X-Scoring-User', req.user._id);
  }
  
  next();
};

export {
  autoUpdateLeadScore,
  autoUpdateLeadScoreOnInteraction,
  scheduledScoreUpdate,
  validateScoringOperation,
  logScoringOperation,
  handleScoringErrors,
  addScoringHeaders
};