// File: models/salesModel.js
// Updated to include payment plan reference and frontend compatibility

import mongoose from 'mongoose';

const saleSchema = new mongoose.Schema(
  {
    project: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: 'Project',
    },
    unit: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: 'Unit',
      // Uniqueness is enforced by a partial index below: one ACTIVE sale per unit,
      // so a cancelled booking can sit alongside a later resale.
    },
    lead: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: 'Lead',
    },
    organization: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: 'Organization',
    },
    salesPerson: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: 'User',
    },
    channelPartner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
    },
    salePrice: {
      type: Number,
      required: true,
    },
    // 🔥 ADD REFERENCE TO PAYMENT PLAN
    paymentPlan: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PaymentPlan',
    },
    // Keep snapshots for historical reference and frontend compatibility
    costSheetSnapshot: {
      type: Object,
      required: true,
    },
    paymentPlanSnapshot: {
      type: Object, // Frontend sends: { templateId, templateName, schedule }
    },
    bookingDate: {
      type: Date,
      default: Date.now,
    },
    status: {
      type: String,
      enum: ['Pending Approval', 'Booked', 'Agreement Signed', 'Registered', 'Completed', 'Cancelled'],
      default: 'Booked',
    },
    commission: {
      rate: { type: Number },
      amount: { type: Number },
    },

    // Channel partner attribution — which CP(s) sourced this booking
    channelPartnerAttribution: {
      viaChannelPartner: { type: Boolean, default: false },
      partners: [
        {
          channelPartner: { type: mongoose.Schema.Types.ObjectId, ref: 'ChannelPartner' },
          agent: { type: mongoose.Schema.Types.ObjectId, ref: 'ChannelPartnerAgent', default: null },
          sharePct: { type: Number, default: 0, min: 0, max: 100 },
        },
      ],
      status: {
        type: String,
        enum: ['tagged', 'pending', 'approved', 'rejected'],
        default: 'tagged',
      },
      taggedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
      taggedAt: { type: Date, default: null },
      history: [
        {
          at: { type: Date, default: Date.now },
          by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
          action: { type: String },
          note: { type: String },
        },
      ],
    },

    // Approval reference (populated when sale requires discount approval)
    approvalRequest: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ApprovalRequest',
    },
    // Add discount tracking for frontend compatibility
    // ── Optional deal detail (captured from developer MIS imports) ──
    additionalUnits: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Unit' }], // "jodi": one booking over several apartments
    sourcingManager: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    sourcingManagerName: { type: String, trim: true },
    closingManagerName: { type: String, trim: true },
    tokenAmount: { type: Number },
    allInValue: { type: Number },
    agreementValuePsf: { type: Number },
    allInValuePsf: { type: Number },
    stampDuty: { type: Number },
    sourceType: { type: String, trim: true },        // CP / Direct / MGMT / Ref
    sourceName: { type: String, trim: true },        // broker person / management referrer
    // Booking process tracker — the CRM desk's Y / N / NA checklist per booking.
    processTracker: {
      costSheet: { type: String, trim: true },
      bookingForm: { type: String, trim: true },
      kyc: { type: String, trim: true },
      token: { type: String, trim: true },
      gstOnToken: { type: String, trim: true },
      bookingAmount: { type: String, trim: true },
      gstOnBookingAmount: { type: String, trim: true },
      reversePayment: { type: String, trim: true },
      registration: { type: String, trim: true },
      erpUpload: { type: String, trim: true },
      systemLive: { type: String, trim: true },
      dependency: { type: String, trim: true },       // Sales / CRM / MGMT
      salesRemarks: { type: String, trim: true },
      crmRemarks: { type: String, trim: true },
    },
    // Status as recorded by other parties (e.g. an auditor's file) for reconciliation.
    externalStatus: {
      sales: { type: String, trim: true },
      audit: { type: String, trim: true },
      auditRemarks: { type: String, trim: true },
    },
    importKey: { type: String, trim: true },
    importBatch: { type: mongoose.Schema.Types.ObjectId, ref: 'ImportBatch' },

    discountAmount: {
      type: Number,
      default: 0,
    },
    // Additional fields for cancellation tracking
    cancellationReason: {
      type: String,
    },
    cancelledBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    cancelledAt: {
      type: Date,
    },
    // SP5+ — set the first time cumulative customer payments cross the
    // developer-org's invoicePolicy.commissionInvoiceTriggerPct threshold.
    // Guards against re-notifying the CP on every subsequent payment.
    commissionInvoiceTriggered: {
      at:      { type: Date, default: null },
      paidPct: { type: Number, default: null },
      cpOrg:   { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', default: null },
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

// Virtual for sale number generation
saleSchema.virtual('saleNumber').get(function() {
  return `SAL-${this._id.toString().slice(-6).toUpperCase()}`;
});

// Virtual for payment plan status
saleSchema.virtual('paymentPlanStatus').get(function() {
  // This will be populated when payment plan is populated
  return this.paymentPlan?.status || 'not_created';
});

// Index for better query performance
saleSchema.index({ organization: 1, project: 1 });
export const ACTIVE_SALE_STATUSES = ['Pending Approval', 'Booked', 'Agreement Signed', 'Registered', 'Completed'];
saleSchema.index(
  { unit: 1 },
  { name: 'unit_active_unique', unique: true, partialFilterExpression: { status: { $in: ACTIVE_SALE_STATUSES } } }
);
saleSchema.index({ organization: 1, importKey: 1 }, { unique: true, partialFilterExpression: { importKey: { $type: 'string' } } });
saleSchema.index({ lead: 1 });
saleSchema.index({ salesPerson: 1 });
saleSchema.index({ status: 1 });
saleSchema.index({ bookingDate: 1 });
saleSchema.index({ paymentPlan: 1 });

const Sale = mongoose.model('Sale', saleSchema);

export default Sale;