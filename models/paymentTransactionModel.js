// File: models/paymentTransactionModel.js
// Description: Defines the Mongoose schema for payment transactions with update/recalculation support

import mongoose from 'mongoose';

// Schema for payment allocation (how payment is distributed across installments)
const paymentAllocationSchema = new mongoose.Schema({
  installment: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    ref: 'Installment'
  },
  allocatedAmount: {
    type: Number,
    required: true,
    min: 0
  },
  allocationDate: {
    type: Date,
    default: Date.now
  },
  allocationType: {
    type: String,
    enum: ['principal', 'late_fee', 'interest', 'penalty', 'adjustment'],
    default: 'principal'
  }
});

// Schema for payment method details
const paymentMethodDetailsSchema = new mongoose.Schema({
  // For cheque payments
  chequeNumber: String,
  chequeDate: Date,
  bankName: String,
  chequeStatus: {
    type: String,
    enum: ['pending', 'cleared', 'bounced', 'cancelled'],
    default: 'pending'
  },
  
  // For bank transfer/NEFT/RTGS
  referenceNumber: String,
  transactionId: String,
  
  // For online payments
  paymentGateway: String,
  gatewayTransactionId: String,
  
  // For card payments
  cardLastFourDigits: String,
  cardType: String,
  
  // For cash payments
  receiptNumber: String,
  
  // For demand draft
  ddNumber: String,
  ddDate: Date,
  
  // For home loan
  loanAccountNumber: String,
  lenderName: String,
  loanReferenceNumber: String
});

// Schema for payment verification
const paymentVerificationSchema = new mongoose.Schema({
  verificationStatus: {
    type: String,
    enum: ['pending', 'verified', 'discrepancy', 'rejected'],
    default: 'pending'
  },
  verifiedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  verificationDate: {
    type: Date
  },
  verificationNotes: {
    type: String,
    trim: true
  },
  bankStatementMatched: {
    type: Boolean,
    default: false
  },
  discrepancyAmount: {
    type: Number,
    default: 0
  },
  discrepancyReason: {
    type: String,
    trim: true
  }
});

// Main payment transaction schema
const paymentTransactionSchema = new mongoose.Schema({
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
  customer: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    ref: 'Lead'
  },
  
  // Transaction identification
  transactionNumber: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  
  // Amount details
  amount: {
    type: Number,
    required: true,
    min: 0
  },
  originalAmount: {
    type: Number,
    required: true,
    min: 0
  },
  
  // Payment details
  paymentDate: {
    type: Date,
    required: true
  },
  receivedDate: {
    type: Date,
    default: Date.now
  },
  
  // Payment method information
  paymentMethod: {
    type: String,
    enum: ['cash', 'cheque', 'bank_transfer', 'online_payment', 'card_payment', 'demand_draft', 'home_loan'],
    required: true
  },
  paymentMethodDetails: paymentMethodDetailsSchema,
  
  // Transaction status
  status: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'cleared', 'bounced', 'cancelled', 'refunded'],
    default: 'pending'
  },
  
  // Payment allocation across installments
  paymentAllocations: [paymentAllocationSchema],
  
  // Bank account where payment was received
  receivedInAccount: {
    accountNumber: String,
    bankName: String,
    ifscCode: String
  },
  
  // Processing fees and charges
  processingFee: {
    type: Number,
    default: 0,
    min: 0
  },
  bankCharges: {
    type: Number,
    default: 0,
    min: 0
  },
  netAmount: {
    type: Number,
    min: 0
  },
  
  // Verification details
  verification: paymentVerificationSchema,
  
  // Receipt information
  receiptGenerated: {
    type: Boolean,
    default: false
  },
  receiptNumber: {
    type: String,
    trim: true
  },
  receiptDate: {
    type: Date
  },
  
  // Modification tracking
  modifications: [{
    modifiedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    modificationDate: {
      type: Date,
      default: Date.now
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
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    modificationType: {
      type: String,
      enum: ['amount_change', 'date_change', 'method_change', 'status_change', 'allocation_change'],
      required: true
    }
  }],
  
  // Refund information
  refundDetails: {
    refundAmount: {
      type: Number,
      default: 0,
      min: 0
    },
    refundDate: {
      type: Date
    },
    refundReason: {
      type: String,
      trim: true
    },
    refundMethod: {
      type: String,
      enum: ['bank_transfer', 'cheque', 'cash', 'adjustment'],
    },
    refundReference: {
      type: String,
      trim: true
    },
    refundedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  },
  
  // Special flags
  isAdvancePayment: {
    type: Boolean,
    default: false
  },
  isPartialPayment: {
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
  recordedBy: {
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
paymentTransactionSchema.virtual('isCleared').get(function() {
  return this.status === 'cleared' || this.status === 'completed';
});

paymentTransactionSchema.virtual('totalAllocated').get(function() {
  return this.paymentAllocations.reduce((sum, allocation) => sum + allocation.allocatedAmount, 0);
});

paymentTransactionSchema.virtual('unallocatedAmount').get(function() {
  return this.amount - this.totalAllocated;
});

// Instance methods

// Method to update payment amount and trigger recalculation
paymentTransactionSchema.methods.updateAmount = async function(newAmount, userId, reason) {
  const originalAmount = this.amount;
  
  // Add modification record
  this.modifications.push({
    modifiedBy: userId,
    previousAmount: originalAmount,
    newAmount: newAmount,
    reason: reason || 'Payment amount updated',
    modificationType: 'amount_change'
  });
  
  // Update amounts
  this.originalAmount = this.originalAmount || originalAmount;
  this.amount = newAmount;
  
  // Recalculate net amount
  this.netAmount = this.amount - this.processingFee - this.bankCharges;
  
  // Update last modified info
  this.lastModifiedBy = userId;
  
  // Save transaction
  await this.save();
  
  // Trigger recalculation of payment plan
  await this.recalculatePaymentPlan();
  
  return this;
};

// Method to allocate payment to installments
paymentTransactionSchema.methods.allocateToInstallments = async function(allocations) {
  // Clear existing allocations
  this.paymentAllocations = [];
  
  // Add new allocations
  let totalAllocated = 0;
  for (const allocation of allocations) {
    this.paymentAllocations.push(allocation);
    totalAllocated += allocation.allocatedAmount;
    
    // Update installment with payment
    const Installment = mongoose.model('Installment');
    const installment = await Installment.findById(allocation.installment);
    if (installment) {
      await installment.recordPayment(allocation.allocatedAmount, this._id);
    }
  }
  
  // Validate total allocation doesn't exceed payment amount
  if (totalAllocated > this.amount) {
    throw new Error('Total allocation cannot exceed payment amount');
  }
  
  return this.save();
};

// Method to recalculate payment plan totals
paymentTransactionSchema.methods.recalculatePaymentPlan = async function() {
  const PaymentPlan = mongoose.model('PaymentPlan');
  const paymentPlan = await PaymentPlan.findById(this.paymentPlan);
  
  if (paymentPlan) {
    await paymentPlan.calculateFinancialSummary();
    await paymentPlan.save();
  }
};

// Method to verify payment
paymentTransactionSchema.methods.verifyPayment = async function(userId, verificationData) {
  this.verification = {
    ...this.verification,
    ...verificationData,
    verifiedBy: userId,
    verificationDate: new Date()
  };
  
  // Update status based on verification
  if (verificationData.verificationStatus === 'verified') {
    this.status = 'cleared';
  } else if (verificationData.verificationStatus === 'rejected') {
    this.status = 'cancelled';
  }
  
  this.lastModifiedBy = userId;
  
  await this.save();
  
  // Trigger recalculation
  await this.recalculatePaymentPlan();
  
  return this;
};

// Method to process refund
paymentTransactionSchema.methods.processRefund = async function(refundAmount, refundReason, userId) {
  if (refundAmount > this.amount) {
    throw new Error('Refund amount cannot exceed payment amount');
  }
  
  this.refundDetails = {
    refundAmount,
    refundReason,
    refundDate: new Date(),
    refundedBy: userId
  };
  
  this.status = 'refunded';
  this.lastModifiedBy = userId;
  
  await this.save();
  
  // Update installments to reverse payment allocation
  for (const allocation of this.paymentAllocations) {
    const Installment = mongoose.model('Installment');
    const installment = await Installment.findById(allocation.installment);
    if (installment) {
      installment.paidAmount -= allocation.allocatedAmount;
      installment.pendingAmount += allocation.allocatedAmount;
      installment.updateStatus();
      await installment.save();
    }
  }
  
  // Trigger recalculation
  await this.recalculatePaymentPlan();
  
  return this;
};

// Method to generate receipt
paymentTransactionSchema.methods.generateReceipt = async function() {
  if (this.receiptGenerated) {
    return this.receiptNumber;
  }
  
  // Generate receipt number
  const receiptNumber = `RCP-${this.organization}-${Date.now()}`;
  
  this.receiptGenerated = true;
  this.receiptNumber = receiptNumber;
  this.receiptDate = new Date();
  
  await this.save();
  
  return receiptNumber;
};

// Static methods

// Method to get payment transactions with details
paymentTransactionSchema.statics.getTransactionsWithDetails = async function(filters = {}) {
  return this.find(filters)
    .populate('paymentPlan', 'totalAmount status')
    .populate('customer', 'firstName lastName email phone')
    .populate('project', 'name')
    .populate('paymentAllocations.installment', 'installmentNumber description')
    .populate('recordedBy', 'firstName lastName')
    .populate('lastModifiedBy', 'firstName lastName')
    .populate('verification.verifiedBy', 'firstName lastName')
    .sort({ receivedDate: -1 });
};

// Method to get pending payments
paymentTransactionSchema.statics.getPendingPayments = async function(organizationId) {
  return this.find({
    organization: organizationId,
    status: { $in: ['pending', 'processing'] }
  }).populate('customer', 'firstName lastName')
    .populate('project', 'name')
    .sort({ receivedDate: -1 });
};

// Method to get payments by date range
paymentTransactionSchema.statics.getPaymentsByDateRange = async function(organizationId, startDate, endDate) {
  return this.find({
    organization: organizationId,
    paymentDate: { $gte: startDate, $lte: endDate },
    status: { $in: ['completed', 'cleared'] }
  }).populate('customer', 'firstName lastName')
    .populate('project', 'name')
    .sort({ paymentDate: -1 });
};

// Pre-save middleware to generate transaction number
paymentTransactionSchema.pre('save', async function(next) {
  if (!this.transactionNumber) {
    const count = await this.constructor.countDocuments({ organization: this.organization });
    this.transactionNumber = `TXN-${this.organization.toString().slice(-6)}-${(count + 1).toString().padStart(6, '0')}`;
  }
  
  // Calculate net amount
  this.netAmount = this.amount - this.processingFee - this.bankCharges;
  
  next();
});

// Indexes for better performance
paymentTransactionSchema.index({ organization: 1, project: 1 });
paymentTransactionSchema.index({ paymentPlan: 1 });
paymentTransactionSchema.index({ customer: 1 });
paymentTransactionSchema.index({ status: 1 });
paymentTransactionSchema.index({ paymentDate: 1 });
paymentTransactionSchema.index({ transactionNumber: 1 });
paymentTransactionSchema.index({ 'paymentMethodDetails.referenceNumber': 1 });

const PaymentTransaction = mongoose.model('PaymentTransaction', paymentTransactionSchema);

export default PaymentTransaction;