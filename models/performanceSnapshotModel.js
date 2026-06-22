// File: models/performanceSnapshotModel.js
// Description: Materialized per-user performance snapshot for the People &
//   Performance module (spec §6). One row per (organization, user, period,
//   periodStart). The nightly job writes the previous day's snapshot and
//   refreshes the in-progress week + month; dashboards read these for history
//   and trends, merging a live compute for the current day.

import mongoose from 'mongoose';

// ─── CONSTANTS ───────────────────────────────────────────────────
const PERIODS = ['day', 'week', 'month'];

// ─── METRICS SUB-SCHEMA ──────────────────────────────────────────
// Money values are stored as raw numbers (no currency conversion / scaling).
const metricsSchema = new mongoose.Schema(
  {
    leadsWorked: { type: Number, default: 0 },
    leadsConverted: { type: Number, default: 0 },
    conversionRate: { type: Number, default: 0 }, // 0..1
    salesCount: { type: Number, default: 0 },
    salesValue: { type: Number, default: 0 }, // raw number
    tasksCompleted: { type: Number, default: 0 },
    tasksOverdue: { type: Number, default: 0 },
    taskSlaRate: { type: Number, default: 0 }, // 0..1
    ticketsResolved: { type: Number, default: 0 },
    ticketAvgResolutionHrs: { type: Number, default: 0 },
    interactionsLogged: { type: Number, default: 0 },
  },
  { _id: false }
);

// ─── RED-FLAGS SUB-SCHEMA ────────────────────────────────────────
// Persisted on the snapshot for the dashboard "needs attention" inbox.
// Populated by the red-flag engine (Task 4); the signals service leaves it
// at defaults.
const redFlagsSchema = new mongoose.Schema(
  {
    staleLeads: { type: Number, default: 0 },
    noMovementLeads: { type: Number, default: 0 },
    overdueFollowUps: { type: Number, default: 0 },
    overdueTasks: { type: Number, default: 0 },
    agingPipeline: { type: Number, default: 0 },
    lowActivity: { type: Number, default: 0 },
  },
  { _id: false }
);

// ─── MAIN SCHEMA ─────────────────────────────────────────────────
const performanceSnapshotSchema = new mongoose.Schema(
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
      enum: PERIODS,
      required: [true, 'Period is required'],
    },
    periodStart: {
      type: Date,
      required: [true, 'Period start is required'],
    },
    periodEnd: {
      type: Date,
      required: [true, 'Period end is required'],
    },
    metrics: {
      type: metricsSchema,
      default: () => ({}),
    },
    redFlags: {
      type: redFlagsSchema,
      default: () => ({}),
    },
    computedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

// ─── INDEXES ─────────────────────────────────────────────────────
// One snapshot per user per period bucket — drives idempotent upserts.
performanceSnapshotSchema.index(
  { organization: 1, user: 1, period: 1, periodStart: 1 },
  { unique: true }
);

// ─── EXPORT ──────────────────────────────────────────────────────
const PerformanceSnapshot = mongoose.model(
  'PerformanceSnapshot',
  performanceSnapshotSchema
);

export default PerformanceSnapshot;
export { PERIODS };
