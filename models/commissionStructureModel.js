// File: models/commissionStructureModel.js
// Description: Defines commission calculation rules and structures for partners

import mongoose from 'mongoose';

// Schema for individual commission tier
const commissionTierSchema = new mongoose.Schema({
  tierName: {
    type: String,
    required: true,
    trim: true
  },
  minSales: {
    type: Number,
    required: true,
    min: 0
  },
  maxSales: {
    type: Number,
    default: null // null means unlimited
  },
  commissionRate: {
    type: Number,
    required: true,
    min: 0,
    max: 100
  },
  flatAmount: {
    type: Number,
    default: 0,
    min: 0
  },
  isActive: {
    type: Boolean,
    default: true
  }
});

// Schema for performance bonus criteria
const performanceBonusSchema = new mongoose.Schema({
  bonusName: {
    type: String,
    required: true,
    trim: true
  },
  bonusType: {
    type: String,
    enum: ['sales_target', 'unit_count', 'customer_rating', 'time_based'],
    required: true
  },
  criteriaValue: {
    type: Number,
    required: true,
    min: 0
  },
  bonusAmount: {
    type: Number,
    default: 0,
    min: 0
  },
  bonusPercentage: {
    type: Number,
    default: 0,
    min: 0,
    max: 100
  },
  validFrom: {
    type: Date,
    required: true
  },
  validUntil: {
    type: Date,
    required: true
  },
  isActive: {
    type: Boolean,
    default: true
  }
});

// Schema for commission deduction rules
const commissionDeductionSchema = new mongoose.Schema({
  deductionName: {
    type: String,
    required: true,
    trim: true
  },
  deductionType: {
    type: String,
    enum: ['tds', 'service_charge', 'processing_fee', 'penalty', 'other'],
    required: true
  },
  deductionAmount: {
    type: Number,
    default: 0,
    min: 0
  },
  deductionPercentage: {
    type: Number,
    default: 0,
    min: 0,
    max: 100
  },
  isAutoDeducted: {
    type: Boolean,
    default: true
  },
  isActive: {
    type: Boolean,
    default: true
  }
});

// Main commission structure schema
const commissionStructureSchema = new mongoose.Schema({
  organization: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    ref: 'Organization'
  },
  project: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Project' // null means applies to all projects
  },
  structureName: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    trim: true
  },
  
  // Commission calculation method
  calculationMethod: {
    type: String,
    enum: ['percentage', 'flat_rate', 'tiered', 'hybrid'],
    required: true
  },
  
  // Basic commission settings
  baseCommissionRate: {
    type: Number,
    default: 0,
    min: 0,
    max: 100
  },
  baseFlatAmount: {
    type: Number,
    default: 0,
    min: 0
  },
  
  // Tiered commission structure
  commissionTiers: [commissionTierSchema],
  
  // Performance bonuses
  performanceBonuses: [performanceBonusSchema],
  
  // Commission deductions
  commissionDeductions: [commissionDeductionSchema],
  
  // Commission calculation basis
  calculationBasis: {
    type: String,
    enum: ['sale_price', 'base_price', 'commission_value', 'custom'],
    default: 'sale_price'
  },
  
  // Unit type specific rates
  unitTypeRates: [{
    unitType: {
      type: String,
      required: true,
      enum: ['1BHK', '2BHK', '3BHK', '4BHK', 'Villa', 'Plot', 'Commercial', 'Other']
    },
    commissionRate: {
      type: Number,
      required: true,
      min: 0,
      max: 100
    },
    flatAmount: {
      type: Number,
      default: 0,
      min: 0
    }
  }],
  
  // Payment terms
  paymentTerms: {
    paymentSchedule: {
      type: String,
      enum: ['immediate', 'monthly', 'quarterly', 'on_possession', 'custom'],
      default: 'monthly'
    },
    paymentDelay: {
      type: Number,
      default: 30, // Days after sale
      min: 0
    },
    holdPeriod: {
      type: Number,
      default: 0, // Days to hold commission
      min: 0
    },
    minimumPayoutAmount: {
      type: Number,
      default: 0,
      min: 0
    }
  },
  
  // TDS and tax settings
  taxSettings: {
    tdsApplicable: {
      type: Boolean,
      default: true
    },
    tdsRate: {
      type: Number,
      default: 5, // 5% TDS
      min: 0,
      max: 30
    },
    gstApplicable: {
      type: Boolean,
      default: false
    },
    gstRate: {
      type: Number,
      default: 0,
      min: 0,
      max: 30
    }
  },
  
  // Eligibility criteria
  eligibilityCriteria: {
    partnerTypes: [{
      type: String,
      enum: ['channel_partner', 'broker', 'employee', 'referral', 'digital_partner']
    }],
    minimumExperience: {
      type: Number,
      default: 0, // Months
      min: 0
    },
    minimumRating: {
      type: Number,
      default: 0,
      min: 0,
      max: 5
    },
    territoryRestrictions: [{
      type: String,
      trim: true
    }],
    exclusivityRequired: {
      type: Boolean,
      default: false
    }
  },
  
  // Approval workflow
  approvalWorkflow: {
    requiresApproval: {
      type: Boolean,
      default: false
    },
    approvalThreshold: {
      type: Number,
      default: 0 // Amount above which approval is required
    },
    approvers: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }],
    autoApproveBelow: {
      type: Number,
      default: 0
    }
  },
  
  // Validity period
  validityPeriod: {
    startDate: {
      type: Date,
      required: true
    },
    endDate: {
      type: Date,
      required: true
    },
    isActive: {
      type: Boolean,
      default: true
    }
  },
  
  // Special conditions
  specialConditions: {
    clawbackPeriod: {
      type: Number,
      default: 0, // Days - commission can be clawed back
      min: 0
    },
    cancellationPolicy: {
      type: String,
      enum: ['full_clawback', 'partial_clawback', 'no_clawback'],
      default: 'full_clawback'
    },
    partialPaymentHandling: {
      type: String,
      enum: ['proportional', 'milestone_based', 'full_on_completion'],
      default: 'proportional'
    }
  },
  
  // Usage tracking
  usageStats: {
    totalPartnersUsing: {
      type: Number,
      default: 0
    },
    totalCommissionPaid: {
      type: Number,
      default: 0
    },
    totalSalesGenerated: {
      type: Number,
      default: 0
    },
    lastUsedDate: {
      type: Date
    }
  },
  
  // Audit trail
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    ref: 'User'
  },
  lastModifiedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  modificationHistory: [{
    modifiedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    modificationDate: {
      type: Date,
      default: Date.now
    },
    changes: {
      type: String,
      trim: true
    },
    reason: {
      type: String,
      trim: true
    }
  }],
  
  // Notes and comments
  notes: {
    type: String,
    trim: true
  },
  internalComments: {
    type: String,
    trim: true
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Virtual fields
commissionStructureSchema.virtual('isCurrentlyActive').get(function() {
  const now = new Date();
  return this.validityPeriod.isActive && 
         this.validityPeriod.startDate <= now && 
         this.validityPeriod.endDate >= now;
});

commissionStructureSchema.virtual('daysRemaining').get(function() {
  const now = new Date();
  if (this.validityPeriod.endDate < now) return 0;
  return Math.ceil((this.validityPeriod.endDate - now) / (1000 * 60 * 60 * 24));
});

// Instance methods

// Method to calculate commission for a sale
commissionStructureSchema.methods.calculateCommission = function(saleData, partnerData) {
  if (!this.isCurrentlyActive) {
    throw new Error('Commission structure is not active');
  }
  
  const { salePrice, basePrice, unitType, partnerSalesVolume } = saleData;
  let calculationBase = 0;
  
  // Determine calculation base
  switch (this.calculationBasis) {
    case 'sale_price':
      calculationBase = salePrice;
      break;
    case 'base_price':
      calculationBase = basePrice;
      break;
    case 'commission_value':
      calculationBase = saleData.commissionValue || salePrice;
      break;
    default:
      calculationBase = salePrice;
  }
  
  let commissionAmount = 0;
  
  // Calculate based on method
  switch (this.calculationMethod) {
    case 'percentage':
      commissionAmount = this.calculatePercentageCommission(calculationBase, unitType);
      break;
    case 'flat_rate':
      commissionAmount = this.calculateFlatCommission(unitType);
      break;
    case 'tiered':
      commissionAmount = this.calculateTieredCommission(calculationBase, partnerSalesVolume);
      break;
    case 'hybrid':
      commissionAmount = this.calculateHybridCommission(calculationBase, unitType, partnerSalesVolume);
      break;
  }
  
  // Add performance bonuses
  const bonusAmount = this.calculatePerformanceBonuses(saleData, partnerData);
  commissionAmount += bonusAmount;
  
  // Calculate deductions
  const deductions = this.calculateDeductions(commissionAmount);
  
  // Calculate final amount
  const finalAmount = commissionAmount - deductions.totalDeductions;
  
  return {
    grossCommission: commissionAmount,
    bonusAmount,
    deductions,
    netCommission: finalAmount,
    calculationDetails: {
      method: this.calculationMethod,
      basis: this.calculationBasis,
      calculationBase,
      rate: this.getApplicableRate(unitType, partnerSalesVolume)
    }
  };
};

// Method to calculate percentage-based commission
commissionStructureSchema.methods.calculatePercentageCommission = function(calculationBase, unitType) {
  const rate = this.getUnitTypeRate(unitType) || this.baseCommissionRate;
  return (calculationBase * rate) / 100;
};

// Method to calculate flat commission
commissionStructureSchema.methods.calculateFlatCommission = function(unitType) {
  const unitTypeConfig = this.unitTypeRates.find(utr => utr.unitType === unitType);
  return unitTypeConfig?.flatAmount || this.baseFlatAmount;
};

// Method to calculate tiered commission
commissionStructureSchema.methods.calculateTieredCommission = function(calculationBase, partnerSalesVolume) {
  const applicableTier = this.getApplicableTier(partnerSalesVolume);
  if (!applicableTier) return 0;
  
  return (calculationBase * applicableTier.commissionRate) / 100 + applicableTier.flatAmount;
};

// Method to calculate hybrid commission
commissionStructureSchema.methods.calculateHybridCommission = function(calculationBase, unitType, partnerSalesVolume) {
  const percentageCommission = this.calculatePercentageCommission(calculationBase, unitType);
  const flatCommission = this.calculateFlatCommission(unitType);
  const tieredCommission = this.calculateTieredCommission(calculationBase, partnerSalesVolume);
  
  return Math.max(percentageCommission, flatCommission, tieredCommission);
};

// Method to get applicable commission tier
commissionStructureSchema.methods.getApplicableTier = function(salesVolume) {
  return this.commissionTiers
    .filter(tier => tier.isActive)
    .find(tier => {
      const minSales = tier.minSales || 0;
      const maxSales = tier.maxSales || Infinity;
      return salesVolume >= minSales && salesVolume < maxSales;
    });
};

// Method to get unit type specific rate
commissionStructureSchema.methods.getUnitTypeRate = function(unitType) {
  const unitTypeConfig = this.unitTypeRates.find(utr => utr.unitType === unitType);
  return unitTypeConfig?.commissionRate;
};

// Method to calculate performance bonuses
commissionStructureSchema.methods.calculatePerformanceBonuses = function(saleData, partnerData) {
  const now = new Date();
  let totalBonus = 0;
  
  this.performanceBonuses
    .filter(bonus => bonus.isActive && bonus.validFrom <= now && bonus.validUntil >= now)
    .forEach(bonus => {
      if (this.isEligibleForBonus(bonus, saleData, partnerData)) {
        totalBonus += bonus.bonusAmount;
        if (bonus.bonusPercentage > 0) {
          totalBonus += (saleData.salePrice * bonus.bonusPercentage) / 100;
        }
      }
    });
  
  return totalBonus;
};

// Method to calculate deductions
commissionStructureSchema.methods.calculateDeductions = function(commissionAmount) {
  const deductions = {
    tds: 0,
    serviceCharge: 0,
    processingFee: 0,
    other: 0,
    totalDeductions: 0
  };
  
  // Calculate TDS
  if (this.taxSettings.tdsApplicable) {
    deductions.tds = (commissionAmount * this.taxSettings.tdsRate) / 100;
  }
  
  // Calculate other deductions
  this.commissionDeductions
    .filter(deduction => deduction.isActive)
    .forEach(deduction => {
      let deductionAmount = deduction.deductionAmount;
      if (deduction.deductionPercentage > 0) {
        deductionAmount += (commissionAmount * deduction.deductionPercentage) / 100;
      }
      
      switch (deduction.deductionType) {
        case 'service_charge':
          deductions.serviceCharge += deductionAmount;
          break;
        case 'processing_fee':
          deductions.processingFee += deductionAmount;
          break;
        default:
          deductions.other += deductionAmount;
      }
    });
  
  deductions.totalDeductions = deductions.tds + deductions.serviceCharge + deductions.processingFee + deductions.other;
  
  return deductions;
};

// Method to check bonus eligibility
commissionStructureSchema.methods.isEligibleForBonus = function(bonus, saleData, partnerData) {
  switch (bonus.bonusType) {
    case 'sales_target':
      return partnerData.totalSales >= bonus.criteriaValue;
    case 'unit_count':
      return partnerData.unitsSold >= bonus.criteriaValue;
    case 'customer_rating':
      return partnerData.averageRating >= bonus.criteriaValue;
    case 'time_based':
      return saleData.saleDate <= bonus.criteriaValue;
    default:
      return false;
  }
};

// Static methods

// Method to get active commission structures
commissionStructureSchema.statics.getActiveStructures = async function(organizationId, projectId = null) {
  const now = new Date();
  const query = {
    organization: organizationId,
    'validityPeriod.isActive': true,
    'validityPeriod.startDate': { $lte: now },
    'validityPeriod.endDate': { $gte: now }
  };
  
  if (projectId) {
    query.$or = [
      { project: projectId },
      { project: null }
    ];
  }
  
  return this.find(query).sort({ createdAt: -1 });
};

// Method to find best commission structure for partner
commissionStructureSchema.statics.findBestStructureForPartner = async function(organizationId, projectId, partnerType, salesVolume) {
  const activeStructures = await this.getActiveStructures(organizationId, projectId);
  
  return activeStructures
    .filter(structure => {
      return structure.eligibilityCriteria.partnerTypes.includes(partnerType);
    })
    .sort((a, b) => {
      // Sort by potential commission amount (descending)
      const commissionA = a.calculateCommission({ salePrice: 1000000, partnerSalesVolume: salesVolume }, {});
      const commissionB = b.calculateCommission({ salePrice: 1000000, partnerSalesVolume: salesVolume }, {});
      return commissionB.netCommission - commissionA.netCommission;
    })[0];
};

// Indexes for better performance
commissionStructureSchema.index({ organization: 1, project: 1 });
commissionStructureSchema.index({ 'validityPeriod.startDate': 1, 'validityPeriod.endDate': 1 });
commissionStructureSchema.index({ 'validityPeriod.isActive': 1 });
commissionStructureSchema.index({ calculationMethod: 1 });

const CommissionStructure = mongoose.model('CommissionStructure', commissionStructureSchema);

export default CommissionStructure;