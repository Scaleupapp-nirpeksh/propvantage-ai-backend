// File: models/reportInstanceModel.js
// Description: A frozen, generated report produced from a ReportTemplate (or ad-hoc).
// The `blocks[].data` payloads are snapshotted at generation time.

import mongoose from 'mongoose';
import { GATE_TYPES } from './reportTemplateModel.js';

// =============================================================================
// CONSTANTS
// =============================================================================

export const REVIEW_STATUSES = ['draft', 'in_review', 'changes_requested', 'approved'];
export const DISTRIBUTION_STATUSES = ['not_sent', 'queued', 'sending', 'sent', 'failed'];
export const RECIPIENT_EMAIL_STATUSES = ['pending', 'sent', 'bounced', 'failed'];
export const FLAG_SEVERITIES = ['info', 'warn', 'critical'];
export const FLAG_STATUSES = ['open', 'resolved'];

// =============================================================================
// SCHEMA
// =============================================================================

const snapshotBlockSchema = new mongoose.Schema(
  {
    id: { type: String },
    type: { type: String },
    title: { type: String },
    config: { type: mongoose.Schema.Types.Mixed },
    order: { type: Number, default: 0 },
    data: { type: mongoose.Schema.Types.Mixed },   // FROZEN resolved data
  },
  { _id: false }
);

const overrideSchema = new mongoose.Schema(
  {
    id: { type: String },
    blockId: { type: String },
    fieldPath: { type: String },
    originalValue: { type: mongoose.Schema.Types.Mixed },
    newValue: { type: mongoose.Schema.Types.Mixed },
    reason: { type: String },
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

const flagSchema = new mongoose.Schema(
  {
    id: { type: String },
    blockId: { type: String },
    note: { type: String },
    severity: { type: String, enum: FLAG_SEVERITIES, default: 'warn' },
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    status: { type: String, enum: FLAG_STATUSES, default: 'open' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    createdAt: { type: Date, default: Date.now },
    resolvedAt: { type: Date },
  },
  { _id: false }
);

const recipientSchema = new mongoose.Schema(
  {
    email: { type: String },
    name: { type: String },
    emailStatus: { type: String, enum: RECIPIENT_EMAIL_STATUSES, default: 'pending' },
    emailedAt: { type: Date },
    token: { type: String },
  },
  { _id: false }
);

const instanceImageSchema = new mongoose.Schema(
  { id: { type: String }, label: { type: String }, url: { type: String } },
  { _id: false }
);

const reportInstanceSchema = new mongoose.Schema(
  {
    organization: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: [true, 'Organization is required'],
      index: true,
    },
    template: { type: mongoose.Schema.Types.ObjectId, ref: 'ReportTemplate', index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

    title: { type: String, trim: true },
    periodLabel: { type: String },
    periodStart: { type: Date },
    periodEnd: { type: Date },

    blocks: [snapshotBlockSchema],
    images: [instanceImageSchema],
    theme: { type: mongoose.Schema.Types.Mixed },
    scope: {
      mode: { type: String },
      projectIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Project' }],
    },

    overrides: [overrideSchema],
    flags: [flagSchema],

    review: {
      status: { type: String, enum: REVIEW_STATUSES, default: 'draft' },
      submittedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      approvedAt: { type: Date },
      notes: { type: String },
    },

    distribution: {
      status: { type: String, enum: DISTRIBUTION_STATUSES, default: 'not_sent' },
      sentAt: { type: Date },
      recipients: [recipientSchema],
    },

    publicSlug: { type: String, unique: true, sparse: true },
    accessToken: { type: String },
    gate: { type: String, enum: GATE_TYPES, default: 'email' },
    expiresAt: { type: Date, index: true },

    stats: {
      uniqueViewers: { type: Number, default: 0 },
      totalViews: { type: Number, default: 0 },
      recipientsOpened: { type: Number, default: 0 },
      forwardedOpens: { type: Number, default: 0 },
      firstOpenAt: { type: Date },
      lastOpenAt: { type: Date },
    },

    pdfS3Key: { type: String, default: null },   // Phase 5
  },
  { timestamps: true }
);

// =============================================================================
// INDEXES
// =============================================================================

reportInstanceSchema.index({ organization: 1, 'review.status': 1, createdAt: -1 });

const ReportInstance = mongoose.model('ReportInstance', reportInstanceSchema);

export default ReportInstance;
