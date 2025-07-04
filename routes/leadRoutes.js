// File: routes/leadRoutes.js
// Description: Compatible Lead Routes - only imports existing functions
// Version: 1.5 - Compatible with current controller structure
// Location: routes/leadRoutes.js

import express from 'express';

// EXISTING: Import only available functions from leadController
import {
  createLead,
  getLeads,
  getLeadById,
  updateLead,
  addInteractionToLead,
  getLeadInteractions,
  // Add other existing functions if available
  // assignLead,                    // Add if exists
  // bulkUpdateLeads,              // Add if exists
  // getLeadStats,                 // Add if exists
  // deleteLead                    // Add if exists
} from '../controllers/leadController.js';

// EXISTING: Import only available functions from leadScoringController
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
  // NOT YET AVAILABLE: getLeadsByPriority, getOverdueFollowUps, getAIInsights
} from '../controllers/leadScoringController.js';

// Import authentication middleware (when available)
// import { protect, authorize } from '../middleware/authMiddleware.js';

const router = express.Router();

// =============================================================================
// EXISTING ROUTES - CORE LEAD MANAGEMENT
// =============================================================================

// Route for creating a lead and getting all leads
router.route('/')
  .post(createLead)               // EXISTING: Create new lead
  .get(getLeads);                // EXISTING: Get all leads

// Route for getting a single lead and updating it
router.route('/:id')
  .get(getLeadById)              // EXISTING: Get lead details
  .put(updateLead);              // EXISTING: Update lead
  // .delete(deleteLead);         // ADD: When deleteLead is available

// Route for adding and getting interactions for a specific lead
router.route('/:id/interactions')
  .post(addInteractionToLead)    // EXISTING: Add interaction
  .get(getLeadInteractions);     // EXISTING: Get interactions

// =============================================================================
// ENHANCED ROUTES - EXISTING LEAD SCORING FUNCTIONALITY
// =============================================================================

// Lead scoring routes (existing functions)
router.route('/:id/score')
  .get(getLeadScore);            // EXISTING: Get detailed lead score

router.route('/:id/recalculate-score')
  .put(recalculateLeadScore);    // EXISTING: Recalculate lead score

router.route('/:id/score-history')
  .get(getLeadScoreHistory);     // EXISTING: Get score history

// Priority and analytics routes (existing functions)
router.route('/high-priority')
  .get(getHighPriorityLeads);    // EXISTING: Get high-priority leads

router.route('/needs-attention')
  .get(getLeadsNeedingAttention); // EXISTING: Get leads needing attention

router.route('/score-analytics')
  .get(getScoreAnalytics);       // EXISTING: Get score analytics

// Bulk operations (existing functions)
router.route('/bulk-recalculate-scores')
  .post(bulkRecalculateScores);  // EXISTING: Bulk recalculate scores

// Configuration routes (existing functions)
router.route('/scoring-config')
  .get(getScoringConfig)         // EXISTING: Get scoring config
  .put(updateScoringConfig);     // EXISTING: Update scoring config

// =============================================================================
// ADDITIONAL ROUTES - ADD WHEN FUNCTIONS BECOME AVAILABLE
// =============================================================================

// Lead management routes (add when functions are available)
// router.route('/:id/assign')
//   .put(assignLead);              // ADD: When assignLead is available

// router.route('/bulk-update')
//   .put(bulkUpdateLeads);         // ADD: When bulkUpdateLeads is available

// router.route('/stats')
//   .get(getLeadStats);            // ADD: When getLeadStats is available

// Advanced AI routes (add when functions are available)
// router.route('/priority/:priority')
//   .get(getLeadsByPriority);      // ADD: When getLeadsByPriority is available

// router.route('/overdue-followups')
//   .get(getOverdueFollowUps);     // ADD: When getOverdueFollowUps is available

// router.route('/:id/ai-insights')
//   .get(getAIInsights);           // ADD: When getAIInsights is available

// =============================================================================
// SIMPLE PLACEHOLDER ROUTES - FOR IMMEDIATE FUNCTIONALITY
// =============================================================================

// Simple lead statistics endpoint (basic implementation)
router.route('/simple-stats')
  .get(async (req, res) => {
    try {
      // Import Lead model dynamically to avoid circular deps
      const { default: Lead } = await import('../models/leadModel.js');
      
      const query = { organization: req.user?.organization || 'test' };
      
      // Basic stats calculation
      const totalLeads = await Lead.countDocuments(query);
      const highPriorityLeads = await Lead.countDocuments({ 
        ...query, 
        priority: { $in: ['High', 'Critical'] } 
      });
      const qualifiedLeads = await Lead.countDocuments({ 
        ...query, 
        qualificationStatus: { $in: ['Qualified', 'Pre-Approved'] } 
      });
      
      res.json({
        success: true,
        data: {
          totalLeads,
          highPriorityLeads,
          qualifiedLeads,
          conversionRate: totalLeads > 0 ? 
            ((qualifiedLeads / totalLeads) * 100).toFixed(2) : 0
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Error calculating lead statistics',
        error: error.message
      });
    }
  });

// Simple priority filter endpoint
router.route('/by-priority/:priority')
  .get(async (req, res) => {
    try {
      const { priority } = req.params;
      const { limit = 20 } = req.query;
      
      // Import Lead model dynamically
      const { default: Lead } = await import('../models/leadModel.js');
      
      const validPriorities = ['Critical', 'High', 'Medium', 'Low', 'Very Low'];
      if (!validPriorities.includes(priority)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid priority level'
        });
      }
      
      const query = {
        organization: req.user?.organization || 'test',
        priority,
        status: { $nin: ['Booked', 'Lost', 'Unqualified'] }
      };
      
      const leads = await Lead.find(query)
        .populate('project', 'name')
        .populate('assignedTo', 'firstName lastName')
        .sort({ score: -1 })
        .limit(parseInt(limit))
        .select('firstName lastName phone email score scoreGrade priority status');
      
      res.json({
        success: true,
        data: {
          priority,
          count: leads.length,
          leads
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Error fetching leads by priority',
        error: error.message
      });
    }
  });

// Simple overdue follow-ups endpoint
router.route('/simple-overdue-followups')
  .get(async (req, res) => {
    try {
      // Import Lead model dynamically
      const { default: Lead } = await import('../models/leadModel.js');
      
      const now = new Date();
      const query = {
        organization: req.user?.organization || 'test',
        'followUpSchedule.nextFollowUpDate': { $lt: now },
        status: { $nin: ['Booked', 'Lost', 'Unqualified'] }
      };
      
      const overdueLeads = await Lead.find(query)
        .populate('assignedTo', 'firstName lastName')
        .populate('project', 'name')
        .sort({ 'followUpSchedule.nextFollowUpDate': 1 })
        .limit(50)
        .select('firstName lastName phone email score priority followUpSchedule assignedTo project');
      
      // Calculate overdue days
      const leadsWithOverdueDays = overdueLeads.map(lead => {
        const overdueDays = lead.followUpSchedule?.nextFollowUpDate ? 
          Math.floor((now - new Date(lead.followUpSchedule.nextFollowUpDate)) / (1000 * 60 * 60 * 24)) : 0;
        
        return {
          ...lead.toObject(),
          overdueDays,
          urgencyLevel: overdueDays > 7 ? 'Critical' : 
                       overdueDays > 3 ? 'High' : 'Medium'
        };
      });
      
      res.json({
        success: true,
        data: {
          count: leadsWithOverdueDays.length,
          leads: leadsWithOverdueDays
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Error fetching overdue follow-ups',
        error: error.message
      });
    }
  });

// =============================================================================
// HEALTH CHECK ROUTES
// =============================================================================

// Route to check which lead scoring functions are available
router.route('/scoring-health')
  .get((req, res) => {
    res.json({
      success: true,
      availableFunctions: {
        // Core scoring functions
        getLeadScore: true,
        recalculateLeadScore: true,
        getHighPriorityLeads: true,
        getLeadsNeedingAttention: true,
        getScoreAnalytics: true,
        bulkRecalculateScores: true,
        getLeadScoreHistory: true,
        getScoringConfig: true,
        updateScoringConfig: true,
        
        // Not yet implemented
        getLeadsByPriority: false,
        getOverdueFollowUps: false,
        getAIInsights: false,
        assignLead: false,
        bulkUpdateLeads: false,
        getLeadStats: false
      },
      simpleFunctions: {
        simpleStats: true,
        byPriority: true,
        simpleOverdueFollowups: true
      },
      message: 'Lead scoring system partially available. Core functions working.'
    });
  });

export default router;