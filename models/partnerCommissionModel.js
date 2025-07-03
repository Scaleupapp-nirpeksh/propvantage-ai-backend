// File: models/partnerCommissionModel.js
// Description: Tracks individual partner commission records and calculations

import mongoose from 'mongoose';

// Schema for commission calculation breakdown
const commissionBreakdownSchema = new mongoose.Schema({
  calculationMethod: {
    type: String,
    enum: ['percentage', 'flat_rate', 'tiered', 'hybrid'],
    required: true
  },
  calculationBasis: {
    type: String,
    enum: ['sale_price', 'base_price', 'commission_value'],
    required: true
  },
  calculationBase: {
    type: Number,
    required: true,
    min: 0
  },
  commissionRate: {
    type: Number,
    default: 0,
    min: 0,
    max: 100
  },
  flatAmount: {
    type: Number,
    default: 0,
    min: 0
  },
  tierUsed: {
    tierName: String,
    minSales: Number,
    maxSales: Number,
    commissionRate: Number
  }
});

// Schema for performance bonus breakdown
const bonusBreakdownSchema = new mongoose.Schema({
  bonusName: {
    type: String,
    required: true
  },
  bonusType: {
    type: String,
    enum: ['sales_target', 'unit_count', 'customer_rating', 'time_based'],
    required: true
  },
  bonusAmount: {
    type: Number,
    required: true,
    min: 0
  },
  criteriaValue: {
    type: Number,
    required: true
  },
  actualValue: {
    type: Number,
    required: true
  },
  qualified: {
    type: Boolean,
    required: true
  }
});

// Schema for deduction breakdown
const deductionBreakdownSchema = new mongoose.Schema({
  deductionType: {
    type: String,
    enum: ['tds', 'service_charge', 'processing_fee', 'penalty', 'other'],
    required: true
  },
  deductionName: {
    type: String,
    required: true
  },
  deductionAmount: {
    type: Number,
    required: true,
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
  }
});

// Schema for payment installments
const paymentInstallmentSchema = new mongoose.Schema({
  installmentNumber: {
    type: Number,
    required: true,
    min: 1
  },
  amount: {
    type: Number,
    required: true,
    min: 0
  },
  dueDate: {
    type: Date,
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'paid', 'overdue', 'cancelled'],
    default: 'pending'
  },
  paidDate: {
    type: Date
  },
  paidAmount: {
    type: Number,
    default: 0,
    min: 0
  },
  paymentMethod: {
    type: String,
    enum: ['bank_transfer', 'cheque', 'cash', 'online', 'adjustment']
  },
  paymentReference: {
    type: String,
    trim: true
  },
  notes: {
    type: String,
    trim: true
  }
});

// Main partner commission schema
const partnerCommissionSchema = new mongoose.Schema({
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
    ref: 'Sale'
  },
  partner: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    ref: 'User' // Partner user
  },
  commissionStructure: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    ref: 'CommissionStructure'
  },
  
  // Commission calculation details
  saleDetails: {
    salePrice: {
      type: Number,
      required: true,
      min: 0
    },
    basePrice: {
      type: Number,
      required: true,
      min: 0
    },
    unitType: {
      type: String,
      required: true,
      enum: ['1BHK', '2BHK', '3BHK', '4BHK', 'Villa', 'Plot', 'Commercial', 'Other']
    },
    saleDate: {
      type: Date,
      required: true
    },
    bookingDate: {
      type: Date,
      required: true
    },
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Lead'
    }
  },
  
  // Partner performance data at time of sale
  partnerPerformance: {
    totalSalesVolume: {
      type: Number,
      default: 0,
      min: 0
    },
    totalUnitsSold: {
      type: Number,
      default: 0,
      min: 0
    },
    averageRating: {
      type: Number,
      default: 0,
      min: 0,
      max: 5
    },
    monthsWithCompany: {
      type: Number,
      default: 0,
      min: 0
    },
    lastSaleDate: {
      type: Date
    }
  },
  
  // Commission calculation breakdown
  commissionCalculation: {
    calculationMethod: {
      type: String,
      enum: ['percentage', 'flat_rate', 'tiered', 'hybrid'],
      required: true
    },
    breakdown: commissionBreakdownSchema,
    grossCommission: {
      type: Number,
      required: true,
      min: 0
    },
    bonuses: [bonusBreakdownSchema],
    totalBonuses: {
      type: Number,
      default: 0,
      min: 0
    },
    deductions: [deductionBreakdownSchema],
    totalDeductions: {
      type: Number,
      default: 0,
      min: 0
    },
    netCommission: {
      type: Number,
      required: true,
      min: 0
    },
    calculationDate: {
      type: Date,
      default: Date.now
    }
  },
  
  // Commission status and lifecycle
  status: {
    type: String,
    enum: ['calculated', 'pending_approval', 'approved', 'on_hold', 'paid', 'cancelled', 'clawed_back'],
    default: 'calculated'
  },
  
  // Approval workflow
  approvalWorkflow: {
    requiresApproval: {
      type: Boolean,
      default: false
    },
    approvalStatus: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'not_required'],
      default: 'not_required'
    },
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    approvalDate: {
      type: Date
    },
    approvalNotes: {
      type: String,
      trim: true
    },
    rejectionReason: {
      type: String,
      trim: true
    }
  },
  
  // Payment scheduling
  paymentSchedule: {
    paymentMethod: {
      type: String,
      enum: ['immediate', 'monthly', 'quarterly', 'on_possession', 'custom'],
      default: 'monthly'
    },
    scheduledDate: {
      type: Date,
      required: true
    },
    holdPeriod: {
      type: Number,
      default: 0, // Days
      min: 0
    },
    holdUntil: {
      type: Date
    },
    installments: [paymentInstallmentSchema],
    totalInstallments: {
      type: Number,
      default: 1,
      min: 1
    }
  },
  
  // Payment tracking
  paymentDetails: {
    totalPaid: {
      type: Number,
      default: 0,
      min: 0
    },
    totalPending: {
      type: Number,
      default: 0,
      min: 0
    },
    lastPaymentDate: {
      type: Date
    },
    lastPaymentAmount: {
      type: Number,
      default: 0,
      min: 0
    },
    paymentMethod: {
      type: String,
      enum: ['bank_transfer', 'cheque', 'cash', 'online', 'adjustment']
    },
    paymentReference: {
      type: String,
      trim: true
    },
    bankAccountDetails: {
      accountNumber: String,
      bankName: String,
      ifscCode: String,
      accountHolderName: String
    }
  },
  
  // Tax and compliance
  taxDetails: {
    tdsDeducted: {
      type: Number,
      default: 0,
      min: 0
    },
    tdsRate: {
      type: Number,
      default: 0,
      min: 0,
      max: 30
    },
    tdsCertificateGenerated: {
      type: Boolean,
      default: false
    },
    tdsCertificateNumber: {
      type: String,
      trim: true
    },
    gstAmount: {
      type: Number,
      default: 0,
      min: 0
    },
    gstRate: {
      type: Number,
      default: 0,
      min: 0,
      max: 30
    },
    financialYear: {
      type: String,
      required: true
    }
  },
  
  // Clawback and cancellation
  clawbackDetails: {
    isClawbackEligible: {
      type: Boolean,
      default: true
    },
    clawbackPeriod: {
      type: Number,
      default: 90, // Days
      min: 0
    },
    clawbackAmount: {
      type: Number,
      default: 0,
      min: 0
    },
    clawbackDate: {
      type: Date
    },
    clawbackReason: {
      type: String,
      trim: true
    },
    clawbackBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  },
  
  // Adjustments and modifications
  adjustments: [{
    adjustmentType: {
      type: String,
      enum: ['amount_increase', 'amount_decrease', 'bonus_added', 'deduction_added', 'hold_applied', 'hold_released'],
      required: true
    },
    adjustmentAmount: {
      type: Number,
      required: true
    },
    previousAmount: {
      type: Number,
      required: true
    },
    newAmount: {
      type: Number,
      required: true
    },
    reason: {
      type: String,
      required: true,
      trim: true
    },
    adjustedBy: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: 'User'
    },
    adjustmentDate: {
      type: Date,
      default: Date.now
    },
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  }],
  
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
partnerCommissionSchema.virtual('isOverdue').get(function() {
  const now = new Date();
  return this.paymentSchedule.scheduledDate < now && this.status !== 'paid';
});

partnerCommissionSchema.virtual('daysOverdue').get(function() {
  if (!this.isOverdue) return 0;
  const now = new Date();
  return Math.floor((now - this.paymentSchedule.scheduledDate) / (1000 * 60 * 60 * 24));
});

partnerCommissionSchema.virtual('isClawbackPeriodActive').get(function() {
  if (!this.clawbackDetails.isClawbackEligible) return false;
  const now = new Date();
  const clawbackDeadline = new Date(this.saleDetails.saleDate);
  clawbackDeadline.setDate(clawbackDeadline.getDate() + this.clawbackDetails.clawbackPeriod);
  return now <= clawbackDeadline;
});

partnerCommissionSchema.virtual('pendingAmount').get(function() {
  return this.commissionCalculation.netCommission - this.paymentDetails.totalPaid;
});

// Instance methods

// Method to approve commission
partnerCommissionSchema.methods.approveCommission = async function(userId, notes) {
  if (this.approvalWorkflow.approvalStatus === 'approved') {
    throw new Error('Commission is already approved');
  }
  
  this.approvalWorkflow.approvalStatus = 'approved';
  this.approvalWorkflow.approvedBy = userId;
  this.approvalWorkflow.approvalDate = new Date();
  this.approvalWorkflow.approvalNotes = notes;
  this.status = 'approved';
  this.lastModifiedBy = userId;
  
  return this.save();
};

// Method to reject commission
partnerCommissionSchema.methods.rejectCommission = async function(userId, reason) {
  this.approvalWorkflow.approvalStatus = 'rejected';
  this.approvalWorkflow.rejectionReason = reason;
  this.status = 'cancelled';
  this.lastModifiedBy = userId;
  
  return this.save();
};

// Method to put commission on hold
partnerCommissionSchema.methods.putOnHold = async function(userId, reason, holdDays) {
  this.status = 'on_hold';
  this.paymentSchedule.holdPeriod = holdDays;
  this.paymentSchedule.holdUntil = new Date(Date.now() + (holdDays * 24 * 60 * 60 * 1000));
  
  this.adjustments.push({
    adjustmentType: 'hold_applied',
    adjustmentAmount: 0,
    previousAmount: this.commissionCalculation.netCommission,
    newAmount: this.commissionCalculation.netCommission,
    reason: reason,
    adjustedBy: userId
  });
  
  this.lastModifiedBy = userId;
  
  return this.save();
};

// Method to release hold
partnerCommissionSchema.methods.releaseHold = async function(userId, reason) {
  if (this.status !== 'on_hold') {
    throw new Error('Commission is not on hold');
  }
  
  this.status = 'approved';
  this.paymentSchedule.holdUntil = null;
  
  this.adjustments.push({
    adjustmentType: 'hold_released',
    adjustmentAmount: 0,
    previousAmount: this.commissionCalculation.netCommission,
    newAmount: this.commissionCalculation.netCommission,
    reason: reason,
    adjustedBy: userId
  });
  
  this.lastModifiedBy = userId;
  
  return this.save();
};

// Method to record payment
partnerCommissionSchema.methods.recordPayment = async function(paymentData, userId) {
  const { amount, paymentMethod, paymentReference, paymentDate } = paymentData;
  
  if (amount <= 0) {
    throw new Error('Payment amount must be greater than zero');
  }
  
  if (amount > this.pendingAmount) {
    throw new Error('Payment amount exceeds pending commission');
  }
  
  // Update payment details
  this.paymentDetails.totalPaid += amount;
  this.paymentDetails.totalPending = this.commissionCalculation.netCommission - this.paymentDetails.totalPaid;
  this.paymentDetails.lastPaymentDate = paymentDate || new Date();
  this.paymentDetails.lastPaymentAmount = amount;
  this.paymentDetails.paymentMethod = paymentMethod;
  this.paymentDetails.paymentReference = paymentReference;
  
  // Update installments if applicable
  if (this.paymentSchedule.installments.length > 0) {
    let remainingAmount = amount;
    for (const installment of this.paymentSchedule.installments) {
      if (remainingAmount <= 0) break;
      if (installment.status === 'pending') {
        const installmentPendingAmount = installment.amount - installment.paidAmount;
        const paymentToInstallment = Math.min(remainingAmount, installmentPendingAmount);
        
        installment.paidAmount += paymentToInstallment;
        remainingAmount -= paymentToInstallment;
        
        if (installment.paidAmount >= installment.amount) {
          installment.status = 'paid';
          installment.paidDate = paymentDate || new Date();
        }
      }
    }
  }
  
  // Update status
  if (this.paymentDetails.totalPending <= 0) {
    this.status = 'paid';
  }
  
  this.lastModifiedBy = userId;
  
  return this.save();
};

// Method to clawback commission
partnerCommissionSchema.methods.clawbackCommission = async function(userId, reason, clawbackAmount) {
  if (!this.isClawbackPeriodActive) {
    throw new Error('Clawback period has expired');
  }
  
  if (clawbackAmount > this.paymentDetails.totalPaid) {
    throw new Error('Clawback amount exceeds paid amount');
  }
  
  this.clawbackDetails.clawbackAmount = clawbackAmount;
  this.clawbackDetails.clawbackDate = new Date();
  this.clawbackDetails.clawbackReason = reason;
  this.clawbackDetails.clawbackBy = userId;
  
  this.paymentDetails.totalPaid -= clawbackAmount;
  this.paymentDetails.totalPending += clawbackAmount;
  
  this.status = 'clawed_back';
  this.lastModifiedBy = userId;
  
  return this.save();
};

// Method to adjust commission amount
partnerCommissionSchema.methods.adjustCommissionAmount = async function(newAmount, reason, userId) {
  const previousAmount = this.commissionCalculation.netCommission;
  const adjustmentAmount = newAmount - previousAmount;
  
  this.commissionCalculation.netCommission = newAmount;
  this.paymentDetails.totalPending = newAmount - this.paymentDetails.totalPaid;
  
  this.adjustments.push({
    adjustmentType: adjustmentAmount > 0 ? 'amount_increase' : 'amount_decrease',
    adjustmentAmount: Math.abs(adjustmentAmount),
    previousAmount: previousAmount,
    newAmount: newAmount,
    reason: reason,
    adjustedBy: userId
  });
  
  this.lastModifiedBy = userId;
  
  return this.save();
};

// Static methods

// Method to get partner commissions with details
partnerCommissionSchema.statics.getPartnerCommissionsWithDetails = async function(filters = {}) {
  return this.find(filters)
    .populate('partner', 'firstName lastName email phone')
    .populate('project', 'name')
    .populate('sale', 'salePrice bookingDate')
    .populate('commissionStructure', 'structureName calculationMethod')
    .populate('createdBy', 'firstName lastName')
    .populate('approvalWorkflow.approvedBy', 'firstName lastName')
    .sort({ createdAt: -1 });
};

// Method to get overdue commissions
partnerCommissionSchema.statics.getOverdueCommissions = async function(organizationId) {
  const now = new Date();
  
  return this.find({
    organization: organizationId,
    status: { $in: ['approved', 'on_hold'] },
    'paymentSchedule.scheduledDate': { $lt: now }
  }).populate('partner', 'firstName lastName email phone')
    .populate('project', 'name')
    .sort({ 'paymentSchedule.scheduledDate': 1 });
};

// Method to get partner commission summary
partnerCommissionSchema.statics.getPartnerCommissionSummary = async function(organizationId, partnerId, period) {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - period);
  
  return this.aggregate([
    {
      $match: {
        organization: organizationId,
        partner: partnerId,
        createdAt: { $gte: startDate }
      }
    },
    {
      $group: {
        _id: null,
        totalCommissions: { $sum: '$commissionCalculation.netCommission' },
        totalPaid: { $sum: '$paymentDetails.totalPaid' },
        totalPending: { $sum: '$paymentDetails.totalPending' },
        totalSales: { $sum: '$saleDetails.salePrice' },
        commissionsCount: { $sum: 1 },
        averageCommission: { $avg: '$commissionCalculation.netCommission' }
      }
    }
  ]);
};

// Indexes for better performance
partnerCommissionSchema.index({ organization: 1, partner: 1 });
partnerCommissionSchema.index({ project: 1 });
partnerCommissionSchema.index({ sale: 1 });
partnerCommissionSchema.index({ status: 1 });
partnerCommissionSchema.index({ 'paymentSchedule.scheduledDate': 1 });
partnerCommissionSchema.index({ 'saleDetails.saleDate': 1 });
partnerCommissionSchema.index({ 'approvalWorkflow.approvalStatus': 1 });

const PartnerCommission = mongoose.model('PartnerCommission', partnerCommissionSchema);

export default PartnerCommission;