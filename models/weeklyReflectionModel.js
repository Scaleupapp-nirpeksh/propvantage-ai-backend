// File: models/weeklyReflectionModel.js
// Description: Weekly reflection document for the People & Performance module (spec §6).
//   One document per (organization, user, isoWeek). Contains answers, status,
//   voice transcription metadata, AI sentiment (written by moraleService — Task 6),
//   and manager acknowledgement.

import mongoose from 'mongoose';

// =============================================================================
// SUB-SCHEMAS
// =============================================================================

const answersSchema = new mongoose.Schema(
  {
    wins:            { type: String, default: '' },
    areasToImprove:  { type: String, default: '' },
    dislikes:        { type: String, default: '' },
    achievements:    { type: String, default: '' },
    plansNextWeek:   { type: String, default: '' },
    other:           { type: String, default: '' },  // optional
  },
  { _id: false }
);

const voiceMetaItemSchema = new mongoose.Schema(
  {
    field:           { type: String, required: true },   // answer field name
    durationSec:     { type: Number },
    transcribedAt:   { type: Date },
  },
  { _id: false }
);

// Sentiment is written by moraleService (Task 6) — defined here as nullable.
const sentimentSchema = new mongoose.Schema(
  {
    score:       { type: Number, min: -1, max: 1 },  // -1..1
    label:       { type: String, enum: ['positive', 'neutral', 'negative'] },
    themes:      [{ type: String }],
    riskSignals: [{ type: String }],   // e.g. 'burnout', 'flight-risk', ...
    analyzedAt:  { type: Date },
    model:       { type: String },     // e.g. 'claude-3-7-sonnet-...'
  },
  { _id: false }
);

const managerAckSchema = new mongoose.Schema(
  {
    by:   { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    at:   { type: Date },
    note: { type: String, trim: true, maxlength: 2000 },
  },
  { _id: false }
);

// =============================================================================
// MAIN SCHEMA
// =============================================================================

const weeklyReflectionSchema = new mongoose.Schema(
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
    },
    // ISO week string: 'YYYY-Www', e.g. '2026-W25'
    isoWeek: {
      type: String,
      required: [true, 'isoWeek is required'],
      match: [/^\d{4}-W\d{2}$/, 'isoWeek must be in YYYY-Www format'],
    },
    weekStart: {
      type: Date,
      required: [true, 'weekStart is required'],
    },
    weekEnd: {
      type: Date,
      required: [true, 'weekEnd is required'],
    },
    answers: {
      type: answersSchema,
      default: () => ({}),
    },
    status: {
      type: String,
      enum: ['draft', 'submitted'],
      default: 'draft',
    },
    submittedAt: {
      type: Date,
    },
    voiceMeta: {
      type: [voiceMetaItemSchema],
      default: [],
    },
    sentiment: {
      type: sentimentSchema,
      default: null,
    },
    managerAck: {
      type: managerAckSchema,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// =============================================================================
// INDEXES
// =============================================================================

// Unique constraint — one reflection per user per week per org
weeklyReflectionSchema.index({ organization: 1, user: 1, isoWeek: 1 }, { unique: true });

// Manager/owner queries: all reflections for an org in a given week
weeklyReflectionSchema.index({ organization: 1, isoWeek: 1 });

// Member queries: all of a user's reflections across weeks
weeklyReflectionSchema.index({ user: 1, isoWeek: -1 });

// =============================================================================
// REQUIRED ANSWER FIELDS (exported for use in reflectionService)
// =============================================================================
export const REQUIRED_ANSWER_FIELDS = [
  'wins',
  'areasToImprove',
  'dislikes',
  'achievements',
  'plansNextWeek',
];

export const MIN_ANSWER_LENGTH = 500;

const WeeklyReflection = mongoose.model('WeeklyReflection', weeklyReflectionSchema);

export default WeeklyReflection;
