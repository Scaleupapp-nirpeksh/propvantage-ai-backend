// File: services/people/redFlagService.js
// Description: Red-flag detection engine for the People & Performance module (spec §8).
//
//   detectFlags(orgId, user, asOf) — evaluate every red-flag dimension for one
//     active member as-of a reference date and return counts + entity IDs.
//
//   sendDigests(orgId, asOf) — for every active member with ≥1 flag:
//     • send the member a perf_redflag_self nudge;
//     • group flagged members by their DIRECT manager and send each manager ONE
//       perf_redflag_digest summarising their flagged direct-reports.
//
//   Thresholds come from config/redFlagThresholds.js (DEFAULT_THRESHOLDS) —
//   an org-level override object can be spread over the defaults in the future.
//
//   BOUNDARY CONVENTION (all checks use strict >):
//     "stale if lastInteractionDate > staleLeadDays ago"
//   i.e. a lead interacted with exactly staleLeadDays days ago is NOT stale;
//   one interacted with staleLeadDays+1 or more days ago IS stale.
//   The same strict-greater-than convention applies to every day-count threshold.

import mongoose from 'mongoose';
import Lead from '../../models/leadModel.js';
import Task from '../../models/taskModel.js';
import Interaction from '../../models/interactionModel.js';
import User from '../../models/userModel.js';
import { createNotification } from '../notificationService.js';
import { getManagerChain } from './hierarchyService.js';
import { DEFAULT_THRESHOLDS } from '../../config/redFlagThresholds.js';

// ─── CONSTANTS ────────────────────────────────────────────────────

/**
 * Terminal lead statuses — leads in these states are NOT "open".
 * Derived from the Lead schema enum: ['pending','New','Qualified',
 * 'Site Visit Completed','Negotiating','Booked','Lost','Revived'].
 * Terminal = Booked, Lost.  'pending' is the CP intake queue — also
 * excluded from "open" because it hasn't been accepted into the pipeline yet.
 */
const TERMINAL_LEAD_STATUSES = ['Booked', 'Lost', 'pending'];

/** Task statuses that mean the task is done / cancelled (not overdue). */
const TASK_DONE_STATUSES = ['Completed', 'Cancelled'];

// ─── HELPERS ─────────────────────────────────────────────────────

function toObjectId(id) {
  if (id instanceof mongoose.Types.ObjectId) return id;
  return new mongoose.Types.ObjectId(String(id));
}

/**
 * Return a Date that is `days` days before `asOf` (UTC midnight boundary kept
 * because we compare against stored Date fields which may have time components).
 * Pure arithmetic — no timezone adjustment needed for thresholds.
 */
function daysBeforeAsOf(asOf, days) {
  return new Date(asOf.getTime() - days * 24 * 60 * 60 * 1000);
}

// ─── detectFlags ─────────────────────────────────────────────────

/**
 * Detect all red-flag dimensions for a single user as of a reference date.
 *
 * @param {mongoose.Types.ObjectId|string} orgId
 * @param {object} user - user doc (must have _id)
 * @param {Date} asOf - reference "now" (nightly job passes previousDay)
 * @param {object} [thresholdOverrides] - optional partial threshold overrides
 * @returns {Promise<{
 *   staleLeads:       { count: number, items: string[] },
 *   noMovementLeads:  { count: number, items: string[] },
 *   overdueFollowUps: { count: number, items: string[] },
 *   overdueTasks:     { count: number, items: string[] },
 *   agingPipeline:    { count: number, items: string[] },
 *   lowActivity:      { count: number, items: string[] },
 * }>}
 */
export async function detectFlags(orgId, user, asOf, thresholdOverrides = {}) {
  const t = { ...DEFAULT_THRESHOLDS, ...thresholdOverrides };
  const userId = toObjectId(user._id);
  const org = toObjectId(orgId);
  const now = asOf instanceof Date ? asOf : new Date(asOf);

  // ── Cutoff dates (all strict-greater-than comparisons) ─────────
  const staleCutoff         = daysBeforeAsOf(now, t.staleLeadDays);
  const noMovementCutoff    = daysBeforeAsOf(now, t.noMovementDays);
  const followUpCutoff      = daysBeforeAsOf(now, t.followUpOverdueDays);
  const agingCutoff         = daysBeforeAsOf(now, t.agingPipelineDays);
  const activityWindowStart = daysBeforeAsOf(now, t.lowActivityWindowDays);

  // Base filter: leads assigned to this user in this org, open status only.
  const openLeadFilter = {
    organization: org,
    assignedTo: userId,
    status: { $nin: TERMINAL_LEAD_STATUSES },
  };

  // Run all DB queries in parallel.
  const [
    staleLeadDocs,
    noMovementLeadDocs,
    overdueFollowUpDocs,
    overdueTaskDocs,
    agingLeadDocs,
    recentInteractionCount,
  ] = await Promise.all([
    // staleLeads: open leads where lastInteractionDate is strictly older than cutoff
    // (null lastInteractionDate also counts as stale — the lead was never interacted with)
    Lead.find({
      ...openLeadFilter,
      $or: [
        { 'engagementMetrics.lastInteractionDate': { $lt: staleCutoff } },
        { 'engagementMetrics.lastInteractionDate': { $exists: false } },
        { 'engagementMetrics.lastInteractionDate': null },
      ],
    })
      .select('_id')
      .lean(),

    // noMovementLeads: open leads where statusChangedAt is strictly older than cutoff
    Lead.find({
      ...openLeadFilter,
      statusChangedAt: { $lt: noMovementCutoff },
    })
      .select('_id')
      .lean(),

    // overdueFollowUps: any lead (open or otherwise) with nextFollowUpDate strictly past the cutoff
    Lead.find({
      organization: org,
      assignedTo: userId,
      'followUpSchedule.nextFollowUpDate': { $lt: followUpCutoff },
    })
      .select('_id')
      .lean(),

    // overdueTasks: tasks past dueDate, not completed/cancelled
    Task.find({
      organization: org,
      assignedTo: userId,
      status: { $nin: TASK_DONE_STATUSES },
      dueDate: { $lt: now },
    })
      .select('_id')
      .lean(),

    // agingPipeline: open leads created strictly before the aging cutoff
    Lead.find({
      ...openLeadFilter,
      createdAt: { $lt: agingCutoff },
    })
      .select('_id')
      .lean(),

    // lowActivity: count interactions for this user in the rolling window
    Interaction.countDocuments({
      organization: org,
      user: userId,
      createdAt: { $gte: activityWindowStart },
    }),
  ]);

  // lowActivity is a single count-based flag: 0 or 1.
  const isLowActivity = recentInteractionCount < t.lowActivityMinInteractions;

  return {
    staleLeads: {
      count: staleLeadDocs.length,
      items: staleLeadDocs.map((d) => String(d._id)),
    },
    noMovementLeads: {
      count: noMovementLeadDocs.length,
      items: noMovementLeadDocs.map((d) => String(d._id)),
    },
    overdueFollowUps: {
      count: overdueFollowUpDocs.length,
      items: overdueFollowUpDocs.map((d) => String(d._id)),
    },
    overdueTasks: {
      count: overdueTaskDocs.length,
      items: overdueTaskDocs.map((d) => String(d._id)),
    },
    agingPipeline: {
      count: agingLeadDocs.length,
      items: agingLeadDocs.map((d) => String(d._id)),
    },
    lowActivity: {
      count: isLowActivity ? 1 : 0,
      items: [],
    },
  };
}

// ─── sendDigests ─────────────────────────────────────────────────

/**
 * Compute flags for every active member in the org, send self-nudges to
 * flagged members, and send one digest notification per direct manager for
 * each manager who has ≥1 flagged direct-report.
 *
 * @param {mongoose.Types.ObjectId|string} orgId
 * @param {Date} asOf - reference "now"
 * @param {object} [thresholdOverrides] - optional partial threshold overrides
 * @returns {Promise<{ selfNudges: number, digests: number }>}
 */
export async function sendDigests(orgId, asOf, thresholdOverrides = {}) {
  const org = toObjectId(orgId);
  const now = asOf instanceof Date ? asOf : new Date(asOf);

  // Load all active members for this org.
  const members = await User.find({
    organization: org,
    isActive: true,
    invitationStatus: 'accepted',
  })
    .select('_id organization role roleRef firstName lastName')
    .lean();

  if (members.length === 0) return { selfNudges: 0, digests: 0 };

  // Detect flags for every member in parallel.
  const flagResults = await Promise.all(
    members.map((member) =>
      detectFlags(org, member, now, thresholdOverrides).then((flags) => ({
        member,
        flags,
      }))
    )
  );

  // Split into flagged vs unflagged.
  const flaggedMembers = flagResults.filter(({ flags }) => totalFlagCount(flags) > 0);

  let selfNudges = 0;
  let digests = 0;

  // ── 1. Self-nudge per flagged member ─────────────────────────
  await Promise.all(
    flaggedMembers.map(async ({ member, flags }) => {
      const total = totalFlagCount(flags);
      const lines = buildFlagSummaryLines(flags);
      const result = await createNotification({
        organization: org,
        recipient: member._id,
        type: 'perf_redflag_self',
        title: `${total} performance flag${total > 1 ? 's' : ''} need your attention`,
        message: `Your dashboard has ${total} open flag${total > 1 ? 's' : ''}: ${lines.join('; ')}.`,
        actionUrl: '/people/me',
        priority: 'high',
        metadata: { flags: serializeFlags(flags), asOf: now.toISOString() },
      });
      if (result) selfNudges++;
    })
  );

  // ── 2. Digest per direct manager ────────────────────────────
  // Group flagged members by their direct manager (getManagerChain[0]).
  // If a member has no manager (e.g. owner-level), skip the digest for that member.
  const managerMap = new Map(); // managerId → [{ member, flags }, ...]

  await Promise.all(
    flaggedMembers.map(async ({ member, flags }) => {
      const chain = await getManagerChain(member);
      if (!chain || chain.length === 0) return; // no direct manager
      const directManager = chain[0];
      const key = String(directManager._id);
      if (!managerMap.has(key)) {
        managerMap.set(key, { manager: directManager, reports: [] });
      }
      managerMap.get(key).reports.push({ member, flags });
    })
  );

  // Send one digest per manager.
  await Promise.all(
    Array.from(managerMap.values()).map(async ({ manager, reports }) => {
      const reportLines = reports.map(({ member, flags }) => {
        const name = memberDisplayName(member);
        const total = totalFlagCount(flags);
        return `${name}: ${total} flag${total > 1 ? 's' : ''}`;
      });

      const totalFlagged = reports.length;
      const result = await createNotification({
        organization: org,
        recipient: manager._id,
        type: 'perf_redflag_digest',
        title: `${totalFlagged} team member${totalFlagged > 1 ? 's' : ''} have performance flags`,
        message: `Daily performance digest — ${reportLines.join('; ')}.`,
        actionUrl: '/people/team',
        priority: 'high',
        metadata: {
          flaggedMemberCount: totalFlagged,
          reports: reports.map(({ member, flags }) => ({
            userId: String(member._id),
            name: memberDisplayName(member),
            flags: serializeFlags(flags),
          })),
          asOf: now.toISOString(),
        },
      });
      if (result) digests++;
    })
  );

  return { selfNudges, digests };
}

// ─── PRIVATE HELPERS ─────────────────────────────────────────────

/** Sum all flag counts for a detectFlags result. */
function totalFlagCount(flags) {
  return (
    flags.staleLeads.count +
    flags.noMovementLeads.count +
    flags.overdueFollowUps.count +
    flags.overdueTasks.count +
    flags.agingPipeline.count +
    flags.lowActivity.count
  );
}

/** Build short human-readable lines for each active flag type. */
function buildFlagSummaryLines(flags) {
  const lines = [];
  if (flags.staleLeads.count > 0)
    lines.push(`${flags.staleLeads.count} stale lead${flags.staleLeads.count > 1 ? 's' : ''}`);
  if (flags.noMovementLeads.count > 0)
    lines.push(`${flags.noMovementLeads.count} lead${flags.noMovementLeads.count > 1 ? 's' : ''} with no movement`);
  if (flags.overdueFollowUps.count > 0)
    lines.push(`${flags.overdueFollowUps.count} overdue follow-up${flags.overdueFollowUps.count > 1 ? 's' : ''}`);
  if (flags.overdueTasks.count > 0)
    lines.push(`${flags.overdueTasks.count} overdue task${flags.overdueTasks.count > 1 ? 's' : ''}`);
  if (flags.agingPipeline.count > 0)
    lines.push(`${flags.agingPipeline.count} aging pipeline lead${flags.agingPipeline.count > 1 ? 's' : ''}`);
  if (flags.lowActivity.count > 0)
    lines.push('low activity this week');
  return lines;
}

/** Serialize flags to a plain object for notification metadata. */
function serializeFlags(flags) {
  return {
    staleLeads: flags.staleLeads.count,
    noMovementLeads: flags.noMovementLeads.count,
    overdueFollowUps: flags.overdueFollowUps.count,
    overdueTasks: flags.overdueTasks.count,
    agingPipeline: flags.agingPipeline.count,
    lowActivity: flags.lowActivity.count,
  };
}

/** Format a user's display name. */
function memberDisplayName(member) {
  const first = member.firstName || '';
  const last = member.lastName || '';
  return `${first} ${last}`.trim() || String(member._id);
}

export default { detectFlags, sendDigests };
