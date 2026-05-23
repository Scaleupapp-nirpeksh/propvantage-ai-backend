// File: services/partnershipService.js
// Description: Domain logic for the marketplace partnership lifecycle (SP3) — the
//   transition state machine, the ChannelPartner-record reconciliation that keeps
//   the existing developer-side engines (attribution / commission / analytics)
//   working, and partnership notification fan-out. HTTP concerns stay in the
//   controller; this module is pure domain logic.

import Organization from '../models/organizationModel.js';
import ChannelPartner from '../models/channelPartnerModel.js';
import Notification from '../models/notificationModel.js';
import User from '../models/userModel.js';
import Role from '../models/roleModel.js';
import { CP_PERMISSIONS, PERMISSIONS } from '../config/permissions.js';

// ─── Transition state machine ────────────────────────────────────────────────
// side:               which org type may invoke the transition ('any' = either).
// from:               statuses the partnership may be in for the transition.
// to:                 the resulting status.
// action:             the history-log action verb.
// requiresInitiatedBy: the transition is only valid when the partnership was
//                      initiated by that side (approve/reject vs accept/decline).
export const PARTNERSHIP_TRANSITIONS = {
  approve:   { side: 'developer',       from: ['pending'],             to: 'active',     action: 'approved',   requiresInitiatedBy: 'channel_partner' },
  reject:    { side: 'developer',       from: ['pending'],             to: 'rejected',   action: 'rejected',   requiresInitiatedBy: 'channel_partner' },
  accept:    { side: 'channel_partner', from: ['pending'],             to: 'active',     action: 'accepted',   requiresInitiatedBy: 'developer' },
  decline:   { side: 'channel_partner', from: ['pending'],             to: 'rejected',   action: 'declined',   requiresInitiatedBy: 'developer' },
  suspend:   { side: 'developer',       from: ['active'],              to: 'suspended',  action: 'suspended' },
  resume:    { side: 'developer',       from: ['suspended'],           to: 'active',     action: 'resumed' },
  terminate: { side: 'any',             from: ['active', 'suspended'], to: 'terminated', action: 'terminated' },
};

/**
 * Validate a requested transition. Pure — does not mutate.
 * @returns {{ ok: true, transition: object } | { ok: false, status: number, message: string }}
 */
export const validateTransition = (partnership, action, callerSide) => {
  const t = PARTNERSHIP_TRANSITIONS[action];
  if (!t) {
    return { ok: false, status: 400, message: `Unknown partnership action: ${action}` };
  }
  if (t.side !== 'any' && t.side !== callerSide) {
    return { ok: false, status: 403, message: `Your organization cannot ${action} this partnership` };
  }
  if (!t.from.includes(partnership.status)) {
    return { ok: false, status: 409, message: `Cannot ${action} a partnership that is ${partnership.status}` };
  }
  if (t.requiresInitiatedBy && partnership.initiatedBy !== t.requiresInitiatedBy) {
    return { ok: false, status: 409, message: `This partnership cannot be ${t.action} — it was not initiated that way` };
  }
  return { ok: true, transition: t };
};

/**
 * Apply a validated transition to a partnership document (mutates in place;
 * the caller persists). Sets status, the decision audit, and a history entry.
 */
export const applyTransition = (partnership, transition, { actorUserId, actorOrgId, note = '' }) => {
  partnership.status = transition.to;
  if (['approved', 'rejected', 'accepted', 'declined'].includes(transition.action)) {
    partnership.decidedAt = new Date();
    partnership.decidedBy = actorUserId || null;
  }
  partnership.history.push({
    status: transition.to,
    action: transition.action,
    actor: actorUserId || null,
    actorOrg: actorOrgId || null,
    at: new Date(),
    note,
  });
  return partnership;
};

// ─── ChannelPartner reconciliation (Target Architecture §3.3) ────────────────

/**
 * On a partnership becoming `active`, ensure a linked ChannelPartner shadow
 * record exists in the developer's org so the existing attribution / commission
 * / analytics engines keep working. Idempotent on the channelPartnerOrg link —
 * re-activation after terminate→re-apply→approve never duplicates the record.
 *
 * Optional `options.session` (SP4) — when provided (Mongo transaction), all
 * reads/writes participate in the transaction. SP3 callers pass nothing and
 * the function behaves exactly as before.
 */
export const reconcileChannelPartnerRecord = async (partnership, actorUserId, options = {}) => {
  const session = options.session;
  const sessionOpt = session ? { session } : {};

  const existing = await ChannelPartner.findOne(
    {
      organization: partnership.developerOrg,
      channelPartnerOrg: partnership.channelPartnerOrg,
    },
    null,
    sessionOpt
  );
  if (existing) {
    existing.status = 'active';
    if (partnership.projects && partnership.projects.length > 0) {
      existing.approvedProjects = partnership.projects;
    }
    if (session) existing.$session(session);
    await existing.save({ session });
    return existing;
  }
  const cpOrg = await Organization.findById(partnership.channelPartnerOrg, null, sessionOpt)
    .select('name category contactInfo reraRegistrationNumber');

  const created = await ChannelPartner.create(
    [
      {
        organization: partnership.developerOrg,
        channelPartnerOrg: partnership.channelPartnerOrg,
        firmName: cpOrg?.name || 'Channel Partner',
        category: cpOrg?.category || 'broker_firm',
        reraRegistrationNumber: cpOrg?.reraRegistrationNumber || '',
        primaryContact: { phone: cpOrg?.contactInfo?.phone || '' },
        approvedProjects: partnership.projects || [],
        status: 'active',
        onboardedBy: actorUserId || partnership.decidedBy || null,
      },
    ],
    sessionOpt
  );
  return created[0];
};

/**
 * Mirror a partnership status change onto the linked ChannelPartner record so
 * the developer-side engines stop / resume attributing. Never deletes the
 * record — historical attribution and commission are preserved. ChannelPartner
 * has no `terminated` status, so a terminated partnership maps to `suspended`.
 */
export const syncChannelPartnerStatus = async (partnership, partnershipStatus) => {
  const record = await ChannelPartner.findOne({
    organization: partnership.developerOrg,
    channelPartnerOrg: partnership.channelPartnerOrg,
  });
  if (!record) return null;
  record.status = partnershipStatus === 'active' ? 'active' : 'suspended';
  await record.save();
  return record;
};

// ─── Notifications ───────────────────────────────────────────────────────────

/**
 * Resolve the users in an org who should receive a partnership notification:
 * everyone whose role grants the gating permission, plus the org owner (always,
 * via the owner role). Returns an array of user ids.
 */
const resolveRecipients = async (organizationId, gatingPermission) => {
  const roles = await Role.find({
    organization: organizationId,
    $or: [{ isOwnerRole: true }, { permissions: gatingPermission }],
  }).select('_id');
  if (roles.length === 0) return [];
  const users = await User.find({
    organization: organizationId,
    isActive: true,
    roleRef: { $in: roles.map((r) => r._id) },
  }).select('_id');
  return users.map((u) => u._id);
};

/**
 * Fan a partnership notification out to one side of the partnership.
 * @param {object}  partnership   - the Partnership document
 * @param {string}  recipientSide - 'developer' | 'channel_partner'
 * @param {string}  type          - 'partnership_request' | 'partnership_update'
 * @param {string}  title         - notification title
 * @param {string}  message       - notification body
 * @param {string?} actorUserId   - the user who triggered the event
 */
export const notifyPartnership = async ({ partnership, recipientSide, type, title, message, actorUserId }) => {
  const isDeveloper = recipientSide === 'developer';
  const orgId = isDeveloper ? partnership.developerOrg : partnership.channelPartnerOrg;
  const gating = isDeveloper
    ? PERMISSIONS.CHANNEL_PARTNERS.VIEW
    : CP_PERMISSIONS.PARTNERSHIPS.VIEW;
  const recipientIds = await resolveRecipients(orgId, gating);
  if (recipientIds.length === 0) return;
  const actionUrl = isDeveloper ? '/channel-partners/requests' : '/partner/partnerships';
  await Notification.insertMany(
    recipientIds.map((recipient) => ({
      organization: orgId,
      recipient,
      type,
      title,
      message,
      priority: 'medium',
      actor: actorUserId || null,
      relatedEntity: { entityType: 'Partnership', entityId: partnership._id, displayLabel: title },
      actionUrl,
    }))
  );
};
