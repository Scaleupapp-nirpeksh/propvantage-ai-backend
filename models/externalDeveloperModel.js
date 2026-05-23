// File: models/externalDeveloperModel.js
// Description: SP4 — an off-platform developer that a channel-partner
//   organization tracks locally. Lives in the CP org. When the actual
//   developer later joins the platform via the invite link, this record
//   gets `claimedByOrg` / `claimedAt` set and (in services/external
//   DeveloperService.claimExternalDeveloper) a Partnership is created and
//   all linked Prospects are re-tagged from external → platform context.

import mongoose from 'mongoose';
import Organization from './organizationModel.js';

const projectEntrySchema = new mongoose.Schema(
  {
    name: { type: String, required: [true, 'Project name is required'], trim: true },
    location: { type: String, trim: true },
    // Free text — e.g. 'Residential', 'Commercial', '4BHK Tower' — intentionally
    // unstructured at this stage.
    type: { type: String, trim: true },
    notes: { type: String, trim: true },
  },
  { _id: false }
);

const inviteSchema = new mongoose.Schema(
  {
    // 64-char hex from crypto.randomBytes(32).toString('hex'). Sparse-unique
    // index defined on the parent schema below; subdoc itself is unkeyed.
    token: { type: String, default: null, trim: true },
    email: { type: String, trim: true, lowercase: true, default: '' },
    invitedAt: { type: Date, default: null },
    invitedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    expiresAt: { type: Date, default: null },
  },
  { _id: false }
);

const externalDeveloperSchema = new mongoose.Schema(
  {
    organization: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
    name: { type: String, required: [true, 'Name is required'], trim: true },
    description: { type: String, trim: true, default: '' },
    contact: {
      person: { type: String, trim: true, default: '' },
      email: { type: String, trim: true, lowercase: true, default: '' },
      phone: { type: String, trim: true, default: '' },
    },
    address: { type: String, trim: true, default: '' },
    city: { type: String, trim: true, index: true, default: '' },
    projects: { type: [projectEntrySchema], default: [] },
    invite: { type: inviteSchema, default: () => ({}) },
    // Set when the developer registers via the invite link; from that point on
    // the partnership is active and the linked Prospects are re-tagged.
    claimedByOrg: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      default: null,
    },
    claimedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// On first create, assert the owning org is a channel-partner. Subsequent
// updates skip the check (organization is immutable in practice).
externalDeveloperSchema.pre('save', async function preSaveValidateOrg(next) {
  if (!this.isNew) return next();
  try {
    const org = await Organization.findById(this.organization).select('type').lean();
    if (!org) return next(new Error('Organization not found'));
    if (org.type !== 'channel_partner') {
      return next(new Error('ExternalDeveloper can only be created in a channel-partner organization'));
    }
    return next();
  } catch (err) {
    return next(err);
  }
});

// Indexes — query shapes used by the controller / claim flow.
// (organization: 1 is already declared inline via `index: true` on the field.)
externalDeveloperSchema.index({ 'invite.token': 1 }, { unique: true, sparse: true });
externalDeveloperSchema.index({ claimedByOrg: 1 }, { sparse: true });

const ExternalDeveloper = mongoose.model('ExternalDeveloper', externalDeveloperSchema);

export default ExternalDeveloper;
