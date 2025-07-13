// File: models/projectModel.js - ENHANCED VERSION
// Description: Added budget tracking fields to existing project model
// ⚠️ IMPORTANT: This enhances your existing model - copy and replace your current projectModel.js

import mongoose from 'mongoose';

// Schema for defining additional one-time or recurring charges for a project.
const additionalChargeSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
  },
  amount: {
    type: Number,
    required: true,
  },
  type: {
    type: String,
    enum: ['one-time', 'monthly', 'yearly'],
    default: 'one-time',
  },
});

// Schema for defining the financial rules applicable to a project.
const pricingRulesSchema = new mongoose.Schema({
  gstRate: { type: Number, default: 5 }, // Default GST rate in percentage
  tdsRate: { type: Number, default: 1 }, // Default TDS rate in percentage
  floorRiseCharge: { type: Number, default: 0 }, // Cost per floor rise
  plcCharges: {
    // Preferential Location Charges
    parkFacing: { type: Number, default: 0 },
    cornerUnit: { type: Number, default: 0 },
    seaFacing: { type: Number, default: 0 },
    roadFacing: { type: Number, default: 0 }
  },
});

// Schema for payment plan template installments (matches frontend and PaymentPlan model)
const installmentSchema = new mongoose.Schema({
  installmentNumber: {
    type: Number,
    required: true,
    min: 1
  },
  description: {
    type: String,
    required: true,
    trim: true
  },
  percentage: {
    type: Number,
    required: true,
    min: 0,
    max: 100
  },
  dueAfterDays: {
    type: Number,
    default: 0,
    min: 0
  },
  milestoneType: {
    type: String,
    enum: ['booking', 'time_based', 'construction', 'possession', 'custom'],
    default: 'time_based'
  },
  milestoneDescription: {
    type: String,
    trim: true
  },
  isOptional: {
    type: Boolean,
    default: false
  }
});

// Schema for payment plan templates (matches PaymentPlan model)
const paymentPlanTemplateSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    trim: true
  },
  planType: {
    type: String,
    enum: ['construction_linked', 'time_based', 'milestone_based', 'custom'],
    required: true
  },
  installments: [installmentSchema],
  totalPercentage: {
    type: Number,
    default: 100,
    validate: {
      validator: function() {
        // Calculate total percentage from installments
        const total = this.installments.reduce((sum, inst) => sum + (inst.percentage || 0), 0);
        return Math.abs(total - 100) < 0.01; // Allow for small floating point differences
      },
      message: 'Total installment percentages must equal 100%'
    }
  },
  gracePeriodDays: {
    type: Number,
    default: 7,
    min: 0
  },
  lateFeeRate: {
    type: Number,
    default: 0,
    min: 0,
    max: 100
  },
  isActive: {
    type: Boolean,
    default: true
  },
  usageCount: {
    type: Number,
    default: 0,
    min: 0
  }
}, {
  timestamps: true
});

// Schema for project-level payment configuration
const paymentConfigurationSchema = new mongoose.Schema({
  // Default payment terms for this project
  defaultPaymentTerms: {
    gracePeriodDays: {
      type: Number,
      default: 7,
      min: 0
    },
    lateFeeRate: {
      type: Number,
      default: 2, // 2% per month
      min: 0,
      max: 100
    },
    interestRate: {
      type: Number,
      default: 0,
      min: 0,
      max: 100
    },
    compoundInterest: {
      type: Boolean,
      default: false
    }
  },
  
  // Available payment plan templates for this project
  paymentPlanTemplates: [paymentPlanTemplateSchema],
  
  // Default charges applicable to all units in this project
  defaultCharges: {
    parkingCharges: { type: Number, default: 0 },
    clubMembership: { type: Number, default: 0 },
    maintenanceDeposit: { type: Number, default: 0 },
    legalCharges: { type: Number, default: 0 },
    powerConnectionCharges: { type: Number, default: 0 },
    waterConnectionCharges: { type: Number, default: 0 },
    sewerageConnectionCharges: { type: Number, default: 0 }
  },
  
  // Tax configuration
  taxConfiguration: {
    gstApplicable: {
      type: Boolean,
      default: true
    },
    gstRate: {
      type: Number,
      default: 5,
      min: 0,
      max: 100
    },
    stampDutyRate: {
      type: Number,
      default: 5,
      min: 0,
      max: 100
    },
    registrationFeeRate: {
      type: Number,
      default: 1,
      min: 0,
      max: 100
    }
  },
  
  // Discount configuration
  discountConfiguration: {
    maxDiscountPercentage: {
      type: Number,
      default: 10,
      min: 0,
      max: 100
    },
    earlyBirdDiscount: {
      enabled: { type: Boolean, default: false },
      percentage: { type: Number, default: 0 },
      validUntil: Date
    },
    bulkBookingDiscount: {
      enabled: { type: Boolean, default: false },
      minUnits: { type: Number, default: 1 },
      percentage: { type: Number, default: 0 }
    }
  },
  
  // Accepted payment methods
  acceptedPaymentMethods: [{
    method: {
      type: String,
      enum: ['cash', 'cheque', 'dd', 'neft', 'rtgs', 'upi', 'card'],
      required: true
    },
    isActive: {
      type: Boolean,
      default: true
    },
    processingFee: {
      type: Number,
      default: 0
    }
  }],
  
  // Bank account details for payments
  bankAccountDetails: [{
    bankName: { type: String, required: true },
    accountNumber: { type: String, required: true },
    ifscCode: { type: String, required: true },
    accountHolderName: { type: String, required: true },
    branch: { type: String },
    isPrimary: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true }
  }]
});

// 🆕 NEW: Budget tracking schema (ADDED FOR REAL-TIME BUDGET TRACKING)
const budgetTrackingSchema = new mongoose.Schema({
  // Enable/disable budget tracking for this project
  enabled: {
    type: Boolean,
    default: true
  },
  
  // Variance threshold for alerts (percentage)
  varianceThreshold: {
    type: Number,
    default: 10, // 10% variance threshold
    min: [1, 'Variance threshold must be at least 1%'],
    max: [50, 'Variance threshold cannot exceed 50%']
  },
  
  // Target pricing per unit (calculated from targetRevenue / totalUnits)
  targetPricePerUnit: {
    type: Number,
    min: [0, 'Target price per unit must be positive']
  },
  
  // Last budget variance check timestamp
  lastVarianceCheck: {
    type: Date,
    default: Date.now
  },
  
  // Number of times budget has been checked
  varianceCheckCount: {
    type: Number,
    default: 0
  },
  
  // Last calculated variance percentage
  lastVariancePercentage: {
    type: Number,
    default: 0
  },
  
  // Budget alerts history (keep last 50 alerts)
  alerts: [{
    alertType: {
      type: String,
      enum: ['variance_warning', 'variance_critical', 'target_achieved', 'price_adjustment_needed'],
      required: true
    },
    severity: {
      type: String,
      enum: ['info', 'warning', 'critical'],
      required: true
    },
    message: {
      type: String,
      required: true
    },
    variancePercentage: {
      type: Number
    },
    generatedAt: {
      type: Date,
      default: Date.now
    },
    acknowledged: {
      type: Boolean,
      default: false
    },
    acknowledgedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    acknowledgedAt: {
      type: Date
    }
  }],
  
  // Pricing adjustment history
  pricingAdjustments: [{
    adjustmentDate: {
      type: Date,
      default: Date.now
    },
    reason: {
      type: String,
      enum: ['budget_variance', 'market_conditions', 'promotional', 'manual'],
      required: true
    },
    variancePercentage: {
      type: Number
    },
    adjustmentPercentage: {
      type: Number,
      required: true
    },
    affectedUnits: {
      type: Number,
      default: 0
    },
    expectedImpact: {
      type: String
    },
    adjustedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  }]
});

// Main Project Schema (ENHANCED with budget tracking)
const projectSchema = new mongoose.Schema(
  {
    organization: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: 'Organization',
    },
    name: {
      type: String,
      required: [true, 'Project name is required'],
      trim: true,
      maxlength: [100, 'Project name cannot exceed 100 characters'],
    },
    description: {
      type: String,
      trim: true,
      maxlength: [500, 'Description cannot exceed 500 characters'],
    },
    type: {
      type: String,
      required: [true, 'Project type is required'],
      enum: ['apartment', 'villa', 'plot', 'commercial'],
    },
    status: {
      type: String,
      required: true,
      enum: ['planning', 'pre-launch', 'launched', 'under-construction', 'completed', 'on-hold'],
      default: 'planning',
    },
    location: {
      city: { type: String, required: true },
      area: { type: String, required: true },
      pincode: { type: String },
      state: { type: String },
      landmark: { type: String },
    },
    totalUnits: {
      type: Number,
      required: [true, 'Total units is required'],
      min: [1, 'Total units must be at least 1'],
    },
    totalArea: {
      type: Number, // Total area in square feet
      min: [1, 'Total area must be positive'],
    },
    priceRange: {
      min: { type: Number, required: true },
      max: { type: Number, required: true },
    },
    targetRevenue: {
      type: Number,
      required: [true, 'Target revenue is required'],
      min: [1, 'Target revenue must be positive'],
    },
    launchDate: {
      type: Date,
    },
    expectedCompletionDate: {
      type: Date,
    },
    actualCompletionDate: {
      type: Date,
    },
    approvals: {
      rera: { 
        number: String, 
        date: Date, 
        validUntil: Date 
      },
      environmentClearance: { 
        number: String, 
        date: Date 
      },
      buildingPlan: { 
        number: String, 
        date: Date 
      },
    },
    amenities: [String],
    configuration: {
      type: Map,
      of: String,
    },
    // Existing schemas (UNCHANGED)
    pricingRules: pricingRulesSchema,
    additionalCharges: [additionalChargeSchema],
    paymentConfiguration: {
      type: paymentConfigurationSchema,
      default: () => ({
        defaultPaymentTerms: {
          gracePeriodDays: 7,
          lateFeeRate: 2,
          interestRate: 0,
          compoundInterest: false
        },
        paymentPlanTemplates: [],
        defaultCharges: {
          parkingCharges: 0,
          clubMembership: 0,
          maintenanceDeposit: 0,
          legalCharges: 0,
          powerConnectionCharges: 0,
          waterConnectionCharges: 0,
          sewerageConnectionCharges: 0
        },
        taxConfiguration: {
          gstApplicable: true,
          gstRate: 5,
          stampDutyRate: 5,
          registrationFeeRate: 1
        },
        discountConfiguration: {
          maxDiscountPercentage: 10,
          earlyBirdDiscount: { enabled: false, percentage: 0 },
          bulkBookingDiscount: { enabled: false, minUnits: 1, percentage: 0 }
        },
        acceptedPaymentMethods: [],
        bankAccountDetails: []
      })
    },
    
    // 🆕 NEW: Budget tracking configuration (ADDED)
    budgetTracking: {
      type: budgetTrackingSchema,
      default: () => ({
        enabled: true,
        varianceThreshold: 10,
        lastVarianceCheck: new Date(),
        varianceCheckCount: 0,
        lastVariancePercentage: 0,
        alerts: [],
        pricingAdjustments: []
      })
    }
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

// 🆕 NEW: Virtual field for target price per unit (ADDED)
projectSchema.virtual('targetPricePerUnit').get(function() {
  if (this.targetRevenue && this.totalUnits) {
    return Math.round(this.targetRevenue / this.totalUnits);
  }
  return 0;
});

// 🆕 NEW: Virtual field for budget tracking status (ADDED)
projectSchema.virtual('budgetTrackingEnabled').get(function() {
  return this.budgetTracking?.enabled ?? true;
});

// Existing virtual fields (UNCHANGED)
projectSchema.virtual('activePaymentTemplates').get(function() {
  if (!this.paymentConfiguration || !this.paymentConfiguration.paymentPlanTemplates) {
    return [];
  }
  return this.paymentConfiguration.paymentPlanTemplates.filter(template => template && template.isActive);
});

projectSchema.virtual('primaryBankAccount').get(function() {
  if (!this.paymentConfiguration || !this.paymentConfiguration.bankAccountDetails) {
    return null;
  }
  return this.paymentConfiguration.bankAccountDetails.find(account => 
    account && account.isPrimary && account.isActive
  ) || null;
});

// 🆕 NEW: Budget tracking methods (ADDED)

// Method to update budget tracking info
projectSchema.methods.updateBudgetTracking = function(varianceData) {
  if (!this.budgetTracking) {
    this.budgetTracking = {
      enabled: true,
      varianceThreshold: 10,
      alerts: [],
      pricingAdjustments: []
    };
  }
  
  this.budgetTracking.lastVarianceCheck = new Date();
  this.budgetTracking.varianceCheckCount += 1;
  this.budgetTracking.lastVariancePercentage = varianceData.variancePercentage || 0;
  
  // Update target price per unit if not set
  if (!this.budgetTracking.targetPricePerUnit && this.targetRevenue && this.totalUnits) {
    this.budgetTracking.targetPricePerUnit = Math.round(this.targetRevenue / this.totalUnits);
  }
  
  return this.save();
};

// Method to add budget variance alert
projectSchema.methods.addBudgetAlert = function(alertData) {
  if (!this.budgetTracking) {
    this.budgetTracking = { alerts: [] };
  }
  if (!this.budgetTracking.alerts) {
    this.budgetTracking.alerts = [];
  }
  
  // Add new alert
  this.budgetTracking.alerts.push({
    alertType: alertData.type,
    severity: alertData.severity,
    message: alertData.message,
    variancePercentage: alertData.variancePercentage,
    generatedAt: new Date()
  });
  
  // Keep only last 50 alerts
  if (this.budgetTracking.alerts.length > 50) {
    this.budgetTracking.alerts = this.budgetTracking.alerts.slice(-50);
  }
  
  return this.save();
};

// Method to add pricing adjustment record
projectSchema.methods.addPricingAdjustment = function(adjustmentData) {
  if (!this.budgetTracking) {
    this.budgetTracking = { pricingAdjustments: [] };
  }
  if (!this.budgetTracking.pricingAdjustments) {
    this.budgetTracking.pricingAdjustments = [];
  }
  
  this.budgetTracking.pricingAdjustments.push({
    adjustmentDate: new Date(),
    reason: adjustmentData.reason,
    variancePercentage: adjustmentData.variancePercentage,
    adjustmentPercentage: adjustmentData.adjustmentPercentage,
    affectedUnits: adjustmentData.affectedUnits || 0,
    expectedImpact: adjustmentData.expectedImpact,
    adjustedBy: adjustmentData.adjustedBy
  });
  
  return this.save();
};

// Method to get recent budget alerts
projectSchema.methods.getRecentBudgetAlerts = function(limit = 10) {
  if (!this.budgetTracking || !this.budgetTracking.alerts) {
    return [];
  }
  
  return this.budgetTracking.alerts
    .sort((a, b) => new Date(b.generatedAt) - new Date(a.generatedAt))
    .slice(0, limit);
};

// Existing methods (UNCHANGED)
projectSchema.methods.addPaymentPlanTemplate = function(templateData) {
  if (!this.paymentConfiguration) {
    this.paymentConfiguration = { paymentPlanTemplates: [] };
  }
  if (!this.paymentConfiguration.paymentPlanTemplates) {
    this.paymentConfiguration.paymentPlanTemplates = [];
  }
  
  this.paymentConfiguration.paymentPlanTemplates.push(templateData);
  return this.save();
};

projectSchema.methods.updatePaymentPlanTemplate = function(templateId, updateData) {
  if (!this.paymentConfiguration || !this.paymentConfiguration.paymentPlanTemplates) {
    throw new Error('Payment configuration not found');
  }
  
  const template = this.paymentConfiguration.paymentPlanTemplates.id(templateId);
  if (template) {
    Object.assign(template, updateData);
    return this.save();
  }
  throw new Error('Payment plan template not found');
};

projectSchema.methods.deactivatePaymentPlanTemplate = function(templateId) {
  if (!this.paymentConfiguration || !this.paymentConfiguration.paymentPlanTemplates) {
    throw new Error('Payment configuration not found');
  }
  
  const template = this.paymentConfiguration.paymentPlanTemplates.id(templateId);
  if (template) {
    template.isActive = false;
    return this.save();
  }
  throw new Error('Payment plan template not found');
};

projectSchema.methods.removePaymentPlanTemplate = function(templateId) {
  if (!this.paymentConfiguration || !this.paymentConfiguration.paymentPlanTemplates) {
    throw new Error('Payment configuration not found');
  }
  
  this.paymentConfiguration.paymentPlanTemplates.pull(templateId);
  return this.save();
};

projectSchema.methods.getAvailablePaymentMethods = function() {
  if (!this.paymentConfiguration || !this.paymentConfiguration.acceptedPaymentMethods) {
    return [];
  }
  return this.paymentConfiguration.acceptedPaymentMethods.filter(method => 
    method && method.isActive
  );
};

projectSchema.methods.calculateProjectCharges = function(unitPrice, options = {}) {
  const charges = this.paymentConfiguration?.defaultCharges || {};
  const taxes = this.paymentConfiguration?.taxConfiguration || { 
    gstApplicable: true, 
    gstRate: 5, 
    stampDutyRate: 5, 
    registrationFeeRate: 1 
  };
  
  let totalAmount = unitPrice;
  const breakdown = {
    basePrice: unitPrice,
    charges: { ...charges },
    taxes: {},
    discounts: {},
    finalAmount: 0
  };
  
  // Add default charges
  Object.values(charges).forEach(charge => {
    if (typeof charge === 'number' && charge > 0) {
      totalAmount += charge;
    }
  });
  
  // Calculate taxes
  if (taxes.gstApplicable) {
    const gstAmount = (totalAmount * (taxes.gstRate || 5)) / 100;
    breakdown.taxes.gst = gstAmount;
    totalAmount += gstAmount;
  }
  
  if (options.includeStampDuty) {
    const stampDutyAmount = (unitPrice * (taxes.stampDutyRate || 5)) / 100;
    breakdown.taxes.stampDuty = stampDutyAmount;
    totalAmount += stampDutyAmount;
  }
  
  if (options.includeRegistrationFee) {
    const registrationFeeAmount = (unitPrice * (taxes.registrationFeeRate || 1)) / 100;
    breakdown.taxes.registrationFee = registrationFeeAmount;
    totalAmount += registrationFeeAmount;
  }
  
  // Apply discounts if provided
  if (options.discounts) {
    Object.keys(options.discounts).forEach(discountType => {
      const discountAmount = options.discounts[discountType];
      if (typeof discountAmount === 'number' && discountAmount > 0) {
        breakdown.discounts[discountType] = discountAmount;
        totalAmount -= discountAmount;
      }
    });
  }
  
  breakdown.finalAmount = Math.max(0, totalAmount);
  return breakdown;
};

// Static methods
projectSchema.statics.getProjectWithPaymentConfig = async function(projectId) {
  return this.findById(projectId)
    .populate('organization', 'name')
    .select('+paymentConfiguration');
};

// 🆕 NEW: Static method to get project with budget tracking (ADDED)
projectSchema.statics.getProjectWithBudgetTracking = async function(projectId) {
  return this.findById(projectId)
    .populate('organization', 'name')
    .select('+budgetTracking +paymentConfiguration');
};

// Indexes for better performance (ENHANCED)
projectSchema.index({ organization: 1 });
projectSchema.index({ status: 1 });
projectSchema.index({ 'paymentConfiguration.paymentPlanTemplates.isActive': 1 });
// 🆕 NEW: Budget tracking indexes (ADDED)
projectSchema.index({ 'budgetTracking.enabled': 1 });
projectSchema.index({ 'budgetTracking.lastVarianceCheck': 1 });
projectSchema.index({ 'budgetTracking.alerts.generatedAt': -1 });

// Pre-save middleware (ENHANCED)
projectSchema.pre('save', function(next) {
  // Ensure paymentConfiguration exists (EXISTING)
  if (!this.paymentConfiguration) {
    this.paymentConfiguration = {
      defaultPaymentTerms: {
        gracePeriodDays: 7,
        lateFeeRate: 2,
        interestRate: 0,
        compoundInterest: false
      },
      paymentPlanTemplates: [],
      defaultCharges: {
        parkingCharges: 0,
        clubMembership: 0,
        maintenanceDeposit: 0,
        legalCharges: 0,
        powerConnectionCharges: 0,
        waterConnectionCharges: 0,
        sewerageConnectionCharges: 0
      },
      taxConfiguration: {
        gstApplicable: true,
        gstRate: 5,
        stampDutyRate: 5,
        registrationFeeRate: 1
      },
      discountConfiguration: {
        maxDiscountPercentage: 10,
        earlyBirdDiscount: { enabled: false, percentage: 0 },
        bulkBookingDiscount: { enabled: false, minUnits: 1, percentage: 0 }
      },
      acceptedPaymentMethods: [],
      bankAccountDetails: []
    };
  }
  
  // 🆕 NEW: Ensure budgetTracking exists (ADDED)
  if (!this.budgetTracking) {
    this.budgetTracking = {
      enabled: true,
      varianceThreshold: 10,
      lastVarianceCheck: new Date(),
      varianceCheckCount: 0,
      lastVariancePercentage: 0,
      alerts: [],
      pricingAdjustments: []
    };
  }
  
  // 🆕 NEW: Auto-calculate target price per unit (ADDED)
  if (this.targetRevenue && this.totalUnits && this.budgetTracking) {
    this.budgetTracking.targetPricePerUnit = Math.round(this.targetRevenue / this.totalUnits);
  }
  
  next();
});

const Project = mongoose.model('Project', projectSchema);

export default Project;