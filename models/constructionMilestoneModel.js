// File: models/constructionMilestoneModel.js
// Description: Defines the Mongoose schema for construction milestones and project phases

import mongoose from 'mongoose';

const constructionMilestoneSchema = new mongoose.Schema(
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
    // Milestone basic information
    name: {
      type: String,
      required: [true, 'Milestone name is required'],
      trim: true,
      maxlength: [200, 'Milestone name cannot exceed 200 characters']
    },
    description: {
      type: String,
      trim: true,
      maxlength: [1000, 'Description cannot exceed 1000 characters']
    },
    // Milestone type and category
    type: {
      type: String,
      enum: [
        'Planning',
        'Foundation',
        'Structure',
        'Roofing',
        'Plumbing',
        'Electrical',
        'Flooring',
        'Walls',
        'Finishing',
        'Inspection',
        'Handover',
        'Other'
      ],
      required: true
    },
    category: {
      type: String,
      enum: [
        'Civil Work',
        'Electrical Work',
        'Plumbing Work',
        'Finishing Work',
        'Inspection',
        'Documentation',
        'Approval',
        'Other'
      ],
      required: true
    },
    // Milestone hierarchy
    parentMilestone: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ConstructionMilestone',
      default: null
    },
    phase: {
      type: String,
      enum: [
        'Pre-Construction',
        'Foundation Phase',
        'Structure Phase',
        'MEP Phase', // Mechanical, Electrical, Plumbing
        'Finishing Phase',
        'Inspection Phase',
        'Handover Phase'
      ],
      required: true
    },
    // Milestone scheduling
    plannedStartDate: {
      type: Date,
      required: true
    },
    plannedEndDate: {
      type: Date,
      required: true
    },
    actualStartDate: {
      type: Date,
      default: null
    },
    actualEndDate: {
      type: Date,
      default: null
    },
    // Milestone status
    status: {
      type: String,
      enum: [
        'Not Started',
        'Planning',
        'In Progress',
        'On Hold',
        'Completed',
        'Delayed',
        'Cancelled'
      ],
      default: 'Not Started'
    },
    // Progress tracking
    progress: {
      percentage: {
        type: Number,
        default: 0,
        min: 0,
        max: 100
      },
      lastUpdated: {
        type: Date,
        default: Date.now
      },
      updatedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      }
    },
    // Milestone priority
    priority: {
      type: String,
      enum: ['Low', 'Medium', 'High', 'Critical'],
      default: 'Medium'
    },
    // Dependencies
    dependencies: [{
      milestone: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'ConstructionMilestone'
      },
      type: {
        type: String,
        enum: ['finish-to-start', 'start-to-start', 'finish-to-finish', 'start-to-finish'],
        default: 'finish-to-start'
      },
      lagDays: {
        type: Number,
        default: 0
      }
    }],
    // Responsible parties
    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    contractor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Contractor',
      default: null
    },
    supervisor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    // Quality and compliance
    qualityChecks: [{
      checkName: {
        type: String,
        required: true
      },
      description: String,
      isRequired: {
        type: Boolean,
        default: true
      },
      status: {
        type: String,
        enum: ['Pending', 'Passed', 'Failed', 'Not Applicable'],
        default: 'Pending'
      },
      checkedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      },
      checkedAt: Date,
      notes: String,
      attachments: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'File'
      }]
    }],
    // Approvals and inspections
    approvals: [{
      type: {
        type: String,
        enum: ['Internal', 'Municipal', 'Fire Department', 'Environmental', 'Other'],
        required: true
      },
      approvalName: {
        type: String,
        required: true
      },
      status: {
        type: String,
        enum: ['Pending', 'Approved', 'Rejected', 'Expired'],
        default: 'Pending'
      },
      appliedDate: Date,
      approvedDate: Date,
      expiryDate: Date,
      approvalNumber: String,
      approvedBy: String,
      notes: String,
      documents: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'File'
      }]
    }],
    // Cost and budget
    budget: {
      plannedCost: {
        type: Number,
        required: true,
        min: 0
      },
      actualCost: {
        type: Number,
        default: 0,
        min: 0
      },
      costVariance: {
        type: Number,
        default: 0
      },
      currency: {
        type: String,
        default: 'INR'
      }
    },
    // Resource requirements
    resources: [{
      type: {
        type: String,
        enum: ['Material', 'Equipment', 'Labor', 'Service'],
        required: true
      },
      name: {
        type: String,
        required: true
      },
      quantity: {
        type: Number,
        required: true
      },
      unit: {
        type: String,
        required: true
      },
      costPerUnit: {
        type: Number,
        required: true
      },
      totalCost: {
        type: Number,
        required: true
      },
      supplier: String,
      status: {
        type: String,
        enum: ['Planned', 'Ordered', 'Delivered', 'Used'],
        default: 'Planned'
      }
    }],
    // Progress documentation
    progressPhotos: [{
      photo: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'File'
      },
      takenAt: {
        type: Date,
        default: Date.now
      },
      takenBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      },
      description: String,
      location: String,
      isBeforePhoto: {
        type: Boolean,
        default: false
      },
      isAfterPhoto: {
        type: Boolean,
        default: false
      }
    }],
    // Weather and external factors
    weatherImpact: [{
      date: {
        type: Date,
        required: true
      },
      weatherCondition: {
        type: String,
        enum: ['Sunny', 'Rainy', 'Cloudy', 'Stormy', 'Extreme Heat', 'Extreme Cold'],
        required: true
      },
      impactLevel: {
        type: String,
        enum: ['None', 'Low', 'Medium', 'High', 'Severe'],
        required: true
      },
      description: String,
      delayDays: {
        type: Number,
        default: 0
      }
    }],
    // Issues and risks
    issues: [{
      issueType: {
        type: String,
        enum: ['Quality', 'Safety', 'Timeline', 'Budget', 'Resource', 'Weather', 'Other'],
        required: true
      },
      severity: {
        type: String,
        enum: ['Low', 'Medium', 'High', 'Critical'],
        required: true
      },
      title: {
        type: String,
        required: true
      },
      description: {
        type: String,
        required: true
      },
      reportedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
      },
      reportedAt: {
        type: Date,
        default: Date.now
      },
      status: {
        type: String,
        enum: ['Open', 'In Progress', 'Resolved', 'Closed'],
        default: 'Open'
      },
      resolution: String,
      resolvedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      },
      resolvedAt: Date,
      attachments: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'File'
      }]
    }],
    // Milestone completion
    completionDetails: {
      completedAt: Date,
      completedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      },
      completionNotes: String,
      nextMilestone: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'ConstructionMilestone'
      }
    },
    // Notifications and alerts
    notifications: [{
      type: {
        type: String,
        enum: ['Due Date', 'Delay', 'Quality Issue', 'Budget Overrun', 'Approval Pending'],
        required: true
      },
      message: {
        type: String,
        required: true
      },
      sentTo: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      }],
      sentAt: {
        type: Date,
        default: Date.now
      },
      isRead: {
        type: Boolean,
        default: false
      }
    }],
    // Created and modified tracking
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    lastModifiedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  },
  {
    timestamps: true,
  }
);

// Indexes for better performance
constructionMilestoneSchema.index({ organization: 1, project: 1 });
constructionMilestoneSchema.index({ organization: 1, status: 1 });
constructionMilestoneSchema.index({ organization: 1, phase: 1 });
constructionMilestoneSchema.index({ assignedTo: 1, status: 1 });
constructionMilestoneSchema.index({ plannedStartDate: 1, plannedEndDate: 1 });
constructionMilestoneSchema.index({ actualStartDate: 1, actualEndDate: 1 });
constructionMilestoneSchema.index({ 'progress.percentage': 1 });
constructionMilestoneSchema.index({ priority: 1, status: 1 });

// Virtual for milestone duration (planned)
constructionMilestoneSchema.virtual('plannedDuration').get(function() {
  if (this.plannedStartDate && this.plannedEndDate) {
    const diffTime = this.plannedEndDate - this.plannedStartDate;
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24)); // Convert to days
  }
  return 0;
});

// Virtual for actual duration
constructionMilestoneSchema.virtual('actualDuration').get(function() {
  if (this.actualStartDate && this.actualEndDate) {
    const diffTime = this.actualEndDate - this.actualStartDate;
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24)); // Convert to days
  }
  return 0;
});

// Virtual for delay calculation
constructionMilestoneSchema.virtual('delayDays').get(function() {
  const currentDate = new Date();
  
  if (this.status === 'Completed' && this.actualEndDate && this.plannedEndDate) {
    const diffTime = this.actualEndDate - this.plannedEndDate;
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  }
  
  if (this.status !== 'Completed' && this.plannedEndDate < currentDate) {
    const diffTime = currentDate - this.plannedEndDate;
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  }
  
  return 0;
});

// Virtual for cost variance percentage
constructionMilestoneSchema.virtual('costVariancePercentage').get(function() {
  if (this.budget.plannedCost > 0) {
    return ((this.budget.actualCost - this.budget.plannedCost) / this.budget.plannedCost) * 100;
  }
  return 0;
});

// Virtual for overall health score
constructionMilestoneSchema.virtual('healthScore').get(function() {
  let score = 100;
  
  // Progress factor
  if (this.progress.percentage < 50 && this.status === 'In Progress') {
    score -= 10;
  }
  
  // Delay factor
  const delayDays = this.delayDays;
  if (delayDays > 0) {
    score -= Math.min(delayDays * 2, 30); // Max 30 points for delays
  }
  
  // Budget factor
  const costVariance = this.costVariancePercentage;
  if (costVariance > 10) {
    score -= Math.min(costVariance, 25); // Max 25 points for cost overrun
  }
  
  // Quality issues factor
  const failedQualityChecks = this.qualityChecks.filter(check => check.status === 'Failed').length;
  score -= failedQualityChecks * 5;
  
  // Open issues factor
  const openIssues = this.issues.filter(issue => issue.status === 'Open').length;
  score -= openIssues * 3;
  
  return Math.max(score, 0);
});

// Method to update progress
constructionMilestoneSchema.methods.updateProgress = function(percentage, userId) {
  this.progress.percentage = Math.min(Math.max(percentage, 0), 100);
  this.progress.lastUpdated = new Date();
  this.progress.updatedBy = userId;
  
  // Auto-update status based on progress
  if (percentage === 0) {
    this.status = 'Not Started';
  } else if (percentage === 100) {
    this.status = 'Completed';
    this.completionDetails.completedAt = new Date();
    this.completionDetails.completedBy = userId;
  } else if (this.status === 'Not Started') {
    this.status = 'In Progress';
    this.actualStartDate = new Date();
  }
  
  return this;
};

// Method to add quality check
constructionMilestoneSchema.methods.addQualityCheck = function(checkData) {
  this.qualityChecks.push({
    checkName: checkData.checkName,
    description: checkData.description,
    isRequired: checkData.isRequired || true,
    status: checkData.status || 'Pending'
  });
  
  return this.qualityChecks[this.qualityChecks.length - 1];
};

// Method to add issue
constructionMilestoneSchema.methods.addIssue = function(issueData, userId) {
  this.issues.push({
    ...issueData,
    reportedBy: userId,
    reportedAt: new Date()
  });
  
  return this.issues[this.issues.length - 1];
};

// Method to check if milestone is overdue
constructionMilestoneSchema.methods.isOverdue = function() {
  const currentDate = new Date();
  return this.status !== 'Completed' && this.plannedEndDate < currentDate;
};

// Method to check if milestone is ready to start
constructionMilestoneSchema.methods.isReadyToStart = function() {
  if (this.status !== 'Not Started') return false;
  
  // Check if all dependencies are completed
  return this.dependencies.every(dep => {
    // This would need to be populated to check actual dependency status
    return true; // Simplified for now
  });
};

// Static method to get project timeline
constructionMilestoneSchema.statics.getProjectTimeline = function(projectId) {
  return this.find({ project: projectId })
    .populate('assignedTo', 'firstName lastName')
    .populate('contractor', 'name')
    .sort({ plannedStartDate: 1 });
};

// Static method to get overdue milestones
constructionMilestoneSchema.statics.getOverdueMilestones = function(organizationId) {
  const currentDate = new Date();
  return this.find({
    organization: organizationId,
    status: { $nin: ['Completed', 'Cancelled'] },
    plannedEndDate: { $lt: currentDate }
  })
    .populate('project', 'name')
    .populate('assignedTo', 'firstName lastName')
    .sort({ plannedEndDate: 1 });
};

// Pre-save middleware to calculate cost variance
constructionMilestoneSchema.pre('save', function(next) {
  if (this.isModified('budget.actualCost') || this.isModified('budget.plannedCost')) {
    this.budget.costVariance = this.budget.actualCost - this.budget.plannedCost;
  }
  
  // Set last modified by
  if (this.isModified() && !this.isNew) {
    this.lastModifiedBy = this.createdBy; // This should be set by the controller
  }
  
  next();
});

const ConstructionMilestone = mongoose.model('ConstructionMilestone', constructionMilestoneSchema);

export default ConstructionMilestone;