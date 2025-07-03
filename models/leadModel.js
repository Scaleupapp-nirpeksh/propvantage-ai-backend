// File: models/leadModel.js
// Description: Defines the Mongoose schema and model for a Lead.

import mongoose from 'mongoose';

const leadSchema = new mongoose.Schema(
  {
    organization: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: 'Organization',
    },
    project: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: 'Project',
    },
    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User', // Sales Executive or Manager
    },
    firstName: {
      type: String,
      required: [true, 'Please add a first name'],
      trim: true,
    },
    lastName: {
      type: String,
      trim: true,
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
    },
    phone: {
      type: String,
      required: [true, 'Please add a phone number'],
      trim: true,
    },
    source: {
      type: String,
      enum: [
        'Website',
        'Property Portal',
        'Referral',
        'Walk-in',
        'Social Media',
        'Advertisement',
        'Cold Call',
        'Other',
      ],
      default: 'Other',
    },
    status: {
      type: String,
      enum: [
        'New',
        'Contacted',
        'Qualified',
        'Site Visit Scheduled',
        'Site Visit Completed',
        'Negotiating',
        'Booked',
        'Lost',
        'Unqualified',
      ],
      default: 'New',
    },
    // AI-powered score to determine lead quality
    score: {
      type: Number,
      default: 0,
    },
    budget: {
      min: { type: Number },
      max: { type: Number },
    },
    // Flexible object for lead's specific requirements
    requirements: {
      unitTypes: [String], // e.g., ['2BHK', '3BHK']
      timeline: String, // e.g., 'immediate', '1-3_months'
      notes: String,
    },
  },
  {
    timestamps: true,
  }
);

const Lead = mongoose.model('Lead', leadSchema);

export default Lead;
