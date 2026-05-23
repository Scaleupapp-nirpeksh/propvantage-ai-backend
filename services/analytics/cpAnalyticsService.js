// File: services/analytics/cpAnalyticsService.js
// Description: SP5 — CP-side analytics for Areas 1–4 of the spec.
//   1. getPipelineHealth        — prospects, follow-ups, aging, activity heat
//   2. getCommissionOverview    — expected/received/outstanding, per-currency
//   3. getAgentPerformance      — per-agent KPIs + composite score (view_team)
//   4. getDeveloperPerformance  — per-developer KPIs + delta-vs-overall
//
//   All four functions:
//     • Are organisation-scoped (CP org via `orgId`).
//     • Apply CP Agent auto-narrowing via agentScopeMatch(user).
//     • Are wrapped with the 5-minute in-memory cache from _shared.
//     • Never call the LLM — they are pure analytics, standalone-useful.

import mongoose from 'mongoose';
import Prospect from '../../models/prospectModel.js';
import Partnership from '../../models/partnershipModel.js';
import User from '../../models/userModel.js';
import Organization from '../../models/organizationModel.js';
import ExternalDeveloper from '../../models/externalDeveloperModel.js';
import Lead from '../../models/leadModel.js';
import {
  parseRange, isCpAgent, agentScopeMatch, toObjectId, safeDiv, round2, withCache,
} from './_shared.js';

const TERMINAL_STATUSES = ['Booked', 'Lost', 'Unqualified'];
const FUNNEL_ORDER = [
  'New', 'Contacted', 'Qualified', 'Site Visit Scheduled',
  'Site Visit Completed', 'Negotiating', 'Booked',
];

// ─── Area 1 — Pipeline Health ───────────────────────────────────────────────

/**
 * Pipeline health for a CP organisation.
 *
 * @param {ObjectId|string} orgId — CP org id.
 * @param {Object} params — { range?, project? } (project filter not yet
 *   wired; reserved for future drill-through).
 * @param {Object} user — req.user (used for CP Agent narrowing).
 * @returns {Promise<{summary, breakdowns, series, generatedAt, range}>}
 */
export async function getPipelineHealth(orgId, params, user) {
  const { from, to, range } = parseRange(params?.range);
  const agentFilter = agentScopeMatch(user);
  const orgFilter = { organization: toObjectId(orgId), ...agentFilter };
  const cacheKey = `pipeline:${orgId}:${range}:${isCpAgent(user) ? user._id : 'org'}`;

  return withCache(cacheKey, async () => {
    const now = new Date();
    const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    const endOfWeek = new Date(endOfToday.getTime() + 6 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const heatFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // Single aggregation that emits all the counts via $facet.
    const [agg = {}] = await Prospect.aggregate([
      { $match: orgFilter },
      {
        $facet: {
          totals: [
            {
              $group: {
                _id: null,
                totalProspects: { $sum: 1 },
                activeProspects: {
                  $sum: { $cond: [{ $in: ['$status', TERMINAL_STATUSES] }, 0, 1] },
                },
                agingOver30d: {
                  $sum: {
                    $cond: [
                      {
                        $and: [
                          { $not: { $in: ['$status', TERMINAL_STATUSES] } },
                          { $lt: ['$updatedAt', thirtyDaysAgo] },
                        ],
                      },
                      1,
                      0,
                    ],
                  },
                },
              },
            },
          ],
          followUps: [
            {
              $match: {
                'followUp.nextDate': { $ne: null },
                status: { $nin: TERMINAL_STATUSES },
              },
            },
            {
              $group: {
                _id: null,
                followUpsDueToday: {
                  $sum: { $cond: [{ $lte: ['$followUp.nextDate', endOfToday] }, 1, 0] },
                },
                followUpsDueThisWeek: {
                  $sum: { $cond: [{ $lte: ['$followUp.nextDate', endOfWeek] }, 1, 0] },
                },
              },
            },
          ],
          activity: [
            { $unwind: { path: '$activities', preserveNullAndEmptyArrays: false } },
            {
              $group: {
                _id: null,
                activityVolume7d: {
                  $sum: { $cond: [{ $gte: ['$activities.at', sevenDaysAgo] }, 1, 0] },
                },
                activityVolume30d: {
                  $sum: { $cond: [{ $gte: ['$activities.at', thirtyDaysAgo] }, 1, 0] },
                },
              },
            },
          ],
          byStatus: [
            { $group: { _id: '$status', count: { $sum: 1 } } },
          ],
          aging: [
            { $match: { status: { $nin: TERMINAL_STATUSES } } },
            {
              $project: {
                status: 1,
                ageDays: {
                  $divide: [{ $subtract: [now, '$updatedAt'] }, 1000 * 60 * 60 * 24],
                },
              },
            },
            {
              $bucket: {
                groupBy: '$ageDays',
                boundaries: [0, 7, 14, 30, 60, 365],
                default: '365+',
                output: { count: { $sum: 1 } },
              },
            },
          ],
          activityHeat: [
            { $match: from ? { updatedAt: { $gte: heatFrom } } : {} },
            { $unwind: { path: '$activities', preserveNullAndEmptyArrays: false } },
            { $match: { 'activities.at': { $gte: heatFrom } } },
            {
              $group: {
                _id: {
                  $dateToString: { format: '%Y-%m-%d', date: '$activities.at', timezone: 'Asia/Kolkata' },
                },
                count: { $sum: 1 },
              },
            },
            { $project: { _id: 0, date: '$_id', count: 1 } },
            { $sort: { date: 1 } },
          ],
        },
      },
    ]);

    const totals = (agg.totals && agg.totals[0]) || { totalProspects: 0, activeProspects: 0, agingOver30d: 0 };
    const followUps = (agg.followUps && agg.followUps[0]) || { followUpsDueToday: 0, followUpsDueThisWeek: 0 };
    const activity = (agg.activity && agg.activity[0]) || { activityVolume7d: 0, activityVolume30d: 0 };

    const byStatusMap = Object.fromEntries((agg.byStatus || []).map((b) => [b._id, b.count]));
    const byStatus = Object.entries(byStatusMap).map(([status, count]) => ({ status, count }));
    const funnel = FUNNEL_ORDER.map((status) => ({ status, count: byStatusMap[status] || 0 }));

    return {
      summary: {
        totalProspects: totals.totalProspects,
        activeProspects: totals.activeProspects,
        followUpsDueToday: followUps.followUpsDueToday,
        followUpsDueThisWeek: followUps.followUpsDueThisWeek,
        agingOver30d: totals.agingOver30d,
        activityVolume7d: activity.activityVolume7d,
        activityVolume30d: activity.activityVolume30d,
      },
      breakdowns: {
        byStatus,
        funnel,
        aging: agg.aging || [],
      },
      series: {
        activityHeat: agg.activityHeat || [],
      },
      generatedAt: now.toISOString(),
      range,
    };
  });
}

// ─── Area 2 — Commission Overview ──────────────────────────────────────────

/**
 * Commission summary for a CP org. Per-currency rollup so INR + USD
 * deals are never conflated.
 *
 * @returns {Promise<{summary: {byCurrency: [{currency, expected, received,
 *   outstanding, writtenOff, realisationRate}]}, breakdowns: {byStatus,
 *   byDeveloper, byAgent?}, series: {byMonth: [{month, currency, received}]}}>}
 */
export async function getCommissionOverview(orgId, params, user) {
  const { range } = parseRange(params?.range);
  const agentFilter = agentScopeMatch(user);
  const orgFilter = { organization: toObjectId(orgId), ...agentFilter };
  const cacheKey = `commission:${orgId}:${range}:${isCpAgent(user) ? user._id : 'org'}`;

  return withCache(cacheKey, async () => {
    // 1. Per-currency summary (every prospect with a commissionAgreement contributes).
    const summaryAgg = await Prospect.aggregate([
      { $match: orgFilter },
      {
        $project: {
          currency: { $ifNull: ['$commissionAgreement.currency', 'INR'] },
          expectedAmount: { $ifNull: ['$commission.expectedAmount', 0] },
          paidAmount: {
            $sum: {
              $map: { input: { $ifNull: ['$commission.payments', []] }, as: 'p', in: '$$p.amount' },
            },
          },
          isWrittenOff: { $eq: ['$commission.status', 'written_off'] },
        },
      },
      {
        $group: {
          _id: '$currency',
          expected: { $sum: '$expectedAmount' },
          received: { $sum: '$paidAmount' },
          writtenOff: { $sum: { $cond: ['$isWrittenOff', '$expectedAmount', 0] } },
        },
      },
      {
        $project: {
          _id: 0,
          currency: '$_id',
          expected: 1,
          received: 1,
          writtenOff: 1,
          outstanding: { $subtract: ['$expected', '$received'] },
        },
      },
    ]);
    const byCurrency = summaryAgg.map((c) => ({
      ...c,
      expected: round2(c.expected),
      received: round2(c.received),
      writtenOff: round2(c.writtenOff),
      outstanding: round2(c.outstanding),
      realisationRate: round2(safeDiv(c.received, c.expected)),
    }));

    // 2. By status (counts across statuses; values aggregated per status).
    const byStatusAgg = await Prospect.aggregate([
      { $match: orgFilter },
      {
        $group: {
          _id: '$commission.status',
          count: { $sum: 1 },
          expected: { $sum: { $ifNull: ['$commission.expectedAmount', 0] } },
        },
      },
      { $project: { _id: 0, status: '$_id', count: 1, expected: { $round: ['$expected', 2] } } },
    ]);

    // 3. By developer (platform → Partnership.developerOrg.name; external →
    //    developerContext.externalDeveloper.name). Two pipelines combined.
    const byDeveloperPlatform = await Prospect.aggregate([
      { $match: { ...orgFilter, 'developerContext.type': 'platform' } },
      { $lookup: { from: 'partnerships', localField: 'developerContext.partnership', foreignField: '_id', as: 'p' } },
      { $unwind: { path: '$p', preserveNullAndEmptyArrays: true } },
      { $lookup: { from: 'organizations', localField: 'p.developerOrg', foreignField: '_id', as: 'devOrg' } },
      { $unwind: { path: '$devOrg', preserveNullAndEmptyArrays: true } },
      {
        $group: {
          _id: { devOrgId: '$devOrg._id', name: '$devOrg.name' },
          expected: { $sum: { $ifNull: ['$commission.expectedAmount', 0] } },
          received: { $sum: { $sum: { $map: { input: { $ifNull: ['$commission.payments', []] }, as: 'p', in: '$$p.amount' } } } },
          prospects: { $sum: 1 },
        },
      },
      {
        $project: {
          _id: 0,
          context: { $literal: 'platform' },
          developerId: '$_id.devOrgId',
          developerName: '$_id.name',
          expected: { $round: ['$expected', 2] },
          received: { $round: ['$received', 2] },
          prospects: 1,
        },
      },
    ]);
    const byDeveloperExternal = await Prospect.aggregate([
      { $match: { ...orgFilter, 'developerContext.type': 'external' } },
      { $lookup: { from: 'externaldevelopers', localField: 'developerContext.externalDeveloper', foreignField: '_id', as: 'x' } },
      { $unwind: { path: '$x', preserveNullAndEmptyArrays: true } },
      {
        $group: {
          _id: { xId: '$x._id', name: '$x.name' },
          expected: { $sum: { $ifNull: ['$commission.expectedAmount', 0] } },
          received: { $sum: { $sum: { $map: { input: { $ifNull: ['$commission.payments', []] }, as: 'p', in: '$$p.amount' } } } },
          prospects: { $sum: 1 },
        },
      },
      {
        $project: {
          _id: 0,
          context: { $literal: 'external' },
          developerId: '$_id.xId',
          developerName: '$_id.name',
          expected: { $round: ['$expected', 2] },
          received: { $round: ['$received', 2] },
          prospects: 1,
        },
      },
    ]);
    const byDeveloper = [...byDeveloperPlatform, ...byDeveloperExternal]
      .sort((a, b) => b.received - a.received);

    // 4. By agent (skip if CP Agent — they can only see their own).
    let byAgent = [];
    if (!isCpAgent(user)) {
      byAgent = await Prospect.aggregate([
        { $match: orgFilter },
        { $lookup: { from: 'users', localField: 'assignedAgent', foreignField: '_id', as: 'agent' } },
        { $unwind: { path: '$agent', preserveNullAndEmptyArrays: true } },
        {
          $group: {
            _id: { agentId: '$agent._id', firstName: '$agent.firstName', lastName: '$agent.lastName' },
            expected: { $sum: { $ifNull: ['$commission.expectedAmount', 0] } },
            received: { $sum: { $sum: { $map: { input: { $ifNull: ['$commission.payments', []] }, as: 'p', in: '$$p.amount' } } } },
            prospects: { $sum: 1 },
          },
        },
        {
          $project: {
            _id: 0,
            agentId: '$_id.agentId',
            agentName: {
              $trim: {
                input: { $concat: [{ $ifNull: ['$_id.firstName', ''] }, ' ', { $ifNull: ['$_id.lastName', ''] }] },
              },
            },
            expected: { $round: ['$expected', 2] },
            received: { $round: ['$received', 2] },
            prospects: 1,
          },
        },
        { $sort: { received: -1 } },
      ]);
    }

    // 5. Time-series — received commission, last 12 months, per currency.
    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);
    const byMonth = await Prospect.aggregate([
      { $match: orgFilter },
      { $unwind: { path: '$commission.payments', preserveNullAndEmptyArrays: false } },
      { $match: { 'commission.payments.receivedAt': { $gte: twelveMonthsAgo } } },
      {
        $project: {
          month: {
            $dateToString: { format: '%Y-%m', date: '$commission.payments.receivedAt', timezone: 'Asia/Kolkata' },
          },
          currency: { $ifNull: ['$commissionAgreement.currency', 'INR'] },
          amount: '$commission.payments.amount',
        },
      },
      {
        $group: {
          _id: { month: '$month', currency: '$currency' },
          received: { $sum: '$amount' },
        },
      },
      {
        $project: {
          _id: 0,
          month: '$_id.month',
          currency: '$_id.currency',
          received: { $round: ['$received', 2] },
        },
      },
      { $sort: { month: 1 } },
    ]);

    return {
      summary: { byCurrency },
      breakdowns: { byStatus: byStatusAgg, byDeveloper, byAgent },
      series: { byMonth },
      generatedAt: new Date().toISOString(),
      range,
    };
  });
}

// ─── Area 3 — Agent Performance ────────────────────────────────────────────

/**
 * Per-agent KPIs + composite score. Requires CP_ANALYTICS.VIEW_TEAM at the
 * route layer; we don't double-check here, but we do honour CP Agent self-only
 * narrowing as a defence-in-depth (a CP Agent calling this should only see
 * their own row even if route-gating fails).
 *
 * compositeScore = 0.4 * normalised(conversionRate)
 *                + 0.3 * normalised(activityVolume30d)
 *                + 0.3 * normalised(commissionGenerated)
 * Each component is min-max normalised across the agents returned in this call,
 * so the score is always 0..1.
 */
export async function getAgentPerformance(orgId, params, user) {
  const { range } = parseRange(params?.range);
  const agentFilter = agentScopeMatch(user);
  const orgFilter = { organization: toObjectId(orgId), ...agentFilter };
  const cacheKey = `agents:${orgId}:${range}:${isCpAgent(user) ? user._id : 'org'}`;

  return withCache(cacheKey, async () => {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const agents = await Prospect.aggregate([
      { $match: orgFilter },
      {
        $project: {
          assignedAgent: 1,
          status: 1,
          createdAt: 1,
          bookedAt: '$booking.bookedAt',
          expectedAmount: { $ifNull: ['$commission.expectedAmount', 0] },
          activityCount30d: {
            $size: {
              $filter: {
                input: { $ifNull: ['$activities', []] },
                as: 'a',
                cond: { $gte: ['$$a.at', thirtyDaysAgo] },
              },
            },
          },
        },
      },
      {
        $group: {
          _id: '$assignedAgent',
          prospectsActive: { $sum: { $cond: [{ $in: ['$status', TERMINAL_STATUSES] }, 0, 1] } },
          prospectsBooked: { $sum: { $cond: [{ $eq: ['$status', 'Booked'] }, 1, 0] } },
          totalProspects: { $sum: 1 },
          activityVolume30d: { $sum: '$activityCount30d' },
          commissionGenerated: { $sum: { $cond: [{ $eq: ['$status', 'Booked'] }, '$expectedAmount', 0] } },
          totalTimeToBookingDays: {
            $sum: {
              $cond: [
                { $and: [{ $eq: ['$status', 'Booked'] }, { $ne: ['$bookedAt', null] }] },
                { $divide: [{ $subtract: ['$bookedAt', '$createdAt'] }, 1000 * 60 * 60 * 24] },
                0,
              ],
            },
          },
        },
      },
      { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'agent' } },
      { $unwind: { path: '$agent', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: 0,
          userId: '$_id',
          name: {
            $trim: { input: { $concat: [{ $ifNull: ['$agent.firstName', ''] }, ' ', { $ifNull: ['$agent.lastName', ''] }] } },
          },
          prospectsActive: 1,
          prospectsBooked: 1,
          totalProspects: 1,
          conversionRate: { $cond: [{ $gt: ['$totalProspects', 0] }, { $divide: ['$prospectsBooked', '$totalProspects'] }, 0] },
          avgTimeToBookingDays: { $cond: [{ $gt: ['$prospectsBooked', 0] }, { $divide: ['$totalTimeToBookingDays', '$prospectsBooked'] }, 0] },
          activityVolume30d: 1,
          commissionGenerated: 1,
        },
      },
    ]);

    // Min-max normalisation for composite score.
    const norm = (vals) => {
      const min = Math.min(...vals), max = Math.max(...vals);
      const span = max - min;
      return (v) => (span > 0 ? (v - min) / span : 0);
    };
    if (agents.length > 0) {
      const normConv = norm(agents.map((a) => a.conversionRate));
      const normAct = norm(agents.map((a) => a.activityVolume30d));
      const normCom = norm(agents.map((a) => a.commissionGenerated));
      for (const a of agents) {
        a.compositeScore = round2(
          0.4 * normConv(a.conversionRate) +
          0.3 * normAct(a.activityVolume30d) +
          0.3 * normCom(a.commissionGenerated)
        );
        a.conversionRate = round2(a.conversionRate);
        a.avgTimeToBookingDays = round2(a.avgTimeToBookingDays);
        a.commissionGenerated = round2(a.commissionGenerated);
      }
      agents.sort((a, b) => b.compositeScore - a.compositeScore);
    }

    return { agents, generatedAt: new Date().toISOString(), range };
  });
}

// ─── Area 4 — Developer Performance ────────────────────────────────────────

/**
 * Per-developer KPIs + delta-vs-overall. Lists both 'external' and 'platform'
 * developers. Returns rows sorted by conversionRate DESC.
 */
export async function getDeveloperPerformance(orgId, params, user) {
  const { range } = parseRange(params?.range);
  const agentFilter = agentScopeMatch(user);
  const orgFilter = { organization: toObjectId(orgId), ...agentFilter };
  const cacheKey = `developers:${orgId}:${range}:${isCpAgent(user) ? user._id : 'org'}`;

  return withCache(cacheKey, async () => {
    // Overall org conversion rate — denominator for deltaVsOverall.
    const overallAgg = await Prospect.aggregate([
      { $match: orgFilter },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          booked: { $sum: { $cond: [{ $eq: ['$status', 'Booked'] }, 1, 0] } },
        },
      },
    ]);
    const overall = overallAgg[0] || { total: 0, booked: 0 };
    const overallConversion = safeDiv(overall.booked, overall.total);

    const baseProject = {
      status: 1,
      bookedAt: '$booking.bookedAt',
      createdAt: 1,
      expectedAmount: { $ifNull: ['$commission.expectedAmount', 0] },
      paidAmount: {
        $sum: { $map: { input: { $ifNull: ['$commission.payments', []] }, as: 'p', in: '$$p.amount' } },
      },
      pushedToLead: 1,
    };

    // Platform-context per-developer.
    const platform = await Prospect.aggregate([
      { $match: { ...orgFilter, 'developerContext.type': 'platform' } },
      { $project: { ...baseProject, partnership: '$developerContext.partnership' } },
      { $lookup: { from: 'partnerships', localField: 'partnership', foreignField: '_id', as: 'p' } },
      { $unwind: { path: '$p', preserveNullAndEmptyArrays: true } },
      { $lookup: { from: 'organizations', localField: 'p.developerOrg', foreignField: '_id', as: 'devOrg' } },
      { $unwind: { path: '$devOrg', preserveNullAndEmptyArrays: true } },
      {
        $group: {
          _id: { id: '$devOrg._id', name: '$devOrg.name' },
          prospects: { $sum: 1 },
          booked: { $sum: { $cond: [{ $eq: ['$status', 'Booked'] }, 1, 0] } },
          totalTimeToBookingDays: {
            $sum: {
              $cond: [
                { $and: [{ $eq: ['$status', 'Booked'] }, { $ne: ['$bookedAt', null] }] },
                { $divide: [{ $subtract: ['$bookedAt', '$createdAt'] }, 1000 * 60 * 60 * 24] },
                0,
              ],
            },
          },
          commissionRealised: { $sum: '$paidAmount' },
          pushed: { $sum: { $cond: [{ $ne: ['$pushedToLead', null] }, 1, 0] } },
        },
      },
      // For leadAcceptanceRate we'd join Leads. Skipped here for cost; the
      // ratio is approximated as bookings/pushed (acceptance ~ pushed and not
      // immediately rejected). True acceptance lookup deferred to T2.4-bis if
      // needed; the spec calls this a 'platform-only' field.
      {
        $project: {
          _id: 0,
          context: { $literal: 'platform' },
          id: '$_id.id',
          name: '$_id.name',
          prospects: 1,
          conversionRate: { $cond: [{ $gt: ['$prospects', 0] }, { $divide: ['$booked', '$prospects'] }, 0] },
          avgTimeToBookingDays: { $cond: [{ $gt: ['$booked', 0] }, { $divide: ['$totalTimeToBookingDays', '$booked'] }, 0] },
          commissionRealised: 1,
          leadAcceptanceRate: { $cond: [{ $gt: ['$pushed', 0] }, { $divide: ['$booked', '$pushed'] }, 0] },
        },
      },
    ]);

    // External-context per-developer.
    const external = await Prospect.aggregate([
      { $match: { ...orgFilter, 'developerContext.type': 'external' } },
      { $project: { ...baseProject, xId: '$developerContext.externalDeveloper' } },
      { $lookup: { from: 'externaldevelopers', localField: 'xId', foreignField: '_id', as: 'x' } },
      { $unwind: { path: '$x', preserveNullAndEmptyArrays: true } },
      {
        $group: {
          _id: { id: '$x._id', name: '$x.name' },
          prospects: { $sum: 1 },
          booked: { $sum: { $cond: [{ $eq: ['$status', 'Booked'] }, 1, 0] } },
          totalTimeToBookingDays: {
            $sum: {
              $cond: [
                { $and: [{ $eq: ['$status', 'Booked'] }, { $ne: ['$bookedAt', null] }] },
                { $divide: [{ $subtract: ['$bookedAt', '$createdAt'] }, 1000 * 60 * 60 * 24] },
                0,
              ],
            },
          },
          commissionRealised: { $sum: '$paidAmount' },
        },
      },
      {
        $project: {
          _id: 0,
          context: { $literal: 'external' },
          id: '$_id.id',
          name: '$_id.name',
          prospects: 1,
          conversionRate: { $cond: [{ $gt: ['$prospects', 0] }, { $divide: ['$booked', '$prospects'] }, 0] },
          avgTimeToBookingDays: { $cond: [{ $gt: ['$booked', 0] }, { $divide: ['$totalTimeToBookingDays', '$booked'] }, 0] },
          commissionRealised: 1,
          leadAcceptanceRate: { $literal: null }, // N/A for off-platform devs
        },
      },
    ]);

    const developers = [...platform, ...external].map((d) => ({
      ...d,
      conversionRate: round2(d.conversionRate),
      deltaVsOverall: round2(d.conversionRate - overallConversion),
      avgTimeToBookingDays: round2(d.avgTimeToBookingDays),
      commissionRealised: round2(d.commissionRealised),
      leadAcceptanceRate: d.leadAcceptanceRate == null ? null : round2(d.leadAcceptanceRate),
    }));
    developers.sort((a, b) => b.conversionRate - a.conversionRate);

    return {
      developers,
      overallConversion: round2(overallConversion),
      generatedAt: new Date().toISOString(),
      range,
    };
  });
}

export default {
  getPipelineHealth,
  getCommissionOverview,
  getAgentPerformance,
  getDeveloperPerformance,
};
