// File: models/paymentPlanModel.js
// Description: Defines the Mongoose schema for payment plans with project-level customization

import mongoose from 'mongoose';

// Schema for individual installment configuration within a payment plan
const installmentConfigSchema = new mongoose.Schema({
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
    default: 0, // Days after booking/previous installment
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

// Schema for payment plan templates at project level
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
  installments: [installmentConfigSchema],
  totalPercentage: {
    type: Number,
    default: 100,
    validate: {
      validator: function() {
        // Calculate total percentage from installments
        const total = this.installments.reduce((sum, inst) => sum + inst.percentage, 0);
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
    max: 100 // Percentage per month
  },
  isActive: {
    type: Boolean,
    default: true
  }
});

// Main payment plan schema for actual customer payment plans
const paymentPlanSchema = new mongoose.Schema({
  organization: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    ref: 'Organization'
  },
  project: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    ref: 'Project'
  },
  sale: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    ref: 'Sale',
    unique: true // One payment plan per sale
  },
  customer: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    ref: 'Lead' // Customer info from lead
  },
  templateUsed: {
    type: String,
    trim: true // Name of the template used
  },
  planType: {
    type: String,
    enum: ['construction_linked', 'time_based', 'milestone_based', 'custom'],
    required: true
  },
  totalAmount: {
    type: Number,
    required: true,
    min: 0
  },
  baseAmount: {
    type: Number,
    required: true,
    min: 0 // Amount before taxes and additional charges
  },
  // Breakdown of total amount
  amountBreakdown: {
    basePrice: {
      type: Number,
      required: true,
      min: 0
    },
    taxes: {
      gst: { type: Number, default: 0 },
      stampDuty: { type: Number, default: 0 },
      registrationFees: { type: Number, default: 0 },
      otherTaxes: { type: Number, default: 0 }
    },
    additionalCharges: {
      parkingCharges: { type: Number, default: 0 },
      clubMembership: { type: Number, default: 0 },
      maintenanceDeposit: { type: Number, default: 0 },
      legalCharges: { type: Number, default: 0 },
      otherCharges: { type: Number, default: 0 }
    },
    discounts: {
      earlyBirdDiscount: { type: Number, default: 0 },
      loyaltyDiscount: { type: Number, default: 0 },
      negotiatedDiscount: { type: Number, default: 0 },
      otherDiscounts: { type: Number, default: 0 }
    }
  },
  // Payment terms
  paymentTerms: {
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
  // Current status
  status: {
    type: String,
    enum: ['active', 'completed', 'defaulted', 'cancelled'],
    default: 'active'
  },
  // Financial summary (calculated fields)
  financialSummary: {
    totalPaid: {
      type: Number,
      default: 0,
      min: 0
    },
    totalOutstanding: {
      type: Number,
      default: 0
    },
    totalOverdue: {
      type: Number,
      default: 0
    },
    totalLateFees: {
      type: Number,
      default: 0
    },
    nextDueAmount: {
      type: Number,
      default: 0
    },
    nextDueDate: {
      type: Date
    },
    lastPaymentDate: {
      type: Date
    },
    lastPaymentAmount: {
      type: Number,
      default: 0
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
    modifiedAt: {
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
  // Special notes and comments
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

// Virtual for completion percentage
paymentPlanSchema.virtual('completionPercentage').get(function() {
  if (this.totalAmount === 0) return 0;
  return Math.round((this.financialSummary.totalPaid / this.totalAmount) * 100);
});

// Virtual for remaining balance
paymentPlanSchema.virtual('remainingBalance').get(function() {
  return this.totalAmount - this.financialSummary.totalPaid;
});

// Method to calculate financial summary
paymentPlanSchema.methods.calculateFinancialSummary = async function() {
  const Installment = mongoose.model('Installment');
  const PaymentTransaction = mongoose.model('PaymentTransaction');
  
  // Get all installments for this payment plan
  const installments = await Installment.find({ paymentPlan: this._id });
  
  // Get all transactions for this payment plan
  const transactions = await PaymentTransaction.find({ 
    paymentPlan: this._id,
    status: { $in: ['completed', 'cleared'] }
  });
  
  // Calculate totals
  const totalPaid = transactions.reduce((sum, transaction) => sum + transaction.amount, 0);
  const totalOutstanding = Math.max(0, this.totalAmount - totalPaid);
  
  // Calculate overdue amounts
  const now = new Date();
  const overdueInstallments = installments.filter(inst => 
    inst.dueDate < now && inst.status === 'pending'
  );
  const totalOverdue = overdueInstallments.reduce((sum, inst) => sum + inst.pendingAmount, 0);
  
  // Calculate total late fees
  const totalLateFees = installments.reduce((sum, inst) => sum + (inst.lateFeeAccrued || 0), 0);
  
  // Find next due installment
  const nextDueInstallment = installments
    .filter(inst => inst.status === 'pending')
    .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate))[0];
  
  // Find last payment
  const lastPayment = transactions
    .sort((a, b) => new Date(b.paymentDate) - new Date(a.paymentDate))[0];
  
  // Update financial summary
  this.financialSummary = {
    totalPaid,
    totalOutstanding,
    totalOverdue,
    totalLateFees,
    nextDueAmount: nextDueInstallment?.pendingAmount || 0,
    nextDueDate: nextDueInstallment?.dueDate || null,
    lastPaymentDate: lastPayment?.paymentDate || null,
    lastPaymentAmount: lastPayment?.amount || 0
  };
  
  return this.financialSummary;
};

// Method to add modification history
paymentPlanSchema.methods.addModificationHistory = function(userId, changes, reason) {
  this.modificationHistory.push({
    modifiedBy: userId,
    modifiedAt: new Date(),
    changes,
    reason
  });
  this.lastModifiedBy = userId;
};

// Static method to get payment plan with populated data
paymentPlanSchema.statics.getPaymentPlanWithDetails = async function(paymentPlanId) {
  return this.findById(paymentPlanId)
    .populate('organization', 'name')
    .populate('project', 'name type')
    .populate('sale', 'salePrice bookingDate')
    .populate('customer', 'firstName lastName email phone')
    .populate('createdBy', 'firstName lastName')
    .populate('lastModifiedBy', 'firstName lastName')
    .populate('modificationHistory.modifiedBy', 'firstName lastName');
};

// Indexes for better query performance
paymentPlanSchema.index({ organization: 1, project: 1 });
paymentPlanSchema.index({ sale: 1 });
paymentPlanSchema.index({ customer: 1 });
paymentPlanSchema.index({ status: 1 });
paymentPlanSchema.index({ 'financialSummary.nextDueDate': 1 });

const PaymentPlan = mongoose.model('PaymentPlan', paymentPlanSchema);

// Export both schemas for use in project model
export { PaymentPlan, paymentPlanTemplateSchema };
export default PaymentPlan;