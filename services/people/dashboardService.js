// File: services/people/dashboardService.js
// Description: Aggregates data from Tasks 1–6 into the three dashboard shapes
//   (member, team, org) and provides the shared access-control guard used by
//   every People & Performance endpoint (spec §12, §13).
//
//   assertCanView(viewer, targetUserId)
//     Throws a 403-style Error if the viewer is not allowed to read targetUserId's data.
//     Allowed iff:
//       • viewer's scope === 'org'  (Owner — unrestricted)
//       • targetUserId is in viewer's subtree userIds  (Head viewing their team member)
//       • targetUserId === viewer._id  (self-view)
//
//   getMemberDashboard(viewer, userId, range)
//     Full scorecard for one member: live metrics, attainment, flags, trend,
//     vs-team-median, reflection status.
//
//   getTeamDashboard(head, range)
//     Roster of lightweight scorecards for each team member + rollup + medians.
//
//   getOrgDashboard(owner, range)
//     Roster of Head scorecards + org-level rollup.

import mongoose from 'mongoose';
import { getSubtree, getTeam, isOwnerLevel, HEAD_ROLE_BY_DEPARTMENT } from './hierarchyService.js';
import { computeMetrics, teamMedians, resolveWindow, METRIC_KEYS } from './performanceSignalsService.js';
import { getOrSeedTarget, computeAttainment } from './targetService.js';
import { detectFlags } from './redFlagService.js';
import { currentStatus } from './reflectionService.js';
import User from '../../models/userModel.js';

// ─── HELPERS ─────────────────────────────────────────────────────

function toObjectId(id) {
  if (id instanceof mongoose.Types.ObjectId) return id;
  return new mongoose.Types.ObjectId(String(id));
}

/**
 * Parse a client-supplied range object `{ from, to }` into validated Date instances.
 * Both must be valid dates and `from` must be <= `to`.
 *
 * @param {{ from: Date, to: Date }} range
 * @returns {{ from: Date, to: Date }}
 */
function validateRange(range) {
  const from = range.from instanceof Date ? range.from : new Date(range.from);
  const to   = range.to   instanceof Date ? range.to   : new Date(range.to);
  if (isNaN(from.getTime()) || isNaN(to.getTime())) {
    const err = new Error('Invalid date range');
    err.statusCode = 400;
    throw err;
  }
  if (from > to) {
    const err = new Error('range.from must be before range.to');
    err.statusCode = 400;
    throw err;
  }
  return { from, to };
}

/**
 * Compute the prior window of equal length immediately before `range`.
 * Used for trend comparison.
 *
 * @param {{ from: Date, to: Date }} range
 * @returns {{ from: Date, to: Date }}
 */
function priorWindow(range) {
  const lengthMs = range.to.getTime() - range.from.getTime();
  return {
    from: new Date(range.from.getTime() - lengthMs),
    to:   new Date(range.from.getTime()),
  };
}

/**
 * Compute a simple percentage-change trend for each metric key.
 * trend[key] = (current - prior) / prior  (null when prior is 0)
 *
 * @param {Record<string, number>} current
 * @param {Record<string, number>} prior
 * @returns {Record<string, number|null>}
 */
function computeTrend(current, prior) {
  const trend = {};
  for (const key of METRIC_KEYS) {
    const c = current[key] ?? 0;
    const p = prior[key]   ?? 0;
    trend[key] = p === 0 ? null : (c - p) / p;
  }
  return trend;
}

// ─── ZERO METRICS HELPER ─────────────────────────────────────────
function zeroMetrics() {
  return METRIC_KEYS.reduce((acc, k) => { acc[k] = 0; return acc; }, {});
}

// ─── COUNT FLAGS ─────────────────────────────────────────────────
function countFlags(flags) {
  if (!flags) return 0;
  return (flags.staleLeads?.count      ?? 0)
       + (flags.noMovementLeads?.count ?? 0)
       + (flags.overdueFollowUps?.count ?? 0)
       + (flags.overdueTasks?.count    ?? 0)
       + (flags.agingPipeline?.count   ?? 0)
       + (flags.lowActivity?.count     ?? 0);
}

// =============================================================================
// assertCanView
// =============================================================================

/**
 * Guard: throw a 403-style error if `viewer` is not allowed to read `targetUserId`'s data.
 *
 * Allowed when ANY of:
 *   • viewer's scope === 'org'  (owner — unrestricted, owns _everyone_ incl. themselves)
 *   • targetUserId equals viewer._id  (self-view always allowed)
 *   • targetUserId is in viewer's subtree userIds
 *
 * @param {object} viewer - authenticated User doc
 * @param {mongoose.Types.ObjectId|string} targetUserId
 * @throws {Error} 403-style error with statusCode = 403
 */
export async function assertCanView(viewer, targetUserId) {
  const targetId = toObjectId(targetUserId);
  const viewerId = toObjectId(viewer._id);

  // Self-view is always allowed
  if (targetId.equals(viewerId)) return;

  const subtree = await getSubtree(viewer);

  if (subtree.scope === 'org') return; // Owner — unrestricted

  const inSubtree = subtree.userIds.some((uid) => uid.equals(targetId));
  if (!inSubtree) {
    const err = new Error('Access denied: user is not in your subtree');
    err.statusCode = 403;
    throw err;
  }
}

// =============================================================================
// getMemberDashboard
// =============================================================================

/**
 * Full scorecard for one member.
 *
 * @param {object} viewer     - authenticated User doc (may be same as target for self-view)
 * @param {mongoose.Types.ObjectId|string} userId  - target member's id
 * @param {{ from: Date, to: Date }} range
 * @returns {Promise<object>}
 */
export async function getMemberDashboard(viewer, userId, range) {
  await assertCanView(viewer, userId);

  const { from, to } = validateRange(range);
  const targetId = toObjectId(userId);

  // Fetch the target user
  const targetUser = await User.findById(targetId)
    .select('-password')
    .populate('roleRef', 'name slug level isOwnerRole')
    .lean();

  if (!targetUser) {
    const err = new Error('User not found');
    err.statusCode = 404;
    throw err;
  }

  const orgId = targetUser.organization;

  // Determine the month bucket for target seeding (use start of range month)
  const { periodStart: monthStart } = resolveWindow('month', from);

  // Run live metric computation, target seeding, flag detection, and prior-window
  // metrics in parallel for performance.
  const [metrics, targetDoc, flags, priorMetrics, medians, reflStatus] = await Promise.all([
    computeMetrics(targetUser, from, to),
    getOrSeedTarget(orgId, targetId, monthStart),
    detectFlags(orgId, targetUser, new Date()),
    // Trend: compute metrics over the equal-length prior window
    (async () => {
      const pw = priorWindow({ from, to });
      return computeMetrics(targetUser, pw.from, pw.to);
    })(),
    // vs team median — use the 'month' period resolved from range start
    teamMedians(orgId, targetUser, 'month', from),
    currentStatus(targetUser),
  ]);

  const attainment = computeAttainment(metrics, targetDoc);
  const trend      = computeTrend(metrics, priorMetrics);

  // vsTeamMedian: delta percentage vs median for each metric
  const vsTeamMedian = {};
  for (const key of METRIC_KEYS) {
    const actual = metrics[key] ?? 0;
    const median = medians[key] ?? 0;
    vsTeamMedian[key] = median === 0 ? null : (actual - median) / median;
  }

  return {
    user: {
      _id:          targetUser._id,
      firstName:    targetUser.firstName,
      lastName:     targetUser.lastName,
      email:        targetUser.email,
      role:         targetUser.role,
      lastActiveAt: targetUser.lastActiveAt ?? null,
    },
    range: { from, to },
    metrics,
    attainment,
    trend,
    vsTeamMedian,
    flags,
    flagCount:       countFlags(flags),
    reflectionStatus: reflStatus,
  };
}

// =============================================================================
// getTeamDashboard
// =============================================================================

/**
 * Team roster of lightweight scorecards for each member of a Head's team,
 * plus an aggregate rollup and the team medians.
 *
 * @param {object} head  - the Head user doc
 * @param {{ from: Date, to: Date }} range
 * @returns {Promise<{ members: object[], rollup: object, medians: object }>}
 */
export async function getTeamDashboard(head, range) {
  const { from, to } = validateRange(range);

  const teamMembers = await getTeam(head);

  const { periodStart: monthStart } = resolveWindow('month', from);
  const medians = await teamMedians(head.organization, head, 'month', from);

  // Build scorecard for each member in parallel
  const members = await Promise.all(
    teamMembers.map(async (member) => {
      const [metrics, targetDoc, flags, reflStatus] = await Promise.all([
        computeMetrics(member, from, to),
        getOrSeedTarget(member.organization, member._id, monthStart),
        detectFlags(member.organization, member, new Date()),
        currentStatus(member),
      ]);

      const attainment = computeAttainment(metrics, targetDoc);

      return {
        user: {
          _id:          member._id,
          firstName:    member.firstName,
          lastName:     member.lastName,
          email:        member.email,
          role:         member.role,
          lastActiveAt: member.lastActiveAt ?? null,
        },
        metrics,
        attainment,
        flagCount:     countFlags(flags),
        reflectionIn:  reflStatus.status === 'submitted',
      };
    })
  );

  // Org-level rollup: sum metrics across all team members
  const rollup = zeroMetrics();
  for (const scorecard of members) {
    for (const key of METRIC_KEYS) {
      rollup[key] += scorecard.metrics[key] ?? 0;
    }
  }
  // Rate metrics are not summable — replace with team median
  rollup.conversionRate  = medians.conversionRate  ?? 0;
  rollup.taskSlaRate     = medians.taskSlaRate      ?? 0;

  return { members, rollup, medians };
}

// =============================================================================
// getOrgDashboard
// =============================================================================

// Rate metrics that must NOT be summed — use median instead
const RATE_METRIC_KEYS = new Set(['conversionRate', 'taskSlaRate', 'ticketAvgResolutionHrs']);

/**
 * Organization-level dashboard: one scorecard per department Head (users whose
 * role is one of the head roles, excluding 'Business Head') plus an org-wide
 * rollup.
 *
 * Each head entry includes:
 *   - user:       the head's basic profile fields
 *   - metrics:    the head's OWN metrics for the period
 *   - attainment: computed against the head's target
 *   - teamSize:   number of members in the head's team
 *   - teamRollup: aggregate of the team's metrics
 *
 * orgRollup sums additive metrics across all teamRollups and uses global
 * teamMedians (owner as head) for rate metrics.
 *
 * @param {object} owner  - the Owner user doc
 * @param {{ from: Date, to: Date }} range
 * @returns {Promise<{ heads: object[], orgRollup: object }>}
 */
export async function getOrgDashboard(owner, range) {
  if (!isOwnerLevel(owner)) {
    const err = new Error('Only the org owner may view the org dashboard');
    err.statusCode = 403;
    throw err;
  }

  const { from, to } = validateRange(range);
  const { periodStart: monthStart } = resolveWindow('month', from);
  const orgId = owner.organization;

  // ── 1. Fetch department head users ──────────────────────────────
  const HEAD_ROLES_LIST = Object.values(HEAD_ROLE_BY_DEPARTMENT).filter(
    (r) => r !== 'Business Head',
  );
  const headUsers = await User.find({
    organization: orgId,
    role: { $in: HEAD_ROLES_LIST },
    isActive: true,
    invitationStatus: 'accepted',
  }).lean();

  // ── 2. Build per-head scorecard (parallel across heads) ──────────
  const heads = await Promise.all(
    headUsers.map(async (head) => {
      // a) Head's own metrics + target
      const [metrics, targetDoc, teamMembers, medians] = await Promise.all([
        computeMetrics(head, from, to),
        getOrSeedTarget(orgId, head._id, monthStart),
        getTeam(head),
        teamMedians(orgId, head, 'month', from),
      ]);

      const attainment = computeAttainment(metrics, targetDoc);

      // b) Team member metrics (parallel within the head's team)
      const memberMetrics = await Promise.all(
        teamMembers.map((member) => computeMetrics(member, from, to)),
      );

      // c) Build teamRollup — sum additive metrics; use medians for rates
      const teamRollup = zeroMetrics();
      for (const mMetrics of memberMetrics) {
        for (const key of METRIC_KEYS) {
          if (!RATE_METRIC_KEYS.has(key)) {
            teamRollup[key] += mMetrics[key] ?? 0;
          }
        }
      }
      // Replace rate metrics with team medians
      teamRollup.conversionRate         = medians.conversionRate         ?? 0;
      teamRollup.taskSlaRate            = medians.taskSlaRate            ?? 0;
      teamRollup.ticketAvgResolutionHrs = medians.ticketAvgResolutionHrs ?? 0;

      const teamSize = teamMembers.length;
      teamRollup.teamSize = teamSize;

      return {
        user: {
          _id:          head._id,
          firstName:    head.firstName,
          lastName:     head.lastName,
          email:        head.email,
          role:         head.role,
          lastActiveAt: head.lastActiveAt ?? null,
        },
        metrics,
        attainment,
        teamSize,
        teamRollup,
      };
    }),
  );

  // ── 3. Build orgRollup ───────────────────────────────────────────
  // Sum additive metrics from all teamRollups; use global teamMedians for rates.
  const globalMedians = await teamMedians(orgId, owner, 'month', from);

  const orgRollup = zeroMetrics();
  for (const headEntry of heads) {
    for (const key of METRIC_KEYS) {
      if (!RATE_METRIC_KEYS.has(key)) {
        orgRollup[key] += headEntry.teamRollup[key] ?? 0;
      }
    }
  }
  orgRollup.conversionRate         = globalMedians.conversionRate         ?? 0;
  orgRollup.taskSlaRate            = globalMedians.taskSlaRate            ?? 0;
  orgRollup.ticketAvgResolutionHrs = globalMedians.ticketAvgResolutionHrs ?? 0;

  // ── 4. Build flat members roster (all active org members) ────────
  const allActiveMembers = await User.find({
    organization: orgId,
    isActive:     true,
    invitationStatus: 'accepted',
  }).lean();

  const members = await Promise.all(
    allActiveMembers.map(async (member) => {
      const [metrics, targetDoc, flags] = await Promise.all([
        computeMetrics(member, from, to),
        getOrSeedTarget(orgId, member._id, monthStart),
        detectFlags(orgId, member, new Date()),
      ]);
      const attainment = computeAttainment(metrics, targetDoc);
      return {
        user: {
          _id:          member._id,
          firstName:    member.firstName,
          lastName:     member.lastName,
          email:        member.email,
          role:         member.role,
          lastActiveAt: member.lastActiveAt ?? null,
        },
        metrics,
        attainment,
        flagCount: countFlags(flags),
      };
    }),
  );

  return { heads, orgRollup, members };
}

export default { assertCanView, getMemberDashboard, getTeamDashboard, getOrgDashboard };
