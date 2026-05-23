// File: utils/partnerAccessHelper.js
// Description: SP4 — the single source of truth for "what cross-org leads
//   can this CP user see/edit?" Returns a Mongo filter to AND with Lead
//   queries, scoping a CP user to leads attributed to their CP org via an
//   active Partnership. For non-CP users this returns null (the caller
//   simply skips the AND and uses its own org-scoping).
//
//   Security-critical: any new CP-facing Lead endpoint MUST AND its query
//   with the result. The function is intentionally self-contained — it
//   loads the caller's organization itself if `req.organization` isn't
//   already populated by middleware.
//
//   Contract:
//   - Non-CP caller (developer org)                     → null
//   - CP caller, 0 active partnerships                  → { _id: { $in: [] } }  (matches nothing)
//   - CP caller, partnerships but no ChannelPartner shadow record yet
//                                                        → { _id: { $in: [] } }
//   - CP caller, has active partnerships + shadows      → filter on
//       channelPartnerAttribution.partners.channelPartner ∈ [shadow ids]
//   - CP Agent (roleRef.name='CP Agent')                → additionally narrows
//       channelPartnerAttribution.partners.agentUser = self
//
//   Owner-bypass is implicit: only CP Agents are role-narrowed.
//
//   This function is READ-ONLY — no mutations, no notifications, no side effects.

import Organization from '../models/organizationModel.js';
import Partnership from '../models/partnershipModel.js';
import ChannelPartner from '../models/channelPartnerModel.js';

/**
 * Build a Mongo filter limiting Lead queries to records this CP user may see.
 *
 * @param {import('express').Request} req — must carry req.user (with .organization
 *   and an optional .roleRef populated by `protect`). req.organization may
 *   optionally be pre-loaded by `requireOrgType` or similar middleware.
 * @returns {Promise<Object|null>} a Mongo filter object, or null for non-CP users.
 */
export async function partnerAccessScope(req) {
  const user = req?.user;
  if (!user || !user.organization) return null;

  // Resolve the caller's organization type (avoid a second DB hit when a
  // middleware has already loaded it).
  const orgDoc = req.organization
    ? req.organization
    : await Organization.findById(user.organization).select('type').lean();
  if (!orgDoc || orgDoc.type !== 'channel_partner') return null;

  const cpOrgId = orgDoc._id || user.organization;

  // 1. Active partnerships → the developer orgs whose leads we may touch.
  const partnerships = await Partnership.find({
    channelPartnerOrg: cpOrgId,
    status: 'active',
  })
    .select('developerOrg')
    .lean();
  if (partnerships.length === 0) {
    return { _id: { $in: [] } };
  }
  const devOrgIds = partnerships.map((p) => p.developerOrg);

  // 2. The dev-side ChannelPartner shadow records that link back to this CP org.
  //    SP3's reconciliation creates these on partnership activation.
  const cpRecords = await ChannelPartner.find({
    organization: { $in: devOrgIds },
    channelPartnerOrg: cpOrgId,
  })
    .select('_id')
    .lean();
  if (cpRecords.length === 0) {
    return { _id: { $in: [] } };
  }
  const cpRecordIds = cpRecords.map((c) => c._id);

  // 3. Base scope — Leads attributed to those shadow records.
  const filter = {
    'channelPartnerAttribution.partners.channelPartner': { $in: cpRecordIds },
  };

  // 4. CP Agent narrowing — only their own attribution (by `agentUser`).
  //    Identity comes from the populated roleRef; the legacy `User.role`
  //    string field is unreliable for CP roles (CP Owner is mapped to
  //    'Business Head' for backward compatibility — see authController).
  const roleName = user.roleRef?.name;
  const roleSlug = user.roleRef?.slug;
  if (roleName === 'CP Agent' || roleSlug === 'cp-agent') {
    filter['channelPartnerAttribution.partners.agentUser'] = user._id;
  }

  return filter;
}

export default { partnerAccessScope };
