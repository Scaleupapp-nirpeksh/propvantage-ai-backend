// File: models/leadModel.js
// Description: Complete Lead Model - FIXED export and compatible with existing structure
// Version: 1.5 - Working model with proper exports and all required fields
// Location: models/leadModel.js

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
    // EXISTING SCORING FIELDS - MAINTAINING CURRENT STRUCTURE
    // ====================================================================
    
    // Current AI scoring system
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
        avgUnitPrice: { type: String, default: '' },
        // NEW ENHANCED fields (safe to add)
        alignmentPercentage: { type: Number, default: 0 },
        deviation: { type: Number, default: 0 }
      },
      engagementLevel: {
        rawScore: { type: Number, default: 0 },
        weightedScore: { type: Number, default: 0 },
        reasoning: { type: String, default: '' },
        interactionCount: { type: Number, default: 0 },
        // NEW ENHANCED fields (safe to add)
        recencyBonus: { type: Number, default: 0 },
        lastInteractionDate: { type: Date, default: null },
        daysSinceLastInteraction: { type: Number, default: null }
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
        ageInDays: { type: Number, default: 0 },
        // NEW ENHANCED field (safe to add)
        createdDate: { type: Date, default: null }
      }
    },
    
    // Timestamp of last score calculation
    lastScoreUpdate: {
      type: Date,
      default: Date.now,
    },
    
    // ====================================================================
    // NEW ENHANCED FIELDS - ADDING GRADUALLY FOR COMPATIBILITY
    // ====================================================================
    
    // NEW: Priority level based on score (safe to add with default)
    priority: {
      type: String,
      enum: ['Critical', 'High', 'Medium', 'Low', 'Very Low'],
      default: 'Very Low',
      index: true  // Index for efficient querying by priority
    },
    
    // NEW: Confidence level in the calculated score (safe to add with default)
    confidence: {
      type: Number,
      default: 60,
      min: 0,
      max: 100
    },
    
    // ====================================================================
    // EXISTING LEAD FIELDS - MAINTAINING COMPATIBILITY
    // ====================================================================
    
    // Budget information
    budget: {
      min: { type: Number },
      max: { type: Number },
      // Budget validation status
      isValidated: { type: Boolean, default: false },
      // Budget source
      budgetSource: { 
        type: String, 
        enum: ['self_reported', 'pre_approved', 'loan_approved', 'verified'],
        default: 'self_reported' 
      },
      // NEW ENHANCED fields (safe to add)
      currency: { type: String, default: 'INR' },
      lastUpdated: { type: Date, default: Date.now },
      updatedBy: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'User',
        default: null 
      }
    },
    
    // Requirements and preferences
    requirements: {
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
      unitType: { type: String }, // e.g., '2BHK', '3BHK'
      floor: {
        preference: { 
          type: String, 
          enum: ['low', 'medium', 'high', 'any'],
          default: 'any' 
        },
        specific: { type: Number } // Specific floor number if any
      },
      facing: {
        type: String,
        enum: ['North', 'South', 'East', 'West', 'North-East', 'North-West', 'South-East', 'South-West', 'Any'],
        default: 'Any'
      },
      // NEW ENHANCED fields (safe to add)
      amenities: [{ type: String }], // Preferred amenities
      specialRequirements: { type: String } // Any special requirements
    },
    
    // Qualification status
    qualificationStatus: {
      type: String,
      enum: ['Not Qualified', 'In Progress', 'Qualified', 'Pre-Approved'],
      default: 'Not Qualified'
    },
    
    // Lead engagement metrics
    engagementMetrics: {
      totalInteractions: { type: Number, default: 0 },
      lastInteractionDate: { type: Date },
      lastInteractionType: { type: String },
      responseRate: { type: Number, default: 0, min: 0, max: 100 },
      // NEW ENHANCED fields (safe to add)
      averageResponseTime: { type: Number, default: 0 }, // in hours
      preferredContactMethod: { 
        type: String, 
        enum: ['phone', 'email', 'whatsapp', 'in_person'],
        default: 'phone' 
      },
      lastResponseTime: { type: Number, default: 0 } // hours to respond
    },
    
    // Follow-up scheduling
    followUpSchedule: {
      nextFollowUpDate: { type: Date },
      followUpType: { 
        type: String, 
        enum: ['call', 'email', 'site_visit', 'meeting', 'whatsapp'],
        default: 'call' 
      },
      notes: { type: String },
      // NEW ENHANCED fields (safe to add)
      isOverdue: { type: Boolean, default: false },
      overdueBy: { type: Number, default: 0 }, // days overdue
      remindersSent: { type: Number, default: 0 }
    },
    
    // Lead notes and comments
    notes: { type: String },
    
    // NEW ENHANCED: Structured activity tracking (safe to add)
    activitySummary: {
      callsCount: { type: Number, default: 0 },
      emailsCount: { type: Number, default: 0 },
      meetingsCount: { type: Number, default: 0 },
      siteVisitsCount: { type: Number, default: 0 },
      lastCallDate: { type: Date },
      lastEmailDate: { type: Date },
      lastMeetingDate: { type: Date },
      lastSiteVisitDate: { type: Date }
    },
    
    // NEW: Campaign and marketing attribution (safe to add)
    attribution: {
      campaign: { type: String },
      medium: { type: String },
      source: { type: String },
      content: { type: String },
      term: { type: String },
      firstTouchpoint: { type: String },
      lastTouchpoint: { type: String },
      touchpointCount: { type: Number, default: 1 }
    }
  },
  {
    timestamps: true, // Automatically adds createdAt and updatedAt fields
    // NEW: Add indexing for better performance
    indexes: [
      { score: -1 }, // Descending score for leaderboards
      { priority: 1, score: -1 }, // Priority + score composite
      { organization: 1, assignedTo: 1 }, // Organization + assignedTo composite
      { organization: 1, status: 1 }, // Organization + status composite
      { lastScoreUpdate: -1 }, // Recent score updates
      { 'followUpSchedule.nextFollowUpDate': 1 }, // Follow-up scheduling
      { createdAt: -1 } // Recent leads
    ]
  }
);

// ====================================================================
// VIRTUAL FIELDS - COMPUTED PROPERTIES
// ====================================================================

// Virtual for full name
leadSchema.virtual('fullName').get(function() {
  return `${this.firstName} ${this.lastName || ''}`.trim();
});

// NEW: Virtual for score status
leadSchema.virtual('scoreStatus').get(function() {
  if (this.confidence < 70) return 'Low Confidence';
  if (this.score >= 85) return 'Hot Lead';
  if (this.score >= 70) return 'Warm Lead';
  if (this.score >= 50) return 'Moderate Lead';
  return 'Cold Lead';
});

// NEW: Virtual for follow-up urgency
leadSchema.virtual('followUpUrgency').get(function() {
  if (!this.followUpSchedule?.nextFollowUpDate) return 'Not Scheduled';
  
  const now = new Date();
  const followUpDate = new Date(this.followUpSchedule.nextFollowUpDate);
  const hoursDiff = (followUpDate - now) / (1000 * 60 * 60);
  
  if (hoursDiff < 0) return 'Overdue';
  if (hoursDiff < 24) return 'Today';
  if (hoursDiff < 72) return 'This Week';
  return 'Future';
});

// NEW: Virtual for engagement level
leadSchema.virtual('engagementLevel').get(function() {
  const interactions = this.engagementMetrics?.totalInteractions || 0;
  const daysSinceLastInteraction = this.scoreBreakdown?.engagementLevel?.daysSinceLastInteraction;
  
  if (interactions === 0) return 'No Engagement';
  if (daysSinceLastInteraction && daysSinceLastInteraction > 30) return 'Cold';
  if (interactions >= 8) return 'Very High';
  if (interactions >= 5) return 'High';
  if (interactions >= 3) return 'Medium';
  return 'Low';
});

// ====================================================================
// INSTANCE METHODS - UTILITY FUNCTIONS
// ====================================================================

// Method to update priority based on score
leadSchema.methods.updatePriority = function() {
  if (this.score >= 85) {
    this.priority = 'Critical';
  } else if (this.score >= 75) {
    this.priority = 'High';
  } else if (this.score >= 60) {
    this.priority = 'Medium';
  } else if (this.score >= 40) {
    this.priority = 'Low';
  } else {
    this.priority = 'Very Low';
  }
};

// NEW: Get score trend (requires score history - future implementation)
leadSchema.methods.getScoreTrend = function() {
  // For now, return a simple trend based on recent score updates
  // This would be enhanced when we add score history
  const hoursAgo = this.lastScoreUpdate ? (new Date() - this.lastScoreUpdate) / (1000 * 60 * 60) : 999;
  
  if (hoursAgo < 24 && this.score >= 70) return 'improving';
  if (hoursAgo < 24 && this.score < 40) return 'declining';
  return 'stable';
};

// NEW: Check if follow-up is overdue
leadSchema.methods.updateFollowUpStatus = function() {
  if (this.followUpSchedule?.nextFollowUpDate) {
    const now = new Date();
    const followUpDate = new Date(this.followUpSchedule.nextFollowUpDate);
    const isOverdue = followUpDate < now;
    const overdueDays = isOverdue ? Math.floor((now - followUpDate) / (1000 * 60 * 60 * 24)) : 0;
    
    this.followUpSchedule.isOverdue = isOverdue;
    this.followUpSchedule.overdueBy = overdueDays;
  }
};

// NEW: Update activity summary
leadSchema.methods.updateActivitySummary = function(activityType) {
  const now = new Date();
  
  switch (activityType) {
    case 'call':
      this.activitySummary.callsCount += 1;
      this.activitySummary.lastCallDate = now;
      break;
    case 'email':
      this.activitySummary.emailsCount += 1;
      this.activitySummary.lastEmailDate = now;
      break;
    case 'meeting':
      this.activitySummary.meetingsCount += 1;
      this.activitySummary.lastMeetingDate = now;
      break;
    case 'site_visit':
      this.activitySummary.siteVisitsCount += 1;
      this.activitySummary.lastSiteVisitDate = now;
      break;
  }
  
  // Update engagement metrics
  this.engagementMetrics.totalInteractions += 1;
  this.engagementMetrics.lastInteractionDate = now;
  this.engagementMetrics.lastInteractionType = activityType;
};

// ====================================================================
// STATIC METHODS - MODEL-LEVEL UTILITIES
// ====================================================================

// Get leads needing attention (existing functionality enhanced)
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

// NEW: Get leads by priority
leadSchema.statics.getLeadsByPriority = function(organizationId, priority) {
  return this.find({ 
    organization: organizationId, 
    priority,
    status: { $nin: ['Booked', 'Lost', 'Unqualified'] }
  })
  .populate('assignedTo', 'firstName lastName')
  .populate('project', 'name')
  .sort({ score: -1, lastScoreUpdate: -1 });
};

// NEW: Get overdue follow-ups
leadSchema.statics.getOverdueFollowUps = function(organizationId) {
  const now = new Date();
  return this.find({
    organization: organizationId,
    'followUpSchedule.nextFollowUpDate': { $lt: now },
    status: { $nin: ['Booked', 'Lost', 'Unqualified'] }
  })
  .populate('assignedTo', 'firstName lastName')
  .sort({ 'followUpSchedule.nextFollowUpDate': 1 });
};

// ====================================================================
// MIDDLEWARE - AUTOMATIC PROCESSING
// ====================================================================

// Pre-save middleware to update priority and follow-up status
leadSchema.pre('save', function(next) {
  // Update priority based on score
  this.updatePriority();
  
  // Update follow-up status if needed
  this.updateFollowUpStatus();
  
  // Update qualification status based on score and other factors
  if (this.score >= 80 && this.budget?.min && this.requirements?.timeline) {
    this.qualificationStatus = 'Pre-Approved';
  } else if (this.score >= 70) {
    this.qualificationStatus = 'Qualified';
  } else if (this.score >= 50) {
    this.qualificationStatus = 'In Progress';
  } else {
    this.qualificationStatus = 'Not Qualified';
  }
  
  next();
});

// Post-save middleware for logging
leadSchema.post('save', function(doc) {
  if (doc.isModified('score')) {
    console.log(`✅ Lead ${doc._id} saved with score: ${doc.score} (${doc.scoreGrade}, ${doc.priority})`);
  }
});

// ====================================================================
// CREATE AND EXPORT MODEL
// ====================================================================

const Lead = mongoose.model('Lead', leadSchema);

export default Lead;