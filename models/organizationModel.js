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

const Organization = mongoose.model('Organization', organizationSchema);

export default Organization;
