// File: services/leadScoringService.js
// Description: FIXED Lead Scoring Service - Compatible with current Lead model
// Version: 1.6 - Debugging and compatibility fixes
// Location: services/leadScoringService.js

import mongoose from 'mongoose';
import { derivePriorityFromTimeline } from '../utils/leadPriority.js';

// FIXED: Use dynamic imports to avoid circular dependency issues
let Lead, Interaction, Sale, Unit, Project;

const initializeModels = async () => {
  if (!Lead) {
    try {
      const { default: LeadModel } = await import('../models/leadModel.js');
      const { default: InteractionModel } = await import('../models/interactionModel.js');
      const { default: UnitModel } = await import('../models/unitModel.js');
      
      Lead = LeadModel;
      Interaction = InteractionModel;
      Unit = UnitModel;
      
      console.log('✅ Models initialized successfully');
    } catch (error) {
      console.error('❌ Failed to initialize models:', error.message);
      throw error;
    }
  }
};

/**
 * SIMPLIFIED: Default scoring configuration - keeping it simple for debugging
 */
const DEFAULT_SCORING_CONFIG = {
  budgetAlignment: {
    weight: 0.25,
    rules: {
      exactMatch: 100,
      within10Percent: 85,
      within20Percent: 70,
      within30Percent: 50,
      below30Percent: 20,
      noBudget: 40
    }
  },
  
  engagementLevel: {
    weight: 0.20,
    rules: {
      highEngagement: 100,
      mediumEngagement: 75,
      lowEngagement: 50,
      noEngagement: 10
    }
  },
  
  timelineUrgency: {
    weight: 0.40,
    rules: {
      immediate: 100,
      within3Months: 85,
      within6Months: 65,
      within12Months: 45,
      longTerm: 25,
      noTimeline: 35
    }
  },
  
  sourceQuality: {
    weight: 0.10,
    // 2026-06 refactor: keyed to the 6 new lead sources.
    rules: {
      referral: 100,
      channelPartner: 85,
      management: 80,
      direct: 70,
      marketing: 55,
      coldCalling: 30,
      other: 40
    }
  },
  
  recencyFactor: {
    weight: 0.05,
    rules: {
      within24Hours: 100,
      within7Days: 85,
      within30Days: 70,
      within90Days: 50,
      older: 25
    }
  }
};

/**
 * FIXED: Main scoring function with comprehensive error handling
 * @param {Object} lead - Lead object
 * @param {Object} config - Scoring configuration
 * @returns {Object} Score calculation result
 */
const calculateLeadScore = async (lead, config = DEFAULT_SCORING_CONFIG) => {
  try {
    console.log(`🔄 Calculating score for lead: ${lead.firstName} ${lead.lastName || ''} (ID: ${lead._id})`);
    
    // CRITICAL FIX: Ensure config is never null/undefined
    if (!config || typeof config !== 'object') {
      console.log('⚠️ Config is null/undefined, using DEFAULT_SCORING_CONFIG');
      config = DEFAULT_SCORING_CONFIG;
    }
    
    // Ensure all config sections exist
    if (!config.budgetAlignment) config.budgetAlignment = DEFAULT_SCORING_CONFIG.budgetAlignment;
    if (!config.engagementLevel) config.engagementLevel = DEFAULT_SCORING_CONFIG.engagementLevel;
    if (!config.timelineUrgency) config.timelineUrgency = DEFAULT_SCORING_CONFIG.timelineUrgency;
    if (!config.sourceQuality) config.sourceQuality = DEFAULT_SCORING_CONFIG.sourceQuality;
    if (!config.recencyFactor) config.recencyFactor = DEFAULT_SCORING_CONFIG.recencyFactor;
    
    console.log('🔧 Using config:', {
      hasBudgetAlignment: !!config.budgetAlignment,
      hasEngagementLevel: !!config.engagementLevel,
      hasTimelineUrgency: !!config.timelineUrgency,
      hasSourceQuality: !!config.sourceQuality,
      hasRecencyFactor: !!config.recencyFactor
    });
    
    // DEBUGGING: Log lead structure
    console.log('📋 Lead data structure:', {
      id: lead._id,
      budget: lead.budget,
      requirements: lead.requirements,
      source: lead.source,
      createdAt: lead.createdAt,
      hasProject: !!lead.project
    });

    await initializeModels();
    
    // Initialize scoreBreakdown properly
    const scoreBreakdown = {
      budgetAlignment: null,
      engagementLevel: null,
      timelineUrgency: null,
      sourceQuality: null,
      recencyFactor: null
    };
    
    let totalScore = 0;
    
    // 1. Budget Alignment Score with error handling
    try {
      console.log('💰 Calculating budget alignment...');
      const budgetScore = await calculateBudgetAlignmentScore(lead, config.budgetAlignment);
      console.log('💰 Budget score result:', budgetScore);
      scoreBreakdown.budgetAlignment = budgetScore;
      totalScore += budgetScore.weightedScore || 0;
    } catch (budgetError) {
      console.error('❌ Budget calculation error:', budgetError.message);
      scoreBreakdown.budgetAlignment = {
        rawScore: config.budgetAlignment.rules.noBudget,
        weightedScore: config.budgetAlignment.rules.noBudget * config.budgetAlignment.weight,
        reasoning: 'Error calculating budget alignment',
        error: budgetError.message
      };
      totalScore += scoreBreakdown.budgetAlignment.weightedScore;
    }
    
    // 2. Engagement Level Score with error handling
    try {
      console.log('📞 Calculating engagement level...');
      const engagementScore = await calculateEngagementScore(lead, config.engagementLevel);
      console.log('📞 Engagement score result:', engagementScore);
      scoreBreakdown.engagementLevel = engagementScore;
      totalScore += engagementScore.weightedScore || 0;
    } catch (engagementError) {
      console.error('❌ Engagement calculation error:', engagementError.message);
      scoreBreakdown.engagementLevel = {
        rawScore: config.engagementLevel.rules.noEngagement,
        weightedScore: config.engagementLevel.rules.noEngagement * config.engagementLevel.weight,
        reasoning: 'Error calculating engagement',
        error: engagementError.message
      };
      totalScore += scoreBreakdown.engagementLevel.weightedScore;
    }
    
    // 3. Timeline Urgency Score with error handling
    try {
      console.log('⏰ Calculating timeline urgency...');
      const timelineScore = calculateTimelineScore(lead, config.timelineUrgency);
      console.log('⏰ Timeline score result:', timelineScore);
      scoreBreakdown.timelineUrgency = timelineScore;
      totalScore += timelineScore.weightedScore || 0;
    } catch (timelineError) {
      console.error('❌ Timeline calculation error:', timelineError.message);
      scoreBreakdown.timelineUrgency = {
        rawScore: config.timelineUrgency.rules.noTimeline,
        weightedScore: config.timelineUrgency.rules.noTimeline * config.timelineUrgency.weight,
        reasoning: 'Error calculating timeline',
        error: timelineError.message
      };
      totalScore += scoreBreakdown.timelineUrgency.weightedScore;
    }
    
    // 4. Source Quality Score with error handling
    try {
      console.log('📍 Calculating source quality...');
      const sourceScore = calculateSourceScore(lead, config.sourceQuality);
      console.log('📍 Source score result:', sourceScore);
      scoreBreakdown.sourceQuality = sourceScore;
      totalScore += sourceScore.weightedScore || 0;
    } catch (sourceError) {
      console.error('❌ Source calculation error:', sourceError.message);
      scoreBreakdown.sourceQuality = {
        rawScore: config.sourceQuality.rules.other,
        weightedScore: config.sourceQuality.rules.other * config.sourceQuality.weight,
        reasoning: 'Error calculating source quality',
        error: sourceError.message
      };
      totalScore += scoreBreakdown.sourceQuality.weightedScore;
    }
    
    // 5. Recency Factor Score with error handling
    try {
      console.log('📅 Calculating recency factor...');
      const recencyScore = calculateRecencyScore(lead, config.recencyFactor);
      console.log('📅 Recency score result:', recencyScore);
      scoreBreakdown.recencyFactor = recencyScore;
      totalScore += recencyScore.weightedScore || 0;
    } catch (recencyError) {
      console.error('❌ Recency calculation error:', recencyError.message);
      scoreBreakdown.recencyFactor = {
        rawScore: config.recencyFactor.rules.older,
        weightedScore: config.recencyFactor.rules.older * config.recencyFactor.weight,
        reasoning: 'Error calculating recency',
        error: recencyError.message
      };
      totalScore += scoreBreakdown.recencyFactor.weightedScore;
    }
    
    // Ensure score is valid
    totalScore = Math.max(0, Math.min(100, Math.round(totalScore * 100) / 100));
    
    const result = {
      totalScore,
      breakdown: scoreBreakdown,
      grade: getScoreGrade(totalScore),
      priority: getLeadPriority(totalScore),
      confidence: 75, // Fixed confidence for now
      calculatedAt: new Date()
    };
    
    console.log(`✅ Score calculated successfully: ${totalScore} (Grade: ${result.grade})`);
    return result;
    
  } catch (error) {
    console.error(`❌ Score calculation failed for lead ${lead._id}:`, error);
    console.error('❌ Error stack:', error.stack);
    
    // Return fallback score
    return {
      totalScore: 25,
      breakdown: {
        budgetAlignment: { rawScore: 25, weightedScore: 7.5, reasoning: 'Calculation failed', error: error.message },
        engagementLevel: { rawScore: 25, weightedScore: 6.25, reasoning: 'Calculation failed', error: error.message },
        timelineUrgency: { rawScore: 25, weightedScore: 5, reasoning: 'Calculation failed', error: error.message },
        sourceQuality: { rawScore: 25, weightedScore: 3.75, reasoning: 'Calculation failed', error: error.message },
        recencyFactor: { rawScore: 25, weightedScore: 2.5, reasoning: 'Calculation failed', error: error.message }
      },
      grade: 'D',
      priority: 'Very Low',
      confidence: 30,
      calculatedAt: new Date(),
      error: error.message
    };
  }
};

/**
 * SIMPLIFIED: Budget alignment calculation
 */
const calculateBudgetAlignmentScore = async (lead, config) => {
  try {
    console.log('💰 Budget data:', lead.budget);
    
    // Check if budget exists and has valid data
    if (!lead.budget || (typeof lead.budget !== 'object')) {
      console.log('💰 No budget object found');
      return {
        rawScore: config.rules.noBudget,
        weightedScore: config.rules.noBudget * config.weight,
        reasoning: 'No budget specified',
        budgetRange: 'Not specified'
      };
    }
    
    const { min, max } = lead.budget;
    
    if (!min && !max) {
      console.log('💰 No budget min/max values');
      return {
        rawScore: config.rules.noBudget,
        weightedScore: config.rules.noBudget * config.weight,
        reasoning: 'No budget amounts specified',
        budgetRange: 'Not specified'
      };
    }
    
    // Get average unit price for comparison
    const avgUnitPrice = await getAverageUnitPrice(lead.project);
    console.log('💰 Average unit price:', avgUnitPrice);
    
    if (!avgUnitPrice) {
      return {
        rawScore: config.rules.noBudget,
        weightedScore: config.rules.noBudget * config.weight,
        reasoning: 'Project unit prices not available',
        budgetRange: formatBudgetRange(min, max)
      };
    }
    
    const budgetMax = max || min;
    const budgetMin = min || max;
    
    let alignmentScore;
    let reasoning;
    
    // Simple alignment check
    if (budgetMin <= avgUnitPrice && avgUnitPrice <= budgetMax) {
      alignmentScore = config.rules.exactMatch;
      reasoning = 'Budget range includes unit price';
    } else {
      const deviation = Math.abs(avgUnitPrice - budgetMax) / avgUnitPrice;
      
      if (deviation <= 0.10) {
        alignmentScore = config.rules.within10Percent;
        reasoning = 'Budget within 10% of unit price';
      } else if (deviation <= 0.20) {
        alignmentScore = config.rules.within20Percent;
        reasoning = 'Budget within 20% of unit price';
      } else if (deviation <= 0.30) {
        alignmentScore = config.rules.within30Percent;
        reasoning = 'Budget within 30% of unit price';
      } else {
        alignmentScore = config.rules.below30Percent;
        reasoning = 'Budget significantly different from unit price';
      }
    }
    
    return {
      rawScore: alignmentScore,
      weightedScore: alignmentScore * config.weight,
      reasoning,
      budgetRange: formatBudgetRange(budgetMin, budgetMax),
      avgUnitPrice: `₹${(avgUnitPrice / 10000000).toFixed(2)} Cr`
    };
    
  } catch (error) {
    console.error('💰 Budget calculation error:', error);
    throw error;
  }
};

/**
 * SIMPLIFIED: Engagement calculation
 */
const calculateEngagementScore = async (lead, config) => {
  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    // Count interactions in last 30 days
    const interactionCount = await Interaction.countDocuments({
      lead: lead._id,
      createdAt: { $gte: thirtyDaysAgo }
    });
    
    console.log('📞 Interaction count:', interactionCount);
    
    let engagementScore;
    let reasoning;
    
    if (interactionCount >= 5) {
      engagementScore = config.rules.highEngagement;
      reasoning = `High engagement: ${interactionCount} interactions`;
    } else if (interactionCount >= 3) {
      engagementScore = config.rules.mediumEngagement;
      reasoning = `Medium engagement: ${interactionCount} interactions`;
    } else if (interactionCount >= 1) {
      engagementScore = config.rules.lowEngagement;
      reasoning = `Low engagement: ${interactionCount} interactions`;
    } else {
      engagementScore = config.rules.noEngagement;
      reasoning = 'No recent interactions';
    }
    
    return {
      rawScore: engagementScore,
      weightedScore: engagementScore * config.weight,
      reasoning,
      interactionCount
    };
    
  } catch (error) {
    console.error('📞 Engagement calculation error:', error);
    throw error;
  }
};

/**
 * SIMPLIFIED: Timeline calculation
 */
const calculateTimelineScore = (lead, config) => {
  try {
    // Check different possible timeline fields
    const timeline = lead.requirements?.timeline || lead.timeline || lead.purchaseTimeline;
    
    console.log('⏰ Timeline data:', timeline);
    
    if (!timeline) {
      return {
        rawScore: config.rules.noTimeline,
        weightedScore: config.rules.noTimeline * config.weight,
        reasoning: 'No timeline specified',
        timeline: 'Not specified'
      };
    }
    
    let timelineScore;
    let reasoning;
    
    const timelineLower = timeline.toLowerCase();
    
    if (timelineLower.includes('immediate') || timeline === 'immediate') {
      timelineScore = config.rules.immediate;
      reasoning = 'Immediate purchase intent';
    } else if (timelineLower.includes('1-3') || timeline === '1-3_months') {
      timelineScore = config.rules.within3Months;
      reasoning = 'Short-term timeline (1-3 months)';
    } else if (timelineLower.includes('3-6') || timeline === '3-6_months') {
      timelineScore = config.rules.within6Months;
      reasoning = 'Medium-term timeline (3-6 months)';
    } else if (timelineLower.includes('6-12') || timeline === '6-12_months') {
      timelineScore = config.rules.within12Months;
      reasoning = 'Long-term timeline (6-12 months)';
    } else {
      timelineScore = config.rules.longTerm;
      reasoning = 'Very long-term timeline';
    }
    
    return {
      rawScore: timelineScore,
      weightedScore: timelineScore * config.weight,
      reasoning,
      timeline
    };
    
  } catch (error) {
    console.error('⏰ Timeline calculation error:', error);
    throw error;
  }
};

/**
 * SIMPLIFIED: Source calculation
 */
const calculateSourceScore = (lead, config) => {
  try {
    const source = lead.source || 'Other';
    console.log('📍 Source data:', source);
    
    const sourceLower = source.toLowerCase();

    // 2026-06 refactor: map the 6 new lead sources to their quality tier.
    let sourceScore;
    if (sourceLower.includes('referral')) {
      sourceScore = config.rules.referral;
    } else if (sourceLower.includes('channel')) {
      sourceScore = config.rules.channelPartner;
    } else if (sourceLower.includes('management')) {
      sourceScore = config.rules.management;
    } else if (sourceLower.includes('marketing')) {
      sourceScore = config.rules.marketing;
    } else if (sourceLower.includes('cold')) {
      sourceScore = config.rules.coldCalling;
    } else if (sourceLower.includes('direct')) {
      sourceScore = config.rules.direct;
    } else {
      sourceScore = config.rules.other;
    }
    
    return {
      rawScore: sourceScore,
      weightedScore: sourceScore * config.weight,
      reasoning: `Source: ${source}`,
      source
    };
    
  } catch (error) {
    console.error('📍 Source calculation error:', error);
    throw error;
  }
};

/**
 * SIMPLIFIED: Recency calculation
 */
const calculateRecencyScore = (lead, config) => {
  try {
    const now = new Date();
    const createdAt = lead.createdAt || new Date();
    const ageInDays = Math.floor((now - createdAt) / (1000 * 60 * 60 * 24));
    
    console.log('📅 Lead age in days:', ageInDays);
    
    let recencyScore;
    let reasoning;
    
    if (ageInDays <= 1) {
      recencyScore = config.rules.within24Hours;
      reasoning = 'Very fresh lead (within 24 hours)';
    } else if (ageInDays <= 7) {
      recencyScore = config.rules.within7Days;
      reasoning = 'Recent lead (within 7 days)';
    } else if (ageInDays <= 30) {
      recencyScore = config.rules.within30Days;
      reasoning = 'Moderately recent lead (within 30 days)';
    } else if (ageInDays <= 90) {
      recencyScore = config.rules.within90Days;
      reasoning = 'Older lead (within 90 days)';
    } else {
      recencyScore = config.rules.older;
      reasoning = 'Old lead (90+ days)';
    }
    
    return {
      rawScore: recencyScore,
      weightedScore: recencyScore * config.weight,
      reasoning,
      ageInDays
    };
    
  } catch (error) {
    console.error('📅 Recency calculation error:', error);
    throw error;
  }
};

/**
 * HELPER: Get average unit price
 */
const getAverageUnitPrice = async (projectId) => {
  try {
    if (!projectId) {
      console.log('💰 No project ID provided');
      return 5000000; // Default fallback
    }
    
    await initializeModels();
    
    const result = await Unit.aggregate([
      { $match: { project: new mongoose.Types.ObjectId(projectId) } },
      { $group: { _id: null, avgPrice: { $avg: '$basePrice' } } }
    ]);
    
    const avgPrice = result[0]?.avgPrice || 5000000;
    console.log('💰 Calculated average price:', avgPrice);
    return avgPrice;
    
  } catch (error) {
    console.error('💰 Error calculating average price:', error);
    return 5000000; // Default fallback
  }
};

/**
 * HELPER: Format budget range
 */
const formatBudgetRange = (min, max) => {
  if (!min && !max) return 'Not specified';
  if (min && max) return `₹${(min/10000000).toFixed(2)} - ${(max/10000000).toFixed(2)} Cr`;
  return `₹${((min || max)/10000000).toFixed(2)} Cr`;
};

/**
 * HELPER: Get score grade
 */
const getScoreGrade = (score) => {
  if (score >= 90) return 'A+';
  if (score >= 80) return 'A';
  if (score >= 70) return 'B+';
  if (score >= 60) return 'B';
  if (score >= 50) return 'C+';
  if (score >= 40) return 'C';
  return 'D';
};

/**
 * HELPER: Get lead priority
 */
// 2026-06 refactor: 4 levels only (no Critical). NOTE: the authoritative
// priority is timeline-derived in the model pre-save hook; this score-based
// band is a fallback kept in-enum so we never assign an invalid value.
const getLeadPriority = (score) => {
  if (score >= 75) return 'High';
  if (score >= 60) return 'Medium';
  if (score >= 40) return 'Low';
  return 'Very Low';
};

/**
 * MAIN: Update lead score function
 */
const updateLeadScore = async (leadId, config = null) => {
  try {
    await initializeModels();
    
    const lead = await Lead.findById(leadId);
    if (!lead) {
      throw new Error('Lead not found');
    }
    
    console.log(`🎯 Starting score update for lead: ${lead.firstName} ${lead.lastName || ''}`);
    
    // CRITICAL FIX: Ensure we never pass null config
    const scoringConfig = config || DEFAULT_SCORING_CONFIG;
    console.log('🔧 Using scoring config:', !!scoringConfig);
    
    const scoreResult = await calculateLeadScore(lead, scoringConfig);
    
    // Update lead with new score
    const previousScore = lead.score || 0;
    
    // Ensure scoreBreakdown field exists
    if (!lead.scoreBreakdown) {
      lead.scoreBreakdown = {};
    }
    
    lead.score = scoreResult.totalScore;
    lead.scoreBreakdown = scoreResult.breakdown;
    lead.scoreGrade = scoreResult.grade;
    lead.lastScoreUpdate = new Date();
    
    // 2026-06 refactor: priority is timeline-derived, not score-derived. (The
    // model pre-save hook also enforces this; we set it here so the in-memory
    // doc + the returned payload are consistent without a re-fetch.)
    if (lead.schema.paths.priority) lead.priority = derivePriorityFromTimeline(lead.requirements?.timeline);
    if (lead.schema.paths.confidence) lead.confidence = scoreResult.confidence;
    
    await lead.save();

    console.log(`✅ Score updated: ${previousScore} → ${scoreResult.totalScore} (${scoreResult.grade})`);

    // SP4+ — if this Lead came from a CP-side Prospect, mirror the dev score
    // back onto that Prospect so the CP can see the developer's view.
    // Best-effort; non-fatal.
    if (lead.sourceProspect) {
      try {
        const { mirrorLeadScoreToProspect } = await import('./prospectScoringService.js');
        await mirrorLeadScoreToProspect(lead.sourceProspect, scoreResult.totalScore, scoreResult.grade);
      } catch (mirrorErr) {
        console.warn('[leadScoring] mirror to prospect failed (non-fatal):', mirrorErr.message);
      }
    }

    return {
      leadId,
      previousScore,
      newScore: scoreResult.totalScore,
      grade: scoreResult.grade,
      priority: derivePriorityFromTimeline(lead.requirements?.timeline),
      confidence: scoreResult.confidence,
      breakdown: scoreResult.breakdown,
      updatedAt: new Date()
    };
    
  } catch (error) {
    console.error(`❌ Failed to update lead score for ${leadId}:`, error.message);
    throw error;
  }
};

/**
 * SIMPLE: Bulk update function
 */
const bulkUpdateLeadScores = async (leadIds, config = null) => {
  const results = {
    successful: [],
    failed: [],
    summary: { total: leadIds.length, successful: 0, failed: 0 }
  };
  
  for (const leadId of leadIds) {
    try {
      const result = await updateLeadScore(leadId, config);
      results.successful.push(result);
      results.summary.successful++;
    } catch (error) {
      results.failed.push({ leadId, error: error.message });
      results.summary.failed++;
    }
  }
  
  return results;
};

// Export functions
export {
  calculateLeadScore,
  updateLeadScore,
  bulkUpdateLeadScores,
  DEFAULT_SCORING_CONFIG,
  getScoreGrade,
  getLeadPriority,
  calculateSourceScore,
  calculateTimelineScore
};