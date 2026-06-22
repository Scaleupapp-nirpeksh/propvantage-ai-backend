// File: jobs/generateMoraleSummaries.js
// Description: node-cron — weekly morale summary generation job (spec §15).
//   Fires Monday morning; processes the PRIOR ISO week.
//   Per org:
//     1. For each Head (via HEAD_ROLE_BY_DEPARTMENT) → buildTeamMorale
//     2. buildOrgMorale
//     3. Emit 'morale_summary_ready' to each Head and to the Owner
//     4. Emit 'reflection_overdue' to members who did NOT submit last week
//
//   Registration pattern mirrors jobs/nightlyPerformanceSnapshot.js:
//   the work function (runMoraleSummaries) is exported separately from
//   the registration function (registerMoraleSummariesJob).
//   NEVER fires on import — only when cron fires or manually called.

import cron from 'node-cron';
import Organization from '../models/organizationModel.js';
import User from '../models/userModel.js';
import WeeklyReflection from '../models/weeklyReflectionModel.js';
import { HEAD_ROLE_BY_DEPARTMENT } from '../services/people/hierarchyService.js';
import { buildTeamMorale, buildOrgMorale } from '../services/people/moraleService.js';
import { createNotification } from '../services/notificationService.js';

// Monday 06:30 IST (01:00 UTC). Covers the prior ISO week (Mon–Sun).
const MORALE_CRON = process.env.MORALE_SUMMARY_CRON || '0 1 * * 1';
const TZ = process.env.INSIGHT_DEFAULT_TIMEZONE || 'Asia/Kolkata';

// =============================================================================
// ISO-WEEK HELPERS (self-contained to avoid circular dep on reflectionService)
// =============================================================================

function isoWeekOfDate(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dow = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dow);
  const year = d.getUTCFullYear();
  const jan1 = new Date(Date.UTC(year, 0, 1));
  const jan1dow = jan1.getUTCDay() || 7;
  const firstThursday = new Date(Date.UTC(year, 0, 1 + (4 - jan1dow + 7) % 7));
  const diff = d - firstThursday;
  const weekNum = Math.round(diff / (7 * 86400000)) + 1;
  return `${year}-W${String(weekNum).padStart(2, '0')}`;
}

/**
 * Return the isoWeek string for the week prior to `isoWeek`.
 */
function previousIsoWeek(isoWeek) {
  const m = isoWeek.match(/^(\d{4})-W(\d{2})$/);
  if (!m) throw new Error(`Invalid isoWeek: ${isoWeek}`);
  const year = parseInt(m[1], 10);
  const week = parseInt(m[2], 10);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4dow = jan4.getUTCDay() || 7;
  const week1Mon = new Date(jan4.getTime() - (jan4dow - 1) * 86400000);
  const weekStart = new Date(week1Mon.getTime() + (week - 1) * 7 * 86400000);
  const dayInPrevWeek = new Date(weekStart.getTime() - 86400000);
  return isoWeekOfDate(dayInPrevWeek);
}

// =============================================================================
// MAIN JOB FUNCTION
// =============================================================================

/**
 * Generate morale summaries for all orgs for the prior ISO week.
 *
 * @param {Date} [now=new Date()] - reference "now"; the prior week is computed from this.
 * @returns {Promise<{orgs:number,teams:number,failed:Array}>}
 */
export async function runMoraleSummaries(now = new Date()) {
  const currentWeek = isoWeekOfDate(now);
  const priorWeek   = previousIsoWeek(currentWeek);

  const summary = { orgs: 0, teams: 0, failed: [] };

  // Head roles we need to look up (excludes 'Business Head' — that's the owner tier)
  const headRoles = Object.values(HEAD_ROLE_BY_DEPARTMENT).filter(
    (r) => r !== 'Business Head'
  );

  // Fetch all orgs
  let orgs;
  try {
    orgs = await Organization.find({}).select('_id name').lean();
  } catch (err) {
    console.error('[generateMoraleSummaries] Failed to fetch orgs:', err.message);
    return summary;
  }

  for (const org of orgs) {
    const orgId = org._id;
    summary.orgs++;

    // ── 1. Team morale per Head ──────────────────────────────────────────
    for (const headRole of headRoles) {
      let headUsers;
      try {
        headUsers = await User.find({
          organization: orgId,
          role: headRole,
          isActive: true,
        }).lean();
      } catch (err) {
        summary.failed.push({ org: String(orgId), headRole, error: err.message });
        continue;
      }

      for (const headUser of headUsers) {
        try {
          const moraleSummaryDoc = await buildTeamMorale(orgId, headUser, priorWeek);
          summary.teams++;

          // Notify the Head
          await createNotification({
            organization: orgId,
            recipient: headUser._id,
            type: 'morale_summary_ready',
            title: 'Team Morale Summary Ready',
            message: `Your team's morale summary for ${priorWeek} is now available.`,
            actionUrl: '/people/team#morale',
            relatedEntity: {
              entityType: 'MoraleSummary',
              entityId: moraleSummaryDoc._id,
              displayLabel: `Team Morale ${priorWeek}`,
            },
            priority: 'medium',
          }).catch((e) => console.error('[generateMoraleSummaries] notification error:', e.message));
        } catch (err) {
          summary.failed.push({
            org:      String(orgId),
            headRole,
            headUser: String(headUser._id),
            step:     'buildTeamMorale',
            error:    err.message,
          });
        }
      }
    }

    // ── 2. Org morale ────────────────────────────────────────────────────
    let orgMoraleDoc;
    try {
      orgMoraleDoc = await buildOrgMorale(orgId, priorWeek);
    } catch (err) {
      summary.failed.push({ org: String(orgId), step: 'buildOrgMorale', error: err.message });
      orgMoraleDoc = null;
    }

    // ── 3. Notify the Owner(s) ───────────────────────────────────────────
    if (orgMoraleDoc) {
      try {
        const owners = await User.find({
          organization: orgId,
          $or: [{ role: 'Business Head' }, { isOwner: true }],
          isActive: true,
        }).lean();

        for (const owner of owners) {
          await createNotification({
            organization: orgId,
            recipient: owner._id,
            type: 'morale_summary_ready',
            title: 'Organisation Morale Summary Ready',
            message: `The organisation morale summary for ${priorWeek} is now available.`,
            actionUrl: '/people/org#morale',
            relatedEntity: {
              entityType: 'MoraleSummary',
              entityId: orgMoraleDoc._id,
              displayLabel: `Org Morale ${priorWeek}`,
            },
            priority: 'medium',
          }).catch((e) =>
            console.error('[generateMoraleSummaries] owner notification error:', e.message)
          );
        }
      } catch (err) {
        summary.failed.push({ org: String(orgId), step: 'ownerNotify', error: err.message });
      }
    }

    // ── 4. reflection_overdue — members who didn't submit last week ──────
    try {
      const activeMembers = await User.find({
        organization: orgId,
        isActive: true,
        invitationStatus: 'accepted',
      })
        .select('_id role')
        .lean();

      for (const member of activeMembers) {
        try {
          const submitted = await WeeklyReflection.findOne({
            organization: orgId,
            user: member._id,
            isoWeek: priorWeek,
            status: 'submitted',
          }).lean();

          if (!submitted) {
            await createNotification({
              organization: orgId,
              recipient: member._id,
              type: 'reflection_overdue',
              title: 'Weekly Reflection Overdue',
              message: `Your reflection for ${priorWeek} was not submitted. Please catch up when possible.`,
              actionUrl: '/people/me#reflection',
              priority: 'medium',
            }).catch((e) =>
              console.error('[generateMoraleSummaries] overdue notification error:', e.message)
            );
          }
        } catch (err) {
          summary.failed.push({
            org:    String(orgId),
            user:   String(member._id),
            step:   'reflection_overdue',
            error:  err.message,
          });
        }
      }
    } catch (err) {
      summary.failed.push({ org: String(orgId), step: 'overdueCheck', error: err.message });
    }
  }

  console.log('[generateMoraleSummaries]', JSON.stringify(summary));
  return summary;
}

// =============================================================================
// CRON REGISTRATION
// =============================================================================

/**
 * Register the weekly morale cron.
 * Call ONCE from server startup (httpServer.listen), never on import.
 */
export function registerMoraleSummariesJob() {
  cron.schedule(
    MORALE_CRON,
    () => {
      runMoraleSummaries().catch((err) =>
        console.error('[generateMoraleSummaries] fatal:', err.message)
      );
    },
    { timezone: TZ }
  );
  console.log(
    `[generateMoraleSummaries] cron registered (cron='${MORALE_CRON}', tz='${TZ}')`
  );
}

export default { registerMoraleSummariesJob, runMoraleSummaries };
