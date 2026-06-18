// File: models/supportInboxModel.js
// Description: Maps a helpdesk recipient address (e.g. 25south@helpdesk.prop-vantage.com)
//   to an organization. The inbound webhook routes mail by RECIPIENT address only —
//   never by an org id in the payload — so this is the single source of truth for
//   multi-tenant routing. Address is lowercased + unique.

import mongoose from 'mongoose';

const supportInboxSchema = new mongoose.Schema(
  {
    organization: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: [true, 'Organization is required'],
      index: true,
    },
    address: {
      type: String,
      required: [true, 'Address is required'],
      lowercase: true,
      trim: true,
      unique: true,
      index: true,
    },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

const SupportInbox = mongoose.model('SupportInbox', supportInboxSchema);

export default SupportInbox;
