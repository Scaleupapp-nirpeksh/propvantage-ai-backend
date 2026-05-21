// File: models/organizationModel.js
// Description: Defines the Mongoose schema and model for an Organization.

import mongoose from 'mongoose';

const organizationSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Please add an organization name'],
      trim: true,
      unique: true,
    },
    type: {
      type: String,
      required: true,
      enum: ['builder', 'channel_partner'],
    },
    country: {
      type: String,
      required: true,
    },
    city: {
      type: String,
      required: true,
    },
    // Flexible object for contact info
    contactInfo: {
      phone: String,
      website: String,
      address: String,
    },
    // Channel-partner-only fields (used when type === 'channel_partner').
    category: {
      type: String,
      enum: ['individual_agent', 'broker_firm', 'corporate', 'digital_aggregator'],
      default: null,
    },
    reraRegistrationNumber: {
      type: String,
      trim: true,
      uppercase: true,
      default: null,
    },
    subscriptionPlan: {
      type: String,
      enum: ['trial', 'starter', 'professional', 'enterprise'],
      default: 'trial',
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true, // Automatically adds createdAt and updatedAt fields
  }
);

// RERA registration number is unique among channel-partner orgs only —
// the partial filter keeps it from colliding with builder orgs (which have none).
organizationSchema.index(
  { reraRegistrationNumber: 1 },
  { unique: true, partialFilterExpression: { type: 'channel_partner' } }
);

const Organization = mongoose.model('Organization', organizationSchema);

export default Organization;
