// ===================================================================
// File: models/unitModel.js (UPDATED)
// Description: Updated Unit model to include tower reference
// ===================================================================

import mongoose from 'mongoose';

const unitSchema = new mongoose.Schema(
  {
    project: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: 'Project',
    },
    tower: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Tower',
      // NOTE: Not required for backward compatibility
      // Existing units without towers will continue to work
    },
    organization: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: 'Organization',
    },
    unitNumber: {
      type: String,
      required: true,
      trim: true,
    },
    type: {
      type: String,
      required: true,
      trim: true,
    },
    floor: {
      type: Number,
      required: true,
    },
    areaSqft: {
      type: Number,
      required: true,
    },
    basePrice: {
      type: Number,
      required: true,
    },
    currentPrice: {
      type: Number,
      required: true,
    },
    facing: {
      type: String,
      enum: ['North', 'South', 'East', 'West', 'North-East', 'North-West', 'South-East', 'South-West'],
    },
    status: {
      type: String,
      required: true,
      enum: ['available', 'booked', 'sold', 'blocked'],
      default: 'available',
    },
    features: {
      isParkFacing: { type: Boolean, default: false },
      isCornerUnit: { type: Boolean, default: false },
      hasBalcony: { type: Boolean, default: false },
      hasServantRoom: { type: Boolean, default: false },
      hasParkingSlot: { type: Boolean, default: false },
      hasStudyRoom: { type: Boolean, default: false },
      hasUtilityArea: { type: Boolean, default: false },
    },
    // Enhanced unit details
    specifications: {
      bedrooms: { type: Number, default: 0 },
      bathrooms: { type: Number, default: 0 },
      livingRooms: { type: Number, default: 0 },
      kitchen: { type: Number, default: 0 },
      balconies: { type: Number, default: 0 },
      terraceArea: { type: Number, default: 0 },
      carpetArea: { type: Number, default: 0 },
      builtUpArea: { type: Number, default: 0 },
      superBuiltUpArea: { type: Number, default: 0 }
    },
    // Parking details
    parking: {
      covered: { type: Number, default: 0 },
      open: { type: Number, default: 0 },
      parkingNumbers: [String]
    },
    // Possession details
    possession: {
      plannedDate: Date,
      actualDate: Date,
      handoverStatus: {
        type: String,
        enum: ['pending', 'ready', 'handed_over'],
        default: 'pending'
      }
    }
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

// Indexes for performance
unitSchema.index({ project: 1, unitNumber: 1 }, { unique: true });
unitSchema.index({ tower: 1, floor: 1 });
unitSchema.index({ organization: 1 });
unitSchema.index({ status: 1 });

// Virtual for full address (backward compatible)
unitSchema.virtual('fullAddress').get(function() {
  if (this.tower && this.tower.towerName) {
    return `${this.tower.towerName} - ${this.unitNumber}`;
  }
  return this.unitNumber;
});

// Method to check if unit belongs to a tower
unitSchema.methods.hasTower = function() {
  return !!this.tower;
};

// Static method to find units by tower (with fallback for non-tower units)
unitSchema.statics.findByProjectOrTower = function(projectId, towerId = null) {
  const query = { project: projectId };
  if (towerId) {
    query.tower = towerId;
  } else {
    // If no tower specified, get units without towers (backward compatibility)
    query.$or = [
      { tower: { $exists: false } },
      { tower: null }
    ];
  }
  return this.find(query).sort({ floor: 1, unitNumber: 1 });
};

const Unit = mongoose.model('Unit', unitSchema);

export default Unit;