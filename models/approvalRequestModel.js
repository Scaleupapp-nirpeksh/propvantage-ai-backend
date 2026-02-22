// File: models/approvalRequestModel.js
// Description: Individual approval request instances with full audit trail.

import mongoose from 'mongoose';
import { APPROVAL_TYPES } from './approvalPolicyModel.js';

// ─── Constants ────────────────────────────────────────────────

export const APPROVAL_REQUEST_STATUSES = [
  'pending',
  'approved',
  'rejected',
  'cancelled',
  'expired',
];

export const APPROVAL_ENTITY_TYPES = [
  'Sale',
  'Unit',
  'PaymentTransaction',
  'Invoice',
  'Installment',
  'PartnerCommission',
];

// ─── Sub-schemas ──────────────────────────────────────────────

const approverActionSchema = new mongoose.Schema(
  {
    approver: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    action: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
    },
    comment: { type: String, trim: true, maxlength: 2000 },
    actionAt: { type: Date },
  },
  { _id: false }
);

const auditEntrySchema = new mongoose.Schema(
  {
    action: {
      type: String,
      required: true,
      enum: [
        'created',
        'approved',
        'rejected',
        'cancelled',
        'escalated',
        'reassigned',
        'comment_added',
        'expired',
        'auto_approved',
      ],
    },
    performedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    performedAt: { type: Date, default: Date.now },
    details: { type: mongoose.Schema.Types.Mixed },
    comment: { type: String, trim: true },
  },
  { _id: false }
);

const escalationEntrySchema = new mongoose.Schema(
  {
    level: { type: Number, required: true },
    escalatedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    escalatedAt: { type: Date, default: Date.now },
    reason: { type: String, trim: true },
  },
  { _id: false }
);

// ─── Main schema ──────────────────────────────────────────────

const approvalRequestSchema = new mongoose.Schema(
  {
    // ─── Organization Scoping ─────────────────────────────
    organization: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: 'Organization',
      index: true,
    },
    project: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
    },

    // ─── Identification ───────────────────────────────────
    // NOTE: requestNumber is NOT marked required to avoid Mongoose
    // validation-before-pre-save-hook issue. Uniqueness enforced by index.
    requestNumber: {
      type: String,
      index: true,
    },
    sequenceNumber: { type: Number },

    // ─── Type & Status ────────────────────────────────────
    approvalType: {
      type: String,
      required: true,
      enum: APPROVAL_TYPES,
    },
    status: {
      type: String,
      enum: APPROVAL_REQUEST_STATUSES,
      default: 'pending',
      index: true,
    },
    priority: {
      type: String,
      enum: ['Critical', 'High', 'Medium', 'Low'],
      default: 'Medium',
    },

    // ─── Entity Reference (polymorphic) ───────────────────
    entityType: {
      type: String,
      required: true,
      enum: APPROVAL_ENTITY_TYPES,
    },
    entityId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },

    // ─── Policy Reference ─────────────────────────────────
    approvalPolicy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ApprovalPolicy',
      required: true,
    },

    // ─── Request Details ──────────────────────────────────
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 300,
    },
    description: {
      type: String,
      trim: true,
      maxlength: 5000,
    },
    requestedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    // ─── Type-Specific Snapshot Data ──────────────────────
    requestData: {
      // DISCOUNT_APPROVAL
      discountPercentage: { type: Number },
      discountAmount: { type: Number },
      salePrice: { type: Number },
      originalPrice: { type: Number },
      unitId: { type: mongoose.Schema.Types.ObjectId },

      // PRICE_OVERRIDE
      currentPrice: { type: Number },
      proposedPrice: { type: Number },
      basePrice: { type: Number },
      deviationPercentage: { type: Number },

      // REFUND_APPROVAL
      refundAmount: { type: Number },
      refundReason: { type: String },
      originalPaymentAmount: { type: Number },

      // INSTALLMENT_MODIFICATION
      modificationType: { type: String },
      originalValue: { type: mongoose.Schema.Types.Mixed },
      proposedValue: { type: mongoose.Schema.Types.Mixed },

      // SALE_CANCELLATION
      cancellationReason: { type: String },
      salePriceAtCancellation: { type: Number },

      // COMMISSION_PAYOUT
      commissionAmount: { type: Number },
      partnerName: { type: String },

      // INVOICE_APPROVAL
      invoiceAmount: { type: Number },
      invoiceType: { type: String },
    },

    // ─── Approvers ────────────────────────────────────────
    approverActions: [approverActionSchema],
    requiredApprovals: { type: Number, default: 1, min: 1 },
    currentApprovalCount: { type: Number, default: 0 },

    // ─── Task Integration ─────────────────────────────────
    linkedTask: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Task',
    },

    // ─── SLA & Escalation ─────────────────────────────────
    slaDeadline: { type: Date },
    currentEscalationLevel: { type: Number, default: 0, min: 0, max: 3 },
    escalationHistory: [escalationEntrySchema],

    // ─── Resolution ───────────────────────────────────────
    resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    resolvedAt: { type: Date },
    resolutionComment: { type: String, trim: true },

    // ─── Audit Trail ──────────────────────────────────────
    auditTrail: [auditEntrySchema],
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ─── Indexes ──────────────────────────────────────────────────

approvalRequestSchema.index({ organization: 1, status: 1, createdAt: -1 });
approvalRequestSchema.index({ organization: 1, approvalType: 1, status: 1 });
approvalRequestSchema.index({ 'approverActions.approver': 1, status: 1 });
approvalRequestSchema.index({ entityType: 1, entityId: 1 });
approvalRequestSchema.index({ requestedBy: 1, status: 1 });
approvalRequestSchema.index({ linkedTask: 1 });
approvalRequestSchema.index({ slaDeadline: 1, status: 1 });
approvalRequestSchema.index(
  { organization: 1, requestNumber: 1 },
  { unique: true }
);

// ─── Pre-save: generate request number ────────────────────────

approvalRequestSchema.pre('save', async function (next) {
  if (this.isNew) {
    const lastRequest = await this.constructor
      .findOne({ organization: this.organization })
      .sort({ sequenceNumber: -1 })
      .select('sequenceNumber');

    this.sequenceNumber = lastRequest ? lastRequest.sequenceNumber + 1 : 1;
    this.requestNumber = `APR-${String(this.sequenceNumber).padStart(4, '0')}`;

    this.auditTrail.push({
      action: 'created',
      performedBy: this.requestedBy,
      details: {
        approvalType: this.approvalType,
        entityType: this.entityType,
      },
    });
  }
  next();
});

// ─── Virtuals ─────────────────────────────────────────────────

approvalRequestSchema.virtual('isOverdue').get(function () {
  if (this.status !== 'pending' || !this.slaDeadline) return false;
  return new Date() > this.slaDeadline;
});

approvalRequestSchema.virtual('hoursUntilDeadline').get(function () {
  if (!this.slaDeadline) return null;
  return Math.round(
    (this.slaDeadline.getTime() - Date.now()) / (1000 * 60 * 60)
  );
});

const ApprovalRequest = mongoose.model(
  'ApprovalRequest',
  approvalRequestSchema
);

export default ApprovalRequest;
