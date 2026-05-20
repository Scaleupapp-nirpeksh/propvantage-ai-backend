// File: models/channelPartnerAgentModel.js
// Description: An individual agent working under a channel partner firm.
//   Managed records (no login in this phase).

import mongoose from 'mongoose';

const channelPartnerAgentSchema = new mongoose.Schema(
  {
    organization: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
    channelPartner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ChannelPartner',
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: [true, 'Agent name is required'],
      trim: true,
    },
    email: { type: String, trim: true, lowercase: true, default: '' },
    phone: { type: String, trim: true, default: '' },
    reraAgentNumber: { type: String, trim: true, default: '' },
    status: {
      type: String,
      enum: ['active', 'inactive'],
      default: 'active',
    },
  },
  { timestamps: true }
);

const ChannelPartnerAgent = mongoose.model(
  'ChannelPartnerAgent',
  channelPartnerAgentSchema
);

export default ChannelPartnerAgent;
