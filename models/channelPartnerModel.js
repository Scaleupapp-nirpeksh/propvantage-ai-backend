// File: models/channelPartnerModel.js
// Description: A channel partner firm — an external broker organisation that
//   sources buyers for the developer. Managed records (no login in this phase).

import mongoose from 'mongoose';
import encryptionPlugin from '../utils/encryptionPlugin.js';

const channelPartnerSchema = new mongoose.Schema(
  {
    organization: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
    firmName: {
      type: String,
      required: [true, 'Firm name is required'],
      trim: true,
    },
    reraRegistrationNumber: { type: String, trim: true, default: '' },
    pan: { type: String, trim: true, uppercase: true, default: '' },
    gstin: { type: String, trim: true, uppercase: true, default: '' },
    primaryContact: {
      name: { type: String, trim: true, default: '' },
      email: { type: String, trim: true, lowercase: true, default: '' },
      phone: { type: String, trim: true, default: '' },
    },
    address: { type: String, trim: true, default: '' },
    approvedProjects: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Project' }],
    status: {
      type: String,
      enum: ['active', 'suspended', 'blacklisted'],
      default: 'active',
      index: true,
    },
    category: {
      type: String,
      enum: ['broker_firm', 'individual_agent', 'corporate', 'digital_aggregator'],
      default: 'broker_firm',
      index: true,
    },
    bankDetails: {
      accountName: { type: String, trim: true, default: '' },
      accountNumber: { type: String, trim: true, default: '' },
      ifsc: { type: String, trim: true, uppercase: true, default: '' },
      bankName: { type: String, trim: true, default: '' },
    },
    agreementNotes: { type: String, trim: true, default: '' },
    onboardedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

// Compound indexes for the controller's common query shapes.
channelPartnerSchema.index({ organization: 1, status: 1 });
channelPartnerSchema.index({ organization: 1, firmName: 1 });
channelPartnerSchema.index({ organization: 1, category: 1 });

// Field-level encryption for the payout bank account number (PII).
channelPartnerSchema.plugin(encryptionPlugin, {
  fields: ['bankDetails.accountNumber'],
});

const ChannelPartner = mongoose.model('ChannelPartner', channelPartnerSchema);

export default ChannelPartner;
