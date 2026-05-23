// File: services/analytics/devAnalyticsService.js
// Description: SP5 — developer-side analytics for Areas 6–8 of the spec.
//   6. getChannelPartnerScorecard — per-active-partner KPIs + quality score
//   7. getCommissionPayouts       — paid / outstanding / by-CP / by-project / monthly
//   8. getLeadQuality             — per-CP acceptance + rejection signals
//
//   All three are org-scoped to the developer org. No partnerAccessScope
//   (devs read their own org by definition). Read-only; cached for 5min.

import mongoose from 'mongoose';
import Lead from '../../models/leadModel.js';
import Sale from '../../models/salesModel.js';
import Organization from '../../models/organizationModel.js'; // for populate('channelPartnerOrg')
import CommissionRecord from '../../models/commissionRecordModel.js';
import ChannelPartner from '../../models/channelPartnerModel.js';
import Partnership from '../../models/partnershipModel.js';
import { parseRange, toObjectId, safeDiv, round2, withCache } from './_shared.js';

// ─── Area 6 — Channel Partner Scorecard ────────────────────────────────────

/**
 * Per-active-partner KPIs.
 *
 * partnerQualityScore = 0.5 * acceptRate
 *                     + 0.3 * conversionRate
 *                     + 0.2 * (1 / max(1, avgTimeToDecisionDays))
 */
export async function getChannelPartnerScorecard(orgId, params, user) {
  const { from, range } = parseRange(params?.range);
  const cacheKey = `dev:cpScorecard:${orgId}:${range}`;

  return withCache(cacheKey, async () => {
    const devOrgId = toObjectId(orgId);

    // Active partnerships → CP shadow records that link to a CP org.
    const partnerships = await Partnership.find({
      developerOrg: devOrgId,
      status: 'active',
    })
      .populate({ path: 'channelPartnerOrg', select: 'name' })
      .lean();

    if (partnerships.length === 0) {
      return { partners: [], generatedAt: new Date().toISOString(), range };
    }

    const shadows = await ChannelPartner.find({
      organization: devOrgId,
      channelPartnerOrg: { $in: partnerships.map((p) => p.channelPartnerOrg?._id).filter(Boolean) },
    }).select('_id channelPartnerOrg firmName').lean();
    const shadowByOrg = new Map(
      shadows.map((s) => [s.channelPartnerOrg?.toString(), s])
    );

    const partners = [];
    for (const p of partnerships) {
      const cpOrgId = p.channelPartnerOrg?._id || p.channelPartnerOrg;
      const shadow = shadowByOrg.get(cpOrgId?.toString());
      if (!shadow) continue; // no shadow → partnership not yet reconciled

      const leadFilter = {
        organization: devOrgId,
        'channelPartnerAttribution.partners.channelPartner': shadow._id,
        ...(from ? { createdAt: { $gte: from } } : {}),
      };

      // Status counts.
      const leadAgg = await Lead.aggregate([
        { $match: leadFilter },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            accepted: { $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 0, 1] } },
            rejected: {
              $sum: { $cond: [{ $eq: ['$channelPartnerAttribution.status', 'rejected'] }, 1, 0] },
            },
            booked: { $sum: { $cond: [{ $eq: ['$status', 'Booked'] }, 1, 0] } },
            totalTimeToDecisionMs: {
              $sum: {
                $cond: [
                  { $ne: ['$status', 'pending'] },
                  { $subtract: [{ $ifNull: ['$updatedAt', '$createdAt'] }, '$createdAt'] },
                  0,
                ],
              },
            },
            decidedCount: { $sum: { $cond: [{ $ne: ['$status', 'pending'] }, 1, 0] } },
          },
        },
      ]);
      const stats = leadAgg[0] || {
        total: 0, accepted: 0, rejected: 0, booked: 0, totalTimeToDecisionMs: 0, decidedCount: 0,
      };

      // Commission paid YTD (always YTD per spec table — overrides range).
      const ytdStart = new Date(new Date().getFullYear(), 0, 1);
      const ytdCommissions = await CommissionRecord.aggregate([
        { $match: { organization: devOrgId, channelPartner: shadow._id } },
        { $unwind: { path: '$payouts', preserveNullAndEmptyArrays: false } },
        { $match: { 'payouts.status': 'paid', 'payouts.paidOn': { $gte: ytdStart } } },
        { $group: { _id: null, paid: { $sum: '$payouts.amount' } } },
      ]);
      const commissionPaidYtd = ytdCommissions[0]?.paid || 0;

      const acceptRate = safeDiv(stats.accepted, stats.total);
      const conversionRate = safeDiv(stats.booked, stats.total);
      const avgTimeToDecisionHours = safeDiv(stats.totalTimeToDecisionMs, stats.decidedCount) / (1000 * 60 * 60);
      const avgTimeToDecisionDays = avgTimeToDecisionHours / 24;
      const partnerQualityScore = round2(
        0.5 * acceptRate +
        0.3 * conversionRate +
        0.2 * safeDiv(1, Math.max(1, avgTimeToDecisionDays))
      );

      partners.push({
        partnershipId: p._id,
        channelPartnerOrg: { _id: cpOrgId, name: p.channelPartnerOrg?.name || shadow.firmName },
        channelPartnerShadowId: shadow._id,
        leadsSubmitted: stats.total,
        accepted: stats.accepted,
        rejected: stats.rejected,
        acceptRate: round2(acceptRate),
        conversionRate: round2(conversionRate),
        avgTimeToDecisionHours: round2(avgTimeToDecisionHours),
        commissionPaidYtd: round2(commissionPaidYtd),
        partnerQualityScore,
      });
    }

    partners.sort((a, b) => b.partnerQualityScore - a.partnerQualityScore);
    return { partners, generatedAt: new Date().toISOString(), range };
  });
}

// ─── Area 7 — Commission Payouts ───────────────────────────────────────────

export async function getCommissionPayouts(orgId, params, user) {
  const { from, range } = parseRange(params?.range);
  const cacheKey = `dev:payouts:${orgId}:${range}`;

  return withCache(cacheKey, async () => {
    const devOrgId = toObjectId(orgId);

    // Summary: paidThisPeriod, outstanding, cpsPaid, avgPayoutPerCp.
    const summaryAgg = await CommissionRecord.aggregate([
      { $match: { organization: devOrgId } },
      {
        $project: {
          channelPartner: 1,
          grossAmount: 1,
          netAmount: 1,
          paidInPeriod: {
            $sum: {
              $map: {
                input: {
                  $filter: {
                    input: { $ifNull: ['$payouts', []] },
                    as: 'p',
                    cond: {
                      $and: [
                        { $eq: ['$$p.status', 'paid'] },
                        from ? { $gte: ['$$p.paidOn', from] } : { $literal: true },
                      ],
                    },
                  },
                },
                as: 'q',
                in: '$$q.amount',
              },
            },
          },
          paidAllTime: {
            $sum: {
              $map: {
                input: {
                  $filter: { input: { $ifNull: ['$payouts', []] }, as: 'p', cond: { $eq: ['$$p.status', 'paid'] } },
                },
                as: 'q',
                in: '$$q.amount',
              },
            },
          },
        },
      },
      {
        $group: {
          _id: null,
          paidThisPeriod: { $sum: '$paidInPeriod' },
          totalGross: { $sum: '$grossAmount' },
          totalPaidAllTime: { $sum: '$paidAllTime' },
          cpsPaidSet: { $addToSet: { $cond: [{ $gt: ['$paidInPeriod', 0] }, '$channelPartner', null] } },
        },
      },
    ]);
    const s = summaryAgg[0] || { paidThisPeriod: 0, totalGross: 0, totalPaidAllTime: 0, cpsPaidSet: [] };
    const cpsPaid = (s.cpsPaidSet || []).filter(Boolean).length;
    const summary = {
      paidThisPeriod: round2(s.paidThisPeriod),
      outstanding: round2(s.totalGross - s.totalPaidAllTime),
      cpsPaid,
      avgPayoutPerCp: round2(safeDiv(s.paidThisPeriod, cpsPaid)),
    };

    // By CP.
    const byCp = await CommissionRecord.aggregate([
      { $match: { organization: devOrgId } },
      { $lookup: { from: 'channelpartners', localField: 'channelPartner', foreignField: '_id', as: 'cp' } },
      { $unwind: { path: '$cp', preserveNullAndEmptyArrays: true } },
      { $unwind: { path: '$payouts', preserveNullAndEmptyArrays: false } },
      { $match: { 'payouts.status': 'paid', ...(from ? { 'payouts.paidOn': { $gte: from } } : {}) } },
      {
        $group: {
          _id: { id: '$cp._id', name: '$cp.firmName' },
          paid: { $sum: '$payouts.amount' },
          payoutCount: { $sum: 1 },
        },
      },
      {
        $project: {
          _id: 0,
          channelPartnerId: '$_id.id',
          channelPartnerName: '$_id.name',
          paid: { $round: ['$paid', 2] },
          payoutCount: 1,
        },
      },
      { $sort: { paid: -1 } },
    ]);

    // By project: join Sale → Project for the projectId/name.
    const byProject = await CommissionRecord.aggregate([
      { $match: { organization: devOrgId } },
      { $unwind: { path: '$payouts', preserveNullAndEmptyArrays: false } },
      { $match: { 'payouts.status': 'paid', ...(from ? { 'payouts.paidOn': { $gte: from } } : {}) } },
      { $lookup: { from: 'sales', localField: 'sale', foreignField: '_id', as: 'sale' } },
      { $unwind: { path: '$sale', preserveNullAndEmptyArrays: true } },
      { $lookup: { from: 'projects', localField: 'sale.project', foreignField: '_id', as: 'project' } },
      { $unwind: { path: '$project', preserveNullAndEmptyArrays: true } },
      {
        $group: {
          _id: { id: '$project._id', name: '$project.name' },
          paid: { $sum: '$payouts.amount' },
        },
      },
      { $project: { _id: 0, projectId: '$_id.id', projectName: '$_id.name', paid: { $round: ['$paid', 2] } } },
      { $sort: { paid: -1 } },
    ]);

    // Monthly time series (last 12 months).
    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);
    const byMonth = await CommissionRecord.aggregate([
      { $match: { organization: devOrgId } },
      { $unwind: { path: '$payouts', preserveNullAndEmptyArrays: false } },
      { $match: { 'payouts.status': 'paid', 'payouts.paidOn': { $gte: twelveMonthsAgo } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m', date: '$payouts.paidOn', timezone: 'Asia/Kolkata' } },
          paid: { $sum: '$payouts.amount' },
        },
      },
      { $project: { _id: 0, month: '$_id', paid: { $round: ['$paid', 2] } } },
      { $sort: { month: 1 } },
    ]);

    return {
      summary,
      breakdowns: { byCp, byProject },
      series: { byMonth },
      generatedAt: new Date().toISOString(),
      range,
    };
  });
}

// ─── Area 8 — Lead Quality ─────────────────────────────────────────────────

// Tiny v1 rejection-reason classifier — keyword buckets. ML can come in SP6+.
function classifyRejection(notes) {
  const n = String(notes || '').toLowerCase();
  if (!n.trim()) return 'unspecified';
  if (/\bduplicate\b/.test(n)) return 'duplicate';
  if (/budget|afford|price|cost/.test(n)) return 'budget_mismatch';
  if (/\bcontact|reach|phone|wrong/.test(n)) return 'contact_invalid';
  if (/\binterest|cold|not.serious\b/.test(n)) return 'low_intent';
  if (/timeline|future|next year/.test(n)) return 'timeline';
  return 'other';
}

export async function getLeadQuality(orgId, params, user) {
  const { from, range } = parseRange(params?.range);
  const cacheKey = `dev:leadQuality:${orgId}:${range}`;

  return withCache(cacheKey, async () => {
    const devOrgId = toObjectId(orgId);
    const partnerships = await Partnership.find({ developerOrg: devOrgId, status: 'active' })
      .populate({ path: 'channelPartnerOrg', select: 'name' })
      .lean();
    const cpOrgIds = partnerships.map((p) => p.channelPartnerOrg?._id).filter(Boolean);
    const shadows = await ChannelPartner.find({
      organization: devOrgId,
      channelPartnerOrg: { $in: cpOrgIds },
    }).select('_id channelPartnerOrg firmName').lean();
    const shadowByOrg = new Map(shadows.map((s) => [s.channelPartnerOrg?.toString(), s]));

    const partners = [];
    for (const p of partnerships) {
      const cpOrgIdLocal = p.channelPartnerOrg?._id || p.channelPartnerOrg;
      const shadow = shadowByOrg.get(cpOrgIdLocal?.toString());
      if (!shadow) continue;

      const leadFilter = {
        organization: devOrgId,
        'channelPartnerAttribution.partners.channelPartner': shadow._id,
        ...(from ? { createdAt: { $gte: from } } : {}),
      };

      const leads = await Lead.find(leadFilter)
        .select('_id status channelPartnerAttribution proposedStatusChange sourceProspect')
        .lean();

      const totalSubmitted = leads.length;
      let accepted = 0, rejected = 0, proposalsSubmitted = 0, proposalsAccepted = 0;
      const rejectionBuckets = {};
      for (const l of leads) {
        if (l.status === 'pending') continue;
        if (l.channelPartnerAttribution?.status === 'rejected') {
          rejected++;
          // Best-effort: classify based on attribution note or proposal note.
          const note = (l.channelPartnerAttribution?.note || l.proposedStatusChange?.note || '');
          const bucket = classifyRejection(note);
          rejectionBuckets[bucket] = (rejectionBuckets[bucket] || 0) + 1;
        } else {
          accepted++;
        }
        if (l.proposedStatusChange?.status) proposalsSubmitted++;
      }
      // proposalsAccepted is approximated as accepted-proposal advances —
      // an exact count would require Interaction history; deferred.

      const acceptRate = safeDiv(accepted, accepted + rejected);
      const topRejectionReasons = Object.entries(rejectionBuckets)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 3)
        .map(([reason, count]) => ({ reason, count }));

      const duplicateFlagRate = round2(safeDiv(rejectionBuckets.duplicate || 0, totalSubmitted));
      const leadQualityScore = round2(
        0.6 * acceptRate +
        0.4 * (1 - duplicateFlagRate)
      );

      partners.push({
        partnershipId: p._id,
        channelPartnerOrg: { _id: cpOrgIdLocal, name: p.channelPartnerOrg?.name || shadow.firmName },
        channelPartnerShadowId: shadow._id,
        totalSubmitted,
        accepted,
        rejected,
        acceptRate: round2(acceptRate),
        topRejectionReasons,
        duplicateFlagRate,
        proposalsSubmitted,
        proposalsAccepted, // currently 0 (see comment above)
        leadQualityScore,
      });
    }

    partners.sort((a, b) => b.leadQualityScore - a.leadQualityScore);
    return { partners, generatedAt: new Date().toISOString(), range };
  });
}

export default { getChannelPartnerScorecard, getCommissionPayouts, getLeadQuality };
