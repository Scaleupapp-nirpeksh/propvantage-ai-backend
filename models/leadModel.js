// File: models/leadModel.js
// Description: Enhanced Mongoose schema and model for a Lead with advanced scoring capabilities
// ADD THESE FIELDS TO YOUR EXISTING LEAD MODEL

import mongoose from 'mongoose';

const leadSchema = new mongoose.Schema(
  {
    organization: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: 'Organization',
    },
    project: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: 'Project',
    },
    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User', // Sales Executive or Manager
    },
    firstName: {
      type: String,
      required: [true, 'Please add a first name'],
      trim: true,
    },
    lastName: {
      type: String,
      trim: true,
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
    },
    phone: {
      type: String,
      required: [true, 'Please add a phone number'],
      trim: true,
    },
    source: {
      type: String,
      enum: [
        'Website',
        'Property Portal',
        'Referral',
        'Walk-in',
        'Social Media',
        'Advertisement',
        'Cold Call',
        'Other',
      ],
      default: 'Other',
    },
    status: {
      type: String,
      enum: [
        'New',
        'Contacted',
        'Qualified',
        'Site Visit Scheduled',
        'Site Visit Completed',
        'Negotiating',
        'Booked',
        'Lost',
        'Unqualified',
      ],
      default: 'New',
    },
    
    // ====================================================================
    // ENHANCED SCORING FIELDS - ADD THESE TO YOUR EXISTING MODEL
    // ====================================================================
    
    // Enhanced AI-powered scoring system
    score: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },
    
    // Score grade for quick visual reference
    scoreGrade: {
      type: String,
      enum: ['A+', 'A', 'B+', 'B', 'C+', 'C', 'D'],
      default: 'D',
    },
    
    // Detailed breakdown of score components
    scoreBreakdown: {
      budgetAlignment: {
        rawScore: { type: Number, default: 0 },
        weightedScore: { type: Number, default: 0 },
        reasoning: { type: String, default: '' },
        budgetRange: { type: String, default: '' },
        avgUnitPrice: { type: String, default: '' }
      },
      engagementLevel: {
        rawScore: { type: Number, default: 0 },
        weightedScore: { type: Number, default: 0 },
        reasoning: { type: String, default: '' },
        interactionCount: { type: Number, default: 0 }
      },
      timelineUrgency: {
        rawScore: { type: Number, default: 0 },
        weightedScore: { type: Number, default: 0 },
        reasoning: { type: String, default: '' },
        timeline: { type: String, default: '' }
      },
      sourceQuality: {
        rawScore: { type: Number, default: 0 },
        weightedScore: { type: Number, default: 0 },
        reasoning: { type: String, default: '' },
        source: { type: String, default: '' }
      },
      recencyFactor: {
        rawScore: { type: Number, default: 0 },
        weightedScore: { type: Number, default: 0 },
        reasoning: { type: String, default: '' },
        ageInDays: { type: Number, default: 0 }
      }
    },
    
    // Timestamp of last score calculation
    lastScoreUpdate: {
      type: Date,
      default: Date.now,
    },
    
    // Enhanced budget tracking
    budget: {
      min: { type: Number },
      max: { type: Number },
      // Budget validation status
      isValidated: { type: Boolean, default: false },
      // Budget source (self-reported, pre-approved, etc.)
      source: {
        type: String,
        enum: ['Self-reported', 'Pre-approved', 'Estimated', 'Verified'],
        default: 'Self-reported'
      }
    },
    
    // Enhanced requirements with structured timeline
    requirements: {
      unitTypes: [String], // e.g., ['2BHK', '3BHK']
      timeline: {
        type: String,
        enum: [
          'immediate',
          '1-3_months',
          '3-6_months',
          '6-12_months',
          '12+_months'
        ]
      },
      preferredFloor: {
        min: Number,
        max: Number
      },
      specificRequirements: String, // Open text field for specific needs
      notes: String,
    },
    
    // Lead qualification status
    qualificationStatus: {
      type: String,
      enum: [
        'Not Qualified',
        'Partially Qualified',
        'Fully Qualified',
        'Disqualified'
      ],
      default: 'Not Qualified'
    },
    
    // AI-generated insights and recommendations
    aiInsights: {
      lastGeneratedAt: Date,
      conversionProbability: {
        type: Number,
        min: 0,
        max: 100,
        default: 0
      },
      recommendedActions: [String],
      riskFactors: [String],
      opportunities: [String],
      nextBestAction: String,
      optimalContactTime: {
        dayOfWeek: String,
        timeOfDay: String
      }
    },
    
    // Lead priority based on score and other factors
    priority: {
      type: String,
      enum: ['Low', 'Medium', 'High', 'Critical'],
      default: 'Medium'
    },
    
    // Engagement metrics
    engagementMetrics: {
      totalInteractions: { type: Number, default: 0 },
      lastInteractionDate: Date,
      responseRate: { type: Number, default: 0 }, // Percentage
      avgResponseTime: { type: Number, default: 0 }, // In hours
      engagementTrend: {
        type: String,
        enum: ['Increasing', 'Stable', 'Decreasing', 'No Data'],
        default: 'No Data'
      }
    },
    
    // Competition and market factors
    competitionFactors: {
      isConsideringCompetitors: { type: Boolean, default: false },
      competitorNames: [String],
      priceComparison: {
        type: String,
        enum: ['Higher', 'Competitive', 'Lower', 'Unknown'],
        default: 'Unknown'
      },
      decisionInfluencers: [String] // Family members, consultants, etc.
    },
    
    // Follow-up tracking
    followUpSchedule: {
      nextFollowUpDate: Date,
      followUpType: {
        type: String,
        enum: ['Call', 'Email', 'SMS', 'Meeting', 'Site Visit', 'WhatsApp']
      },
      reminderSet: { type: Boolean, default: false },
      isOverdue: { type: Boolean, default: false }
    }
  },
  {
    timestamps: true,
  }
);

// ====================================================================
// INDEXES - ADD THESE FOR BETTER PERFORMANCE
// ====================================================================

// Index for better query performance
leadSchema.index({ organization: 1, score: -1 });
leadSchema.index({ organization: 1, scoreGrade: 1 });
leadSchema.index({ organization: 1, priority: 1 });
leadSchema.index({ organization: 1, qualificationStatus: 1 });
leadSchema.index({ assignedTo: 1, score: -1 });
leadSchema.index({ lastScoreUpdate: 1 });
leadSchema.index({ 'followUpSchedule.nextFollowUpDate': 1 });

// ====================================================================
// VIRTUAL FIELDS - ADD THESE FOR COMPUTED PROPERTIES
// ====================================================================

// Virtual for full name
leadSchema.virtual('fullName').get(function() {
  return `${this.firstName} ${this.lastName || ''}`.trim();
});

// Virtual for days since last interaction
leadSchema.virtual('daysSinceLastInteraction').get(function() {
  if (!this.engagementMetrics.lastInteractionDate) return null;
  const now = new Date();
  const diffTime = Math.abs(now - this.engagementMetrics.lastInteractionDate);
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
});

// Virtual for lead age in days
leadSchema.virtual('ageInDays').get(function() {
  const now = new Date();
  const diffTime = Math.abs(now - this.createdAt);
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
});

// ====================================================================
// INSTANCE METHODS - ADD THESE FOR LEAD-SPECIFIC FUNCTIONALITY
// ====================================================================

// Method to update priority based on score
leadSchema.methods.updatePriority = function() {
  if (this.score >= 85) {
    this.priority = 'Critical';
  } else if (this.score >= 70) {
    this.priority = 'High';
  } else if (this.score >= 50) {
    this.priority = 'Medium';
  } else {
    this.priority = 'Low';
  }
  return this.priority;
};

// Method to check if lead needs score recalculation
leadSchema.methods.needsScoreRecalculation = function() {
  if (!this.lastScoreUpdate) return true;
  
  const daysSinceUpdate = Math.floor((Date.now() - this.lastScoreUpdate) / (1000 * 60 * 60 * 24));
  
  // Recalculate if:
  // 1. Score was updated more than 7 days ago
  // 2. Lead has new interactions since last update
  // 3. Lead status changed recently
  
  return daysSinceUpdate > 7 || 
         (this.engagementMetrics.lastInteractionDate && 
          this.engagementMetrics.lastInteractionDate > this.lastScoreUpdate);
};

// Method to update engagement metrics
leadSchema.methods.updateEngagementMetrics = async function() {
  const Interaction = mongoose.model('Interaction');
  
  // Get interaction count
  const totalInteractions = await Interaction.countDocuments({ lead: this._id });
  
  // Get last interaction date
  const lastInteraction = await Interaction.findOne(
    { lead: this._id },
    {},
    { sort: { createdAt: -1 } }
  );
  
  this.engagementMetrics.totalInteractions = totalInteractions;
  this.engagementMetrics.lastInteractionDate = lastInteraction?.createdAt;
  
  // Update engagement trend (simplified logic)
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  
  const recentInteractions = await Interaction.countDocuments({
    lead: this._id,
    createdAt: { $gte: thirtyDaysAgo }
  });
  
  const previousThirtyDays = new Date();
  previousThirtyDays.setDate(previousThirtyDays.getDate() - 60);
  
  const previousInteractions = await Interaction.countDocuments({
    lead: this._id,
    createdAt: { $gte: previousThirtyDays, $lt: thirtyDaysAgo }
  });
  
  if (recentInteractions > previousInteractions) {
    this.engagementMetrics.engagementTrend = 'Increasing';
  } else if (recentInteractions === previousInteractions) {
    this.engagementMetrics.engagementTrend = 'Stable';
  } else {
    this.engagementMetrics.engagementTrend = 'Decreasing';
  }
  
  return this.engagementMetrics;
};

// ====================================================================
// STATIC METHODS - ADD THESE FOR QUERY HELPERS
// ====================================================================

// Static method to get high-scoring leads
leadSchema.statics.getHighPriorityLeads = function(organizationId, limit = 50) {
  return this.find({
    organization: organizationId,
    score: { $gte: 70 },
    status: { $nin: ['Booked', 'Lost', 'Unqualified'] }
  })
  .sort({ score: -1, lastScoreUpdate: -1 })
  .limit(limit)
  .populate('assignedTo', 'firstName lastName')
  .populate('project', 'name');
};

// Static method to get leads needing attention
leadSchema.statics.getLeadsNeedingAttention = function(organizationId) {
  const threeDaysAgo = new Date();
  threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
  
  return this.find({
    organization: organizationId,
    status: { $nin: ['Booked', 'Lost', 'Unqualified'] },
    $or: [
      { 'engagementMetrics.lastInteractionDate': { $lt: threeDaysAgo } },
      { 'followUpSchedule.nextFollowUpDate': { $lt: new Date() } },
      { score: { $lt: 40 } }
    ]
  })
  .sort({ score: -1, 'engagementMetrics.lastInteractionDate': 1 })
  .populate('assignedTo', 'firstName lastName')
  .populate('project', 'name');
};

// ====================================================================
// PRE-SAVE MIDDLEWARE - ADD THIS FOR AUTOMATIC UPDATES
// ====================================================================

// Pre-save middleware to update priority and qualification status
leadSchema.pre('save', function(next) {
  // Update priority based on score
  this.updatePriority();
  
  // Update qualification status based on score and other factors
  if (this.score >= 80 && this.budget.min && this.requirements.timeline) {
    this.qualificationStatus = 'Fully Qualified';
  } else if (this.score >= 60) {
    this.qualificationStatus = 'Partially Qualified';
  } else if (this.score < 30) {
    this.qualificationStatus = 'Disqualified';
  } else {
    this.qualificationStatus = 'Not Qualified';
  }
  
  // Set follow-up as overdue if past due date
  if (this.followUpSchedule.nextFollowUpDate && 
      this.followUpSchedule.nextFollowUpDate < new Date()) {
    this.followUpSchedule.isOverdue = true;
  }
  
  next();
});

const Lead = mongoose.model('Lead', leadSchema);

export default Lead;