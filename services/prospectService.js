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
