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
import Partnership from '../models/partnershipModel.js';
import { reconcileChannelPartnerRecord } from './partnershipService.js';
import { notifyUsersWithPermission } from './notificationService.js';

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
  // SP4 Phase L finding #3 — populate claimedByOrg.name so the CP UI can
  // render the actual on-platform org name on the "Claimed" drawer instead
  // of the generic "Developer Org" fallback.
  const developers = await ExternalDeveloper.find(filter)
    .populate('claimedByOrg', 'name type city')
    .sort({ updatedAt: -1 })
    .lean();
  return developers;
}

export async function getExternalDeveloper(id, user) {
  const doc = await findInScope(id, user);
  await doc.populate({ path: 'claimedByOrg', select: 'name type city' });
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

// ─── Claim (SP4 Phase F) ───────────────────────────────────────────────────

/**
 * Transactional claim flow — called from registerUser when a newly-created
 * builder org has an externalDeveloperInviteToken on its registration body.
 *
 * Atomic across:
 *   1. Mark the ExternalDeveloper claimed (clear invite.token to invalidate).
 *   2. Upsert an active Partnership for (developerOrg, channelPartnerOrg).
 *   3. SP3 reconciliation — ensure the dev-side ChannelPartner shadow record
 *      exists with channelPartnerOrg linked.
 *   4. Bulk-retag every linked Prospect: developerContext.type='platform',
 *      partnership=<new>, externalDeveloper cleared, system activity pushed.
 *
 * The notification fan-out runs OUTSIDE the transaction (best-effort —
 * a notification failure doesn't roll back the claim).
 *
 * @param {string}    token            — 64-hex invite token from the registration body
 * @param {ObjectId}  newDeveloperOrgId — the just-created builder org's _id
 * @param {Object}    actorUser        — the just-created owner User (req.user)
 * @returns {Promise<{externalDeveloper, partnership}>}
 *
 * Errors:
 *  - 404 — token unknown / malformed
 *  - 410 — token already claimed or expired
 *  - any Mongoose validation / network error inside the transaction aborts
 *    the entire operation and rethrows.
 */
export async function claimExternalDeveloper(token, newDeveloperOrgId, actorUser) {
  if (!token || !/^[a-f0-9]{64}$/i.test(token)) {
    throw httpError(404, 'Invitation not found');
  }
  if (!actorUser?._id) {
    throw httpError(400, 'actorUser is required');
  }
  if (!mongoose.isValidObjectId(newDeveloperOrgId)) {
    throw httpError(400, 'Invalid developer organization id');
  }

  let result;
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      // 1. Find + validate the invite (with session).
      const doc = await ExternalDeveloper.findOne(
        { 'invite.token': token },
        null,
        { session }
      );
      if (!doc) throw httpError(404, 'Invitation not found');
      if (doc.claimedByOrg) throw httpError(410, 'This invitation has already been used');
      if (doc.invite?.expiresAt && doc.invite.expiresAt.getTime() < Date.now()) {
        throw httpError(410, 'This invitation has expired');
      }

      const now = new Date();

      // 2. Mark claimed + invalidate the token so it cannot be reused.
      doc.claimedByOrg = newDeveloperOrgId;
      doc.claimedAt = now;
      if (doc.invite) doc.invite.token = null;
      doc.$session(session);
      await doc.save({ session });

      // 3. Upsert Partnership(developerOrg, channelPartnerOrg).
      const histAccepted = {
        status: 'active',
        action: 'accepted',
        actor: actorUser._id,
        actorOrg: newDeveloperOrgId,
        at: now,
        note: 'Off-platform CP invited developer to platform; claimed via registration link',
      };
      let partnership = await Partnership.findOne(
        {
          developerOrg: newDeveloperOrgId,
          channelPartnerOrg: doc.organization,
        },
        null,
        { session }
      );
      if (partnership) {
        // Reopen if previously rejected/terminated; leave alone if already active/pending/suspended.
        if (['rejected', 'terminated'].includes(partnership.status)) {
          partnership.status = 'active';
          partnership.initiatedBy = 'channel_partner';
          partnership.decidedAt = now;
          partnership.decidedBy = actorUser._id;
          partnership.history.push(histAccepted);
          partnership.$session(session);
          await partnership.save({ session });
        }
        // If status is 'active'/'pending'/'suspended' we keep it as-is — the
        // claim just adds the ChannelPartner shadow + retags prospects.
      } else {
        const created = await Partnership.create(
          [
            {
              developerOrg: newDeveloperOrgId,
              channelPartnerOrg: doc.organization,
              status: 'active',
              initiatedBy: 'channel_partner',
              projects: [],
              requestedAt: doc.invite?.invitedAt || now,
              decidedAt: now,
              decidedBy: actorUser._id,
              history: [histAccepted],
            },
          ],
          { session }
        );
        partnership = created[0];
      }

      // 4. SP3 reconciliation — ensure the dev-side ChannelPartner shadow.
      await reconcileChannelPartnerRecord(partnership, actorUser._id, { session });

      // 5. Bulk-retag linked Prospects (single aggregation-pipeline update).
      const systemActivity = {
        type: 'system',
        note: 'Developer joined the platform',
        at: now,
        by: null,
      };
      await Prospect.updateMany(
        {
          organization: doc.organization,
          'developerContext.externalDeveloper': doc._id,
        },
        [
          {
            $set: {
              'developerContext.type': 'platform',
              'developerContext.partnership': partnership._id,
              activities: { $concatArrays: ['$activities', [systemActivity]] },
            },
          },
          { $unset: 'developerContext.externalDeveloper' },
        ],
        { session }
      );

      result = {
        externalDeveloper: doc.toObject(),
        partnership: partnership.toObject(),
      };
    });
  } finally {
    await session.endSession();
  }

  // 6. Notify the inviting CP's Manager/Owner — outside the transaction.
  try {
    await notifyUsersWithPermission({
      organizationId: result.externalDeveloper.organization,
      permission: 'cp_partnerships:manage',
      type: 'external_developer_claimed',
      title: 'Off-platform developer joined the platform',
      message: `${result.externalDeveloper.name} has registered — your partnership is now active and any linked prospects have been re-tagged.`,
      actionUrl: '/partner/partnerships',
      relatedEntity: {
        entityType: 'ExternalDeveloper',
        entityId: result.externalDeveloper._id,
        displayLabel: result.externalDeveloper.name,
      },
      actor: actorUser._id,
    });
  } catch (notifyErr) {
    console.error(
      '[claimExternalDeveloper] notification fan-out failed (non-fatal):',
      notifyErr?.message
    );
  }

  return result;
}
