// File: models/projectModel.js
// Description: Defines the Mongoose schema and model for a Project.

import mongoose from 'mongoose';

// Schema for defining additional one-time or recurring charges for a project.
const additionalChargeSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
  },
  amount: {
    type: Number,
    required: true,
  },
  type: {
    type: String,
    enum: ['one-time', 'monthly', 'yearly'],
    default: 'one-time',
  },
});

// Schema for defining the financial rules applicable to a project.
const pricingRulesSchema = new mongoose.Schema({
  gstRate: { type: Number, default: 5 }, // Default GST rate in percentage
  tdsRate: { type: Number, default: 1 }, // Default TDS rate in percentage
  floorRiseCharge: { type: Number, default: 0 }, // Cost per floor rise
  plcCharges: {
    // Preferential Location Charges
    parkFacing: { type: Number, default: 0 },
    cornerUnit: { type: Number, default: 0 },
  },
});

const projectSchema = new mongoose.Schema(
  {
    organization: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: 'Organization', // Reference to the Organization this project belongs to
    },
    name: {
      type: String,
      required: [true, 'Please add a project name'],
      trim: true,
    },
    type: {
      type: String,
      required: true,
      enum: ['apartment', 'villa', 'commercial', 'plot'],
    },
    location: {
      address: String,
      city: String,
      state: String,
      country: String,
      zipCode: String,
      googleMapsLink: String,
    },
    status: {
      type: String,
      required: true,
      enum: ['planning', 'launched', 'under_construction', 'ready', 'completed'],
      default: 'planning',
    },
    totalUnits: {
      type: Number,
      required: true,
    },
    targetRevenue: {
      type: Number,
      required: [true, 'Please specify the target revenue'],
    },
    launchDate: {
      type: Date,
    },
    possessionDate: {
      type: Date,
    },
    // Flexible object for project-specific configurations like amenities, etc.
    configuration: {
      type: Map,
      of: String,
    },
    // Embedded schemas for financial rules
    pricingRules: pricingRulesSchema,
    additionalCharges: [additionalChargeSchema],
  },
  {
    timestamps: true, // Automatically adds createdAt and updatedAt fields
  }
);

const Project = mongoose.model('Project', projectSchema);

export default Project;
