// File: services/salesAttributionHelper.js
// Description: 2026-05-24 lifecycle-repair — single source of truth for
//   computing a Sale's channelPartnerAttribution at booking time.
//
//   THE bug this fixes (B1): createSale used to only read attribution from
//   req.body, never falling back to the upstream Lead. Devs converting a
//   CP-pushed lead to a sale could silently strip the CP tag by forgetting
//   to re-tick the form. This helper makes inheritance explicit and
//   validated, and is called from BOTH the Pending-Approval and Booked
//   branches of createSale so the two paths can't drift (B15).
//
//   Behavior:
//   - If req.body sends `channelPartnerAttribution.viaChannelPartner=true`
//     with partners[], that wins (explicit dev-side tagging).
//   - Else, if the Lead has `channelPartnerAttribution.viaChannelPartner=true`,
//     inherit from the Lead.
//   - Else, return null (direct dev sale — non-CP, no attribution).
//
//   Validation (applied to whichever source wins):
//   - partners must be a non-empty array
//   - each partner must have a `channelPartner` ref
//   - sum(sharePct) must equal 100 within ±0.01 tolerance (B7)
//   - for each partner whose ChannelPartner.channelPartnerOrg is set
//     (a platform CP — not a legacy off-platform-only record), there must be
//     an active Partnership between the sale's developer org and that CP org.
//     Off-platform-only ChannelPartner records (channelPartnerOrg=null) are
//     accepted without partnership validation — backward compatibility.
//
//   Errors thrown carry a `statusCode` so the asyncHandler in salesController
//   can surface them with the right HTTP status.

import mongoose from 'mongoose';
import ChannelPartner from '../models/channelPartnerModel.js';
import Partnership from '../models/partnershipModel.js';

const httpError = (status, message) => {
  const err = new Error(message);
  err.statusCode = status;
  return err;
};

/**
 * Build the channelPartnerAttribution sub-document for a new Sale.
 *
 * @param {object} args
 * @param {object} args.lead — the Lead doc the sale is being booked against
 *                            (already loaded; can be a lean object or a doc)
 * @param {object} [args.bodyAttribution] — req.body.channelPartnerAttribution
 *                            from createSale (may be undefined)
 * @param {object} args.user — req.user (for taggedBy/history)
 * @param {ObjectId|string} args.saleOrgId — the developer org id (req.user.organization)
 * @param {string} [args.actionLabel='tagged'] — history action ('tagged'|'inherited_from_lead')
 * @returns {Promise<object|null>} — the attribution object to write, or null
 *                                   if this is a non-CP sale
 */
export async function buildSaleAttributionFromLead({
  lead,
  bodyAttribution,
  user,
  saleOrgId,
}) {
  // Decide source: body wins if it explicitly opts in.
  const bodySaysCp = bodyAttribution && bodyAttribution.viaChannelPartner === true;
  const leadSaysCp = lead?.channelPartnerAttribution?.viaChannelPartner === true;

  if (!bodySaysCp && !leadSaysCp) return null; // direct dev sale

  let partners;
  let sourceLabel; // for history note
  if (bodySaysCp) {
    partners = Array.isArray(bodyAttribution.partners)
      ? bodyAttribution.partners.filter((p) => p && p.channelPartner)
      : [];
    sourceLabel = 'Set at booking creation.';
  } else {
    partners = Array.isArray(lead.channelPartnerAttribution.partners)
      ? lead.channelPartnerAttribution.partners.filter((p) => p && p.channelPartner)
      : [];
    sourceLabel = 'Auto-inherited from the upstream Lead at booking.';
  }

  if (partners.length === 0) {
    throw httpError(
      400,
      'Channel partner attribution is enabled but no partners were provided.'
    );
  }

  // Share validation (B7) — must sum to 100% within rounding tolerance.
  const shareSum = partners.reduce((a, p) => a + (Number(p.sharePct) || 0), 0);
  if (Math.abs(shareSum - 100) > 0.01) {
    throw httpError(
      400,
      `Channel partner commission split must sum to 100% (got ${shareSum.toFixed(2)}).`
    );
  }

  // Partnership-active validation for each on-platform CP.
  // Off-platform-only ChannelPartner records (legacy, channelPartnerOrg=null)
  // are accepted without partnership validation.
  const cpIds = partners
    .map((p) => p.channelPartner)
    .filter((id) => mongoose.isValidObjectId(id));
  if (cpIds.length > 0) {
    const cpDocs = await ChannelPartner.find({ _id: { $in: cpIds } })
      .select('_id firmName channelPartnerOrg organization')
      .lean();
    const cpById = new Map(cpDocs.map((c) => [String(c._id), c]));

    // Reject if any partner references a ChannelPartner that doesn't exist
    // OR belongs to a different developer org.
    for (const partner of partners) {
      const cp = cpById.get(String(partner.channelPartner));
      if (!cp) {
        throw httpError(
          400,
          `ChannelPartner ${partner.channelPartner} not found.`
        );
      }
      if (String(cp.organization) !== String(saleOrgId)) {
        throw httpError(
          400,
          `ChannelPartner ${cp.firmName || cp._id} does not belong to this developer organisation.`
        );
      }
    }

    // For platform-linked CPs (channelPartnerOrg set), require active Partnership.
    const platformCpOrgIds = cpDocs
      .filter((c) => c.channelPartnerOrg)
      .map((c) => c.channelPartnerOrg);

    if (platformCpOrgIds.length > 0) {
      const activePartnerships = await Partnership.find({
        developerOrg: saleOrgId,
        channelPartnerOrg: { $in: platformCpOrgIds },
        status: 'active',
      })
        .select('channelPartnerOrg')
        .lean();
      const activeCpOrgIds = new Set(activePartnerships.map((p) => String(p.channelPartnerOrg)));

      const inactiveCps = cpDocs.filter(
        (c) => c.channelPartnerOrg && !activeCpOrgIds.has(String(c.channelPartnerOrg))
      );
      if (inactiveCps.length > 0) {
        const names = inactiveCps.map((c) => c.firmName || c._id).join(', ');
        throw httpError(
          409,
          `No active Partnership exists with: ${names}. ` +
            `Either reactivate the partnership or remove these CPs from the booking.`
        );
      }
    }
  }

  // Construct the attribution document. Strip any unexpected fields from
  // the caller — only canonical fields survive.
  const cleanPartners = partners.map((p) => {
    const entry = {
      channelPartner: p.channelPartner,
      sharePct: Number(p.sharePct) || 0,
    };
    if (p.agent) entry.agent = p.agent;
    return entry;
  });

  // If we inherited, preserve the original Lead's status & history;
  // otherwise treat the booking-time tag as the initial event.
  const inheritedFromLead = !bodySaysCp;
  const baseStatus = inheritedFromLead
    ? lead.channelPartnerAttribution?.status || 'approved'
    : 'tagged';

  return {
    viaChannelPartner: true,
    partners: cleanPartners,
    status: baseStatus,
    taggedBy: user._id,
    taggedAt: new Date(),
    history: [
      {
        by: user._id,
        action: inheritedFromLead ? 'inherited_from_lead' : 'tagged',
        note: sourceLabel,
      },
    ],
  };
}

export default { buildSaleAttributionFromLead };
