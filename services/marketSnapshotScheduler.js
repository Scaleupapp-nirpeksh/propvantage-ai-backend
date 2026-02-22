// File: services/marketSnapshotScheduler.js
// Description: Weekly cron job for automated market snapshot generation.
// Generates snapshots for all actively tracked localities in each organization.

import CompetitorProject from '../models/competitorProjectModel.js';
import { generateSnapshot } from './competitiveDataService.js';

let schedulerInterval = null;

/**
 * Run snapshot generation for all orgs and their tracked localities.
 */
const runSnapshotGeneration = async () => {
  console.log('[Snapshot Scheduler] Starting weekly snapshot generation...');

  try {
    // Get all distinct org + locality combos
    const localities = await CompetitorProject.aggregate([
      { $match: { isActive: true } },
      {
        $group: {
          _id: {
            organization: '$organization',
            city: '$location.city',
            area: '$location.area',
          },
          count: { $sum: 1 },
        },
      },
    ]);

    console.log(
      `[Snapshot Scheduler] Found ${localities.length} locality groups to snapshot`
    );

    let success = 0;
    let failed = 0;

    for (const loc of localities) {
      try {
        await generateSnapshot(
          loc._id.organization,
          loc._id.city,
          loc._id.area,
          'scheduled'
        );
        success++;
      } catch (err) {
        console.error(
          `[Snapshot Scheduler] Failed for ${loc._id.area}, ${loc._id.city}:`,
          err.message
        );
        failed++;
      }
    }

    console.log(
      `[Snapshot Scheduler] Complete. Success: ${success}, Failed: ${failed}`
    );
  } catch (err) {
    console.error('[Snapshot Scheduler] Fatal error:', err.message);
  }
};

/**
 * Start the weekly snapshot scheduler.
 * Runs every Sunday at 2:00 AM IST.
 */
const startScheduler = () => {
  if (schedulerInterval) {
    console.log('[Snapshot Scheduler] Already running');
    return;
  }

  // Check every hour if it's time to run (Sunday 2 AM IST)
  schedulerInterval = setInterval(async () => {
    const now = new Date();
    // IST = UTC + 5:30
    const istHour = (now.getUTCHours() + 5) % 24 + (now.getUTCMinutes() >= 30 ? 1 : 0);
    const istDay = now.getUTCDay();

    // Adjust day if IST pushes past midnight
    const adjustedDay = istHour < (now.getUTCHours() + 5) % 24 ? (istDay + 1) % 7 : istDay;

    // Sunday = 0, 2 AM IST
    if (adjustedDay === 0 && istHour === 2 && now.getMinutes() < 5) {
      await runSnapshotGeneration();
    }
  }, 60 * 60 * 1000); // Check every hour

  console.log('[Snapshot Scheduler] Started. Runs every Sunday at 2:00 AM IST.');
};

/**
 * Stop the scheduler.
 */
const stopScheduler = () => {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
    console.log('[Snapshot Scheduler] Stopped.');
  }
};

export { startScheduler, stopScheduler, runSnapshotGeneration };
