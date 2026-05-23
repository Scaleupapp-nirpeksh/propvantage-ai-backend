// File: services/externalDeveloperService.js
// Description: SP4 — domain logic for ExternalDeveloper records (off-platform
//   developers a CP tracks locally). Handles CRUD, the invite-to-platform
//   token flow (generate + public lookup), and — added in T24 — the
//   transactional claim when the developer registers via the invite link.
//
//   All functions take `user` (req.user) and resolve org-scoping themselves.
//   Errors carry `.statusCode` for controller-side HTTP translation.

import crypto from 'crypto';
import mongoose from 'mongoose';
import ExternalDeveloper from '../models/externalDeveloperModel.js';
import Prospect from '../models/prospectModel.js';
import Organization from '../models/organizationModel.js';

const INVITE_EXPIRY_DAYS = 90;
const INVITE_EXPIRY_MS = INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000;

// ─── Internal helpers ──────────────────────────────────────────────────────

const httpError = (status, message) => {
  const e = new Error(message);
  e.statusCode = status;
  return e;
};

const scopeFilter = (user) => ({ organization: user.organization });

const findInScope = async (id, user) => {
  if (!mongoose.isValidObjectId(id)) throw httpError(400, 'Invalid external developer id');
  const doc = await ExternalDeveloper.findOne({ _id: id, ...scopeFilter(user) });
  if (!doc) throw httpError(404, 'External developer not found');
  return doc;
};

// Sanitise client input — block server-controlled fields.
const SERVER_CONTROLLED = new Set([
  'organization', 'invite', 'claimedByOrg', 'claimedAt', 'createdAt', 'updatedAt', '_id', '__v',
]);
function sanitizeForWrite(data) {
  const out = {};
  for (const [k, v] of Object.entries(data || {})) {
    if (!SERVER_CONTROLLED.has(k)) out[k] = v;
  }
  return out;
}

// ─── Public service surface ────────────────────────────────────────────────

export async function listExternalDevelopers(query, user) {
  const filter = { ...scopeFilter(user) };
  if (query?.search) {
    const escaped = String(query.search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(escaped, 'i');
    filter.$or = [{ name: re }, { 'contact.person': re }, { city: re }];
  }
  const developers = await ExternalDeveloper.find(filter)
    .sort({ updatedAt: -1 })
    .lean();
  return developers;
}

export async function getExternalDeveloper(id, user) {
  const doc = await findInScope(id, user);
  return doc.toObject();
}

export async function createExternalDeveloper(data, user) {
  const safe = sanitizeForWrite(data);
  if (!safe.name || !String(safe.name).trim()) {
    throw httpError(400, 'name is required');
  }
  safe.organization = user.organization;
  try {
    const doc = await ExternalDeveloper.create(safe);
    return doc.toObject();
  } catch (err) {
    if (err?.name === 'ValidationError') throw httpError(400, err.message);
    throw err;
  }
}

export async function updateExternalDeveloper(id, data, user) {
  const doc = await findInScope(id, user);
  if (doc.claimedByOrg) {
    throw httpError(409, 'Cannot edit an external developer that has been claimed');
  }
  const safe = sanitizeForWrite(data);
  Object.assign(doc, safe);
  try {
    await doc.save();
    return doc.toObject();
  } catch (err) {
    if (err?.name === 'ValidationError') throw httpError(400, err.message);
    throw err;
  }
}

export async function deleteExternalDeveloper(id, user) {
  const doc = await findInScope(id, user);
  if (doc.claimedByOrg) {
    throw httpError(409, 'Cannot delete an external developer that has been claimed');
  }
  const linkedCount = await Prospect.countDocuments({
    organization: user.organization,
    'developerContext.externalDeveloper': doc._id,
  });
  if (linkedCount > 0) {
    throw httpError(
      409,
      `Cannot delete: ${linkedCount} prospect(s) reference this external developer`
    );
  }
  await doc.deleteOne();
  return { deleted: true, id };
}

// Generate (or regenerate) the platform-invite token. Returns the URL the
// developer will use to register.
export async function inviteExternalDeveloper(id, email, user) {
  if (!email || typeof email !== 'string') {
    throw httpError(400, 'email is required');
  }
  const normEmail = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normEmail)) {
    throw httpError(400, 'email is not a valid address');
  }
  const doc = await findInScope(id, user);
  if (doc.claimedByOrg) {
    throw httpError(409, 'This external developer has already joined the platform');
  }

  const token = crypto.randomBytes(32).toString('hex');
  const now = new Date();
  doc.invite = {
    token,
    email: normEmail,
    invitedAt: now,
    invitedBy: user._id,
    expiresAt: new Date(now.getTime() + INVITE_EXPIRY_MS),
  };
  await doc.save();

  const baseUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
  const inviteUrl = `${baseUrl}/register?inviteToken=${token}`;
  return {
    externalDeveloperId: doc._id,
    token,
    email: normEmail,
    inviteUrl,
    expiresAt: doc.invite.expiresAt,
  };
}

// Public — used by the registration page pre-fill (T22 mounts at
// /api/external-developer-invites/:token, no auth).
// Returns 200 with the developer info when the token is valid; throws 410
// when claimed/expired; throws 404 for a token we don't recognise.
export async function getInviteByToken(token) {
  if (!token || typeof token !== 'string' || !/^[a-f0-9]{64}$/i.test(token)) {
    throw httpError(404, 'Invitation not found');
  }
  const doc = await ExternalDeveloper.findOne({ 'invite.token': token });
  if (!doc) throw httpError(404, 'Invitation not found');

  if (doc.claimedByOrg) {
    const err = httpError(410, 'This invitation has already been used');
    err.reason = 'claimed';
    throw err;
  }
  if (doc.invite?.expiresAt && doc.invite.expiresAt.getTime() < Date.now()) {
    const err = httpError(410, 'This invitation has expired');
    err.reason = 'expired';
    throw err;
  }

  const invitingOrg = await Organization.findById(doc.organization)
    .select('name')
    .lean();

  return {
    valid: true,
    name: doc.name,
    contact: doc.contact || {},
    city: doc.city,
    projects: doc.projects || [],
    invitedByOrgName: invitingOrg?.name || 'A channel partner',
  };
}
