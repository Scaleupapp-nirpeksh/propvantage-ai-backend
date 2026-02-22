// File: models/competitiveAnalysisModel.js
// Description: Cached AI analysis results with TTL auto-expiry.
// Stores GPT-4 generated competitive recommendations, invalidated by data hash changes.

import mongoose from 'mongoose';

const recommendationSchema = new mongoose.Schema(
  {
    category: {
      type: String,
      enum: [
        'pricing', 'revenue', 'absorption', 'demand_supply',
        'launch_timing', 'unit_mix', 'marketing', 'general',
      ],
    },
    priority: {
      type: String,
      enum: ['critical', 'high', 'medium', 'low'],
      default: 'medium',
    },
    title: String,
    description: String,
    confidenceScore: { type: Number, min: 0, max: 100 },
    estimatedImpact: String,
    actionItems: [String],
  },
  { _id: false }
);

const competitiveAnalysisSchema = new mongoose.Schema(
  {
    organization: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },

    // ─── Scope ────────────────────────────────────────────────
    analysisScope: {
      project: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Project',
        required: true,
      },
      city: { type: String, required: true },
      area: { type: String, required: true },
      competitorProjectIds: [
        {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'CompetitorProject',
        },
      ],
      competitorCount: { type: Number, default: 0 },
    },

    // ─── Analysis Type ────────────────────────────────────────
    analysisType: {
      type: String,
      enum: [
        'pricing_recommendations',
        'revenue_planning',
        'absorption_rate',
        'demand_supply_gap',
        'launch_timing',
        'optimal_unit_mix',
        'marketing_strategy',
        'comprehensive',
      ],
      required: true,
    },

    // ─── AI-Generated Results ─────────────────────────────────
    results: {
      type: mongoose.Schema.Types.Mixed,
    },

    // ─── Structured Recommendations ───────────────────────────
    recommendations: [recommendationSchema],

    // ─── Market Positioning ───────────────────────────────────
    marketPositioning: {
      segment: {
        type: String,
        enum: ['budget', 'affordable', 'mid_segment', 'premium', 'luxury', 'ultra_luxury'],
      },
      pricePercentile: { type: Number, min: 0, max: 100 },
      competitiveAdvantages: [String],
      competitiveDisadvantages: [String],
    },

    // ─── Metadata ─────────────────────────────────────────────
    metadata: {
      model: { type: String, default: 'gpt-4' },
      tokensUsed: Number,
      generationTimeMs: Number,
      promptVersion: { type: String, default: '1.0' },
      dataQuality: {
        type: String,
        enum: ['high', 'medium', 'low', 'very_low'],
        default: 'medium',
      },
      competitorDataFreshness: {
        freshCount: { type: Number, default: 0 },
        recentCount: { type: Number, default: 0 },
        staleCount: { type: Number, default: 0 },
      },
    },

    // ─── Cache Control ────────────────────────────────────────
    expiresAt: {
      type: Date,
      default: () => new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
      index: { expires: 0 }, // TTL index — MongoDB auto-deletes after expiresAt
    },

    isExpired: {
      type: Boolean,
      default: false,
    },

    // MD5 hash of competitor data at generation time — for cache invalidation
    dataHashAtGeneration: String,

    requestedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

// Compound index for cache lookups
competitiveAnalysisSchema.index({
  organization: 1,
  'analysisScope.project': 1,
  analysisType: 1,
});

const CompetitiveAnalysis = mongoose.model(
  'CompetitiveAnalysis',
  competitiveAnalysisSchema
);

export default CompetitiveAnalysis;
