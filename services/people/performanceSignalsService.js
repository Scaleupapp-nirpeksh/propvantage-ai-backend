// File: services/people/performanceSignalsService.js
// Description: One source of truth for per-user performance metrics (spec §6/§7).
//   Used by BOTH the nightly snapshot job (materialized history) and live
//   dashboard reads (current in-progress day). Given (user, periodStart,
//   periodEnd) it returns the metrics object; buildSnapshot upserts it as a
//   PerformanceSnapshot row; teamMedians rolls a head's team into a per-metric
//   median for "vs team" comparison.
//
//   Metric → source (spec §7):
//     leadsWorked / leadsConverted / conversionRate → Lead (assignedTo, statusHistory, status=Booked)
//     salesCount / salesValue                       → Sale (salesPerson, bookingDate, status ≠ Cancelled)
//     tasksCompleted / tasksOverdue / taskSlaRate   → Task (assignedTo, completedAt, dueDate, sla)
//     ticketsResolved / ticketAvgResolutionHrs      → SupportTicket (assignee, status, closedAt, createdAt)
//     interactionsLogged                            → Interaction (user, createdAt)
//
//   Money (salesValue) is a raw number.

import mongoose from 'mongoose';
import Lead from '../../models/leadModel.js';
import Sale from '../../models/salesModel.js';
import Task from '../../models/taskModel.js';
import SupportTicket from '../../models/supportTicketModel.js';
import Interaction from '../../models/interactionModel.js';
import PerformanceSnapshot from '../../models/performanceSnapshotModel.js';
import { getTeam } from './hierarchyService.js';

// ─── METRIC KEYS ─────────────────────────────────────────────────
// Canonical ordered list — used to zero-fill and to drive teamMedians.
export const METRIC_KEYS = [
  'leadsWorked',
  'leadsConverted',
  'conversionRate',
  'salesCount',
  'salesValue',
  'tasksCompleted',
  'tasksOverdue',
  'taskSlaRate',
  'ticketsResolved',
  'ticketAvgResolutionHrs',
  'interactionsLogged',
];

const ZERO_METRICS = () =>
  METRIC_KEYS.reduce((acc, k) => {
    acc[k] = 0;
    return acc;
  }, {});

// ─── PERIOD WINDOWS ──────────────────────────────────────────────
// day   = the calendar day of periodStart [00:00, next 00:00)
// week  = the ISO week (Mon 00:00 .. next Mon 00:00) containing periodStart
// month = the calendar month of periodStart [1st 00:00, next-month 1st 00:00)
// All in UTC for determinism (snapshots are machine artefacts, not display).

function startOfDay(d) {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}

function startOfIsoWeek(d) {
  const x = startOfDay(d);
  // getUTCDay: 0=Sun..6=Sat → ISO Monday is the start. Shift Sun(0) to 7.
  const dow = x.getUTCDay() || 7;
  x.setUTCDate(x.getUTCDate() - (dow - 1));
  return x;
}

function startOfMonth(d) {
  const x = new Date(d);
  return new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), 1, 0, 0, 0, 0));
}

/**
 * Resolve the [periodStart, periodEnd) window for a given period + anchor date.
 * periodStart is normalized to the start of the bucket; periodEnd is exclusive.
 * @param {'day'|'week'|'month'} period
 * @param {Date} anchor - any date within the desired bucket
 * @returns {{ periodStart: Date, periodEnd: Date }}
 */
export function resolveWindow(period, anchor) {
  if (period === 'day') {
    const periodStart = startOfDay(anchor);
    const periodEnd = new Date(periodStart);
    periodEnd.setUTCDate(periodEnd.getUTCDate() + 1);
    return { periodStart, periodEnd };
  }
  if (period === 'week') {
    const periodStart = startOfIsoWeek(anchor);
    const periodEnd = new Date(periodStart);
    periodEnd.setUTCDate(periodEnd.getUTCDate() + 7);
    return { periodStart, periodEnd };
  }
  if (period === 'month') {
    const periodStart = startOfMonth(anchor);
    const periodEnd = new Date(
      Date.UTC(periodStart.getUTCFullYear(), periodStart.getUTCMonth() + 1, 1, 0, 0, 0, 0)
    );
    return { periodStart, periodEnd };
  }
  throw new Error(`Unknown period: ${period}`);
}

// ─── HELPERS ─────────────────────────────────────────────────────
function toObjectId(id) {
  if (id instanceof mongoose.Types.ObjectId) return id;
  return new mongoose.Types.ObjectId(id);
}

function round(n, dp = 4) {
  if (!Number.isFinite(n)) return 0;
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

/** Median of a numeric array. Even count → average of the two middle values. */
export function median(values) {
  const nums = (values || []).filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (nums.length === 0) return 0;
  const mid = Math.floor(nums.length / 2);
  if (nums.length % 2 === 1) return nums[mid];
  return (nums[mid - 1] + nums[mid]) / 2;
}

// ─── computeMetrics ──────────────────────────────────────────────
/**
 * Compute the full metrics object for a user over [periodStart, periodEnd).
 * Pure read — touches Lead/Sale/Task/SupportTicket/Interaction. Both the
 * nightly job and live dashboard reads call this (one source of truth).
 *
 * @param {object} user - user doc (uses _id and organization)
 * @param {Date} periodStart - inclusive window start
 * @param {Date} periodEnd - exclusive window end
 * @returns {Promise<object>} metrics keyed by METRIC_KEYS
 */
export async function computeMetrics(user, periodStart, periodEnd) {
  const userId = toObjectId(user._id);
  const orgId = user.organization ? toObjectId(user.organization) : undefined;
  const metrics = ZERO_METRICS();

  // ── Leads (assignedTo within window) ──────────────────────────
  // leadsWorked: leads assigned to the user whose status moved within the
  //   window (statusHistory.changedAt) OR were created in the window.
  // leadsConverted: of those, status === 'Booked' with a Booked statusHistory
  //   entry inside the window.
  const leadMatch = { assignedTo: userId };
  if (orgId) leadMatch.organization = orgId;

  const leadAgg = await Lead.aggregate([
    { $match: leadMatch },
    {
      $project: {
        status: 1,
        worked: {
          $or: [
            // created within window
            {
              $and: [
                { $gte: ['$createdAt', periodStart] },
                { $lt: ['$createdAt', periodEnd] },
              ],
            },
            // any status change within window
            {
              $gt: [
                {
                  $size: {
                    $filter: {
                      input: { $ifNull: ['$statusHistory', []] },
                      as: 'h',
                      cond: {
                        $and: [
                          { $gte: ['$$h.changedAt', periodStart] },
                          { $lt: ['$$h.changedAt', periodEnd] },
                        ],
                      },
                    },
                  },
                },
                0,
              ],
            },
          ],
        },
        convertedInWindow: {
          $gt: [
            {
              $size: {
                $filter: {
                  input: { $ifNull: ['$statusHistory', []] },
                  as: 'h',
                  cond: {
                    $and: [
                      { $eq: ['$$h.status', 'Booked'] },
                      { $gte: ['$$h.changedAt', periodStart] },
                      { $lt: ['$$h.changedAt', periodEnd] },
                    ],
                  },
                },
              },
            },
            0,
          ],
        },
      },
    },
    {
      $group: {
        _id: null,
        leadsWorked: { $sum: { $cond: ['$worked', 1, 0] } },
        leadsConverted: { $sum: { $cond: ['$convertedInWindow', 1, 0] } },
      },
    },
  ]);

  if (leadAgg.length) {
    metrics.leadsWorked = leadAgg[0].leadsWorked || 0;
    metrics.leadsConverted = leadAgg[0].leadsConverted || 0;
  }
  metrics.conversionRate =
    metrics.leadsWorked > 0
      ? round(metrics.leadsConverted / metrics.leadsWorked)
      : 0;

  // ── Sales (salesPerson, bookingDate in window, status ≠ Cancelled) ──
  const saleMatch = {
    salesPerson: userId,
    status: { $ne: 'Cancelled' },
    bookingDate: { $gte: periodStart, $lt: periodEnd },
  };
  if (orgId) saleMatch.organization = orgId;

  const saleAgg = await Sale.aggregate([
    { $match: saleMatch },
    {
      $group: {
        _id: null,
        salesCount: { $sum: 1 },
        salesValue: { $sum: '$salePrice' },
      },
    },
  ]);
  if (saleAgg.length) {
    metrics.salesCount = saleAgg[0].salesCount || 0;
    metrics.salesValue = saleAgg[0].salesValue || 0;
  }

  // ── Tasks (assignedTo) ────────────────────────────────────────
  // tasksCompleted: status Completed with completedAt in window.
  // tasksOverdue: due within window and either flagged sla.isOverdue or past
  //   due and not completed.
  // taskSlaRate: completed-on-time / completed (in window). On-time =
  //   completed and not overdue.
  const taskMatch = { assignedTo: userId };
  if (orgId) taskMatch.organization = orgId;

  const taskAgg = await Task.aggregate([
    { $match: taskMatch },
    {
      $project: {
        completedInWindow: {
          $and: [
            { $eq: ['$status', 'Completed'] },
            { $ne: ['$completedAt', null] },
            { $gte: ['$completedAt', periodStart] },
            { $lt: ['$completedAt', periodEnd] },
          ],
        },
        overdueInWindow: {
          $and: [
            { $ne: ['$dueDate', null] },
            { $gte: ['$dueDate', periodStart] },
            { $lt: ['$dueDate', periodEnd] },
            { $eq: [{ $ifNull: ['$sla.isOverdue', false] }, true] },
          ],
        },
        onTime: { $ifNull: ['$sla.isOverdue', false] },
      },
    },
    {
      $group: {
        _id: null,
        tasksCompleted: { $sum: { $cond: ['$completedInWindow', 1, 0] } },
        tasksOverdue: { $sum: { $cond: ['$overdueInWindow', 1, 0] } },
        completedOnTime: {
          $sum: {
            $cond: [
              { $and: ['$completedInWindow', { $eq: ['$onTime', false] }] },
              1,
              0,
            ],
          },
        },
      },
    },
  ]);
  if (taskAgg.length) {
    metrics.tasksCompleted = taskAgg[0].tasksCompleted || 0;
    metrics.tasksOverdue = taskAgg[0].tasksOverdue || 0;
    metrics.taskSlaRate =
      metrics.tasksCompleted > 0
        ? round((taskAgg[0].completedOnTime || 0) / metrics.tasksCompleted)
        : 0;
  }

  // ── Support tickets (assignee, resolved/closed, closedAt in window) ──
  const ticketMatch = {
    assignee: userId,
    status: { $in: ['resolved', 'closed'] },
    closedAt: { $gte: periodStart, $lt: periodEnd },
  };
  if (orgId) ticketMatch.organization = orgId;

  const ticketAgg = await SupportTicket.aggregate([
    { $match: ticketMatch },
    {
      $group: {
        _id: null,
        ticketsResolved: { $sum: 1 },
        totalResolutionHrs: {
          $sum: {
            $divide: [{ $subtract: ['$closedAt', '$createdAt'] }, 1000 * 60 * 60],
          },
        },
      },
    },
  ]);
  if (ticketAgg.length) {
    metrics.ticketsResolved = ticketAgg[0].ticketsResolved || 0;
    metrics.ticketAvgResolutionHrs =
      metrics.ticketsResolved > 0
        ? round((ticketAgg[0].totalResolutionHrs || 0) / metrics.ticketsResolved, 2)
        : 0;
  }

  // ── Interactions (user, createdAt in window) ──────────────────
  const interactionMatch = {
    user: userId,
    createdAt: { $gte: periodStart, $lt: periodEnd },
  };
  if (orgId) interactionMatch.organization = orgId;
  metrics.interactionsLogged = await Interaction.countDocuments(interactionMatch);

  return metrics;
}

// ─── buildSnapshot ───────────────────────────────────────────────
/**
 * Compute + upsert a PerformanceSnapshot for (orgId, user, period, periodStart).
 * Idempotent: keyed on the unique index {organization,user,period,periodStart}
 * so re-running the job overwrites the same row in place.
 *
 * @param {mongoose.Types.ObjectId|string} orgId
 * @param {object} user - user doc (must have _id)
 * @param {'day'|'week'|'month'} period
 * @param {Date} periodStart - any date within the bucket (normalized internally)
 * @returns {Promise<object>} the upserted snapshot doc
 */
export async function buildSnapshot(orgId, user, period, periodStart) {
  const { periodStart: start, periodEnd } = resolveWindow(period, periodStart);
  const org = toObjectId(orgId);
  const userId = toObjectId(user._id);

  const metrics = await computeMetrics(
    { _id: userId, organization: org },
    start,
    periodEnd
  );

  return PerformanceSnapshot.findOneAndUpdate(
    { organization: org, user: userId, period, periodStart: start },
    {
      $set: {
        organization: org,
        user: userId,
        period,
        periodStart: start,
        periodEnd,
        metrics,
        computedAt: new Date(),
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

// ─── teamMedians ─────────────────────────────────────────────────
/**
 * Median of each metric across a head's team for the given period bucket.
 * Reads the team's already-materialized snapshots (one per member) and folds
 * them into a per-metric median for "vs team" comparison on scorecards.
 *
 * @param {mongoose.Types.ObjectId|string} orgId
 * @param {object} headUser - the Head (or Owner) whose team to roll up
 * @param {'day'|'week'|'month'} period
 * @param {Date} periodStart - any date within the bucket (normalized internally)
 * @returns {Promise<Record<string, number>>} metric → median
 */
export async function teamMedians(orgId, headUser, period, periodStart) {
  const { periodStart: start } = resolveWindow(period, periodStart);
  const org = toObjectId(orgId);

  const team = await getTeam(headUser);
  const memberIds = team.map((m) => toObjectId(m._id));

  const result = METRIC_KEYS.reduce((acc, k) => {
    acc[k] = 0;
    return acc;
  }, {});

  if (memberIds.length === 0) return result;

  const snapshots = await PerformanceSnapshot.find({
    organization: org,
    user: { $in: memberIds },
    period,
    periodStart: start,
  }).lean();

  if (snapshots.length === 0) return result;

  for (const key of METRIC_KEYS) {
    const values = snapshots.map((s) => (s.metrics ? s.metrics[key] : 0) || 0);
    result[key] = median(values);
  }

  return result;
}

export default {
  METRIC_KEYS,
  resolveWindow,
  median,
  computeMetrics,
  buildSnapshot,
  teamMedians,
};
