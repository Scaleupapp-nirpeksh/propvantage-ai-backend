// File: services/leadScoringService.js
// Description: Core service for calculating and managing lead scores using multiple criteria

import Lead from '../models/leadModel.js';
import Interaction from '../models/interactionModel.js';
import Sale from '../models/salesModel.js';
import mongoose from 'mongoose';

/**
 * Default scoring configuration
 * Each criterion has a weight and scoring rules
 */
const DEFAULT_SCORING_CONFIG = {
  // Budget alignment (30% weight)
  budgetAlignment: {
    weight: 0.30,
    rules: {
      exactMatch: 100,      // Budget exactly matches unit price
      within10Percent: 85,  // Budget within 10% of unit price
      within20Percent: 70,  // Budget within 20% of unit price
      within30Percent: 50,  // Budget within 30% of unit price
      below30Percent: 20,   // Budget more than 30% below unit price
      noBudget: 40          // No budget specified
    }
  },
  
  // Engagement level (25% weight)
  engagementLevel: {
    weight: 0.25,
    rules: {
      highEngagement: 100,    // 5+ interactions in last 30 days
      mediumEngagement: 75,   // 3-4 interactions in last 30 days
      lowEngagement: 50,      // 1-2 interactions in last 30 days
      noEngagement: 10        // No interactions in last 30 days
    }
  },
  
  // Timeline urgency (20% weight)
  timelineUrgency: {
    weight: 0.20,
    rules: {
      immediate: 100,         // Immediate purchase intent
      within3Months: 85,      // 1-3 months timeline
      within6Months: 65,      // 3-6 months timeline
      within12Months: 45,     // 6-12 months timeline
      longTerm: 25,           // 12+ months timeline
      noTimeline: 35          // No timeline specified
    }
  },
  
  // Lead source quality (15% weight)
  sourceQuality: {
    weight: 0.15,
    rules: {
      referral: 100,          // Referred by existing customer
      walkIn: 90,            // Walk-in lead
      website: 75,           // Website inquiry
      propertyPortal: 70,    // Property portal lead
      socialMedia: 60,       // Social media lead
      advertisement: 50,     // Advertisement response
      coldCall: 30,          // Cold call lead
      other: 40              // Other sources
    }
  },
  
  // Recency factor (10% weight)
  recencyFactor: {
    weight: 0.10,
    rules: {
      within24Hours: 100,     // Created within 24 hours
      within7Days: 85,        // Created within 7 days
      within30Days: 70,       // Created within 30 days
      within90Days: 50,       // Created within 90 days
      older: 25               // Older than 90 days
    }
  }
};

/**
 * Calculates lead score based on multiple criteria
 * @param {Object} lead - Lead object with populated fields
 * @param {Object} config - Optional custom scoring configuration
 * @returns {Object} Score calculation result
 */
const calculateLeadScore = async (lead, config = DEFAULT_SCORING_CONFIG) => {
  try {
    const scoreBreakdown = {};
    let totalScore = 0;
    
    // 1. Budget Alignment Score
    const budgetScore = await calculateBudgetAlignmentScore(lead, config.budgetAlignment);
    scoreBreakdown.budgetAlignment = budgetScore;
    totalScore += budgetScore.weightedScore;
    
    // 2. Engagement Level Score
    const engagementScore = await calculateEngagementScore(lead, config.engagementLevel);
    scoreBreakdown.engagementLevel = engagementScore;
    totalScore += engagementScore.weightedScore;
    
    // 3. Timeline Urgency Score
    const timelineScore = calculateTimelineScore(lead, config.timelineUrgency);
    scoreBreakdown.timelineUrgency = timelineScore;
    totalScore += timelineScore.weightedScore;
    
    // 4. Source Quality Score
    const sourceScore = calculateSourceScore(lead, config.sourceQuality);
    scoreBreakdown.sourceQuality = sourceScore;
    totalScore += sourceScore.weightedScore;
    
    // 5. Recency Factor Score
    const recencyScore = calculateRecencyScore(lead, config.recencyFactor);
    scoreBreakdown.recencyFactor = recencyScore;
    totalScore += recencyScore.weightedScore;
    
    // Round to 2 decimal places
    totalScore = Math.round(totalScore * 100) / 100;
    
    return {
      totalScore,
      breakdown: scoreBreakdown,
      grade: getScoreGrade(totalScore),
      calculatedAt: new Date()
    };
    
  } catch (error) {
    throw new Error(`Failed to calculate lead score: ${error.message}`);
  }
};

/**
 * Calculate budget alignment score
 * @param {Object} lead - Lead object
 * @param {Object} config - Budget alignment configuration
 * @returns {Object} Budget score details
 */
const calculateBudgetAlignmentScore = async (lead, config) => {
  try {
    if (!lead.budget || (!lead.budget.min && !lead.budget.max)) {
      return {
        rawScore: config.rules.noBudget,
        weightedScore: config.rules.noBudget * config.weight,
        reasoning: 'No budget specified'
      };
    }
    
    // Get average unit price for the project (simplified - in real implementation, 
    // you might want to get specific unit prices based on requirements)
    const avgUnitPrice = await getAverageUnitPrice(lead.project);
    
    const budgetMax = lead.budget.max || lead.budget.min;
    const budgetMin = lead.budget.min || lead.budget.max;
    
    // Calculate budget alignment percentage
    let alignmentScore;
    let reasoning;
    
    if (budgetMin <= avgUnitPrice && avgUnitPrice <= budgetMax) {
      alignmentScore = config.rules.exactMatch;
      reasoning = 'Budget perfectly aligns with unit price';
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
        reasoning = 'Budget significantly below unit price';
      }
    }
    
    return {
      rawScore: alignmentScore,
      weightedScore: alignmentScore * config.weight,
      reasoning,
      budgetRange: `₹${budgetMin?.toLocaleString()} - ₹${budgetMax?.toLocaleString()}`,
      avgUnitPrice: `₹${avgUnitPrice?.toLocaleString()}`
    };
    
  } catch (error) {
    return {
      rawScore: config.rules.noBudget,
      weightedScore: config.rules.noBudget * config.weight,
      reasoning: 'Error calculating budget alignment'
    };
  }
};

/**
 * Calculate engagement score based on interactions
 * @param {Object} lead - Lead object
 * @param {Object} config - Engagement configuration
 * @returns {Object} Engagement score details
 */
const calculateEngagementScore = async (lead, config) => {
  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const interactionCount = await Interaction.countDocuments({
      lead: lead._id,
      createdAt: { $gte: thirtyDaysAgo }
    });
    
    let engagementScore;
    let reasoning;
    
    if (interactionCount >= 5) {
      engagementScore = config.rules.highEngagement;
      reasoning = `High engagement: ${interactionCount} interactions in last 30 days`;
    } else if (interactionCount >= 3) {
      engagementScore = config.rules.mediumEngagement;
      reasoning = `Medium engagement: ${interactionCount} interactions in last 30 days`;
    } else if (interactionCount >= 1) {
      engagementScore = config.rules.lowEngagement;
      reasoning = `Low engagement: ${interactionCount} interactions in last 30 days`;
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
    return {
      rawScore: config.rules.noEngagement,
      weightedScore: config.rules.noEngagement * config.weight,
      reasoning: 'Error calculating engagement score'
    };
  }
};

/**
 * Calculate timeline urgency score
 * @param {Object} lead - Lead object
 * @param {Object} config - Timeline configuration
 * @returns {Object} Timeline score details
 */
const calculateTimelineScore = (lead, config) => {
  const timeline = lead.requirements?.timeline;
  
  if (!timeline) {
    return {
      rawScore: config.rules.noTimeline,
      weightedScore: config.rules.noTimeline * config.weight,
      reasoning: 'No timeline specified'
    };
  }
  
  let timelineScore;
  let reasoning;
  
  switch (timeline.toLowerCase()) {
    case 'immediate':
      timelineScore = config.rules.immediate;
      reasoning = 'Immediate purchase intent';
      break;
    case '1-3_months':
      timelineScore = config.rules.within3Months;
      reasoning = 'Short-term timeline (1-3 months)';
      break;
    case '3-6_months':
      timelineScore = config.rules.within6Months;
      reasoning = 'Medium-term timeline (3-6 months)';
      break;
    case '6-12_months':
      timelineScore = config.rules.within12Months;
      reasoning = 'Long-term timeline (6-12 months)';
      break;
    case '12+_months':
      timelineScore = config.rules.longTerm;
      reasoning = 'Very long-term timeline (12+ months)';
      break;
    default:
      timelineScore = config.rules.noTimeline;
      reasoning = 'Timeline not specified';
  }
  
  return {
    rawScore: timelineScore,
    weightedScore: timelineScore * config.weight,
    reasoning,
    timeline
  };
};

/**
 * Calculate source quality score
 * @param {Object} lead - Lead object
 * @param {Object} config - Source quality configuration
 * @returns {Object} Source score details
 */
const calculateSourceScore = (lead, config) => {
  const source = lead.source?.toLowerCase() || 'other';
  
  const sourceMapping = {
    'referral': config.rules.referral,
    'walk-in': config.rules.walkIn,
    'website': config.rules.website,
    'property portal': config.rules.propertyPortal,
    'social media': config.rules.socialMedia,
    'advertisement': config.rules.advertisement,
    'cold call': config.rules.coldCall,
    'other': config.rules.other
  };
  
  const sourceScore = sourceMapping[source] || config.rules.other;
  
  return {
    rawScore: sourceScore,
    weightedScore: sourceScore * config.weight,
    reasoning: `Source: ${lead.source || 'Other'}`,
    source: lead.source
  };
};

/**
 * Calculate recency factor score
 * @param {Object} lead - Lead object
 * @param {Object} config - Recency configuration
 * @returns {Object} Recency score details
 */
const calculateRecencyScore = (lead, config) => {
  const now = new Date();
  const leadAge = now - lead.createdAt;
  const hoursAge = leadAge / (1000 * 60 * 60);
  const daysAge = hoursAge / 24;
  
  let recencyScore;
  let reasoning;
  
  if (hoursAge <= 24) {
    recencyScore = config.rules.within24Hours;
    reasoning = 'Very recent lead (within 24 hours)';
  } else if (daysAge <= 7) {
    recencyScore = config.rules.within7Days;
    reasoning = 'Recent lead (within 7 days)';
  } else if (daysAge <= 30) {
    recencyScore = config.rules.within30Days;
    reasoning = 'Moderately recent lead (within 30 days)';
  } else if (daysAge <= 90) {
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
    ageInDays: Math.round(daysAge)
  };
};

/**
 * Get score grade based on total score
 * @param {number} score - Total calculated score
 * @returns {string} Grade (A+, A, B+, B, C+, C, D)
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
 * Helper function to get average unit price for a project
 * @param {string} projectId - Project ID
 * @returns {number} Average unit price
 */
const getAverageUnitPrice = async (projectId) => {
  try {
    const pipeline = [
      { $match: { project: new mongoose.Types.ObjectId(projectId) } },
      {
        $group: {
          _id: null,
          avgPrice: { $avg: '$basePrice' }
        }
      }
    ];
    
    const result = await mongoose.model('Unit').aggregate(pipeline);
    return result[0]?.avgPrice || 5000000; // Default fallback price
  } catch (error) {
    return 5000000; // Default fallback price
  }
};

/**
 * Update lead score and save to database
 * @param {string} leadId - Lead ID
 * @param {Object} config - Optional custom scoring configuration
 * @returns {Object} Updated lead with new score
 */
const updateLeadScore = async (leadId, config = null) => {
  try {
    const lead = await Lead.findById(leadId);
    if (!lead) {
      throw new Error('Lead not found');
    }
    
    const scoreResult = await calculateLeadScore(lead, config);
    
    // Update the lead with new score
    lead.score = scoreResult.totalScore;
    lead.scoreBreakdown = scoreResult.breakdown;
    lead.scoreGrade = scoreResult.grade;
    lead.lastScoreUpdate = new Date();
    
    await lead.save();
    
    return {
      leadId,
      previousScore: lead.score,
      newScore: scoreResult.totalScore,
      grade: scoreResult.grade,
      breakdown: scoreResult.breakdown,
      updatedAt: new Date()
    };
    
  } catch (error) {
    throw new Error(`Failed to update lead score: ${error.message}`);
  }
};

/**
 * Bulk update scores for multiple leads
 * @param {Array} leadIds - Array of lead IDs
 * @param {Object} config - Optional custom scoring configuration
 * @returns {Object} Bulk update results
 */
const bulkUpdateLeadScores = async (leadIds, config = null) => {
  const results = {
    successful: [],
    failed: [],
    summary: {
      total: leadIds.length,
      successful: 0,
      failed: 0
    }
  };
  
  for (const leadId of leadIds) {
    try {
      const updateResult = await updateLeadScore(leadId, config);
      results.successful.push(updateResult);
      results.summary.successful++;
    } catch (error) {
      results.failed.push({
        leadId,
        error: error.message
      });
      results.summary.failed++;
    }
  }
  
  return results;
};

export {
  calculateLeadScore,
  updateLeadScore,
  bulkUpdateLeadScores,
  DEFAULT_SCORING_CONFIG,
  getScoreGrade
};