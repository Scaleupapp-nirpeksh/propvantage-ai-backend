// File: jobs/nightlyPerformanceSnapshot.js
// Description: node-cron — nightly performance snapshot job (spec §15).
//   Per org → per active member: build the PREVIOUS full day's snapshot and
//   refresh the in-progress week + month buckets. Idempotent via the
//   PerformanceSnapshot unique index {organization,user,period,periodStart}
//   (buildSnapshot upserts), so a re-run overwrites in place.
//
//   Registration mirrors jobs/generateScheduledReports.js: the work function
//   (runNightlySnapshots) is exported separately from the cron registration
//   (registerNightlyPerformanceSnapshotJob). Registration is ONLY invoked from
//   server.js inside httpServer.listen — never on import — so importing this
//   module in tests has no scheduling side effect.

import cron from 'node-cron';
import User from '../models/userModel.js';
import PerformanceSnapshot from '../models/performanceSnapshotModel.js';
import { buildSnapshot, resolveWindow } from '../services/people/performanceSignalsService.js';
import { detectFlags, sendDigests } from '../services/people/redFlagService.js';

// Default: 01:30 IST (20:00 UTC the previous day). The previous full calendar
// day is settled by the time this fires.
const SNAPSHOT_CRON = process.env.PERF_SNAPSHOT_CRON || '0 20 * * *';
const TZ = process.env.INSIGHT_DEFAULT_TIMEZONE || 'Asia/Kolkata';

/**
 * Build snapshots for every active user in every org, then detect red-flags
 * and persist them onto each user's current-day snapshot, and finally send
 * the per-member self-nudge and per-manager digest notifications.
 *
 * Red-flag detection is the SINGLE source of truth for `redFlags` on a
 * PerformanceSnapshot — detectFlags() from redFlagService is always called
 * here; performanceSignalsService never writes redFlags on its own.
 *
 * @param {Date} [now=new Date()] - reference "now"; the day snapshot targets
 *   the calendar day BEFORE this.
 * @returns {Promise<{orgs:number,users:number,snapshots:number,failed:Array,digests:object}>}
 */
export async function runNightlySnapshots(now = new Date()) {
  // Previous full day (anchor inside yesterday's bucket).
  const previousDay = new Date(now);
  previousDay.setUTCDate(previousDay.getUTCDate() - 1);

  const summary = { orgs: 0, users: 0, snapshots: 0, failed: [], digests: {} };

  // Active members only (invitation accepted + active flag) — spec §15.
  const activeUsers = await User.find({
    isActive: true,
    invitationStatus: 'accepted',
  })
    .select('_id organization role roleRef firstName lastName')
    .lean();

  const seenOrgs = new Set();

  for (const user of activeUsers) {
    if (!user.organization) continue;
    seenOrgs.add(String(user.organization));
    summary.users++;

    // (period, anchor) pairs: previous day + current week + current month.
    const jobs = [
      ['day', previousDay],
      ['week', now],
      ['month', now],
    ];

    for (const [period, anchor] of jobs) {
      try {
        await buildSnapshot(user.organization, user, period, anchor);
        summary.snapshots++;
      } catch (err) {
        summary.failed.push({
          user: String(user._id),
          period,
          error: err.message,
        });
      }
    }

    // ── Detect red-flags for this user (asOf = previousDay) ────────────
    // Persist counts onto the current-day snapshot.  Best-effort: a failure
    // here must not abort the rest of the job.
    try {
      const flags = await detectFlags(user.organization, user, previousDay);

      // Resolve the day snapshot's periodStart so we can target the exact row.
      const { periodStart: dayStart } = resolveWindow('day', previousDay);

      await PerformanceSnapshot.findOneAndUpdate(
        {
          organization: user.organization,
          user: user._id,
          period: 'day',
          periodStart: dayStart,
        },
        {
          $set: {
            'redFlags.staleLeads':       flags.staleLeads.count,
            'redFlags.noMovementLeads':  flags.noMovementLeads.count,
            'redFlags.overdueFollowUps': flags.overdueFollowUps.count,
            'redFlags.overdueTasks':     flags.overdueTasks.count,
            'redFlags.agingPipeline':    flags.agingPipeline.count,
            'redFlags.lowActivity':      flags.lowActivity.count,
          },
        },
        { new: true }
      );
    } catch (err) {
      summary.failed.push({
        user: String(user._id),
        period: 'redFlags',
        error: err.message,
      });
    }
  }

  summary.orgs = seenOrgs.size;

  // ── Send self-nudges + manager digests per org ──────────────────────
  // Done once per org after all user snapshots are written.
  for (const orgId of seenOrgs) {
    try {
      const result = await sendDigests(orgId, previousDay);
      summary.digests[orgId] = result;
    } catch (err) {
      summary.failed.push({ org: orgId, period: 'digests', error: err.message });
    }
  }

  console.log('[nightlyPerformanceSnapshot]', JSON.stringify(summary));
  return summary;
}

/**
 * Register the nightly cron. Call ONCE from server startup (httpServer.listen),
 * never on import — node-cron only fires at the scheduled time.
 */
export function registerNightlyPerformanceSnapshotJob() {
  cron.schedule(
    SNAPSHOT_CRON,
    () => {
      runNightlySnapshots().catch((err) =>
        console.error('[nightlyPerformanceSnapshot] fatal:', err.message)
      );
    },
    { timezone: TZ }
  );
  console.log(
    `[nightlyPerformanceSnapshot] cron registered (cron='${SNAPSHOT_CRON}', tz='${TZ}')`
  );
}

export default { registerNightlyPerformanceSnapshotJob, runNightlySnapshots };
