// File: controllers/peopleController.js
// Description: HTTP handlers for the People & Performance API (spec §12, §13).
//   All handlers operate on req.user (set by the `protect` middleware).
//   Access control is delegated to dashboardService.assertCanView — do NOT
//   duplicate guard logic here.
//
//   GET  /me              → getMe
//   GET  /member/:userId  → getMember
//   GET  /team            → getTeam
//   GET  /org             → getOrg
//
//   Admin (owner-only):
//   POST /admin/backfill   → runBackfill
//   POST /admin/seed-demo  → seedDemo
//   GET  /flags           → getFlags
//   GET  /targets/:userId → getTargets
//   PUT  /targets/:userId → setTargets
//   GET  /morale/team     → getMoraleTeam
//   GET  /morale/org      → getMoraleOrg
//
//   Reflection handlers live in controllers/reflectionController.js and are
//   mounted by peopleRoutes.js.

import asyncHandler from 'express-async-handler';
import mongoose from 'mongoose';
import {
  getMemberDashboard,
  getTeamDashboard,
  getOrgDashboard,
  assertCanView,
} from '../services/people/dashboardService.js';
import { detectFlags }         from '../services/people/redFlagService.js';
import { getOrSeedTarget, setTarget as setTargetSvc } from '../services/people/targetService.js';
import { isOwnerLevel, getSubtree } from '../services/people/hierarchyService.js';
import { resolveWindow }       from '../services/people/performanceSignalsService.js';
import MoraleSummary           from '../models/moraleSummaryModel.js';
import User                    from '../models/userModel.js';
import { backfillSnapshots }   from '../services/people/backfillService.js';
import { seedDemoPeopleData }  from '../services/people/demoSeedService.js';

// ─── RANGE PARSING ───────────────────────────────────────────────

/**
 * Parse `?from&to` (ISO dates) or `?range=this_week|last_week|last_2_weeks|this_month`
 * from an Express `req.query` into a `{ from: Date, to: Date }` object.
 *
 * Default: this month when no query params are provided.
 *
 * @param {object} query - req.query
 * @returns {{ from: Date, to: Date }}
 */
export function parseRange(query) {
  const now = new Date();

  if (query.from || query.to) {
    const from = new Date(query.from);
    const to   = new Date(query.to);
    if (isNaN(from.getTime()) || isNaN(to.getTime())) {
      const err = new Error('Invalid ?from or ?to date');
      err.statusCode = 400;
      throw err;
    }
    return { from, to };
  }

  const preset = query.range;

  if (preset === 'this_week') {
    const { periodStart, periodEnd } = resolveWindow('week', now);
    return { from: periodStart, to: periodEnd };
  }

  if (preset === 'last_week') {
    const lastWeekAnchor = new Date(now);
    lastWeekAnchor.setUTCDate(lastWeekAnchor.getUTCDate() - 7);
    const { periodStart, periodEnd } = resolveWindow('week', lastWeekAnchor);
    return { from: periodStart, to: periodEnd };
  }

  if (preset === 'last_2_weeks') {
    const twoWeeksAgo = new Date(now);
    twoWeeksAgo.setUTCDate(twoWeeksAgo.getUTCDate() - 14);
    // from = start of the week 2 weeks ago; to = now (inclusive of ongoing week)
    const { periodStart } = resolveWindow('week', twoWeeksAgo);
    return { from: periodStart, to: now };
  }

  // Default (also handles preset === 'this_month')
  const { periodStart, periodEnd } = resolveWindow('month', now);
  return { from: periodStart, to: periodEnd };
}

// ─── HANDLERS ────────────────────────────────────────────────────

/**
 * @desc    Return the authenticated user's own performance dashboard.
 * @route   GET /api/people/me
 * @access  Authenticated
 */
export const getMe = asyncHandler(async (req, res) => {
  const range = parseRange(req.query);
  const data  = await getMemberDashboard(req.user, req.user._id, range);
  res.json({ success: true, data });
});

/**
 * @desc    Return a specific member's performance dashboard (subtree-guarded).
 * @route   GET /api/people/member/:userId
 * @access  Authenticated (Head/Owner over their subtree, or self)
 */
export const getMember = asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const range = parseRange(req.query);
  const data  = await getMemberDashboard(req.user, userId, range);
  res.json({ success: true, data });
});

/**
 * @desc    Return the team dashboard for the authenticated Head.
 * @route   GET /api/people/team
 * @access  Head or Owner
 */
export const getTeam = asyncHandler(async (req, res) => {
  // Members (scope === 'self') have no team — guard per spec §12.
  const subtree = await getSubtree(req.user);
  if (subtree.scope === 'self') {
    res.status(403);
    throw new Error('Team dashboard is only available to Heads and the Owner');
  }
  const range = parseRange(req.query);
  const data  = await getTeamDashboard(req.user, range);
  res.json({ success: true, data });
});

/**
 * @desc    Return the org dashboard (Owner only).
 * @route   GET /api/people/org
 * @access  Owner
 */
export const getOrg = asyncHandler(async (req, res) => {
  if (!isOwnerLevel(req.user)) {
    res.status(403);
    throw new Error('Only the org owner may view the org dashboard');
  }
  const range = parseRange(req.query);
  const data  = await getOrgDashboard(req.user, range);
  res.json({ success: true, data });
});

/**
 * @desc    Return red-flags for the authenticated user or a subtree user.
 *          Query param `?userId=` to view another user (guarded). Defaults to self.
 * @route   GET /api/people/flags
 * @access  Authenticated
 */
export const getFlags = asyncHandler(async (req, res) => {
  let targetUser = req.user;

  if (req.query.userId) {
    await assertCanView(req.user, req.query.userId);
    targetUser = await User.findById(req.query.userId).lean();
    if (!targetUser) {
      res.status(404);
      throw new Error('User not found');
    }
  }

  const flags = await detectFlags(targetUser.organization, targetUser, new Date());
  res.json({ success: true, data: flags });
});

/**
 * @desc    Read the performance target for a user (subtree-guarded).
 * @route   GET /api/people/targets/:userId
 * @access  Authenticated (subtree-guarded)
 */
export const getTargets = asyncHandler(async (req, res) => {
  const { userId } = req.params;
  await assertCanView(req.user, userId);

  const { periodStart: monthStart } = resolveWindow('month', new Date());
  const target = await getOrSeedTarget(req.user.organization, userId, monthStart);
  res.json({ success: true, data: target });
});

/**
 * @desc    Set / override the performance target for a user.
 *          Guarded: actor must be the user's Head or the Owner.
 * @route   PUT /api/people/targets/:userId
 * @access  Head / Owner
 */
export const setTargets = asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const { periodStart: monthStart } = resolveWindow('month', new Date());

  // setTarget itself enforces the subtree guard — it will throw 403 if actor
  // is not strictly above the target user.
  const target = await setTargetSvc(req.user, userId, monthStart, req.body.targets || req.body);
  res.json({ success: true, data: target });
});

/**
 * @desc    Return the latest MoraleSummary for the caller's team.
 *          Requires the caller to be a Head (or Owner viewing any team).
 * @route   GET /api/people/morale/team
 * @access  Head / Owner
 */
export const getMoraleTeam = asyncHandler(async (req, res) => {
  // Owner or Head only — members have no team morale view
  const subtree = await getSubtree(req.user);
  if (subtree.scope === 'self') {
    res.status(403);
    throw new Error('Team morale is only available to Heads and the Owner');
  }

  // Optional ?headId= lets the Owner query any head's morale summary
  let headId = req.user._id;
  if (req.query.headId && isOwnerLevel(req.user)) {
    if (!mongoose.isValidObjectId(req.query.headId)) {
      res.status(400);
      throw new Error('Invalid headId: must be a valid ObjectId');
    }
    headId = new mongoose.Types.ObjectId(req.query.headId);
  }

  const summary = await MoraleSummary.findOne({
    organization: req.user.organization,
    scope: 'team',
    head: headId,
  })
    .sort({ isoWeek: -1 })
    .lean();

  res.json({ success: true, data: summary || null });
});

/**
 * @desc    Return the latest org-level MoraleSummary (Owner only).
 * @route   GET /api/people/morale/org
 * @access  Owner
 */
export const getMoraleOrg = asyncHandler(async (req, res) => {
  if (!isOwnerLevel(req.user)) {
    res.status(403);
    throw new Error('Only the org owner may view org-level morale');
  }

  const summary = await MoraleSummary.findOne({
    organization: req.user.organization,
    scope: 'org',
  })
    .sort({ isoWeek: -1 })
    .lean();

  res.json({ success: true, data: summary || null });
});

// ─── ADMIN HANDLERS ───────────────────────────────────────────────

/**
 * @desc    Backfill historical performance snapshots for all active org members.
 *          Safe to re-run; buildSnapshot upserts on unique {org,user,period,periodStart} key.
 * @route   POST /api/people/admin/backfill
 * @access  Owner only
 * @query   ?weeks=8   Number of prior ISO weeks to build (default 8)
 */
// Parse a `?weeks=` param into a sane bounded integer (guards NaN + runaway values).
const clampWeeks = (raw, fallback, max) => {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(n, max);
};

export const runBackfill = asyncHandler(async (req, res) => {
  if (!isOwnerLevel(req.user)) {
    res.status(403);
    throw new Error('Only the org owner may run the snapshot backfill');
  }

  const weeks = clampWeeks(req.query.weeks, 8, 52);
  const data  = await backfillSnapshots(req.user.organization, { weeks });
  res.json({ success: true, data });
});

/**
 * @desc    Seed demo-quality People & Performance data (reflections + interactions + morale).
 *          Idempotent: skips existing reflections and members with sufficient recent activity.
 * @route   POST /api/people/admin/seed-demo
 * @access  Owner only
 * @query   ?confirm=true  Required safety gate — prevents accidental invocation
 *          ?weeks=4       Number of prior ISO weeks to seed (default 4)
 */
export const seedDemo = asyncHandler(async (req, res) => {
  if (!isOwnerLevel(req.user)) {
    res.status(403);
    throw new Error('Only the org owner may seed demo data');
  }

  if (req.query.confirm !== 'true') {
    res.status(400);
    throw new Error(
      'Pass ?confirm=true to confirm seeding demo People & Performance data. ' +
      'This operation creates WeeklyReflections and Interactions for all active members.'
    );
  }

  const weeks = clampWeeks(req.query.weeks, 4, 12);
  const data  = await seedDemoPeopleData(req.user.organization, { weeks });
  res.json({ success: true, data });
});
