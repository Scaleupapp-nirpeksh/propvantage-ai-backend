// File: models/unitModel.js
// Description: Defines the Mongoose schema and model for a Unit within a Project.

import mongoose from 'mongoose';

const unitSchema = new mongoose.Schema(
  {
    project: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: 'Project', // Reference to the Project this unit belongs to
    },
    organization: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: 'Organization', // Reference to the Organization for easier querying
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
      // e.g., '2BHK', '3BHK+Study', 'Duplex Penthouse'
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
      // This is the initial price set for the unit
    },
    currentPrice: {
      type: Number,
      required: true,
      // This price will be updated by the dynamic pricing engine
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
    // Flexible object for unit-specific features that can affect pricing
    features: {
      isParkFacing: { type: Boolean, default: false },
      isCornerUnit: { type: Boolean, default: false },
      // Add other preferential location features here
    },
  },
  {
    timestamps: true, // Automatically adds createdAt and updatedAt fields
  }
);

// Create a compound index to ensure unit numbers are unique within a project
unitSchema.index({ project: 1, unitNumber: 1 }, { unique: true });

const Unit = mongoose.model('Unit', unitSchema);

export default Unit;
