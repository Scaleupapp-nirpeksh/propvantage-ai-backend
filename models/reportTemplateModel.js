// File: models/reportTemplateModel.js
// Description: Reusable report definition for the Leadership Report Builder.
// Note: the period field is named `preset` (not `type`) to avoid Mongoose's
// reserved-word handling of a nested `type` key.

import mongoose from 'mongoose';

// =============================================================================
// CONSTANTS
// =============================================================================

export const PERIOD_PRESETS = [
  'last_30d', 'mtd', 'qtd', 'ytd', 'last_quarter', 'last_month', 'custom',
];
export const THEME_PRESETS = ['clean', 'midnight', 'warm'];
export const DELIVERY_MODES = ['review_then_send', 'auto_send'];
export const SCHEDULE_FREQUENCIES = ['weekly', 'monthly', 'quarterly'];
export const GATE_TYPES = ['email', 'public'];
export const TEMPLATE_STATUSES = ['active', 'paused', 'archived'];

// =============================================================================
// SCHEMA
// =============================================================================

const blockSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    type: { type: String, required: true },     // matches blockRegistry, e.g. 'kpi.revenue'
    title: { type: String, trim: true },
    config: { type: mongoose.Schema.Types.Mixed, default: {} },
    order: { type: Number, default: 0 },
  },
  { _id: false }
);

const imageSlotSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    label: { type: String, trim: true },
    s3Key: { type: String },
    url: { type: String },
  },
  { _id: false }
);

const templateRecipientSchema = new mongoose.Schema(
  { email: { type: String }, name: { type: String }, role: { type: String } },
  { _id: false }
);

const reportTemplateSchema = new mongoose.Schema(
  {
    organization: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: [true, 'Organization is required'],
      index: true,
    },
    name: { type: String, required: [true, 'Name is required'], trim: true, maxlength: 200 },
    description: { type: String, trim: true, maxlength: 1000 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

    scope: {
      projects: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Project' }],
      period: {
        preset: { type: String, enum: PERIOD_PRESETS, default: 'last_30d' },
        customStart: { type: Date },
        customEnd: { type: Date },
      },
    },

    theme: {
      preset: { type: String, enum: THEME_PRESETS, default: 'clean' },
      primaryColor: { type: String },
      accentColor: { type: String },
      logoS3Key: { type: String },
      coverImageS3Key: { type: String },
    },

    blocks: [blockSchema],
    imageSlots: [imageSlotSchema],

    schedule: {
      enabled: { type: Boolean, default: false },
      frequency: { type: String, enum: SCHEDULE_FREQUENCIES },
      dayOfWeek: { type: Number, min: 0, max: 6 },
      dayOfMonth: { type: Number, min: 1, max: 31 },
      time: { type: String },               // 'HH:mm'
      timezone: { type: String, default: 'Asia/Kolkata' },
      nextRunAt: { type: Date, index: true },
    },

    delivery: {
      mode: { type: String, enum: DELIVERY_MODES, default: 'review_then_send' },
      recipients: [templateRecipientSchema],
      ccInternal: [{ type: String }],
      reviewers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    },

    access: {
      gate: { type: String, enum: GATE_TYPES, default: 'email' },
      expiresAfterDays: { type: Number, default: 90 },
    },

    status: { type: String, enum: TEMPLATE_STATUSES, default: 'active' },
  },
  { timestamps: true }
);

// =============================================================================
// INDEXES
// =============================================================================

reportTemplateSchema.index({ organization: 1, status: 1 });

const ReportTemplate = mongoose.model('ReportTemplate', reportTemplateSchema);

export default ReportTemplate;
