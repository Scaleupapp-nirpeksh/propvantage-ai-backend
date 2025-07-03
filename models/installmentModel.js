// File: models/installmentModel.js
// Description: Defines the Mongoose schema for individual payment installments with update/recalculation support

import mongoose from 'mongoose';

// Schema for installment adjustments/modifications
const installmentAdjustmentSchema = new mongoose.Schema({
  adjustmentType: {
    type: String,
    enum: ['amount_change', 'date_change', 'late_fee', 'waiver', 'penalty', 'bonus', 'other'],
    required: true
  },
  originalAmount: {
    type: Number,
    required: true
  },
  adjustmentAmount: {
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
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  adjustmentDate: {
    type: Date,
    default: Date.now
  },
  isActive: {
    type: Boolean,
    default: true
  }
});

// Main installment schema
const installmentSchema = new mongoose.Schema({
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
  paymentPlan: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    ref: 'PaymentPlan'
  },
  sale: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    ref: 'Sale'
  },
  customer: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    ref: 'Lead'
  },
  
  // Installment details
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
  milestoneType: {
    type: String,
    enum: ['booking', 'time_based', 'construction', 'possession', 'custom'],
    required: true
  },
  milestoneDescription: {
    type: String,
    trim: true
  },
  
  // Amount details
  originalAmount: {
    type: Number,
    required: true,
    min: 0
  },
  currentAmount: {
    type: Number,
    required: true,
    min: 0
  },
  paidAmount: {
    type: Number,
    default: 0,
    min: 0
  },
  pendingAmount: {
    type: Number,
    default: 0,
    min: 0
  },
  
  // Date management
  originalDueDate: {
    type: Date,
    required: true
  },
  currentDueDate: {
    type: Date,
    required: true
  },
  gracePeriodEndDate: {
    type: Date
  },
  
  // Status tracking
  status: {
    type: String,
    enum: ['pending', 'due', 'overdue', 'partially_paid', 'paid', 'waived', 'cancelled'],
    default: 'pending'
  },
  
  // Late fee management
  lateFeeApplicable: {
    type: Boolean,
    default: true
  },
  lateFeeRate: {
    type: Number,
    default: 0,
    min: 0,
    max: 100
  },
  lateFeeAccrued: {
    type: Number,
    default: 0,
    min: 0
  },
  lateFeeLastCalculated: {
    type: Date
  },
  
  // Payment tracking
  firstPaymentDate: {
    type: Date
  },
  lastPaymentDate: {
    type: Date
  },
  expectedPaymentDate: {
    type: Date
  },
  
  // Installment adjustments history
  adjustments: [installmentAdjustmentSchema],
  
  // Linked payments
  linkedTransactions: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'PaymentTransaction'
  }],
  
  // Additional charges specific to this installment
  additionalCharges: [{
    chargeName: {
      type: String,
      required: true,
      trim: true
    },
    chargeAmount: {
      type: Number,
      required: true,
      min: 0
    },
    chargeType: {
      type: String,
      enum: ['late_fee', 'processing_fee', 'penalty', 'interest', 'other'],
      required: true
    },
    appliedDate: {
      type: Date,
      default: Date.now
    },
    appliedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  }],
  
  // Reminder and communication tracking
  remindersSent: [{
    reminderType: {
      type: String,
      enum: ['pre_due', 'due_today', 'overdue', 'final_notice'],
      required: true
    },
    sentDate: {
      type: Date,
      default: Date.now
    },
    sentBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    method: {
      type: String,
      enum: ['email', 'sms', 'call', 'letter', 'in_person'],
      required: true
    },
    response: {
      type: String,
      trim: true
    }
  }],
  
  // Special conditions
  isOptional: {
    type: Boolean,
    default: false
  },
  canBeWaived: {
    type: Boolean,
    default: false
  },
  requiresApproval: {
    type: Boolean,
    default: false
  },
  
  // Notes and comments
  notes: {
    type: String,
    trim: true
  },
  internalComments: {
    type: String,
    trim: true
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
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Virtual fields
installmentSchema.virtual('isOverdue').get(function() {
  const now = new Date();
  const graceEndDate = this.gracePeriodEndDate || this.currentDueDate;
  return now > graceEndDate && this.status !== 'paid' && this.status !== 'waived';
});

installmentSchema.virtual('isDue').get(function() {
  const now = new Date();
  return now >= this.currentDueDate && now <= (this.gracePeriodEndDate || this.currentDueDate) && this.status !== 'paid' && this.status !== 'waived';
});

installmentSchema.virtual('daysOverdue').get(function() {
  if (!this.isOverdue) return 0;
  const now = new Date();
  const graceEndDate = this.gracePeriodEndDate || this.currentDueDate;
  return Math.floor((now - graceEndDate) / (1000 * 60 * 60 * 24));
});

installmentSchema.virtual('totalAmount').get(function() {
  const additionalChargesTotal = this.additionalCharges.reduce((sum, charge) => sum + charge.chargeAmount, 0);
  return this.currentAmount + additionalChargesTotal;
});

// Instance methods

// Method to calculate and update late fees
installmentSchema.methods.calculateLateFees = function() {
  if (!this.lateFeeApplicable || this.status === 'paid' || this.status === 'waived') {
    return 0;
  }
  
  const now = new Date();
  const graceEndDate = this.gracePeriodEndDate || this.currentDueDate;
  
  if (now <= graceEndDate) {
    return 0;
  }
  
  const daysOverdue = Math.floor((now - graceEndDate) / (1000 * 60 * 60 * 24));
  const monthsOverdue = Math.ceil(daysOverdue / 30);
  
  // Calculate late fee based on pending amount and rate
  const lateFeeAmount = (this.pendingAmount * this.lateFeeRate * monthsOverdue) / 100;
  
  // Update late fee if it has increased
  if (lateFeeAmount > this.lateFeeAccrued) {
    this.lateFeeAccrued = lateFeeAmount;
    this.lateFeeLastCalculated = now;
  }
  
  return this.lateFeeAccrued;
};

// Method to update installment amounts (triggers recalculation)
installmentSchema.methods.updateAmount = async function(newAmount, userId, reason) {
  const originalAmount = this.currentAmount;
  
  // Add adjustment record
  this.adjustments.push({
    adjustmentType: 'amount_change',
    originalAmount: originalAmount,
    adjustmentAmount: newAmount - originalAmount,
    newAmount: newAmount,
    reason: reason || 'Amount updated',
    adjustedBy: userId
  });
  
  // Update current amount
  this.currentAmount = newAmount;
  
  // Recalculate pending amount
  this.pendingAmount = Math.max(0, this.currentAmount - this.paidAmount);
  
  // Update status based on new amounts
  this.updateStatus();
  
  // Update last modified info
  this.lastModifiedBy = userId;
  
  return this.save();
};

// Method to update due date
installmentSchema.methods.updateDueDate = async function(newDueDate, userId, reason) {
  const originalDueDate = this.currentDueDate;
  
  // Add adjustment record
  this.adjustments.push({
    adjustmentType: 'date_change',
    originalAmount: this.currentAmount,
    adjustmentAmount: 0,
    newAmount: this.currentAmount,
    reason: reason || 'Due date updated',
    adjustedBy: userId
  });
  
  // Update due date
  this.currentDueDate = newDueDate;
  
  // Recalculate grace period end date
  const PaymentPlan = mongoose.model('PaymentPlan');
  const paymentPlan = await PaymentPlan.findById(this.paymentPlan);
  const gracePeriodDays = paymentPlan.paymentTerms.gracePeriodDays || 7;
  
  this.gracePeriodEndDate = new Date(newDueDate.getTime() + (gracePeriodDays * 24 * 60 * 60 * 1000));
  
  // Update status
  this.updateStatus();
  
  // Update last modified info
  this.lastModifiedBy = userId;
  
  return this.save();
};

// Method to record payment (partial or full)
installmentSchema.methods.recordPayment = async function(paymentAmount, transactionId) {
  const previousPaidAmount = this.paidAmount;
  this.paidAmount += paymentAmount;
  
  // Update pending amount
  this.pendingAmount = Math.max(0, this.currentAmount - this.paidAmount);
  
  // Set payment dates
  if (!this.firstPaymentDate) {
    this.firstPaymentDate = new Date();
  }
  this.lastPaymentDate = new Date();
  
  // Link transaction
  if (transactionId) {
    this.linkedTransactions.push(transactionId);
  }
  
  // Update status
  this.updateStatus();
  
  return this.save();
};

// Method to update installment status
installmentSchema.methods.updateStatus = function() {
  const now = new Date();
  const graceEndDate = this.gracePeriodEndDate || this.currentDueDate;
  
  if (this.paidAmount >= this.currentAmount) {
    this.status = 'paid';
    this.pendingAmount = 0;
  } else if (this.paidAmount > 0) {
    this.status = 'partially_paid';
  } else if (now > graceEndDate) {
    this.status = 'overdue';
  } else if (now >= this.currentDueDate) {
    this.status = 'due';
  } else {
    this.status = 'pending';
  }
};

// Method to waive installment
installmentSchema.methods.waiveInstallment = async function(userId, reason) {
  if (!this.canBeWaived) {
    throw new Error('This installment cannot be waived');
  }
  
  // Add adjustment record
  this.adjustments.push({
    adjustmentType: 'waiver',
    originalAmount: this.currentAmount,
    adjustmentAmount: -this.pendingAmount,
    newAmount: this.paidAmount,
    reason: reason || 'Installment waived',
    adjustedBy: userId
  });
  
  // Update amounts
  this.currentAmount = this.paidAmount;
  this.pendingAmount = 0;
  this.status = 'waived';
  
  // Update last modified info
  this.lastModifiedBy = userId;
  
  return this.save();
};

// Method to add additional charges
installmentSchema.methods.addAdditionalCharge = function(chargeName, chargeAmount, chargeType, userId) {
  this.additionalCharges.push({
    chargeName,
    chargeAmount,
    chargeType,
    appliedBy: userId
  });
  
  // Update pending amount to include new charge
  this.pendingAmount += chargeAmount;
  
  // Update status
  this.updateStatus();
  
  return this.save();
};

// Static methods

// Method to get installments with payment details
installmentSchema.statics.getInstallmentsWithDetails = async function(filters = {}) {
  const query = this.find(filters)
    .populate('paymentPlan', 'totalAmount status')
    .populate('customer', 'firstName lastName email phone')
    .populate('project', 'name')
    .populate('linkedTransactions', 'amount paymentDate paymentMethod')
    .populate('createdBy', 'firstName lastName')
    .populate('lastModifiedBy', 'firstName lastName')
    .sort({ currentDueDate: 1 });
  
  return query;
};

// Method to get overdue installments
installmentSchema.statics.getOverdueInstallments = async function(organizationId) {
  const now = new Date();
  
  return this.find({
    organization: organizationId,
    status: 'overdue',
    $or: [
      { gracePeriodEndDate: { $lt: now } },
      { 
        gracePeriodEndDate: { $exists: false },
        currentDueDate: { $lt: now }
      }
    ]
  }).populate('customer', 'firstName lastName email phone')
    .populate('project', 'name')
    .sort({ currentDueDate: 1 });
};

// Method to get due installments (including today)
installmentSchema.statics.getDueInstallments = async function(organizationId) {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
  
  return this.find({
    organization: organizationId,
    status: { $in: ['due', 'pending'] },
    currentDueDate: { $gte: startOfDay, $lte: endOfDay }
  }).populate('customer', 'firstName lastName email phone')
    .populate('project', 'name')
    .sort({ currentDueDate: 1 });
};

// Indexes for better performance
installmentSchema.index({ organization: 1, project: 1 });
installmentSchema.index({ paymentPlan: 1 });
installmentSchema.index({ customer: 1 });
installmentSchema.index({ status: 1 });
installmentSchema.index({ currentDueDate: 1 });
installmentSchema.index({ gracePeriodEndDate: 1 });
installmentSchema.index({ installmentNumber: 1 });

const Installment = mongoose.model('Installment', installmentSchema);

export default Installment;