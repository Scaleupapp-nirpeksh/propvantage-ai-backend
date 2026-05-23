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

// Areas 2–4 follow in subsequent commits (T2.2, T2.3, T2.4).
export default { getPipelineHealth };
