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
    },
    reraRegistrationNumber: {
      type: String,
      trim: true,
      uppercase: true, // normalizes on save via Mongoose setter — all writes must go through Mongoose (not raw driver updateOne) for the unique index's case-consistency to hold
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
    // Developer public portfolio (SP2) — public-facing org profile (builder orgs).
    portfolioProfile: {
      logoUrl: { type: String, default: null },
      about: { type: String, default: '' },
    },
    // Channel-partner marketing profile (SP3) — public-facing CP profile
    // (channel_partner orgs); surfaced in the marketplace CP directory and on
    // partnership applications. Unused for builder orgs.
    channelPartnerProfile: {
      logoUrl: { type: String, default: null },
      about: { type: String, default: '' },
      areasServed: { type: [String], default: [] },
      trackRecord: { type: String, default: '' },
    },
  },
  {
    timestamps: true, // Automatically adds createdAt and updatedAt fields
  }
);

// RERA registration number is unique among channel-partner orgs only —
// the partial filter keeps it from colliding with builder orgs (which have none),
// and the $type:'string' guard excludes channel-partner orgs that have no RERA number
// (null / missing) so two unregistered CPs cannot collide on a null key.
organizationSchema.index(
  { reraRegistrationNumber: 1 },
  { unique: true, partialFilterExpression: { type: 'channel_partner', reraRegistrationNumber: { $type: 'string' } } }
);

const Organization = mongoose.model('Organization', organizationSchema);

export default Organization;
