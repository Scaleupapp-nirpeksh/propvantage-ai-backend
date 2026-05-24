// File: services/commissionInvoiceService.js
// Description: SP5+ — business logic for CommissionInvoice.
//   • Validates cross-org refs at every transition.
//   • CP Agent narrowing (same shape as services/prospectService.js).
//   • Fires the 5 commission_invoice_* notifications at the right moments.
//
//   Two read scopes, four mutating verbs:
//     CP side : createDraft, update, submit, cancel
//     Dev side: decide (approve/reject), recordPayment
//     Both    : list, get
//
//   All mutations append a history entry for audit.

import mongoose from 'mongoose';
import CommissionInvoice from '../models/commissionInvoiceModel.js';
import Prospect from '../models/prospectModel.js';
import Lead from '../models/leadModel.js';
import Sale from '../models/salesModel.js';
import Partnership from '../models/partnershipModel.js';
import Organization from '../models/organizationModel.js';
import { createNotification, notifyUsersWithPermission } from './notificationService.js';

// ─── Helpers ───────────────────────────────────────────────────────────

const httpError = (status, message) => {
  const err = new Error(message);
  err.statusCode = status;
  return err;
};

const isCpAgent = (user) =>
  user?.roleRef?.name === 'CP Agent' || user?.roleRef?.slug === 'cp-agent';

const toObjectId = (id) =>
  mongoose.isValidObjectId(id) ? new mongoose.Types.ObjectId(id) : id;

const appendHistory = (doc, action, user, note = '') => {
  doc.history.push({
    at: new Date(),
    by: user?._id || null,
    byOrg: user?.organization || null,
    action,
    note,
  });
};

// Find the CP shadow ChannelPartner record for this lead/sale so we can
// notify the right agent + manager users on the CP side.
async function resolveCpUsers(lead) {
  const agentUserId = lead?.channelPartnerAttribution?.partners?.[0]?.agentUser || null;
  return { agentUserId };
}

// ─── CP-side scope ─────────────────────────────────────────────────────

/**
 * Returns the Mongo filter that restricts the result-set to invoices the
 * caller's CP org may see, narrowed to assignedAgent for CP Agents.
 */
function cpScopeFilter(user) {
  const filter = { cpOrg: toObjectId(user.organization) };
  // CP Agent narrowing happens on the Prospect.assignedAgent — only invoices
  // whose Prospect.assignedAgent === user._id (resolved at query time below).
  return filter;
}

/**
 * For CP Agents: load the prospect, ensure it's assigned to this agent.
 * Throws 403 otherwise. Owner / Manager get a pass.
 */
async function assertCpAgentAccessToProspect(prospectId, user) {
  if (!isCpAgent(user)) return;
  const p = await Prospect.findById(prospectId).select('assignedAgent organization').lean();
  if (!p) throw httpError(404, 'Prospect not found');
  if (String(p.organization) !== String(user.organization)) {
    throw httpError(404, 'Prospect not found');
  }
  if (String(p.assignedAgent) !== String(user._id)) {
    throw httpError(403, 'CP Agents can only manage invoices for their own prospects');
  }
}

// ─── Public surface ───────────────────────────────────────────────────

/**
 * CP creates a draft invoice from a (prospect OR lead). We need both refs
 * because:
 *   • Prospect is the CP-side concept (carries assignedAgent for narrowing)
 *   • Lead/Sale are the dev-side concepts (carry the booking)
 *
 * Resolves: lead + sale + partnership from the prospect.
 */
export async function createDraft(input, user) {
  const cpOrgId = toObjectId(user.organization);
  const prospectId = input?.prospectId;
  if (!prospectId || !mongoose.isValidObjectId(prospectId)) {
    throw httpError(400, 'prospectId is required');
  }

  const prospect = await Prospect.findOne({ _id: prospectId, organization: cpOrgId }).lean();
  if (!prospect) throw httpError(404, 'Prospect not found in your organisation');
  await assertCpAgentAccessToProspect(prospectId, user);

  if (!prospect.pushedToLead) {
    throw httpError(409, 'This prospect has not been pushed to a developer yet — no Lead to invoice');
  }
  if (prospect.developerContext?.type !== 'platform' || !prospect.developerContext?.partnership) {
    throw httpError(409, 'Only platform-context prospects can have commission invoices');
  }

  const lead = await Lead.findById(prospect.pushedToLead).select('_id organization status sourceProspect').lean();
  if (!lead) throw httpError(404, 'Source lead not found');

  // Find the Sale for this Lead. If there's no Sale yet, the dev hasn't
  // booked — invoice generation is premature.
  const sale = await Sale.findOne({ lead: lead._id }).select('_id organization salePrice').lean();
  if (!sale) {
    throw httpError(409, 'No Sale exists for this lead yet — invoice generation requires a booked sale');
  }

  const partnership = await Partnership.findById(prospect.developerContext.partnership)
    .select('_id developerOrg channelPartnerOrg status')
    .lean();
  if (!partnership || partnership.status !== 'active') {
    throw httpError(409, 'Partnership is not active');
  }

  // Block if there's already an open invoice (draft / submitted / approved)
  // for the same (sale, cpOrg) — the unique partial index guards this on the
  // DB side, but a clean 409 is friendlier than E11000.
  const existing = await CommissionInvoice.findOne({
    sale: sale._id,
    cpOrg: cpOrgId,
    status: { $in: ['draft', 'submitted', 'approved'] },
  }).select('_id status').lean();
  if (existing) {
    throw httpError(409, `An invoice already exists for this sale (status: ${existing.status})`);
  }

  // Default baseAmount from the CP-side commission ledger if present.
  const defaultBase = prospect.commission?.expectedAmount || 0;

  const doc = await CommissionInvoice.create({
    cpOrg: cpOrgId,
    developerOrg: partnership.developerOrg,
    partnership: partnership._id,
    prospect: prospect._id,
    lead: lead._id,
    sale: sale._id,
    baseAmount: Number(input.baseAmount) || defaultBase,
    gstPct: input.gstPct ?? 18,
    tdsPct: input.tdsPct ?? 5,
    currency: input.currency || prospect.commissionAgreement?.currency || 'INR',
    cpParty: input.cpParty || {},
    notes: input.notes || '',
    status: 'draft',
    createdBy: user._id,
    history: [{
      at: new Date(),
      by: user._id,
      byOrg: cpOrgId,
      action: 'created',
      note: 'Draft invoice created',
    }],
  });
  return doc.toObject();
}

/**
 * CP updates a draft invoice's editable fields.
 */
export async function update(invoiceId, patch, user) {
  const inv = await CommissionInvoice.findById(invoiceId);
  if (!inv) throw httpError(404, 'Invoice not found');
  if (String(inv.cpOrg) !== String(user.organization)) {
    throw httpError(404, 'Invoice not found');
  }
  if (inv.status !== 'draft' && inv.status !== 'rejected') {
    throw httpError(409, `Cannot edit an invoice with status '${inv.status}'`);
  }
  if (inv.prospect) await assertCpAgentAccessToProspect(inv.prospect, user);

  const editable = ['baseAmount', 'gstPct', 'tdsPct', 'currency', 'cpParty', 'notes'];
  let dirty = false;
  for (const key of editable) {
    if (patch[key] !== undefined) {
      inv[key] = patch[key];
      dirty = true;
    }
  }
  // Re-rejected → bump back to draft so the CP can re-submit.
  if (inv.status === 'rejected') {
    inv.status = 'draft';
    inv.decisionNote = '';
    inv.decidedAt = null;
    inv.decidedBy = null;
  }
  if (dirty) appendHistory(inv, 'edited', user);
  await inv.save();
  return inv.toObject();
}

/**
 * CP submits the draft. Allocates the invoice number, fires the
 * `commission_invoice_submitted` notification to the developer side.
 */
export async function submit(invoiceId, user) {
  const inv = await CommissionInvoice.findById(invoiceId);
  if (!inv) throw httpError(404, 'Invoice not found');
  if (String(inv.cpOrg) !== String(user.organization)) {
    throw httpError(404, 'Invoice not found');
  }
  if (inv.status !== 'draft') {
    throw httpError(409, `Can only submit a draft invoice (current status: '${inv.status}')`);
  }
  if (inv.prospect) await assertCpAgentAccessToProspect(inv.prospect, user);
  if (!(inv.baseAmount > 0)) {
    throw httpError(400, 'baseAmount must be > 0 before submitting');
  }

  // Allocate per-(dev, FY) invoice number on first submission.
  if (!inv.invoiceNumber) {
    inv.invoiceNumber = await CommissionInvoice.allocateInvoiceNumber(
      inv.developerOrg, inv.financialYear, inv.invoicePrefix
    );
  }

  inv.status = 'submitted';
  inv.submittedAt = new Date();
  inv.submittedBy = user._id;
  appendHistory(inv, 'submitted', user);
  await inv.save();

  // Notify the developer-side users (commissions:approve OR commission_invoices:approve).
  try {
    await notifyUsersWithPermission({
      organizationId: inv.developerOrg,
      permission: 'commission_invoices:approve',
      type: 'commission_invoice_submitted',
      title: `New commission invoice ${inv.invoiceNumber}`,
      message: `A channel partner submitted an invoice for ${inv.currency} ${inv.netPayable.toLocaleString('en-IN')} (net payable).`,
      actionUrl: `/leads/${inv.lead}`,
      relatedEntity: { type: 'CommissionInvoice', id: inv._id },
      priority: 'medium',
      actor: user._id,
    });
  } catch (err) {
    console.warn('[commissionInvoice.submit] notify failed (non-fatal):', err.message);
  }

  return inv.toObject();
}

/**
 * CP cancels a draft or submitted invoice.
 */
export async function cancel(invoiceId, user) {
  const inv = await CommissionInvoice.findById(invoiceId);
  if (!inv) throw httpError(404, 'Invoice not found');
  if (String(inv.cpOrg) !== String(user.organization)) {
    throw httpError(404, 'Invoice not found');
  }
  if (!['draft', 'submitted'].includes(inv.status)) {
    throw httpError(409, `Cannot cancel an invoice with status '${inv.status}'`);
  }
  if (inv.prospect) await assertCpAgentAccessToProspect(inv.prospect, user);

  inv.status = 'cancelled';
  appendHistory(inv, 'cancelled', user);
  await inv.save();
  return inv.toObject();
}

/**
 * Developer approves or rejects a submitted invoice.
 *   action: 'approve' | 'reject'
 */
export async function decide(invoiceId, action, decisionNote, user) {
  if (!['approve', 'reject'].includes(action)) {
    throw httpError(400, "action must be 'approve' or 'reject'");
  }
  const inv = await CommissionInvoice.findById(invoiceId);
  if (!inv) throw httpError(404, 'Invoice not found');
  if (String(inv.developerOrg) !== String(user.organization)) {
    throw httpError(404, 'Invoice not found');
  }
  if (inv.status !== 'submitted') {
    throw httpError(409, `Can only decide a submitted invoice (current status: '${inv.status}')`);
  }
  if (action === 'reject' && !String(decisionNote || '').trim()) {
    throw httpError(400, 'A reason is required when rejecting an invoice');
  }

  inv.status = action === 'approve' ? 'approved' : 'rejected';
  inv.decidedAt = new Date();
  inv.decidedBy = user._id;
  inv.decisionNote = String(decisionNote || '').trim();
  appendHistory(inv, action === 'approve' ? 'approved' : 'rejected', user, inv.decisionNote);
  await inv.save();

  // Notify the submitting CP user (and CP Manager/Owner as broadcast).
  try {
    const lead = await Lead.findById(inv.lead).select('channelPartnerAttribution').lean();
    const { agentUserId } = await resolveCpUsers(lead);
    const baseProps = {
      organization: inv.cpOrg,
      type: action === 'approve' ? 'commission_invoice_approved' : 'commission_invoice_rejected',
      title: `Invoice ${inv.invoiceNumber} ${action === 'approve' ? 'approved' : 'rejected'}`,
      message: action === 'approve'
        ? `Your invoice for ${inv.currency} ${inv.netPayable.toLocaleString('en-IN')} was approved.`
        : `Your invoice was rejected: ${inv.decisionNote || 'no reason given'}.`,
      actionUrl: `/partner/prospects/${inv.prospect || ''}`,
      relatedEntity: { type: 'CommissionInvoice', id: inv._id },
      priority: action === 'reject' ? 'high' : 'medium',
      actor: user._id,
    };
    if (agentUserId) {
      await createNotification({ ...baseProps, recipient: agentUserId });
    }
    await notifyUsersWithPermission({
      organizationId: inv.cpOrg,
      permission: 'cp_commission_invoices:manage',
      excludeUserIds: agentUserId ? [agentUserId] : [],
      ...baseProps,
    });
  } catch (err) {
    console.warn('[commissionInvoice.decide] notify failed (non-fatal):', err.message);
  }

  return inv.toObject();
}

/**
 * Developer records payment against an approved invoice.
 */
export async function recordPayment(invoiceId, paymentData, user) {
  const inv = await CommissionInvoice.findById(invoiceId);
  if (!inv) throw httpError(404, 'Invoice not found');
  if (String(inv.developerOrg) !== String(user.organization)) {
    throw httpError(404, 'Invoice not found');
  }
  if (inv.status !== 'approved') {
    throw httpError(409, `Can only record payment on an approved invoice (current status: '${inv.status}')`);
  }
  if (!paymentData?.reference || !String(paymentData.reference).trim()) {
    throw httpError(400, 'A payment reference is required');
  }
  const allowedMethods = ['bank_transfer', 'cheque', 'cash', 'upi', 'other'];
  if (paymentData.method && !allowedMethods.includes(paymentData.method)) {
    throw httpError(400, `method must be one of: ${allowedMethods.join(', ')}`);
  }

  inv.status = 'paid';
  inv.paidAt = paymentData.paidAt ? new Date(paymentData.paidAt) : new Date();
  inv.paidBy = user._id;
  inv.paymentReference = String(paymentData.reference).trim();
  inv.paymentMethod = paymentData.method || 'bank_transfer';
  appendHistory(inv, 'paid', user, `Ref ${inv.paymentReference}`);
  await inv.save();

  // Notify CP.
  try {
    const lead = await Lead.findById(inv.lead).select('channelPartnerAttribution').lean();
    const { agentUserId } = await resolveCpUsers(lead);
    const baseProps = {
      organization: inv.cpOrg,
      type: 'commission_invoice_paid',
      title: `Invoice ${inv.invoiceNumber} paid`,
      message: `Developer recorded payment of ${inv.currency} ${inv.netPayable.toLocaleString('en-IN')} against your invoice. Reference: ${inv.paymentReference}.`,
      actionUrl: `/partner/prospects/${inv.prospect || ''}`,
      relatedEntity: { type: 'CommissionInvoice', id: inv._id },
      priority: 'high',
      actor: user._id,
    };
    if (agentUserId) {
      await createNotification({ ...baseProps, recipient: agentUserId });
    }
    await notifyUsersWithPermission({
      organizationId: inv.cpOrg,
      permission: 'cp_commission_invoices:manage',
      excludeUserIds: agentUserId ? [agentUserId] : [],
      ...baseProps,
    });
  } catch (err) {
    console.warn('[commissionInvoice.recordPayment] notify failed (non-fatal):', err.message);
  }

  return inv.toObject();
}

// ─── Reads ────────────────────────────────────────────────────────────

const POPULATE_DETAIL = [
  { path: 'partnership', select: 'developerOrg channelPartnerOrg status' },
  { path: 'developerOrg', select: 'name type city' },
  { path: 'cpOrg', select: 'name type city' },
  { path: 'prospect', select: 'firstName lastName phone email assignedAgent' },
  { path: 'lead', select: 'firstName lastName phone email status project' },
  { path: 'sale', select: 'salePrice bookingDate' },
  { path: 'createdBy', select: 'firstName lastName' },
  { path: 'submittedBy', select: 'firstName lastName' },
  { path: 'decidedBy', select: 'firstName lastName' },
  { path: 'paidBy', select: 'firstName lastName' },
];

/**
 * List invoices. Scoping decided by caller's org type:
 *   - CP org → invoices where cpOrg === user.organization
 *   - Dev org → invoices where developerOrg === user.organization
 * CP Agents are narrowed to their own prospects' invoices.
 */
export async function list(query, user) {
  const userOrgId = toObjectId(user.organization);
  const org = await Organization.findById(userOrgId).select('type').lean();
  if (!org) throw httpError(404, 'Organization not found');

  const filter = org.type === 'channel_partner'
    ? { cpOrg: userOrgId }
    : { developerOrg: userOrgId };

  if (query?.status) {
    filter.status = Array.isArray(query.status) ? { $in: query.status } : query.status;
  }
  if (query?.leadId && mongoose.isValidObjectId(query.leadId)) {
    filter.lead = toObjectId(query.leadId);
  }
  if (query?.prospectId && mongoose.isValidObjectId(query.prospectId)) {
    filter.prospect = toObjectId(query.prospectId);
  }

  // CP Agent narrowing — restrict to invoices whose prospect.assignedAgent === self.
  if (org.type === 'channel_partner' && isCpAgent(user)) {
    const myProspectIds = await Prospect.find({
      organization: userOrgId,
      assignedAgent: user._id,
    }).select('_id').lean();
    filter.prospect = { $in: myProspectIds.map((p) => p._id) };
  }

  const docs = await CommissionInvoice.find(filter)
    .populate(POPULATE_DETAIL)
    .sort({ createdAt: -1 })
    .limit(Number(query?.limit) || 100)
    .lean();
  return docs;
}

export async function get(invoiceId, user) {
  const inv = await CommissionInvoice.findById(invoiceId).populate(POPULATE_DETAIL).lean();
  if (!inv) throw httpError(404, 'Invoice not found');
  const userOrgId = String(user.organization);
  const isCp = String(inv.cpOrg?._id || inv.cpOrg) === userOrgId;
  const isDev = String(inv.developerOrg?._id || inv.developerOrg) === userOrgId;
  if (!isCp && !isDev) throw httpError(404, 'Invoice not found');
  if (isCp && isCpAgent(user) && inv.prospect) {
    if (String(inv.prospect.assignedAgent) !== String(user._id)) {
      throw httpError(404, 'Invoice not found');
    }
  }
  return inv;
}

export default {
  createDraft, update, submit, cancel, decide, recordPayment, list, get,
};
