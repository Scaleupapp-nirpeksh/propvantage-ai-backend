// File: models/performanceTargetModel.js
// Description: Per-user monthly performance targets for the People & Performance
//   module (spec §6 PerformanceTarget). One row per (organization, user, periodStart).
//   Seeded automatically from role templates on first read; can be overridden
//   manually by the user's Head / Owner (setBy, source:'manual').

import mongoose from 'mongoose';

// ─── TARGETS SUB-SCHEMA ──────────────────────────────────────────
// Money (salesValue) is a raw number — no currency conversion.
// taskSlaRate is a 0..1 fraction (target "at least X% on time").
const targetsSchema = new mongoose.Schema(
  {
    salesCount: { type: Number, default: 0 },
    salesValue: { type: Number, default: 0 },
    leadsWorked: { type: Number, default: 0 },
    conversions: { type: Number, default: 0 },
    taskSlaRate: { type: Number, default: 0 }, // 0..1
  },
  { _id: false }
);

// ─── MAIN SCHEMA ─────────────────────────────────────────────────
const performanceTargetSchema = new mongoose.Schema(
  {
    organization: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: [true, 'Organization is required'],
      index: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User is required'],
      index: true,
    },
    period: {
      type: String,
      enum: ['month'],
      default: 'month',
    },
    periodStart: {
      type: Date,
      required: [true, 'Period start is required'],
    },
    targets: {
      type: targetsSchema,
      default: () => ({}),
    },
    setBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    source: {
      type: String,
      enum: ['template', 'manual'],
      default: 'template',
    },
  },
  { timestamps: true }
);

// ─── INDEXES ─────────────────────────────────────────────────────
// One target per user per month — drives idempotent upserts.
performanceTargetSchema.index(
  { organization: 1, user: 1, periodStart: 1 },
  { unique: true }
);

// ─── EXPORT ──────────────────────────────────────────────────────
const PerformanceTarget = mongoose.model(
  'PerformanceTarget',
  performanceTargetSchema
);

export default PerformanceTarget;
