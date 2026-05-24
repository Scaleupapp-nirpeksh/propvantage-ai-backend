// File: models/commissionInvoiceModel.js
// Description: SP5+ — Commission Invoice. A formal billing document a
//   channel-partner organisation issues to a developer organisation for
//   commission earned on a booked Sale. Distinct from the existing
//   customer-facing Invoice (which bills the customer for the property).
//
//   Lifecycle:
//     draft     ─── CP fills in fields, not visible to dev yet
//        │
//        ▼ submit
//     submitted ── dev sees + reviews
//        │
//        ├── approve ─→ approved ── dev records payment ─→ paid
//        ├── reject  ─→ rejected ── CP can edit + resubmit
//        └── cancel  ─→ cancelled (CP withdraws before approval)
//
//   Trigger: the invoice typically becomes "due" when the customer has paid
//   ≥ Organization.invoicePolicy.commissionInvoiceTriggerPct (default 0.20)
//   of the Sale total. That trigger fires a notification + sets a flag on
//   the Sale; the CP then explicitly creates the invoice.

import mongoose from 'mongoose';

const STATUS_VALUES = ['draft', 'submitted', 'approved', 'rejected', 'paid', 'cancelled'];

// Bank + tax details captured per-invoice (one-time snapshot at issuance
// so changes to the CP profile later don't retroactively alter the invoice).
const cpPartySchema = new mongoose.Schema({
  legalName:       { type: String, trim: true, default: '' },
  gstin:           { type: String, trim: true, uppercase: true, default: '' },
  pan:             { type: String, trim: true, uppercase: true, default: '' },
  bankAccountName: { type: String, trim: true, default: '' },
  bankAccountNumber:{ type: String, trim: true, default: '' },
  bankIfsc:        { type: String, trim: true, uppercase: true, default: '' },
  bankName:        { type: String, trim: true, default: '' },
  address:         { type: String, trim: true, default: '' },
}, { _id: false });

const historyEntrySchema = new mongoose.Schema({
  at:      { type: Date, default: Date.now },
  by:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  byOrg:   { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', default: null },
  action:  { type: String, required: true }, // 'created' | 'submitted' | 'approved' | 'rejected' | 'paid' | 'cancelled' | 'edited'
  note:    { type: String, trim: true, default: '' },
}, { _id: false });

const commissionInvoiceSchema = new mongoose.Schema({
  // ─── Identity ─────────────────────────────────────────────────────────
  invoiceNumber: { type: String, unique: true, sparse: true, index: true },
  invoicePrefix: { type: String, default: 'CP-INV', trim: true, maxlength: 16 },
  financialYear: { type: String, trim: true, default: '' }, // 'YYYY-YY' Apr–Mar

  // ─── Cross-org refs ───────────────────────────────────────────────────
  cpOrg:        { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
  developerOrg: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
  partnership:  { type: mongoose.Schema.Types.ObjectId, ref: 'Partnership',  required: true, index: true },

  // The CP's source Prospect (sparse — null for invoices on dev-originated leads).
  prospect:     { type: mongoose.Schema.Types.ObjectId, ref: 'Prospect', default: null, index: { sparse: true } },
  // The dev-side Lead the invoice is for (always present).
  lead:         { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true, index: true },
  // The Sale that triggered the invoice (always present once a booking exists).
  sale:         { type: mongoose.Schema.Types.ObjectId, ref: 'Sale', required: true, index: true },
  // Optional link to the dev's CommissionRecord engine (for reconciliation).
  commissionRecord: { type: mongoose.Schema.Types.ObjectId, ref: 'CommissionRecord', default: null, sparse: true },

  // ─── Money (Indian compliance shape) ──────────────────────────────────
  baseAmount: { type: Number, required: true, min: 0 },         // commission before tax
  gstPct:     { type: Number, default: 18, min: 0, max: 100 },  // % (Indian default is 18% on services)
  gstAmount:  { type: Number, default: 0, min: 0 },             // auto-computed in pre-save
  tdsPct:     { type: Number, default: 5, min: 0, max: 100 },   // % (Indian default for commission)
  tdsAmount:  { type: Number, default: 0, min: 0 },             // auto-computed in pre-save
  netPayable: { type: Number, default: 0, min: 0 },             // = base + gst - tds (auto)
  currency:   { type: String, default: 'INR', trim: true, uppercase: true },

  // ─── Lifecycle ────────────────────────────────────────────────────────
  status: { type: String, enum: STATUS_VALUES, default: 'draft', index: true },

  // ─── Snapshots ────────────────────────────────────────────────────────
  cpParty: { type: cpPartySchema, default: () => ({}) },

  // ─── Audit ────────────────────────────────────────────────────────────
  createdBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  submittedAt: { type: Date, default: null },
  submittedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  decidedAt:   { type: Date, default: null },
  decidedBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  decisionNote:{ type: String, trim: true, default: '' },
  paidAt:      { type: Date, default: null },
  paidBy:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  paymentReference: { type: String, trim: true, default: '' },
  paymentMethod:    { type: String, enum: ['bank_transfer', 'cheque', 'cash', 'upi', 'other', ''], default: '' },

  notes:    { type: String, trim: true, default: '' },
  history:  { type: [historyEntrySchema], default: [] },
}, { timestamps: true });

// ─── Indexes ────────────────────────────────────────────────────────────
commissionInvoiceSchema.index({ cpOrg: 1, status: 1, createdAt: -1 });
commissionInvoiceSchema.index({ developerOrg: 1, status: 1, createdAt: -1 });
commissionInvoiceSchema.index({ lead: 1, status: 1 });
// Prevent more than one OPEN invoice per (sale, cpOrg) — a CP can't double-bill
// the same booking. Old terminal invoices ('rejected', 'cancelled', 'paid') are
// excluded so the CP can re-submit after a rejection.
commissionInvoiceSchema.index(
  { sale: 1, cpOrg: 1 },
  {
    unique: true,
    partialFilterExpression: { status: { $in: ['draft', 'submitted', 'approved'] } },
  }
);

// ─── Auto-compute money + financial year ───────────────────────────────
commissionInvoiceSchema.pre('save', function preSaveCompute(next) {
  const base = Number(this.baseAmount) || 0;
  const gstPct = Number(this.gstPct) || 0;
  const tdsPct = Number(this.tdsPct) || 0;
  this.gstAmount = Math.round((base * gstPct / 100) * 100) / 100;
  // TDS is deducted on the base (Indian convention) — not on base+GST.
  this.tdsAmount = Math.round((base * tdsPct / 100) * 100) / 100;
  this.netPayable = Math.round((base + this.gstAmount - this.tdsAmount) * 100) / 100;

  // Indian FY: April → March. e.g. May 2026 → '2026-27'.
  if (!this.financialYear) {
    const now = this.createdAt || new Date();
    const y = now.getFullYear();
    const m = now.getMonth(); // 0-indexed
    const startY = m >= 3 ? y : y - 1;
    this.financialYear = `${startY}-${String((startY + 1) % 100).padStart(2, '0')}`;
  }
  next();
});

// ─── Auto-generate invoiceNumber on first submission ───────────────────
// We DON'T allocate a number for drafts — only when the CP submits, so
// cancelled drafts don't burn sequence numbers in the dev's books.
// Format: '<prefix>-<FY>-<seq>'  e.g. 'CP-INV-2026-27-0042'
// Sequence is per (developerOrg, financialYear) — the dev sees a clean
// 1..N invoice book from their CPs in each FY.
commissionInvoiceSchema.statics.allocateInvoiceNumber = async function (devOrgId, financialYear, prefix = 'CP-INV') {
  const Model = this;
  // Count existing numbered invoices for this dev+FY and increment.
  const latest = await Model
    .find({ developerOrg: devOrgId, financialYear, invoiceNumber: { $ne: null, $exists: true } })
    .sort({ createdAt: -1 })
    .limit(1)
    .select('invoiceNumber')
    .lean();
  let seq = 1;
  if (latest.length > 0) {
    const m = String(latest[0].invoiceNumber || '').match(/-(\d+)$/);
    if (m) seq = Number(m[1]) + 1;
  }
  return `${prefix}-${financialYear}-${String(seq).padStart(4, '0')}`;
};

export const COMMISSION_INVOICE_STATUSES = STATUS_VALUES;
const CommissionInvoice = mongoose.model('CommissionInvoice', commissionInvoiceSchema);
export default CommissionInvoice;
