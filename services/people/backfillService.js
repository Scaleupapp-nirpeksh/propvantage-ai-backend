// File: services/people/backfillService.js
// Description: Owner-only admin operation to backfill historical performance
//   snapshots for all active org members.
//
//   backfillSnapshots(orgId, { weeks = 8 }) -> { built, users }
//
//   For each active accepted member:
//     - weekly snapshot for each of the last `weeks` ISO weeks
//     - monthly snapshot for each of the last 3 months
//     - current day, week, and month snapshots
//
//   buildSnapshot already upserts on {organization,user,period,periodStart}
//   so this function is safe to re-run (idempotent).

import User from '../../models/userModel.js';
import { buildSnapshot, resolveWindow } from './performanceSignalsService.js';
import {
  isoWeekOf,
  weekStartOf,
  previousIsoWeek,
  boundsFromIsoWeek,
} from '../../utils/isoWeek.js';

/**
 * Backfill performance snapshots for all active members in an org.
 *
 * @param {import('mongoose').Types.ObjectId|string} orgId
 * @param {{ weeks?: number }} [options]
 * @returns {Promise<{ built: number, users: number }>}
 */
export async function backfillSnapshots(orgId, { weeks = 8 } = {}) {
  const members = await User.find({
    organization:     orgId,
    isActive:         true,
    invitationStatus: 'accepted',
  }).lean();

  if (members.length === 0) {
    return { built: 0, users: 0 };
  }

  const now = new Date();
  let built = 0;

  // ── Past weekly anchors (Mondays of each prior ISO week) ──────────────────
  const weeklyAnchors = [];
  let isoWeek = isoWeekOf(now);
  for (let i = 0; i < weeks; i++) {
    isoWeek = previousIsoWeek(isoWeek);
    const { weekStart } = boundsFromIsoWeek(isoWeek);
    weeklyAnchors.push(weekStart);
  }

  // ── Past monthly anchors (1st of each of the last 3 calendar months) ──────
  const monthlyAnchors = [];
  for (let i = 1; i <= 3; i++) {
    const anchor = new Date(now);
    anchor.setUTCMonth(anchor.getUTCMonth() - i);
    const { periodStart } = resolveWindow('month', anchor);
    monthlyAnchors.push(periodStart);
  }

  // ── Current-period anchors ─────────────────────────────────────────────────
  const { periodStart: currentDayStart }   = resolveWindow('day',   now);
  const currentWeekStart                   = weekStartOf(now);
  const { periodStart: currentMonthStart } = resolveWindow('month', now);

  // ── Per-user snapshot loop ─────────────────────────────────────────────────
  for (const user of members) {
    // Prior weekly snapshots
    for (const anchor of weeklyAnchors) {
      await buildSnapshot(orgId, user, 'week', anchor);
      built++;
    }

    // Prior monthly snapshots
    for (const anchor of monthlyAnchors) {
      await buildSnapshot(orgId, user, 'month', anchor);
      built++;
    }

    // Current day
    await buildSnapshot(orgId, user, 'day',   currentDayStart);
    built++;

    // Current week
    await buildSnapshot(orgId, user, 'week',  currentWeekStart);
    built++;

    // Current month
    await buildSnapshot(orgId, user, 'month', currentMonthStart);
    built++;
  }

  return { built, users: members.length };
}
