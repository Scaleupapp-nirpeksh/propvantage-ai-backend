// File: services/prospectService.js
// Description: SP4 — domain logic for the CP-side Prospect entity. Owns
//   create/read/update/delete and activity logging. Push-to-developer,
//   status-proposal, booking, and commission slices land in later phases
//   (Phase G, H, D respectively).
//
//   All functions take `user` (req.user with populated roleRef) and resolve
//   org-scoping + agent-scoping (CP Agent narrowing) themselves. Errors
//   carry a `.statusCode` property that controllers translate to HTTP.

import mongoose from 'mongoose';
import Prospect from '../models/prospectModel.js';
import User from '../models/userModel.js';
import Lead from '../models/leadModel.js';
import Partnership from '../models/partnershipModel.js';
import ChannelPartner from '../models/channelPartnerModel.js';
import { reconcileChannelPartnerRecord } from './partnershipService.js';
import { createNotification, notifyUsersWithPermission } from './notificationService.js';
import { addLeadScoreUpdateJob } from './backgroundJobService.js';
import { updateProspectScore } from './prospectScoringService.js';

// ─── Internal helpers ──────────────────────────────────────────────────────

// Build a status-aware Error. Controllers set res.status from .statusCode.
const httpError = (status, message) => {
  const e = new Error(message);
  e.statusCode = status;
  return e;
};

// Same identity check used by partnerAccessScope. CP Agent is the only CP
// role that gets narrowed to their own assignedAgent prospects.
const isCpAgent = (user) =>
  user?.roleRef?.name === 'CP Agent' || user?.roleRef?.slug === 'cp-agent';

// Base org + (CP Agent narrowing) filter.
const scopeFilter = (user) => {
  const f = { organization: user.organization };
  if (isCpAgent(user)) f.assignedAgent = user._id;
  return f;
};

// Scoped lookup — 400 on bad id, 404 if not visible.
const findInScope = async (id, user) => {
  if (!mongoose.isValidObjectId(id)) throw httpError(400, 'Invalid prospect id');
  const p = await Prospect.findOne({ _id: id, ...scopeFilter(user) });
  if (!p) throw httpError(404, 'Prospect not found');
  return p;
};

// Fields the client must not write directly. `pushedTo*` is set only by
// pushProspectToDeveloper (Phase G); `commission` is updated via dedicated
// endpoints (Phase D); `activities` only via addActivity. The rest are
// server-managed metadata.
const SERVER_CONTROLLED = new Set([
  'organization', 'pushedToLead', 'pushedAt', 'pushedBy',
  'commission', 'createdAt', 'updatedAt', '_id', '__v',
]);
function sanitizeForWrite(data) {
  const out = {};
  for (const [k, v] of Object.entries(data || {})) {
    if (!SERVER_CONTROLLED.has(k)) out[k] = v;
  }
  delete out.activities; // mutate only via addActivity
  return out;
}

// Common populate shape used by getProspect / listProspects.
// SP4 Phase L finding #3 — nested-populate developerOrg.name so the CP UI
// can render "PropVantage Demo Realty" instead of the bare ObjectId or
// the "Platform Developer" fallback string.
const POPULATE_LIST = [
  { path: 'assignedAgent', select: 'firstName lastName email' },
  {
    path: 'developerContext.partnership',
    select: 'developerOrg channelPartnerOrg status',
    populate: { path: 'developerOrg', select: 'name type city' },
  },
  { path: 'developerContext.externalDeveloper', select: 'name city' },
  { path: 'project.platform', select: 'name location type' },
];
const POPULATE_DETAIL = [
  ...POPULATE_LIST,
  { path: 'developerContext.externalDeveloper', select: 'name city contact' },
  { path: 'pushedToLead', select: 'status updatedAt' },
  { path: 'pushedBy', select: 'firstName lastName email' },
];

// ─── Public service surface ────────────────────────────────────────────────

export async function listProspects(query, user) {
  const filter = { ...scopeFilter(user) };

  // Status — single or comma-separated for multi-select UI.
  if (query.status) {
    const statuses = Array.isArray(query.status)
      ? query.status
      : String(query.status).split(',').map((s) => s.trim()).filter(Boolean);
    if (statuses.length === 1) filter.status = statuses[0];
    else if (statuses.length > 1) filter.status = { $in: statuses };
  }

  // assignedAgent — only honoured for non-Agent callers (Agent is auto-scoped).
  if (query.assignedAgent && !isCpAgent(user)) {
    if (!mongoose.isValidObjectId(query.assignedAgent)) {
      throw httpError(400, 'Invalid assignedAgent id');
    }
    filter.assignedAgent = query.assignedAgent;
  }

  // developerContextType — 'external' | 'platform'
  if (query.developerContextType) {
    filter['developerContext.type'] = query.developerContextType;
  }

  if (query.priority) filter.priority = query.priority;

  if (query.search) {
    const escaped = String(query.search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(escaped, 'i');
    filter.$or = [
      { firstName: re }, { lastName: re }, { email: re }, { phone: re },
    ];
  }

  const prospects = await Prospect.find(filter)
    .populate(POPULATE_LIST)
    .sort({ updatedAt: -1 })
    .lean();
  return prospects;
}

export async function getProspect(id, user) {
  const p = await findInScope(id, user);
  await p.populate(POPULATE_DETAIL);
  return p.toObject();
}

export async function createProspect(data, user) {
  // assignedAgent must be a User in the same org.
  const agentId = data?.assignedAgent;
  if (!agentId || !mongoose.isValidObjectId(agentId)) {
    throw httpError(400, 'assignedAgent is required and must be a valid user id');
  }
  // CP Agent: can only create prospects assigned to self.
  if (isCpAgent(user) && String(agentId) !== String(user._id)) {
    throw httpError(403, 'CP Agents can only create prospects assigned to themselves');
  }
  const agentUser = await User.findOne({
    _id: agentId,
    organization: user.organization,
  }).select('_id').lean();
  if (!agentUser) {
    throw httpError(400, 'assignedAgent must be a user in your organization');
  }

  const safe = sanitizeForWrite(data);
  safe.organization = user.organization;
  safe.assignedAgent = agentId;

  // SP4 — service-level check (the model's pre-save no longer enforces
  // project.platform for platform-context prospects, so the SP4 claim
  // retag flow can bulk-update without violating it).
  if (safe.developerContext?.type === 'platform' && !safe.project?.platform) {
    throw httpError(400, 'project.platform is required when creating a platform-context prospect');
  }

  // Optional initial creation note — kept simple; the UI usually just creates
  // a bare prospect and adds activities afterwards.
  const initialActivities = [];
  if (data?.creationNote) {
    initialActivities.push({
      type: 'note',
      note: String(data.creationNote).trim(),
      at: new Date(),
      by: user._id,
    });
  }
  safe.activities = initialActivities;

  try {
    const p = await Prospect.create(safe);
    // SP4+ — compute initial score so the CP sees a meaningful number
    // immediately. Inline (not queued) so the returned doc carries it.
    await updateProspectScore(p._id);
    await p.populate(POPULATE_DETAIL);
    // Re-read to pick up the score the update just wrote.
    const fresh = await Prospect.findById(p._id).populate(POPULATE_DETAIL).lean();
    return fresh || p.toObject();
  } catch (err) {
    if (err?.name === 'ValidationError') throw httpError(400, err.message);
    throw err;
  }
}

export async function updateProspect(id, data, user) {
  const p = await findInScope(id, user);
  const safe = sanitizeForWrite(data);

  // assignedAgent: CP Agent cannot reassign; Manager/Owner must point to a
  // user in the same org.
  if ('assignedAgent' in safe) {
    if (isCpAgent(user) && String(safe.assignedAgent) !== String(user._id)) {
      throw httpError(403, 'CP Agents cannot reassign prospects');
    }
    if (!isCpAgent(user)) {
      if (!mongoose.isValidObjectId(safe.assignedAgent)) {
        throw httpError(400, 'Invalid assignedAgent id');
      }
      const newAgent = await User.findOne({
        _id: safe.assignedAgent,
        organization: user.organization,
      }).select('_id').lean();
      if (!newAgent) {
        throw httpError(400, 'assignedAgent must be a user in your organization');
      }
    }
  }

  // SP4 — same service-level check on updates that flip context to 'platform'
  // without providing a Project mapping (retag flow is a separate path).
  const nextCtxType = safe?.developerContext?.type ?? p.developerContext?.type;
  const nextPlatformProject = safe?.project?.platform ?? p.project?.platform;
  if (nextCtxType === 'platform' && !nextPlatformProject) {
    throw httpError(400, 'project.platform is required when developerContext.type is "platform"');
  }

  // Record a status_change activity if status moved.
  if ('status' in safe && safe.status && safe.status !== p.status) {
    p.activities.push({
      type: 'status_change',
      note: `Status: ${p.status} → ${safe.status}`,
      at: new Date(),
      by: user._id,
    });
  }

  Object.assign(p, safe);
  try {
    await p.save();
    // SP4+ — any field that scoring reads (budget, requirements.timeline,
    // activities) might have changed; rescore. Inline so the returned doc
    // reflects the new score.
    await updateProspectScore(p._id);
    const fresh = await Prospect.findById(p._id).populate(POPULATE_DETAIL).lean();
    return fresh || p.toObject();
  } catch (err) {
    if (err?.name === 'ValidationError') throw httpError(400, err.message);
    throw err;
  }
}

export async function deleteProspect(id, user) {
  const p = await findInScope(id, user);
  if (p.pushedToLead) {
    throw httpError(409, 'Cannot delete a prospect that has been pushed to a developer');
  }
  await p.deleteOne();
  return { deleted: true, id };
}

export async function addActivity(id, activityData, user) {
  const p = await findInScope(id, user);
  if (!activityData?.type) throw httpError(400, 'activity.type is required');
  // Only user-driven activity types can be created via this endpoint.
  // 'status_change' is recorded automatically by updateProspect; 'system'
  // is reserved for backend-fired entries (e.g. claim re-tagging).
  const ALLOWED = ['call', 'site_visit', 'note', 'follow_up_scheduled'];
  if (!ALLOWED.includes(activityData.type)) {
    throw httpError(400, `activity.type must be one of: ${ALLOWED.join(', ')}`);
  }
  p.activities.push({
    type: activityData.type,
    note: String(activityData.note || '').trim(),
    at: new Date(),
    by: user._id,
  });
  // If a follow-up is being scheduled, mirror it to Prospect.followUp.
  if (activityData.type === 'follow_up_scheduled' && activityData.followUpDate) {
    p.followUp = {
      nextDate: activityData.followUpDate,
      type: activityData.followUpType || 'call',
      note: String(activityData.note || '').trim(),
    };
  }
  await p.save();
  // SP4+ — engagement signal just changed; rescore.
  await updateProspectScore(p._id);
  const fresh = await Prospect.findById(p._id).lean();
  return fresh || p.toObject();
}

// ─── Commission tracking (SP4 Phase D) ─────────────────────────────────────

// Private — recompute commission.expectedAmount + commission.status from
// the current agreement + booking + payments. Never overwrites 'written_off'
// (which is set only via an explicit updateCommission call).
function recomputeCommission(p) {
  if (p.commission?.status === 'written_off') return;

  const agreement = p.commissionAgreement;
  let expected = null;
  if (agreement?.type === 'percentage') {
    const sale = p.booking?.salePrice;
    if (typeof sale === 'number' && sale >= 0 && typeof agreement.value === 'number') {
      expected = sale * (agreement.value / 100);
    }
  } else if (agreement?.type === 'flat') {
    if (typeof agreement.value === 'number') expected = agreement.value;
  }
  p.commission.expectedAmount = expected;

  const totalPaid = (p.commission.payments || []).reduce(
    (s, x) => s + (Number(x.amount) || 0),
    0
  );
  if (totalPaid <= 0) p.commission.status = 'pending';
  else if (expected != null && totalPaid >= expected) p.commission.status = 'paid';
  else p.commission.status = 'partially_paid';
}

// POST /api/cp/prospects/:id/booking — set booking; recompute commission.
export async function recordBooking(id, bookingData, user) {
  const p = await findInScope(id, user);
  if (!bookingData || typeof bookingData !== 'object') {
    throw httpError(400, 'booking payload is required');
  }
  const salePrice = bookingData.salePrice;
  if (
    salePrice !== undefined &&
    salePrice !== null &&
    (!Number.isFinite(Number(salePrice)) || Number(salePrice) < 0)
  ) {
    throw httpError(400, 'booking.salePrice must be a non-negative number');
  }
  p.booking = {
    bookedAt: bookingData.bookedAt ? new Date(bookingData.bookedAt) : new Date(),
    unitInfo: String(bookingData.unitInfo || '').trim(),
    salePrice: salePrice !== undefined && salePrice !== null ? Number(salePrice) : null,
    currency: bookingData.currency || 'INR',
    notes: String(bookingData.notes || '').trim(),
  };
  // SP4 — recording a booking implicitly closes the prospect as 'Booked'.
  // CPs do not want to record a sale and then have to remember to also
  // flip the status by hand. The QA E2E run surfaced this as Bug B.
  const oldStatus = p.status;
  const statusFlipped = oldStatus !== 'Booked';
  p.status = 'Booked';
  recomputeCommission(p);

  // SP4 Phase L finding #4 — also emit a 'status_change' activity when the
  // booking flips the status so the Status Timeline (which filters to
  // 'status_change') reflects the Booked transition. Without this, the
  // timeline silently omitted the most important status transition.
  if (statusFlipped) {
    p.activities.push({
      type: 'status_change',
      note: `${oldStatus} → Booked (via booking)`,
      at: new Date(),
      by: user._id,
    });
  }

  p.activities.push({
    type: 'system',
    note:
      'Booking recorded' +
      (p.booking.unitInfo ? ` (${p.booking.unitInfo})` : '') +
      (p.booking.salePrice != null ? ` — sale price ${p.booking.currency} ${p.booking.salePrice}` : '') +
      (statusFlipped ? ' (status set to Booked)' : ''),
    at: new Date(),
    by: user._id,
  });

  await p.save();
  await p.populate(POPULATE_DETAIL);
  return p.toObject();
}

// POST /api/cp/prospects/:id/commission/payments — append a payment receipt;
// recompute commission status.
export async function addCommissionPayment(id, paymentData, user) {
  const p = await findInScope(id, user);
  const amount = Number(paymentData?.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw httpError(400, 'amount must be a positive number');
  }
  if (!paymentData?.receivedAt) {
    throw httpError(400, 'receivedAt is required');
  }
  const ALLOWED_METHODS = ['bank_transfer', 'cheque', 'cash', 'upi', 'other'];
  if (paymentData.method && !ALLOWED_METHODS.includes(paymentData.method)) {
    throw httpError(400, `method must be one of: ${ALLOWED_METHODS.join(', ')}`);
  }
  p.commission.payments.push({
    amount,
    receivedAt: new Date(paymentData.receivedAt),
    method: paymentData.method,
    referenceNumber: String(paymentData.referenceNumber || '').trim(),
    notes: String(paymentData.notes || '').trim(),
    recordedBy: user._id,
    recordedAt: new Date(),
  });
  recomputeCommission(p);

  p.activities.push({
    type: 'system',
    note: `Commission payment recorded — ${p.commission.payments[p.commission.payments.length - 1].amount}`,
    at: new Date(),
    by: user._id,
  });

  await p.save();
  await p.populate(POPULATE_DETAIL);
  return p.toObject();
}

// ─── Push to developer (SP4 Phase G) ───────────────────────────────────────

// POST /api/cp/prospects/:id/push — create a Lead in the developer's org
// (status='pending') so it appears in their /api/leads/registrations queue
// for accept/reject review. Sets the prospect's pushedToLead pointer + a
// system activity. Notifies developer-side users with leads:update.
export async function pushProspectToDeveloper(id, user) {
  const p = await findInScope(id, user);

  if (p.developerContext?.type !== 'platform') {
    throw httpError(
      409,
      'Only platform-context prospects can be pushed to a developer'
    );
  }
  if (p.pushedToLead) {
    throw httpError(409, 'This prospect has already been pushed to the developer');
  }
  if (!p.developerContext?.partnership) {
    throw httpError(409, 'Prospect has no partnership reference');
  }
  if (!p.project?.platform) {
    throw httpError(
      400,
      'project.platform must be set before pushing this prospect (retagged off-platform prospects may need to be mapped to a real Project first)'
    );
  }

  const partnership = await Partnership.findById(p.developerContext.partnership)
    .select('developerOrg channelPartnerOrg status')
    .lean();
  if (!partnership) throw httpError(409, 'Partnership not found');
  if (partnership.status !== 'active') {
    throw httpError(409, 'Partnership is not active');
  }
  if (String(partnership.channelPartnerOrg) !== String(user.organization)) {
    throw httpError(403, 'Partnership does not belong to your organization');
  }

  // Find (or reconcile, defensively) the dev-side ChannelPartner shadow.
  let cpRecord = await ChannelPartner.findOne({
    organization: partnership.developerOrg,
    channelPartnerOrg: partnership.channelPartnerOrg,
  })
    .select('_id')
    .lean();
  if (!cpRecord) {
    // Defensive — SP3 reconciliation should have created this on activation.
    const created = await reconcileChannelPartnerRecord(
      { ...partnership, projects: [] },
      user._id
    );
    cpRecord = { _id: created._id };
  }

  const now = new Date();

  // Map prospect shape → lead shape. After SP4+ requirements-parity work:
  //  • Prospect.requirements is now the SAME structured shape as
  //    Lead.requirements ({ timeline, unitType, floor, facing, amenities,
  //    specialRequirements }) — copied field-for-field below.
  //  • Prospect.notes is still free text → copies into Lead.notes.
  //  • Prospect.budget = {min, max, currency}; Lead.budget has those + extra
  //    fields (isValidated, budgetSource). Direct copy works (extras default).
  //  • Priority enums overlap on Low/Medium/High — direct copy works when set.
  const composedNotes = String(p.notes || '').trim();
  const reqs = p.requirements || {};
  const mappedRequirements = {
    timeline: reqs.timeline || undefined,
    unitType: reqs.unitType || undefined,
    floor: {
      preference: reqs.floor?.preference || 'any',
      specific: reqs.floor?.specific ?? null,
    },
    facing: reqs.facing || 'Any',
    amenities: Array.isArray(reqs.amenities) ? reqs.amenities : [],
    specialRequirements: reqs.specialRequirements || '',
  };

  // Create the Lead — minimal seed; the developer fills in details on accept.
  const lead = await Lead.create({
    organization: partnership.developerOrg,
    project: p.project.platform,
    firstName: p.firstName,
    lastName: p.lastName,
    email: p.email,
    phone: p.phone,
    // SP4 — Lead.source enum doesn't include 'Channel Partner'; we use
    // 'Referral' as the closest non-breaking value. The CP attribution is
    // captured separately in channelPartnerAttribution.* below, which is
    // the authoritative source-of-truth for "this lead came from a CP."
    // (Surfaced by E2E QA run as Bug A.)
    source: 'Referral',
    status: 'pending',
    // SP4 push-bug fix: priority defaults to 'Medium' on Prospect; both
    // enums share Low/Medium/High so this is safe.
    priority: p.priority || 'Medium',
    // SP4 push-bug fix: only forward fields that share a compatible shape.
    budget: p.budget,
    // SP4+ — requirements now share a shape; field-for-field copy.
    requirements: mappedRequirements,
    notes: composedNotes,
    // SP4+ — research sources captured on the CP form (LinkedIn / company
    // website) seed the dev-side enrichment pipeline. Lead.enrichment.sources
    // is the same shape as Prospect.enrichment.sources; direct copy.
    enrichment: p.enrichment?.sources
      ? {
          sources: {
            linkedinUrl: p.enrichment.sources.linkedinUrl || '',
            companyWebsite: p.enrichment.sources.companyWebsite || '',
          },
        }
      : undefined,
    sourceProspect: p._id,
    channelPartnerAttribution: {
      viaChannelPartner: true,
      partners: [
        {
          channelPartner: cpRecord._id,
          agentUser: p.assignedAgent,
          sharePct: 100,
        },
      ],
      status: 'pending',
      taggedBy: user._id,
      taggedAt: now,
    },
  });

  // Score the freshly created Lead so the dev sees a meaningful number
  // on the registrations queue (not 0/100). Profile-only signals at this
  // stage; engagement signals will refine it after acceptance + activity.
  // Best-effort; non-fatal.
  try { addLeadScoreUpdateJob(lead._id, { delay: 1500 }); } catch { /* fallback no-op */ }

  // Update the prospect.
  p.pushedToLead = lead._id;
  p.pushedAt = now;
  p.pushedBy = user._id;
  p.activities.push({
    type: 'system',
    note: 'Pushed to developer for review',
    at: now,
    by: user._id,
  });
  await p.save();

  // Notify developer-side reviewers.
  try {
    await notifyUsersWithPermission({
      organizationId: partnership.developerOrg,
      permission: 'leads:update',
      type: 'lead_registration_received',
      title: 'New partnership lead',
      message: `${p.firstName} ${p.lastName || ''} — submitted by a partnered channel partner.`.trim(),
      actionUrl: '/leads/registrations',
      relatedEntity: {
        entityType: 'Lead',
        entityId: lead._id,
        displayLabel: `${p.firstName} ${p.lastName || ''}`.trim(),
      },
      actor: user._id,
    });
  } catch (notifyErr) {
    console.error(
      '[pushProspectToDeveloper] notification failed (non-fatal):',
      notifyErr?.message
    );
  }

  await p.populate(POPULATE_DETAIL);
  return {
    prospect: p.toObject(),
    leadId: lead._id,
  };
}

// ─── Status proposal flow (SP4 Phase H) ────────────────────────────────────

// Valid proposed-statuses are the Lead.status enum minus 'pending'.
const VALID_PROPOSED_STATUSES = [
  'New', 'Contacted', 'Qualified', 'Site Visit Scheduled',
  'Site Visit Completed', 'Negotiating', 'Booked', 'Lost', 'Unqualified',
];

// POST /api/cp/prospects/:id/propose-status — CP proposes a Lead.status
// change on a pushed Lead. Sets Lead.proposedStatusChange (until developer
// accepts/rejects via PATCH /api/leads/:id/proposal). 409 when no Lead is
// pushed, or when a proposal is already pending, or when the proposed
// status matches the Lead's current status.
export async function proposeStatusChange(prospectId, statusValue, note, user) {
  const p = await findInScope(prospectId, user);
  if (!p.pushedToLead) {
    throw httpError(409, 'This prospect has not been pushed to a developer yet');
  }
  if (!VALID_PROPOSED_STATUSES.includes(statusValue)) {
    throw httpError(400, `status must be one of: ${VALID_PROPOSED_STATUSES.join(', ')}`);
  }
  const lead = await Lead.findById(p.pushedToLead);
  if (!lead) throw httpError(409, 'The pushed lead no longer exists');
  if (lead.status === statusValue) {
    throw httpError(409, 'The lead is already at that status');
  }
  if (lead.proposedStatusChange && lead.proposedStatusChange.status) {
    throw httpError(409, 'A status proposal is already pending — withdraw it before proposing another');
  }

  const now = new Date();
  lead.proposedStatusChange = {
    status: statusValue,
    proposedBy: user._id,
    proposedAt: now,
    note: String(note || '').trim(),
  };
  await lead.save();

  p.activities.push({
    type: 'status_change',
    note: `Proposed status: ${statusValue}${note ? ` — ${String(note).trim()}` : ''}`,
    at: now,
    by: user._id,
  });
  await p.save();

  // Notify the lead's assignedTo (single) + dev Manager/Owner (broadcast).
  try {
    const message = `${p.firstName} ${p.lastName || ''} — proposed status: ${statusValue}`.trim();
    const payload = {
      organizationId: lead.organization,
      permission: 'leads:update',
      excludeUserIds: lead.assignedTo ? [lead.assignedTo] : [],
      type: 'lead_status_proposed',
      title: 'Channel partner proposed a status change',
      message,
      actionUrl: `/leads/${lead._id}`,
      relatedEntity: { entityType: 'Lead', entityId: lead._id, displayLabel: lead.firstName },
      actor: user._id,
    };
    if (lead.assignedTo) {
      await createNotification({
        organization: lead.organization,
        recipient: lead.assignedTo,
        type: 'lead_status_proposed',
        title: payload.title,
        message,
        actionUrl: payload.actionUrl,
        relatedEntity: payload.relatedEntity,
        actor: user._id,
      });
    }
    await notifyUsersWithPermission(payload);
  } catch (notifyErr) {
    console.error('[proposeStatusChange] notification failed:', notifyErr?.message);
  }

  return { prospect: p.toObject(), lead: lead.toObject() };
}

// DELETE /api/cp/prospects/:id/proposed-status — CP withdraws their pending
// proposal. Allowed for the original proposer OR any CP Manager/Owner of
// the same CP org. Silent — no notification (the developer hasn't acted yet).
export async function withdrawProposedStatusChange(prospectId, user) {
  const p = await findInScope(prospectId, user);
  if (!p.pushedToLead) {
    throw httpError(409, 'This prospect has not been pushed to a developer yet');
  }
  const lead = await Lead.findById(p.pushedToLead);
  if (!lead) throw httpError(409, 'The pushed lead no longer exists');
  if (!lead.proposedStatusChange || !lead.proposedStatusChange.status) {
    throw httpError(409, 'No status proposal is currently pending');
  }

  // Authorisation: original proposer OR any CP Manager/Owner of the same CP org.
  const isProposer = String(lead.proposedStatusChange.proposedBy) === String(user._id);
  if (!isProposer && isCpAgent(user)) {
    throw httpError(403, 'Only the proposer or a CP Manager/Owner may withdraw this proposal');
  }

  lead.proposedStatusChange = null;
  await lead.save();

  p.activities.push({
    type: 'system',
    note: 'Status proposal withdrawn',
    at: new Date(),
    by: user._id,
  });
  await p.save();

  return { prospect: p.toObject(), lead: lead.toObject() };
}

// PUT /api/cp/prospects/:id/commission — update agreement or trigger write-off.
// Write-off requires CP Manager/Owner role + writeOffReason. All other status
// transitions are server-derived; pending/partially_paid/paid cannot be set
// explicitly.
export async function updateCommission(id, data, user) {
  const p = await findInScope(id, user);
  if (!data || typeof data !== 'object') {
    throw httpError(400, 'commission update payload is required');
  }

  // 1. Agreement update (set or clear).
  if (data.commissionAgreement !== undefined) {
    if (data.commissionAgreement === null) {
      p.commissionAgreement = null;
    } else {
      const a = data.commissionAgreement;
      if (!['percentage', 'flat'].includes(a.type)) {
        throw httpError(400, 'commissionAgreement.type must be "percentage" or "flat"');
      }
      const value = Number(a.value);
      if (!Number.isFinite(value) || value < 0) {
        throw httpError(400, 'commissionAgreement.value must be a non-negative number');
      }
      if (a.type === 'percentage' && value > 100) {
        throw httpError(400, 'percentage commission cannot exceed 100');
      }
      p.commissionAgreement = {
        type: a.type,
        value,
        currency: a.currency || 'INR',
        notes: String(a.notes || '').trim(),
      };
    }
  }

  // 2. Explicit status change — only 'written_off' is honoured.
  let didWriteOff = false;
  if (data.status !== undefined) {
    if (data.status !== 'written_off') {
      throw httpError(
        400,
        'Only "written_off" can be set explicitly; pending/partially_paid/paid are server-derived'
      );
    }
    if (isCpAgent(user)) {
      throw httpError(403, 'Only CP Manager or Owner can write off a commission');
    }
    const reason = String(data.writeOffReason || '').trim();
    if (!reason) {
      throw httpError(400, 'writeOffReason is required when writing off a commission');
    }
    p.commission.status = 'written_off';
    p.commission.writeOffReason = reason;
    p.activities.push({
      type: 'system',
      note: `Commission written off: ${reason}`,
      at: new Date(),
      by: user._id,
    });
    didWriteOff = true;
  }

  // 3. Recompute when not writing off (recompute also no-ops on written_off
  //    as a safety net).
  if (!didWriteOff) recomputeCommission(p);

  await p.save();
  await p.populate(POPULATE_DETAIL);
  return p.toObject();
}
