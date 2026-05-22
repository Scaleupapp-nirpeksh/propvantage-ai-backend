// File: controllers/partnershipController.js
// Description: Marketplace partnership lifecycle endpoints (SP3) — apply / invite,
//   the transition actions, and the per-side partnership lists. These routes are
//   used by BOTH org types; each handler resolves the caller's org type and
//   enforces the appropriate permission (developer: channel_partners:*;
//   channel partner: cp_partnerships:*).

import asyncHandler from 'express-async-handler';
import mongoose from 'mongoose';
import Organization from '../models/organizationModel.js';
import Project from '../models/projectModel.js';
import Partnership from '../models/partnershipModel.js';
import {
  validateTransition,
  applyTransition,
  reconcileChannelPartnerRecord,
  syncChannelPartnerStatus,
  notifyPartnership,
} from '../services/partnershipService.js';
import { CP_PERMISSIONS, PERMISSIONS } from '../config/permissions.js';

const PENDING_CAP = parseInt(process.env.CP_MAX_PENDING_APPLICATIONS, 10) || 10;

// Permission check usable inside a handler — mirrors hasPermission()'s owner bypass.
const can = (req, permission) => req.isOwner || (req.userPermissions || []).includes(permission);

// Validate a commissionTerms payload. Returns { ok, message? , value? }.
const validateCommissionTerms = (ct) => {
  if (!ct || typeof ct !== 'object') {
    return { ok: false, message: 'Commission terms are required' };
  }
  if (!['percentage', 'flat'].includes(ct.type)) {
    return { ok: false, message: 'Commission terms type must be "percentage" or "flat"' };
  }
  const value = Number(ct.value);
  if (!Number.isFinite(value) || value < 0) {
    return { ok: false, message: 'Commission terms value must be a non-negative number' };
  }
  if (ct.type === 'percentage' && value > 100) {
    return { ok: false, message: 'A percentage commission cannot exceed 100' };
  }
  return { ok: true, value: { type: ct.type, value, notes: String(ct.notes || '').trim() } };
};

// Sanitize an attachments array from the request body to { url, name }[].
const sanitizeAttachments = (attachments) => {
  if (!Array.isArray(attachments)) return [];
  return attachments
    .filter((a) => a && typeof a.url === 'string' && a.url.trim())
    .map((a) => ({ url: a.url.trim(), name: String(a.name || '').trim() }));
};

const getCallerOrg = (req) =>
  Organization.findById(req.user.organization).select('type name');

// POST /api/partnerships — a CP applies to a developer, or a developer invites a CP.
export const createPartnership = asyncHandler(async (req, res) => {
  const callerOrg = await getCallerOrg(req);
  if (!callerOrg) {
    res.status(404);
    throw new Error('Organization not found');
  }

  const { counterpartyOrgId, message, attachments, projects, commissionTerms } = req.body;
  if (!mongoose.isValidObjectId(counterpartyOrgId)) {
    res.status(400);
    throw new Error('A valid counterpartyOrgId is required');
  }
  const counterparty = await Organization.findById(counterpartyOrgId).select('type name isActive');
  if (!counterparty || counterparty.isActive === false) {
    res.status(404);
    throw new Error('The selected organization was not found');
  }

  const callerIsCp = callerOrg.type === 'channel_partner';
  let developerOrgId;
  let channelPartnerOrgId;
  let initiatedBy;
  let initialAction;
  let termsForDoc = null;
  let projectsForDoc = [];

  if (callerIsCp) {
    // ── CP applying to a developer ──
    if (!can(req, CP_PERMISSIONS.PARTNERSHIPS.MANAGE)) {
      res.status(403);
      throw new Error('Missing required permission(s): cp_partnerships:manage');
    }
    if (counterparty.type !== 'builder') {
      res.status(400);
      throw new Error('You can only apply to developer organizations');
    }
    const publishedCount = await Project.countDocuments({
      organization: counterparty._id,
      'portfolio.isPublished': true,
    });
    if (publishedCount === 0) {
      res.status(400);
      throw new Error('This developer has no published portfolio to partner on');
    }
    developerOrgId = counterparty._id;
    channelPartnerOrgId = callerOrg._id;
    initiatedBy = 'channel_partner';
    initialAction = 'applied';
  } else if (callerOrg.type === 'builder') {
    // ── Developer inviting a CP ──
    if (!can(req, PERMISSIONS.CHANNEL_PARTNERS.CREATE)) {
      res.status(403);
      throw new Error('Missing required permission(s): channel_partners:create');
    }
    if (counterparty.type !== 'channel_partner') {
      res.status(400);
      throw new Error('You can only invite channel-partner organizations');
    }
    const ct = validateCommissionTerms(commissionTerms);
    if (!ct.ok) {
      res.status(400);
      throw new Error(ct.message);
    }
    termsForDoc = ct.value;
    developerOrgId = callerOrg._id;
    channelPartnerOrgId = counterparty._id;
    initiatedBy = 'developer';
    initialAction = 'invited';
    // Optional project restriction — every project must belong to the developer.
    if (Array.isArray(projects) && projects.length > 0) {
      const valid = await Project.countDocuments({
        _id: { $in: projects },
        organization: developerOrgId,
      });
      if (valid !== projects.length) {
        res.status(400);
        throw new Error('One or more selected projects do not belong to your organization');
      }
      projectsForDoc = projects;
    }
  } else {
    res.status(403);
    throw new Error('Your organization type cannot create partnerships');
  }

  // Pending-application cap — CP-initiated applications only.
  if (callerIsCp) {
    const pendingCount = await Partnership.countDocuments({
      channelPartnerOrg: channelPartnerOrgId,
      status: 'pending',
    });
    if (pendingCount >= PENDING_CAP) {
      res.status(409);
      throw new Error(`You have reached the limit of ${PENDING_CAP} pending applications`);
    }
  }

  const appData = {
    message: String(message || '').trim(),
    attachments: sanitizeAttachments(attachments),
  };
  const baseHistory = {
    status: 'pending',
    actor: req.user._id,
    actorOrg: callerOrg._id,
    at: new Date(),
    note: '',
  };

  // Unique-pair handling — one Partnership document per (developer, CP) pair.
  const existing = await Partnership.findOne({
    developerOrg: developerOrgId,
    channelPartnerOrg: channelPartnerOrgId,
  });

  let partnership;
  if (existing) {
    if (['pending', 'active', 'suspended'].includes(existing.status)) {
      res.status(409);
      throw new Error(
        existing.status === 'pending'
          ? 'A partnership request already exists for this organization'
          : 'You already have an active partnership with this organization'
      );
    }
    // rejected | terminated → re-open the same document (Decision 3).
    existing.status = 'pending';
    existing.initiatedBy = initiatedBy;
    existing.application = appData;
    existing.commissionTerms = termsForDoc;
    existing.projects = projectsForDoc;
    existing.requestedAt = new Date();
    existing.decidedAt = null;
    existing.decidedBy = null;
    existing.history.push({
      ...baseHistory,
      action: initiatedBy === 'developer' ? 'reinvited' : 'reapplied',
    });
    partnership = await existing.save();
  } else {
    try {
      partnership = await Partnership.create({
        developerOrg: developerOrgId,
        channelPartnerOrg: channelPartnerOrgId,
        status: 'pending',
        initiatedBy,
        projects: projectsForDoc,
        application: appData,
        commissionTerms: termsForDoc,
        requestedAt: new Date(),
        history: [{ ...baseHistory, action: initialAction }],
      });
    } catch (err) {
      // Unique-index backstop against a concurrent-create race.
      if (err && err.code === 11000) {
        res.status(409);
        throw new Error('A partnership request already exists for this organization');
      }
      throw err;
    }
  }

  await notifyPartnership({
    partnership,
    recipientSide: callerIsCp ? 'developer' : 'channel_partner',
    type: 'partnership_request',
    title: callerIsCp ? 'New partnership application' : 'New partnership invitation',
    message: callerIsCp
      ? `${callerOrg.name} has applied to partner with your organization.`
      : `${callerOrg.name} has invited your organization to partner.`,
    actorUserId: req.user._id,
  });

  res.status(201).json({ success: true, data: partnership });
});

// PATCH /api/partnerships/:id — approve/reject/accept/decline/suspend/resume/terminate.
export const transitionPartnership = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    res.status(400);
    throw new Error('Invalid partnership id');
  }
  const partnership = await Partnership.findById(req.params.id);
  if (!partnership) {
    res.status(404);
    throw new Error('Partnership not found');
  }

  const callerOrgId = String(req.user.organization);
  const isDeveloperSide = callerOrgId === String(partnership.developerOrg);
  const isCpSide = callerOrgId === String(partnership.channelPartnerOrg);
  if (!isDeveloperSide && !isCpSide) {
    res.status(403);
    throw new Error('Your organization is not a party to this partnership');
  }
  const callerSide = isDeveloperSide ? 'developer' : 'channel_partner';
  const { action, note, commissionTerms, projects } = req.body;

  // 1. Transition validity (state machine + side + initiatedBy).
  const check = validateTransition(partnership, action, callerSide);
  if (!check.ok) {
    res.status(check.status);
    throw new Error(check.message);
  }

  // 2. Permission gate by side.
  const requiredPerm = callerSide === 'developer'
    ? PERMISSIONS.CHANNEL_PARTNERS.UPDATE
    : CP_PERMISSIONS.PARTNERSHIPS.MANAGE;
  if (!can(req, requiredPerm)) {
    res.status(403);
    throw new Error(`Missing required permission(s): ${requiredPerm}`);
  }

  // 3. `approve` must carry the agreed commission terms; an optional project
  //    restriction may also be set here.
  if (action === 'approve') {
    const ct = validateCommissionTerms(commissionTerms);
    if (!ct.ok) {
      res.status(400);
      throw new Error(ct.message);
    }
    partnership.commissionTerms = ct.value;
    if (Array.isArray(projects)) {
      if (projects.length > 0) {
        const valid = await Project.countDocuments({
          _id: { $in: projects },
          organization: partnership.developerOrg,
        });
        if (valid !== projects.length) {
          res.status(400);
          throw new Error('One or more selected projects do not belong to your organization');
        }
      }
      partnership.projects = projects;
    }
  }

  // 4. Apply + persist.
  applyTransition(partnership, check.transition, {
    actorUserId: req.user._id,
    actorOrgId: req.user.organization,
    note: String(note || '').trim(),
  });
  await partnership.save();

  // 5. Keep the developer-side ChannelPartner shadow record in sync.
  if (partnership.status === 'active') {
    await reconcileChannelPartnerRecord(partnership, req.user._id);
  } else if (partnership.status === 'suspended' || partnership.status === 'terminated') {
    await syncChannelPartnerStatus(partnership, partnership.status);
  }

  // 6. Notify the other side.
  await notifyPartnership({
    partnership,
    recipientSide: callerSide === 'developer' ? 'channel_partner' : 'developer',
    type: 'partnership_update',
    title: `Partnership ${check.transition.action}`,
    message: `A partnership has been ${check.transition.action}.`,
    actorUserId: req.user._id,
  });

  res.json({ success: true, data: partnership });
});

// GET /api/partnerships — partnerships for the caller's organization.
export const listPartnerships = asyncHandler(async (req, res) => {
  const callerOrg = await getCallerOrg(req);
  if (!callerOrg) {
    res.status(404);
    throw new Error('Organization not found');
  }
  const isCp = callerOrg.type === 'channel_partner';

  const viewPerm = isCp ? CP_PERMISSIONS.PARTNERSHIPS.VIEW : PERMISSIONS.CHANNEL_PARTNERS.VIEW;
  if (!can(req, viewPerm)) {
    res.status(403);
    throw new Error(`Missing required permission(s): ${viewPerm}`);
  }

  const filter = isCp
    ? { channelPartnerOrg: callerOrg._id }
    : { developerOrg: callerOrg._id };
  if (req.query.status) filter.status = req.query.status;
  if (req.query.initiatedBy) filter.initiatedBy = req.query.initiatedBy;

  const counterpartyField = isCp ? 'developerOrg' : 'channelPartnerOrg';
  const counterpartySelect = isCp
    ? 'name city type portfolioProfile'
    : 'name city type category channelPartnerProfile';

  const partnerships = await Partnership.find(filter)
    .populate(counterpartyField, counterpartySelect)
    .sort({ updatedAt: -1 })
    .lean();

  res.json({ success: true, data: partnerships });
});

// GET /api/partnerships/:id — a single partnership the caller is a party to.
export const getPartnership = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    res.status(400);
    throw new Error('Invalid partnership id');
  }
  const partnership = await Partnership.findById(req.params.id)
    .populate('developerOrg', 'name city type category portfolioProfile contactInfo')
    .populate('channelPartnerOrg', 'name city type category channelPartnerProfile contactInfo')
    .populate('projects', 'name type status')
    .lean();
  if (!partnership) {
    res.status(404);
    throw new Error('Partnership not found');
  }

  const callerOrgId = String(req.user.organization);
  const devId = String(partnership.developerOrg?._id || partnership.developerOrg);
  const cpId = String(partnership.channelPartnerOrg?._id || partnership.channelPartnerOrg);
  if (callerOrgId !== devId && callerOrgId !== cpId) {
    res.status(403);
    throw new Error('Your organization is not a party to this partnership');
  }
  const viewPerm = callerOrgId === cpId
    ? CP_PERMISSIONS.PARTNERSHIPS.VIEW
    : PERMISSIONS.CHANNEL_PARTNERS.VIEW;
  if (!can(req, viewPerm)) {
    res.status(403);
    throw new Error(`Missing required permission(s): ${viewPerm}`);
  }

  res.json({ success: true, data: partnership });
});
