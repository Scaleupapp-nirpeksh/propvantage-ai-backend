// File: models/moraleSummaryModel.js
// Description: Weekly morale roll-up document for the People & Performance module (spec §6).
//   One document per (organization, scope, head, isoWeek).
//   Scope 'team' has a head (the Head user); scope 'org' has head = null.
//   Built by moraleService.buildTeamMorale / buildOrgMorale and upserted weekly.

import mongoose from 'mongoose';

// =============================================================================
// SUB-SCHEMAS
// =============================================================================

const peopleToCheckInSchema = new mongoose.Schema(
  {
    user:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    reason: { type: String, trim: true, maxlength: 500 },
  },
  { _id: false }
);

// =============================================================================
// MAIN SCHEMA
// =============================================================================

const moraleSummarySchema = new mongoose.Schema(
  {
    organization: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: [true, 'Organization is required'],
      index: true,
    },
    scope: {
      type: String,
      enum: ['team', 'org'],
      required: [true, 'Scope is required'],
    },
    // Nullable — present for scope='team', null for scope='org'
    head: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    isoWeek: {
      type: String,
      required: [true, 'isoWeek is required'],
      match: [/^\d{4}-W\d{2}$/, 'isoWeek must be in YYYY-Www format'],
    },
    moraleScore: {
      type: Number,
      min: 0,
      max: 100,
      required: [true, 'moraleScore is required'],
    },
    // positive = improved vs last week, negative = declined, null = no prior data
    trendVsLastWeek: {
      type: Number,
      default: null,
    },
    narrative: {
      type: String,
      trim: true,
      maxlength: 3000,
    },
    topPositiveThemes: [{ type: String, trim: true }],
    topNegativeThemes: [{ type: String, trim: true }],
    peopleToCheckIn: {
      type: [peopleToCheckInSchema],
      default: [],
    },
    risks: [{ type: String, trim: true }],
    reflectionsAnalyzed: {
      type: Number,
      required: [true, 'reflectionsAnalyzed is required'],
      min: 0,
    },
    generatedAt: {
      type: Date,
      required: [true, 'generatedAt is required'],
    },
  },
  {
    timestamps: true,
  }
);

// =============================================================================
// INDEXES
// =============================================================================

// Unique: one summary per (org, scope, head, week)
// head is null for org scope — MongoDB treats null as a distinct value so this works.
moraleSummarySchema.index(
  { organization: 1, scope: 1, head: 1, isoWeek: 1 },
  { unique: true }
);

// Head-scoped lookups: fetch all weekly team summaries for one head
moraleSummarySchema.index({ organization: 1, head: 1, isoWeek: -1 });

// Org-level lookups
moraleSummarySchema.index({ organization: 1, scope: 1, isoWeek: -1 });

const MoraleSummary = mongoose.model('MoraleSummary', moraleSummarySchema);

export default MoraleSummary;
