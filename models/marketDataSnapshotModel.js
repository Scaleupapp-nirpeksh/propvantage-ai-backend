// File: models/marketDataSnapshotModel.js
// Description: Periodic aggregated market snapshots for trend analysis.
// Each snapshot captures pricing, supply, and quality metrics for a locality at a point in time.

import mongoose from 'mongoose';

const marketDataSnapshotSchema = new mongoose.Schema(
  {
    organization: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },

    // Scope
    snapshotScope: {
      city: { type: String, required: true, trim: true },
      area: { type: String, required: true, trim: true },
      micromarket: { type: String, trim: true },
    },

    snapshotDate: {
      type: Date,
      required: true,
      default: Date.now,
    },

    // ─── Market Metrics ───────────────────────────────────────
    marketMetrics: {
      totalActiveProjects: { type: Number, default: 0 },
      totalUnitsInMarket: { type: Number, default: 0 },

      pricePerSqft: {
        min: { type: Number, default: 0 },
        max: { type: Number, default: 0 },
        avg: { type: Number, default: 0 },
        median: { type: Number, default: 0 },
        p25: { type: Number, default: 0 },
        p75: { type: Number, default: 0 },
        stdDev: { type: Number, default: 0 },
      },

      floorRiseCharge: {
        min: { type: Number, default: 0 },
        max: { type: Number, default: 0 },
        avg: { type: Number, default: 0 },
      },

      unitTypeDistribution: [
        {
          unitType: String,
          count: Number,
          percentage: Number,
          avgPricePerSqft: Number,
        },
      ],

      projectStatusDistribution: [
        {
          status: String,
          count: Number,
          percentage: Number,
        },
      ],

      amenityPrevalence: [
        {
          amenity: String,
          count: Number,
          percentage: Number,
        },
      ],
    },

    // ─── Trends (compared to previous snapshot) ───────────────
    trends: {
      pricePerSqftChange: { type: Number, default: 0 },           // percentage
      pricePerSqftChangeAbsolute: { type: Number, default: 0 },   // INR
      newProjectsAdded: { type: Number, default: 0 },
      projectsCompleted: { type: Number, default: 0 },
      supplyChange: { type: Number, default: 0 },                 // percentage
    },

    // ─── Data Quality ─────────────────────────────────────────
    dataQuality: {
      totalDataPoints: { type: Number, default: 0 },
      verifiedDataPoints: { type: Number, default: 0 },
      averageConfidenceScore: { type: Number, default: 0 },
      staleDataPoints: { type: Number, default: 0 },
    },

    // Source competitor IDs used for this snapshot
    sourceCompetitorIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'CompetitorProject',
      },
    ],

    generatedBy: {
      type: String,
      enum: ['manual', 'scheduled', 'on_demand'],
      default: 'on_demand',
    },
  },
  {
    timestamps: true,
  }
);

// Unique: one snapshot per org + locality + date
marketDataSnapshotSchema.index(
  {
    organization: 1,
    'snapshotScope.city': 1,
    'snapshotScope.area': 1,
    snapshotDate: 1,
  },
  { unique: true }
);

// Query index for trend lookups
marketDataSnapshotSchema.index({
  organization: 1,
  'snapshotScope.city': 1,
  'snapshotScope.area': 1,
  snapshotDate: -1,
});

const MarketDataSnapshot = mongoose.model(
  'MarketDataSnapshot',
  marketDataSnapshotSchema
);

export default MarketDataSnapshot;
