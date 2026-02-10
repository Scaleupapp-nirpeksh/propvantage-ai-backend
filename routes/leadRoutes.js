// File: routes/leadRoutes.js
// Description: Lead management routes with permission-based authorization

import express from 'express';
import {
  createLead,
  getLeads,
  getLeadById,
  updateLead,
  addInteractionToLead,
  getLeadInteractions,
  deleteLead
} from '../controllers/leadController.js';
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
import { protect, hasPermission } from '../middleware/authMiddleware.js';
import { PERMISSIONS } from '../config/permissions.js';

const router = express.Router();

router.use(protect);

// =============================================================================
// CORE LEAD MANAGEMENT
// =============================================================================

router.route('/')
  .post(hasPermission(PERMISSIONS.LEADS.CREATE), createLead)
  .get(hasPermission(PERMISSIONS.LEADS.VIEW), getLeads);

router.route('/:id')
  .get(hasPermission(PERMISSIONS.LEADS.VIEW), getLeadById)
  .put(hasPermission(PERMISSIONS.LEADS.UPDATE), updateLead)
  .delete(hasPermission(PERMISSIONS.LEADS.DELETE), deleteLead);

router.route('/:id/interactions')
  .post(hasPermission(PERMISSIONS.LEADS.UPDATE), addInteractionToLead)
  .get(hasPermission(PERMISSIONS.LEADS.VIEW), getLeadInteractions);

// =============================================================================
// LEAD SCORING
// =============================================================================

router.get('/:id/score', hasPermission(PERMISSIONS.LEADS.SCORING_VIEW), getLeadScore);
router.put('/:id/recalculate-score', hasPermission(PERMISSIONS.LEADS.SCORING_VIEW), recalculateLeadScore);
router.get('/:id/score-history', hasPermission(PERMISSIONS.LEADS.SCORING_VIEW), getLeadScoreHistory);

router.get('/high-priority', hasPermission(PERMISSIONS.LEADS.VIEW), getHighPriorityLeads);
router.get('/needs-attention', hasPermission(PERMISSIONS.LEADS.VIEW), getLeadsNeedingAttention);
router.get('/score-analytics', hasPermission(PERMISSIONS.LEADS.SCORING_VIEW), getScoreAnalytics);
router.post('/bulk-recalculate-scores', hasPermission(PERMISSIONS.LEADS.BULK_OPERATIONS), bulkRecalculateScores);

router.route('/scoring-config')
  .get(hasPermission(PERMISSIONS.LEADS.SCORING_VIEW), getScoringConfig)
  .put(hasPermission(PERMISSIONS.LEADS.SCORING_CONFIG), updateScoringConfig);

// =============================================================================
// SIMPLE PLACEHOLDER ROUTES
// =============================================================================

router.get('/simple-stats', hasPermission(PERMISSIONS.LEADS.VIEW), async (req, res) => {
  try {
    const { default: Lead } = await import('../models/leadModel.js');
    const query = { organization: req.user.organization };

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
        conversionRate: totalLeads > 0
          ? ((qualifiedLeads / totalLeads) * 100).toFixed(2)
          : 0
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

router.get('/by-priority/:priority', hasPermission(PERMISSIONS.LEADS.VIEW), async (req, res) => {
  try {
    const { priority } = req.params;
    const { limit = 20 } = req.query;
    const { default: Lead } = await import('../models/leadModel.js');

    const validPriorities = ['Critical', 'High', 'Medium', 'Low', 'Very Low'];
    if (!validPriorities.includes(priority)) {
      return res.status(400).json({ success: false, message: 'Invalid priority level' });
    }

    const query = {
      organization: req.user.organization,
      priority,
      status: { $nin: ['Booked', 'Lost', 'Unqualified'] }
    };

    const leads = await Lead.find(query)
      .populate('project', 'name')
      .populate('assignedTo', 'firstName lastName')
      .sort({ score: -1 })
      .limit(parseInt(limit))
      .select('firstName lastName phone email score scoreGrade priority status');

    res.json({ success: true, data: { priority, count: leads.length, leads } });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error fetching leads by priority', error: error.message });
  }
});

router.get('/simple-overdue-followups', hasPermission(PERMISSIONS.LEADS.VIEW), async (req, res) => {
  try {
    const { default: Lead } = await import('../models/leadModel.js');
    const now = new Date();
    const query = {
      organization: req.user.organization,
      'followUpSchedule.nextFollowUpDate': { $lt: now },
      status: { $nin: ['Booked', 'Lost', 'Unqualified'] }
    };

    const overdueLeads = await Lead.find(query)
      .populate('assignedTo', 'firstName lastName')
      .populate('project', 'name')
      .sort({ 'followUpSchedule.nextFollowUpDate': 1 })
      .limit(50)
      .select('firstName lastName phone email score priority followUpSchedule assignedTo project');

    const leadsWithOverdueDays = overdueLeads.map((lead) => {
      const overdueDays = lead.followUpSchedule?.nextFollowUpDate
        ? Math.floor((now - new Date(lead.followUpSchedule.nextFollowUpDate)) / (1000 * 60 * 60 * 24))
        : 0;
      return {
        ...lead.toObject(),
        overdueDays,
        urgencyLevel: overdueDays > 7 ? 'Critical' : overdueDays > 3 ? 'High' : 'Medium'
      };
    });

    res.json({ success: true, data: { count: leadsWithOverdueDays.length, leads: leadsWithOverdueDays } });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error fetching overdue follow-ups', error: error.message });
  }
});

// Health check
router.get('/scoring-health', (req, res) => {
  res.json({
    success: true,
    availableFunctions: {
      getLeadScore: true, recalculateLeadScore: true,
      getHighPriorityLeads: true, getLeadsNeedingAttention: true,
      getScoreAnalytics: true, bulkRecalculateScores: true,
      getLeadScoreHistory: true, getScoringConfig: true,
      updateScoringConfig: true,
    },
    message: 'Lead scoring system available.'
  });
});

export default router;
