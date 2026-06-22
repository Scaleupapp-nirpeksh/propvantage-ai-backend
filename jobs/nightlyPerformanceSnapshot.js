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
import { buildSnapshot } from '../services/people/performanceSignalsService.js';

// Default: 01:30 IST (20:00 UTC the previous day). The previous full calendar
// day is settled by the time this fires.
const SNAPSHOT_CRON = process.env.PERF_SNAPSHOT_CRON || '0 20 * * *';
const TZ = process.env.INSIGHT_DEFAULT_TIMEZONE || 'Asia/Kolkata';

/**
 * Build snapshots for every active user in every org.
 * For each user: previous-day `day` snapshot + current `week` + `month`.
 *
 * @param {Date} [now=new Date()] - reference "now"; the day snapshot targets
 *   the calendar day BEFORE this.
 * @returns {Promise<{orgs:number,users:number,snapshots:number,failed:Array}>}
 */
export async function runNightlySnapshots(now = new Date()) {
  // Previous full day (anchor inside yesterday's bucket).
  const previousDay = new Date(now);
  previousDay.setUTCDate(previousDay.getUTCDate() - 1);

  const summary = { orgs: 0, users: 0, snapshots: 0, failed: [] };

  // Active members only (invitation accepted + active flag) — spec §15.
  const activeUsers = await User.find({
    isActive: true,
    invitationStatus: 'accepted',
  })
    .select('_id organization')
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
  }

  summary.orgs = seenOrgs.size;
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
