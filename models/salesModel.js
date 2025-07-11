// File: models/salesModel.js
// Updated to include payment plan reference and frontend compatibility

import mongoose from 'mongoose';

const saleSchema = new mongoose.Schema(
  {
    project: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: 'Project',
    },
    unit: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: 'Unit',
      unique: true, // A unit can only be sold once
    },
    lead: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: 'Lead',
    },
    organization: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: 'Organization',
    },
    salesPerson: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: 'User',
    },
    channelPartner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
    },
    salePrice: {
      type: Number,
      required: true,
    },
    // 🔥 ADD REFERENCE TO PAYMENT PLAN
    paymentPlan: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PaymentPlan',
    },
    // Keep snapshots for historical reference and frontend compatibility
    costSheetSnapshot: {
      type: Object,
      required: true,
    },
    paymentPlanSnapshot: {
      type: Object, // Frontend sends: { templateId, templateName, schedule }
    },
    bookingDate: {
      type: Date,
      default: Date.now,
    },
    status: {
      type: String,
      enum: ['Booked', 'Agreement Signed', 'Registered', 'Completed', 'Cancelled'],
      default: 'Booked',
    },
    commission: {
      rate: { type: Number },
      amount: { type: Number },
    },
    // Add discount tracking for frontend compatibility
    discountAmount: {
      type: Number,
      default: 0,
    },
    // Additional fields for cancellation tracking
    cancellationReason: {
      type: String,
    },
    cancelledBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    cancelledAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

// Virtual for sale number generation
saleSchema.virtual('saleNumber').get(function() {
  return `SAL-${this._id.toString().slice(-6).toUpperCase()}`;
});

// Virtual for payment plan status
saleSchema.virtual('paymentPlanStatus').get(function() {
  // This will be populated when payment plan is populated
  return this.paymentPlan?.status || 'not_created';
});

// Index for better query performance
saleSchema.index({ organization: 1, project: 1 });
saleSchema.index({ unit: 1 }, { unique: true });
saleSchema.index({ lead: 1 });
saleSchema.index({ salesPerson: 1 });
saleSchema.index({ status: 1 });
saleSchema.index({ bookingDate: 1 });
saleSchema.index({ paymentPlan: 1 });

const Sale = mongoose.model('Sale', saleSchema);

export default Sale;