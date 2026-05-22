// File: models/partnershipModel.js
// Description: A Partnership links one developer (builder) organization and one
//   channel-partner organization — the central model of the marketplace (SP3).
//   It records the relationship a CP and a developer form on the platform: how
//   it was initiated, its lifecycle status, the agreed commission terms, the
//   projects it covers, and a full decision-audit history.

import mongoose from 'mongoose';

// Lifecycle states (SP1 Target Architecture §3.2 — fixed).
export const PARTNERSHIP_STATUSES = ['pending', 'active', 'rejected', 'suspended', 'terminated'];

// History actions — one is appended on every transition.
export const PARTNERSHIP_ACTIONS = [
  'applied', 'invited', 'approved', 'rejected', 'accepted',
  'declined', 'suspended', 'resumed', 'terminated', 'reapplied', 'reinvited',
];

// Agreed commission terms. A dedicated sub-schema (rather than an inline object)
// so the field literally named `type` is unambiguous to Mongoose.
const commissionTermsSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ['percentage', 'flat'] },
    value: { type: Number, min: 0 },
    notes: { type: String, trim: true, default: '' },
  },
  { _id: false }
);

const historyEntrySchema = new mongoose.Schema(
  {
    status: { type: String, enum: PARTNERSHIP_STATUSES }, // the status moved TO
    action: { type: String, enum: PARTNERSHIP_ACTIONS },
    actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    actorOrg: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization' },
    at: { type: Date, default: Date.now },
    note: { type: String, trim: true, default: '' },
  },
  { _id: false }
);

const partnershipSchema = new mongoose.Schema(
  {
    developerOrg: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
    channelPartnerOrg: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: PARTNERSHIP_STATUSES,
      default: 'pending',
      index: true,
    },
    initiatedBy: {
      type: String,
      enum: ['channel_partner', 'developer'],
      required: true,
    },
    // Empty array = the partnership covers ALL the developer's published
    // projects. Non-empty = the developer has restricted it to this subset.
    projects: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Project' }],
    // The apply / invite payload.
    application: {
      message: { type: String, trim: true, default: '' },
      attachments: [
        {
          url: { type: String, trim: true },
          name: { type: String, trim: true },
          uploadedAt: { type: Date, default: Date.now },
        },
      ],
    },
    // Agreed commission terms — set by the developer at approval (CP-initiated)
    // or at invite (developer-initiated). Null until then. On activation these
    // seed the existing CommissionRule / ChannelPartner engine, which still
    // performs the actual commission calculation (SP3 spec §6.5).
    commissionTerms: { type: commissionTermsSchema, default: null },
    // Decision audit.
    requestedAt: { type: Date, default: Date.now },
    decidedAt: { type: Date, default: null },
    decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    history: { type: [historyEntrySchema], default: [] },
  },
  { timestamps: true }
);

// Exactly one Partnership document per (developer, CP) pair, ever. Re-application
// after a reject/terminate reuses the existing document (status → pending again);
// the unique index is the hard backstop against a concurrent-request race.
partnershipSchema.index({ developerOrg: 1, channelPartnerOrg: 1 }, { unique: true });

// Common query shapes: a developer's incoming/active list, a CP's list.
partnershipSchema.index({ developerOrg: 1, status: 1 });
partnershipSchema.index({ channelPartnerOrg: 1, status: 1 });

const Partnership = mongoose.model('Partnership', partnershipSchema);

export default Partnership;
