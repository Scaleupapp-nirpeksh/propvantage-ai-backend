// File: models/aiUsageMeterModel.js
// Description: SP5 — per-CP-org per-day AI usage meter. Tracks generations
//   split by source (`scheduled` vs `onDemand` — the SP6 monetization hook),
//   copilot messages, token usage, cost, and rate-limit hits. One doc per
//   (cpOrgId, periodKey) where periodKey is the IST date string 'YYYY-MM-DD'.
//   `monthKey` ('YYYY-MM') is denormalised so SP6 billing rollups don't have
//   to parse periodKey strings.
//
//   The unique index on (cpOrgId, periodKey) is the upsert key — the
//   middleware in middleware/aiRateLimit.js does `findOneAndUpdate` against
//   it with `{ upsert: true }` on every gated request.

import mongoose from 'mongoose';

const aiUsageMeterSchema = new mongoose.Schema(
  {
    cpOrgId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
    // 'YYYY-MM-DD' in INSIGHT_DEFAULT_TIMEZONE (default Asia/Kolkata).
    // The upsert key, paired with cpOrgId in the unique index below.
    periodKey: {
      type: String,
      required: true,
      match: /^\d{4}-\d{2}-\d{2}$/,
    },
    // 'YYYY-MM' — denormalised for SP6 monthly billing rollups.
    monthKey: {
      type: String,
      required: true,
      match: /^\d{4}-\d{2}$/,
    },

    // Generation counts — kept separate so SP6 can bill on-demand only.
    scheduledGenerations: { type: Number, default: 0, min: 0 },
    onDemandGenerations:  { type: Number, default: 0, min: 0 },
    copilotMessages:      { type: Number, default: 0, min: 0 },

    totalTokensUsed: { type: Number, default: 0, min: 0 },
    totalCostUsd:    { type: Number, default: 0, min: 0 },

    // Bumped every time aiRateLimit returns 429 for this org on this day.
    // Useful for spotting orgs that are routinely hitting their quota
    // (signal for an upsell conversation in SP6).
    rateLimitHits: { type: Number, default: 0, min: 0 },

    lastUpdatedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// Upsert key: one doc per (org, day).
aiUsageMeterSchema.index({ cpOrgId: 1, periodKey: 1 }, { unique: true });
// Billing rollup helper.
aiUsageMeterSchema.index({ cpOrgId: 1, monthKey: 1 });

/**
 * Find-or-create the meter for today (IST). Convenience helper used by
 * the rate-limit middleware and the meter service.
 *
 * @param {mongoose.Types.ObjectId|string} cpOrgId
 * @param {{ periodKey?: string, monthKey?: string }} [overrides]
 *        — pass explicit keys for testing; defaults to today in IST.
 * @returns {Promise<Object>} the AIUsageMeter doc (lean=false so callers
 *          can $inc on it; use updateOne+findOne if you need lean).
 */
aiUsageMeterSchema.statics.findOrCreateForToday = async function (cpOrgId, overrides = {}) {
  const tz = process.env.INSIGHT_DEFAULT_TIMEZONE || 'Asia/Kolkata';
  const now = new Date();
  // Format IST date without bringing in a date library — use Intl.
  const fmt = (opts) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, ...opts }).format(now);
  const periodKey = overrides.periodKey || fmt({ year: 'numeric', month: '2-digit', day: '2-digit' });
  const monthKey  = overrides.monthKey  || periodKey.slice(0, 7);

  return this.findOneAndUpdate(
    { cpOrgId, periodKey },
    { $setOnInsert: { monthKey, cpOrgId, periodKey } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
};

const AIUsageMeter = mongoose.model('AIUsageMeter', aiUsageMeterSchema);

export default AIUsageMeter;
export { AIUsageMeter };
