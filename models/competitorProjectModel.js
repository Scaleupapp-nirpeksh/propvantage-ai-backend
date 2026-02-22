// File: models/competitorProjectModel.js
// Description: Competitor property data with granular pricing, unit mix, and amenities.
// Part of the Competitive Analysis & AI Recommendation Engine.

import mongoose from 'mongoose';

// ─── Sub-schemas ──────────────────────────────────────────────

const unitMixEntrySchema = new mongoose.Schema(
  {
    unitType: {
      type: String,
      required: true,
      trim: true, // '1BHK', '2BHK', '3BHK', '4BHK', '5BHK', 'Penthouse', 'Studio', 'Villa', 'Shop', 'Office'
    },
    carpetAreaRange: {
      min: { type: Number },
      max: { type: Number },
    },
    builtUpAreaRange: {
      min: { type: Number },
      max: { type: Number },
    },
    superBuiltUpAreaRange: {
      min: { type: Number },
      max: { type: Number },
    },
    priceRange: {
      min: { type: Number },
      max: { type: Number },
    },
    pricePerSqftRange: {
      min: { type: Number },
      max: { type: Number },
    },
    totalCount: { type: Number, default: 0 },
    availableCount: { type: Number },
  },
  { _id: false }
);

const paymentPlanInfoSchema = new mongoose.Schema(
  {
    planName: { type: String, trim: true },
    planType: {
      type: String,
      enum: [
        'construction_linked',
        'time_based',
        'subvention',
        'flexi',
        'possession_linked',
        'other',
      ],
    },
    description: { type: String, trim: true },
    bookingAmount: { type: Number },
    bookingPercentage: { type: Number },
  },
  { _id: false }
);

const dataProvenanceSchema = new mongoose.Schema(
  {
    field: { type: String, required: true },
    source: { type: String, required: true },
    collectedAt: { type: Date, default: Date.now },
    collectedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    confidence: {
      type: String,
      enum: ['verified', 'reliable', 'estimated', 'unverified'],
      default: 'unverified',
    },
    notes: { type: String },
  },
  { _id: false }
);

// ─── Constants ────────────────────────────────────────────────

export const DATA_SOURCES = [
  'manual',
  'csv_import',
  'ai_research',
  'propstack',
  'squareyards',
  'zapkey',
  'web_research',
  'field_visit',
];

export const PROJECT_TYPES = [
  'residential',
  'commercial',
  'mixed_use',
  'plotted_development',
];

export const PROJECT_STATUSES = [
  'pre_launch',
  'newly_launched',
  'under_construction',
  'ready_to_move',
  'completed',
];

// ─── Main Schema ──────────────────────────────────────────────

const competitorProjectSchema = new mongoose.Schema(
  {
    organization: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: 'Organization',
      index: true,
    },

    // ─── Basic Info ────────────────────────────────────────
    projectName: {
      type: String,
      required: [true, 'Competitor project name is required'],
      trim: true,
      maxlength: [200, 'Project name cannot exceed 200 characters'],
    },
    developerName: {
      type: String,
      required: [true, 'Developer/builder name is required'],
      trim: true,
    },
    reraNumber: { type: String, trim: true },

    // ─── Location ──────────────────────────────────────────
    location: {
      city: { type: String, required: true, trim: true },
      state: { type: String, trim: true },
      area: { type: String, required: true, trim: true },
      micromarket: { type: String, trim: true },
      pincode: { type: String, trim: true },
      coordinates: {
        latitude: { type: Number },
        longitude: { type: Number },
      },
    },

    // ─── Classification ────────────────────────────────────
    projectType: {
      type: String,
      required: true,
      enum: PROJECT_TYPES,
    },
    projectStatus: {
      type: String,
      required: true,
      enum: PROJECT_STATUSES,
    },
    possessionTimeline: {
      expectedDate: { type: Date },
      description: { type: String, trim: true },
    },

    // ─── Scale ─────────────────────────────────────────────
    totalUnits: { type: Number, min: 0 },
    totalTowers: { type: Number, min: 0 },
    totalAreaAcres: { type: Number, min: 0 },

    // ─── PRICING (core competitive data) ───────────────────
    pricing: {
      pricePerSqft: {
        min: { type: Number, min: 0 },
        max: { type: Number, min: 0 },
        avg: { type: Number, min: 0 },
      },
      basePriceRange: {
        min: { type: Number, min: 0 },
        max: { type: Number, min: 0 },
      },
      floorRiseCharge: { type: Number, default: 0 },
      facingPremiums: {
        parkFacing: { type: Number, default: 0 },
        roadFacing: { type: Number, default: 0 },
        cornerUnit: { type: Number, default: 0 },
        gardenFacing: { type: Number, default: 0 },
        seaFacing: { type: Number, default: 0 },
      },
      plcCharges: { type: Number, default: 0 },
      parkingCharges: {
        covered: { type: Number, default: 0 },
        open: { type: Number, default: 0 },
      },
      clubMembershipCharges: { type: Number, default: 0 },
      maintenanceDeposit: { type: Number, default: 0 },
      legalCharges: { type: Number, default: 0 },
      gstRate: { type: Number, default: 5 },
      stampDutyRate: { type: Number },
    },

    // ─── Unit Mix ──────────────────────────────────────────
    unitMix: [unitMixEntrySchema],

    // ─── Amenities ─────────────────────────────────────────
    amenities: {
      gym: { type: Boolean, default: false },
      swimmingPool: { type: Boolean, default: false },
      clubhouse: { type: Boolean, default: false },
      garden: { type: Boolean, default: false },
      playground: { type: Boolean, default: false },
      powerBackup: { type: Boolean, default: false },
      security24x7: { type: Boolean, default: false },
      lifts: { type: Boolean, default: false },
      joggingTrack: { type: Boolean, default: false },
      indoorGames: { type: Boolean, default: false },
      multipurposeHall: { type: Boolean, default: false },
      rainwaterHarvesting: { type: Boolean, default: false },
      solarPanels: { type: Boolean, default: false },
      evCharging: { type: Boolean, default: false },
      concierge: { type: Boolean, default: false },
      coWorkingSpace: { type: Boolean, default: false },
      other: [{ type: String, trim: true }],
    },

    // ─── Payment Plans ─────────────────────────────────────
    paymentPlans: [paymentPlanInfoSchema],

    // ─── Data Metadata ─────────────────────────────────────
    dataSource: {
      type: String,
      required: true,
      enum: DATA_SOURCES,
      default: 'manual',
    },
    dataCollectionDate: {
      type: Date,
      required: true,
      default: Date.now,
    },
    confidenceScore: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
      default: 50,
    },
    dataProvenance: [dataProvenanceSchema],
    lastVerifiedAt: { type: Date },
    lastVerifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

    // ─── Import tracking ───────────────────────────────────
    importBatchId: { type: String },

    // ─── Status & Audit ────────────────────────────────────
    isActive: { type: Boolean, default: true },
    notes: { type: String, maxlength: 2000 },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ─── Indexes ──────────────────────────────────────────────────

competitorProjectSchema.index({
  organization: 1,
  'location.city': 1,
  'location.area': 1,
});
competitorProjectSchema.index(
  { organization: 1, projectName: 1, 'location.area': 1 },
  { unique: true }
);
competitorProjectSchema.index({ organization: 1, developerName: 1 });
competitorProjectSchema.index({ dataCollectionDate: -1 });
competitorProjectSchema.index({ confidenceScore: -1 });
competitorProjectSchema.index({ isActive: 1 });

// ─── Virtuals ─────────────────────────────────────────────────

competitorProjectSchema.virtual('isStale').get(function () {
  if (!this.dataCollectionDate) return true;
  const daysSince =
    (Date.now() - this.dataCollectionDate.getTime()) / (1000 * 60 * 60 * 24);
  return daysSince > 90;
});

competitorProjectSchema.virtual('dataAgeDays').get(function () {
  if (!this.dataCollectionDate) return null;
  return Math.floor(
    (Date.now() - this.dataCollectionDate.getTime()) / (1000 * 60 * 60 * 24)
  );
});

competitorProjectSchema.virtual('amenityCount').get(function () {
  if (!this.amenities) return 0;
  const boolFields = [
    'gym', 'swimmingPool', 'clubhouse', 'garden', 'playground',
    'powerBackup', 'security24x7', 'lifts', 'joggingTrack', 'indoorGames',
    'multipurposeHall', 'rainwaterHarvesting', 'solarPanels', 'evCharging',
    'concierge', 'coWorkingSpace',
  ];
  let count = 0;
  boolFields.forEach((f) => {
    if (this.amenities[f]) count++;
  });
  count += this.amenities.other?.length || 0;
  return count;
});

// ─── Statics ──────────────────────────────────────────────────

competitorProjectSchema.statics.findByLocality = function (
  organizationId,
  city,
  area
) {
  return this.find({
    organization: organizationId,
    'location.city': new RegExp(city, 'i'),
    'location.area': new RegExp(area, 'i'),
    isActive: true,
  }).sort({ dataCollectionDate: -1 });
};

competitorProjectSchema.statics.findDuplicates = function (
  organizationId,
  projectName,
  area
) {
  return this.find({
    organization: organizationId,
    projectName: new RegExp(`^${projectName.trim()}$`, 'i'),
    'location.area': new RegExp(`^${area.trim()}$`, 'i'),
  });
};

const CompetitorProject = mongoose.model(
  'CompetitorProject',
  competitorProjectSchema
);

export default CompetitorProject;
