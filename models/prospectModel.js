// File: models/prospectModel.js
// Description: SP4 — the CP-side prospect entity. Lives in a CP organization
//   and represents a person the CP is working with, regardless of whether
//   the developer in question is on-platform or off-platform.
//
//   When the developer is on-platform (developerContext.type='platform'),
//   the CP can push the prospect to that developer via
//   POST /api/cp/prospects/:id/push, which creates a status:'pending' Lead
//   in the developer's organization (Lead.sourceProspect points back here).
//
//   When the developer is off-platform (developerContext.type='external'),
//   everything is tracked locally — the CP runs the full workflow (status,
//   activities, manual commission ledger) without the developer needing to
//   join the platform. If the developer later joins via the invite link,
//   claimExternalDeveloper re-tags the developerContext to 'platform'.
//
//   Commission tracking (agreement, booking, payments, write-off) is manual
//   and works for both contexts. The developer-side official CommissionRule
//   engine is unchanged.

import mongoose from 'mongoose';
import Organization from './organizationModel.js';

// ─── Sub-schema: agreed commission terms ────────────────────────────────────
// Dedicated sub-schema so the field literally named `type` is unambiguous to
// Mongoose (same gotcha as Partnership.commissionTerms in SP3).
const commissionAgreementSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ['percentage', 'flat'] },
    value: { type: Number, min: 0 },                  // % when type='percentage', currency amount when 'flat'
    currency: { type: String, default: 'INR' },
    notes: { type: String, trim: true, default: '' },
  },
  { _id: false }
);

// ─── Sub-schema: a single commission payment receipt ────────────────────────
const commissionPaymentSchema = new mongoose.Schema(
  {
    amount: { type: Number, required: true, min: 0 },
    receivedAt: { type: Date, required: true },
    method: {
      type: String,
      enum: ['bank_transfer', 'cheque', 'cash', 'upi', 'other'],
    },
    referenceNumber: { type: String, trim: true, default: '' },
    notes: { type: String, trim: true, default: '' },
    recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    recordedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

// ─── Sub-schema: activity log entry ─────────────────────────────────────────
const activitySchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ['call', 'site_visit', 'note', 'follow_up_scheduled', 'status_change', 'system'],
      required: true,
    },
    note: { type: String, trim: true, default: '' },
    at: { type: Date, default: Date.now },
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }, // null for system entries
  },
  { _id: false }
);

// ─── Lead status values (mirrors Lead.status enum, minus 'pending' which
// only exists server-side for the registrations queue). Kept inline for
// schema clarity — these are the values a CP-side Prospect.status may take.
const PROSPECT_STATUS_VALUES = [
  'New', 'Contacted', 'Qualified', 'Site Visit Scheduled',
  'Site Visit Completed', 'Negotiating', 'Booked', 'Lost', 'Unqualified',
];

const prospectSchema = new mongoose.Schema(
  {
    organization: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },

    // Contact
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, trim: true, default: '' },
    email: { type: String, trim: true, lowercase: true, default: '' },
    phone: { type: String, required: true, trim: true },

    // Developer context — discriminator on `type`. Validation enforced in pre-save.
    developerContext: {
      type: {
        type: String,
        enum: ['external', 'platform'],
        required: true,
      },
      externalDeveloper: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'ExternalDeveloper',
        // required when developerContext.type === 'external' — enforced in pre-save.
      },
      partnership: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Partnership',
        // required when developerContext.type === 'platform' — enforced in pre-save.
      },
    },

    project: {
      // When developerContext.type === 'external' — free text
      external: {
        name: { type: String, trim: true },
        location: { type: String, trim: true },
        type: { type: String, trim: true },
      },
      // When developerContext.type === 'platform' — ref to the developer's Project
      platform: { type: mongoose.Schema.Types.ObjectId, ref: 'Project' },
    },

    assignedAgent: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
      // The service layer enforces that this User belongs to the same CP org.
    },

    status: {
      type: String,
      enum: PROSPECT_STATUS_VALUES,
      default: 'New',
      index: true,
    },

    priority: { type: String, enum: ['Low', 'Medium', 'High'], default: 'Medium' },
    budget: {
      min: { type: Number, default: null },
      max: { type: Number, default: null },
      currency: { type: String, default: 'INR' },
    },
    // SP4+ — structured to mirror Lead.requirements so the CP captures the
    // same customer detail the dev would, and push can map field-for-field.
    // Legacy free-text values were migrated into `specialRequirements` by
    // data/migrateProspectRequirementsToStructured.js.
    requirements: {
      timeline: {
        type: String,
        enum: ['immediate', '1-3_months', '3-6_months', '6-12_months', '12+_months'],
      },
      unitType: { type: String, trim: true }, // e.g. '2BHK', '3BHK', 'Villa'
      floor: {
        preference: {
          type: String,
          enum: ['low', 'medium', 'high', 'any'],
          default: 'any',
        },
        specific: { type: Number, default: null },
      },
      facing: {
        type: String,
        enum: [
          'North', 'South', 'East', 'West',
          'North-East', 'North-West', 'South-East', 'South-West', 'Any',
        ],
        default: 'Any',
      },
      amenities: [{ type: String, trim: true }],
      specialRequirements: { type: String, trim: true, default: '' },
    },
    notes: { type: String, trim: true, default: '' },

    // SP4+ — CP-visible prospect score (mirrors Lead.score on dev side).
    // Computed by services/prospectScoringService using the inputs the CP
    // has (budget, requirements.timeline, recency, activity count). Plus a
    // mirror of the dev-side score once the prospect is pushed/accepted, so
    // the CP can see how the developer is scoring the lead.
    score: { type: Number, min: 0, max: 100, default: 0 },
    scoreGrade: {
      type: String,
      enum: ['Hot', 'Warm', 'Cold', 'Very Cold'],
      default: 'Cold',
    },
    scoreBreakdown: {
      budgetAlignment: { rawScore: Number, weightedScore: Number, reasoning: String },
      engagementLevel: { rawScore: Number, weightedScore: Number, reasoning: String },
      timelineUrgency: { rawScore: Number, weightedScore: Number, reasoning: String },
      recencyFactor: { rawScore: Number, weightedScore: Number, reasoning: String },
    },
    lastScoreUpdate: { type: Date, default: null },
    // Mirrored from the on-platform Lead post-push so the CP can see the
    // developer's view of the same person.
    devScore: { type: Number, min: 0, max: 100, default: null },
    devScoreGrade: { type: String, default: null },
    devScoreUpdatedAt: { type: Date, default: null },

    // SP4+ — research-source URLs the CP can supply at intake; on push
    // these get copied into Lead.enrichment.sources.* so the dev-side AI
    // enrichment pipeline has more to work with. Same shape as the Lead
    // side so mapping is one-to-one.
    enrichment: {
      sources: {
        linkedinUrl: { type: String, trim: true, default: '' },
        companyWebsite: { type: String, trim: true, default: '' },
      },
    },

    activities: { type: [activitySchema], default: [] },

    followUp: {
      nextDate: { type: Date, default: null },
      type: { type: String, enum: ['call', 'site_visit', 'meeting', 'other'] },
      note: { type: String, trim: true, default: '' },
    },

    // Set when this Prospect is pushed to an on-platform developer as a Lead.
    pushedToLead: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Lead',
      default: null,
      index: { sparse: true },
    },
    pushedAt: { type: Date, default: null },
    pushedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    // Manual commission tracking — works regardless of developer being on/off platform.
    commissionAgreement: { type: commissionAgreementSchema, default: null },

    booking: {
      bookedAt: { type: Date, default: null },
      unitInfo: { type: String, trim: true, default: '' }, // free text, e.g. '3BHK Tower A 1204'
      salePrice: { type: Number, default: null },
      currency: { type: String, default: 'INR' },
      notes: { type: String, trim: true, default: '' },
    },

    commission: {
      expectedAmount: { type: Number, default: null }, // auto-calculated by services/prospectService
      status: {
        type: String,
        enum: ['pending', 'partially_paid', 'paid', 'written_off'],
        default: 'pending',
      },
      payments: { type: [commissionPaymentSchema], default: [] },
      writeOffReason: { type: String, trim: true, default: '' }, // required when status='written_off'
    },

    // SP5 — explicit reconciliation-review tracking. Set when a CP user
    // confirms they've reviewed a reconciliation row (matched / cp_only /
    // dev_only / mismatched). Surfaces in the reconciliation dashboard so
    // teams can prioritise unreviewed rows. Set via the
    // POST /api/cp/analytics/reconciliation/:prospectId/reviewed endpoint.
    reconciliationReviewedAt: { type: Date, default: null },
    reconciliationReviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

// ─── Pre-save validation ────────────────────────────────────────────────────
prospectSchema.pre('save', async function preSaveValidate(next) {
  try {
    // 1. The owning org must be a channel partner (only checked on insert —
    //    organization is immutable in practice and re-checking on every save
    //    is wasted work).
    if (this.isNew) {
      const org = await Organization.findById(this.organization).select('type').lean();
      if (!org) return next(new Error('Organization not found'));
      if (org.type !== 'channel_partner') {
        return next(new Error('Prospect can only be created in a channel-partner organization'));
      }
    }

    // 2. Developer-context discriminator must be consistent with refs.
    const ctxType = this.developerContext?.type;
    if (ctxType === 'external') {
      if (!this.developerContext?.externalDeveloper) {
        return next(new Error('developerContext.externalDeveloper is required when developerContext.type is "external"'));
      }
    } else if (ctxType === 'platform') {
      if (!this.developerContext?.partnership) {
        return next(new Error('developerContext.partnership is required when developerContext.type is "platform"'));
      }
      // NOTE: `project.platform` is required at *create-time* for new
      // platform-context prospects — that check lives in prospectService
      // (createProspect / updateProspect). It deliberately does NOT run
      // here because the SP4 claim flow retags external-context prospects
      // into platform-context in bulk (via updateMany) without yet having
      // a Project mapping; those retagged prospects keep their original
      // project.external info and may be mapped to a Project later
      // (deferred — likely SP5 UX).
      //
      // Active-partnership + same-CP-org check on first save (or on
      // partnership change) — still enforced for safety.
      if (this.isNew || this.isModified('developerContext.partnership')) {
        // Lazy-require to avoid an import cycle (Partnership service-side
        // logic may import Prospect later).
        const Partnership = mongoose.model('Partnership');
        const p = await Partnership.findById(this.developerContext.partnership)
          .select('status channelPartnerOrg developerOrg')
          .lean();
        if (!p) return next(new Error('Partnership not found'));
        if (p.status !== 'active') {
          return next(new Error('Partnership must be active to attach a prospect'));
        }
        if (String(p.channelPartnerOrg) !== String(this.organization)) {
          return next(new Error('Partnership does not belong to this channel-partner organization'));
        }
      }
    }

    // 3. Write-off requires a reason.
    if (this.commission?.status === 'written_off' && !String(this.commission?.writeOffReason || '').trim()) {
      return next(new Error('commission.writeOffReason is required when commission.status is "written_off"'));
    }

    return next();
  } catch (err) {
    return next(err);
  }
});

// ─── Indexes — query shapes used by the controller / service ────────────────
// (organization: 1 is already declared inline via `index: true` on the field;
//  status:1 and assignedAgent:1 are likewise inline.)
prospectSchema.index({ organization: 1, status: 1 });
prospectSchema.index({ organization: 1, assignedAgent: 1 });
prospectSchema.index({ 'developerContext.externalDeveloper': 1 }, { sparse: true });
prospectSchema.index({ 'developerContext.partnership': 1 }, { sparse: true });

export { PROSPECT_STATUS_VALUES };

const Prospect = mongoose.model('Prospect', prospectSchema);

export default Prospect;
