// File: models/aiInsightModel.js
// Description: SP5 — cache + audit doc for every AI insight generated for a
//   channel-partner organisation. One document per (cpOrgId, surface, generatedAt)
//   tuple; the most-recent doc whose `expiresAt > now` is served from cache.
//   Older docs auto-purge via the TTL index on `expiresAt`.
//
//   The `factsPackHash` lets us detect data drift between generation and read
//   (the pipeline may invalidate early if upstream metrics moved enough).
//   `validationResult` records the narrator/validator loop outcome so we can
//   audit hallucination rates over time, and `tokenUsage` feeds the SP6
//   monetization meter (AIUsageMeter aggregates per-org per-day).

import mongoose from 'mongoose';

const validationResultSchema = new mongoose.Schema(
  {
    valid:              { type: Boolean, default: true },
    retries:            { type: Number,  default: 0, min: 0 },
    fellBackToTemplate: { type: Boolean, default: false },
    failureReason:      { type: String,  default: '' },
  },
  { _id: false }
);

const tokenUsageSchema = new mongoose.Schema(
  {
    prompt:     { type: Number, default: 0, min: 0 },
    completion: { type: Number, default: 0, min: 0 },
    total:      { type: Number, default: 0, min: 0 },
    costUsd:    { type: Number, default: 0, min: 0 },
  },
  { _id: false }
);

const citationSchema = new mongoose.Schema(
  {
    label: { type: String, default: '' },
    url:   { type: String, default: '' },
  },
  { _id: false }
);

const periodSchema = new mongoose.Schema(
  {
    from:  { type: Date, default: null },
    to:    { type: Date, default: null },
    range: { type: String, default: null }, // '7d' | '30d' | ... | 'all'
  },
  { _id: false }
);

const aiInsightSchema = new mongoose.Schema(
  {
    cpOrgId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
    surface: {
      type: String,
      required: true,
      index: true,
      // Validated against insightSurfaces keys via a lazy import in pre-save
      // (avoids a circular dependency at module-load time).
    },
    period:        { type: periodSchema, default: () => ({}) },
    factsPackHash: { type: String, required: true },
    narrative:     { type: String, default: null },
    headlinedCandidates: { type: [String], default: [] },
    citations:     { type: [citationSchema], default: [] },
    confidence: {
      type: String,
      enum: ['high', 'medium', 'low', 'fallback'],
      default: 'medium',
    },
    source: {
      type: String,
      enum: ['scheduled', 'on_demand'],
      required: true,
    },
    generatedAt: { type: Date, default: Date.now },
    // TTL index — declared below via schema.index so we don't double-declare.
    expiresAt:   { type: Date, required: true },
    validationResult: { type: validationResultSchema, default: () => ({}) },
    tokenUsage:       { type: tokenUsageSchema, default: () => ({}) },
  },
  { timestamps: true }
);

// Cache lookup: most-recent unexpired insight for a (cpOrgId, surface).
aiInsightSchema.index({ cpOrgId: 1, surface: 1, expiresAt: -1 });
// TTL — Mongo deletes docs whose `expiresAt` has passed.
aiInsightSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Surface-name validation. Lazy-loaded so models/* can be imported without
// config/insightSurfaces.js existing yet (Phase 1 ships before Phase 3).
aiInsightSchema.pre('validate', async function preValidateSurface(next) {
  try {
    const mod = await import('../config/insightSurfaces.js').catch(() => null);
    if (mod?.insightSurfaces && !mod.insightSurfaces[this.surface]) {
      return next(new Error(`Unknown insight surface: ${this.surface}`));
    }
    return next();
  } catch (err) {
    return next(err);
  }
});

const AIInsight = mongoose.model('AIInsight', aiInsightSchema);

export default AIInsight;
export { AIInsight };
