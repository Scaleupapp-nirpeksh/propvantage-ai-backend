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
const POPULATE_LIST = [
  { path: 'assignedAgent', select: 'firstName lastName email' },
  { path: 'developerContext.partnership', select: 'developerOrg channelPartnerOrg status' },
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
    await p.populate(POPULATE_DETAIL);
    return p.toObject();
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
    await p.populate(POPULATE_DETAIL);
    return p.toObject();
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
  return p.toObject();
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
  recomputeCommission(p);

  p.activities.push({
    type: 'system',
    note:
      'Booking recorded' +
      (p.booking.unitInfo ? ` (${p.booking.unitInfo})` : '') +
      (p.booking.salePrice != null ? ` — sale price ${p.booking.currency} ${p.booking.salePrice}` : ''),
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
