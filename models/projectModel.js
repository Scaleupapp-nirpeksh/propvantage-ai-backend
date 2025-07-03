// File: models/projectModel.js
// Description: Defines the Mongoose schema and model for a Project with payment configuration support

import mongoose from 'mongoose';
import { paymentPlanTemplateSchema } from './paymentPlanModel.js';

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
  },
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
      max: 30
    },
    stampDutyRate: {
      type: Number,
      default: 3,
      min: 0,
      max: 10
    },
    registrationFeeRate: {
      type: Number,
      default: 1,
      min: 0,
      max: 5
    },
    tdsApplicable: {
      type: Boolean,
      default: true
    },
    tdsRate: {
      type: Number,
      default: 1,
      min: 0,
      max: 10
    }
  },
  
  // Discount configuration
  discountConfiguration: {
    earlyBirdDiscount: {
      applicable: { type: Boolean, default: false },
      percentage: { type: Number, default: 0 },
      validUntil: { type: Date }
    },
    loyaltyDiscount: {
      applicable: { type: Boolean, default: false },
      percentage: { type: Number, default: 0 }
    },
    bulkBookingDiscount: {
      applicable: { type: Boolean, default: false },
      percentage: { type: Number, default: 0 },
      minimumUnits: { type: Number, default: 2 }
    },
    maxNegotiationDiscount: {
      type: Number,
      default: 5, // Maximum discount that can be negotiated
      min: 0,
      max: 50
    }
  },
  
  // Payment methods accepted for this project
  acceptedPaymentMethods: [{
    method: {
      type: String,
      enum: ['cash', 'cheque', 'bank_transfer', 'online_payment', 'card_payment', 'demand_draft', 'home_loan'],
      required: true
    },
    isActive: {
      type: Boolean,
      default: true
    },
    processingFee: {
      type: Number,
      default: 0
    },
    minimumAmount: {
      type: Number,
      default: 0
    },
    maximumAmount: {
      type: Number,
      default: 0 // 0 means no limit
    }
  }],
  
  // Bank account details for this project
  bankAccountDetails: [{
    bankName: {
      type: String,
      required: true,
      trim: true
    },
    accountNumber: {
      type: String,
      required: true,
      trim: true
    },
    accountHolderName: {
      type: String,
      required: true,
      trim: true
    },
    ifscCode: {
      type: String,
      required: true,
      trim: true
    },
    branchName: {
      type: String,
      trim: true
    },
    accountType: {
      type: String,
      enum: ['savings', 'current', 'escrow'],
      default: 'current'
    },
    isActive: {
      type: Boolean,
      default: true
    },
    isPrimary: {
      type: Boolean,
      default: false
    }
  }]
});

const projectSchema = new mongoose.Schema(
  {
    organization: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: 'Organization', // Reference to the Organization this project belongs to
    },
    name: {
      type: String,
      required: [true, 'Please add a project name'],
      trim: true,
    },
    type: {
      type: String,
      required: true,
      enum: ['apartment', 'villa', 'commercial', 'plot'],
    },
    location: {
      address: String,
      city: String,
      state: String,
      country: String,
      zipCode: String,
      googleMapsLink: String,
    },
    status: {
      type: String,
      required: true,
      enum: ['planning', 'launched', 'under_construction', 'ready', 'completed'],
      default: 'planning',
    },
    totalUnits: {
      type: Number,
      required: true,
    },
    targetRevenue: {
      type: Number,
      required: [true, 'Please specify the target revenue'],
    },
    launchDate: {
      type: Date,
    },
    possessionDate: {
      type: Date,
    },
    // Flexible object for project-specific configurations like amenities, etc.
    configuration: {
      type: Map,
      of: String,
    },
    // Embedded schemas for financial rules (keeping existing functionality)
    pricingRules: pricingRulesSchema,
    additionalCharges: [additionalChargeSchema],
    
    // NEW: Payment configuration for this project
    paymentConfiguration: {
      type: paymentConfigurationSchema,
      default: () => ({}) // Will use schema defaults
    }
  },
  {
    timestamps: true, // Automatically adds createdAt and updatedAt fields
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

// Virtual to get active payment plan templates
projectSchema.virtual('activePaymentTemplates').get(function() {
  return this.paymentConfiguration.paymentPlanTemplates.filter(template => template.isActive);
});

// Virtual to get primary bank account
projectSchema.virtual('primaryBankAccount').get(function() {
  return this.paymentConfiguration.bankAccountDetails.find(account => account.isPrimary && account.isActive);
});

// Method to add a new payment plan template
projectSchema.methods.addPaymentPlanTemplate = function(templateData) {
  this.paymentConfiguration.paymentPlanTemplates.push(templateData);
  return this.save();
};

// Method to update payment plan template
projectSchema.methods.updatePaymentPlanTemplate = function(templateId, updateData) {
  const template = this.paymentConfiguration.paymentPlanTemplates.id(templateId);
  if (template) {
    Object.assign(template, updateData);
    return this.save();
  }
  throw new Error('Payment plan template not found');
};

// Method to deactivate payment plan template
projectSchema.methods.deactivatePaymentPlanTemplate = function(templateId) {
  const template = this.paymentConfiguration.paymentPlanTemplates.id(templateId);
  if (template) {
    template.isActive = false;
    return this.save();
  }
  throw new Error('Payment plan template not found');
};

// Method to get available payment methods
projectSchema.methods.getAvailablePaymentMethods = function() {
  return this.paymentConfiguration.acceptedPaymentMethods.filter(method => method.isActive);
};

// Method to calculate total project charges for a unit
projectSchema.methods.calculateProjectCharges = function(unitPrice, options = {}) {
  const charges = this.paymentConfiguration.defaultCharges;
  const taxes = this.paymentConfiguration.taxConfiguration;
  
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
    totalAmount += charge;
  });
  
  // Calculate taxes
  if (taxes.gstApplicable) {
    const gstAmount = (totalAmount * taxes.gstRate) / 100;
    breakdown.taxes.gst = gstAmount;
    totalAmount += gstAmount;
  }
  
  if (options.includeStampDuty) {
    const stampDutyAmount = (unitPrice * taxes.stampDutyRate) / 100;
    breakdown.taxes.stampDuty = stampDutyAmount;
    totalAmount += stampDutyAmount;
  }
  
  if (options.includeRegistrationFee) {
    const registrationFeeAmount = (unitPrice * taxes.registrationFeeRate) / 100;
    breakdown.taxes.registrationFee = registrationFeeAmount;
    totalAmount += registrationFeeAmount;
  }
  
  // Apply discounts if provided
  if (options.discounts) {
    Object.keys(options.discounts).forEach(discountType => {
      const discountAmount = options.discounts[discountType];
      breakdown.discounts[discountType] = discountAmount;
      totalAmount -= discountAmount;
    });
  }
  
  breakdown.finalAmount = totalAmount;
  return breakdown;
};

// Static method to get project with payment configuration
projectSchema.statics.getProjectWithPaymentConfig = async function(projectId) {
  return this.findById(projectId)
    .populate('organization', 'name')
    .select('+paymentConfiguration'); // Ensure payment configuration is included
};

// Indexes for better query performance
projectSchema.index({ organization: 1 });
projectSchema.index({ status: 1 });
projectSchema.index({ 'paymentConfiguration.paymentPlanTemplates.isActive': 1 });

const Project = mongoose.model('Project', projectSchema);

export default Project;