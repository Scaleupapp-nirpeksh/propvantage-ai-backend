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
    // SP5 — per-org AI quota overrides. When null, the rate-limit middleware
    // falls back to INSIGHT_DEFAULT_DAILY_QUOTA / INSIGHT_DEFAULT_HOURLY_QUOTA
    // from .env. The `plan` field is the SP6 monetization hook (e.g.
    // 'default', 'pro', 'enterprise'); SP5 leaves it at 'default' everywhere.
    aiQuota: {
      dailyQuota:  { type: Number, default: null },
      hourlyQuota: { type: Number, default: null },
      plan:        { type: String, default: 'default' },
    },
    // SP5+ — developer-org commission invoice policy. The trigger threshold
    // determines when the system fires `commission_invoice_ready` to the
    // CP (cumulative customer payments ≥ this fraction of Sale.totalAmount).
    // Used only for builder orgs; channel-partner orgs ignore it.
    invoicePolicy: {
      commissionInvoiceTriggerPct: { type: Number, default: 0.20, min: 0, max: 1 },
    },
    // Voice agent (AI calling) — per-org configuration. The provider assistant
    // is created lazily from this config and re-synced when its hash changes.
    voiceAgent: {
      enabled: { type: Boolean, default: false },
      autoCallNewLeads: { type: Boolean, default: false },
      agentName: { type: String, default: 'Aanya', trim: true },
      hindiSwitching: { type: Boolean, default: true },
      callingHours: {
        start: { type: String, default: '09:00' }, // IST, HH:mm
        end: { type: String, default: '21:00' },
      },
      voice: {
        provider: { type: String, default: 'cartesia' },
        voiceId: { type: String, default: '95d51f79-c397-46f9-b49a-23763d3eaa2d' },
        model: { type: String, default: 'sonic-3' },
        language: { type: String, default: 'hi' },
      },
      monthlyMinuteBudget: { type: Number, default: 300, min: 0 },
      // Org-wide guardrails applied to every playbook (a playbook may narrow, not widen,
      // unless timing.overrideOrgGuardrails is set by a top-tier role).
      cooldownDays: { type: Number, default: 3, min: 0 },
      hardWindow: {
        start: { type: String, default: '09:00' },
        end: { type: String, default: '21:00' },
      },
      vapiAssistantId: { type: String, default: null },
      assistantConfigHash: { type: String, default: null },
      phoneNumberId: { type: String, default: null },
      phoneNumber: { type: String, default: null },
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
