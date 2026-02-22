// File: models/approvalPolicyModel.js
// Description: Organization-level configurable approval rules, thresholds, SLA, and escalation settings.

import mongoose from 'mongoose';

// ─── Constants ────────────────────────────────────────────────

export const APPROVAL_TYPES = [
  'DISCOUNT_APPROVAL',
  'SALE_CANCELLATION',
  'PRICE_OVERRIDE',
  'REFUND_APPROVAL',
  'INSTALLMENT_MODIFICATION',
  'COMMISSION_PAYOUT',
  'INVOICE_APPROVAL',
];

// ─── Sub-schemas ──────────────────────────────────────────────

const discountThresholdSchema = new mongoose.Schema(
  {
    roleSlug: { type: String, required: true, trim: true },
    roleLevel: { type: Number, required: true },
    maxDiscountPercentage: { type: Number, required: true, min: 0, max: 100 },
  },
  { _id: false }
);

const amountThresholdSchema = new mongoose.Schema(
  {
    minAmount: { type: Number, required: true, min: 0 },
    maxAmount: { type: Number, default: null }, // null = unlimited
    approverRoleSlug: { type: String, required: true, trim: true },
    approverRoleLevel: { type: Number, required: true },
  },
  { _id: false }
);

const approverRuleSchema = new mongoose.Schema(
  {
    roleSlug: { type: String, required: true, trim: true },
    roleLevel: { type: Number, required: true },
    specificUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    // 'role' = anyone with the role, 'specific' = only listed users, 'hierarchy' = anyone at or above this level
    assignmentMode: {
      type: String,
      enum: ['role', 'specific', 'hierarchy'],
      default: 'hierarchy',
    },
  },
  { _id: false }
);

// ─── Main schema ──────────────────────────────────────────────

const approvalPolicySchema = new mongoose.Schema(
  {
    organization: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: 'Organization',
      index: true,
    },
    project: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
      default: null, // null = org-wide; if set, overrides org policy for this project
    },
    approvalType: {
      type: String,
      required: true,
      enum: APPROVAL_TYPES,
    },
    isEnabled: {
      type: Boolean,
      default: true,
    },
    displayName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },
    description: {
      type: String,
      trim: true,
      maxlength: 500,
    },

    // ─── Threshold Configuration ────────────────────────────

    // For DISCOUNT_APPROVAL: role-based discount limits
    discountThresholds: [discountThresholdSchema],

    // For PRICE_OVERRIDE: % deviation from base price that triggers approval
    priceOverrideThresholdPercent: {
      type: Number,
      default: 10,
      min: 0,
      max: 100,
    },

    // For REFUND_APPROVAL: amount-based thresholds
    amountThresholds: [amountThresholdSchema],

    // For types that always require approval regardless of thresholds
    alwaysRequire: {
      type: Boolean,
      default: false,
    },

    // ─── Approver Configuration ─────────────────────────────

    approverRules: [approverRuleSchema],

    requiredApprovals: {
      type: Number,
      default: 1,
      min: 1,
      max: 5,
    },

    // ─── SLA Configuration ──────────────────────────────────

    slaHours: {
      type: Number,
      default: 24,
      min: 1,
    },
    escalationConfig: {
      enabled: { type: Boolean, default: true },
      level1AfterHours: { type: Number, default: 24 },
      level2AfterHours: { type: Number, default: 48 },
      level3AfterHours: { type: Number, default: 72 },
    },

    // ─── Audit ──────────────────────────────────────────────

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    lastModifiedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ─── Indexes ──────────────────────────────────────────────────

// One policy per type per org (or per type per project)
approvalPolicySchema.index(
  { organization: 1, approvalType: 1, project: 1 },
  { unique: true }
);
approvalPolicySchema.index({ organization: 1, isEnabled: 1 });

const ApprovalPolicy = mongoose.model('ApprovalPolicy', approvalPolicySchema);

export default ApprovalPolicy;
