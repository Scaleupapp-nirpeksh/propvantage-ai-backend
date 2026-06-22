// File: jobs/reflectionReminders.js
// Description: node-cron — Friday reflection-due reminder job (spec §15).
//   Fires Friday morning; processes the CURRENT ISO week.
//   Per org:
//     For each active member who has NOT yet submitted their current-week
//     reflection → emit 'reflection_due' notification.
//
//   Registration pattern mirrors jobs/generateMoraleSummaries.js:
//   the work function (sendReflectionDueReminders) is exported separately
//   from the registration function (registerReflectionDueReminderJob).
//   NEVER fires on import — only when cron fires or manually called.

import cron from 'node-cron';
import Organization from '../models/organizationModel.js';
import User from '../models/userModel.js';
import WeeklyReflection from '../models/weeklyReflectionModel.js';
import { isoWeekOf } from '../services/people/reflectionService.js';
import { createNotification } from '../services/notificationService.js';

// Friday 06:30 IST (01:00 UTC). Covers the current ISO week (Mon–Sun).
const REFLECTION_DUE_CRON = process.env.REFLECTION_DUE_CRON || '0 1 * * 5';
const TZ = process.env.INSIGHT_DEFAULT_TIMEZONE || 'Asia/Kolkata';

// =============================================================================
// MAIN JOB FUNCTION
// =============================================================================

/**
 * Send 'reflection_due' notifications to active members whose current ISO-week
 * reflection is not yet submitted.
 *
 * @param {Date} [asOf=new Date()] - reference "now"; the current isoWeek is
 *   derived from this date, making the function testable without time travel.
 * @returns {Promise<{orgs:number,notified:number,failed:Array}>}
 */
export async function sendReflectionDueReminders(asOf = new Date()) {
  const currentWeek = isoWeekOf(asOf);
  const summary = { orgs: 0, notified: 0, failed: [] };

  let orgs;
  try {
    orgs = await Organization.find({}).select('_id name').lean();
  } catch (err) {
    console.error('[reflectionReminders] Failed to fetch orgs:', err.message);
    return summary;
  }

  for (const org of orgs) {
    const orgId = org._id;
    summary.orgs++;

    // Fetch all active, accepted members for this org
    let activeMembers;
    try {
      activeMembers = await User.find({
        organization: orgId,
        isActive: true,
        invitationStatus: 'accepted',
      })
        .select('_id role')
        .lean();
    } catch (err) {
      summary.failed.push({ org: String(orgId), step: 'fetchMembers', error: err.message });
      continue;
    }

    for (const member of activeMembers) {
      try {
        // A member needs a reminder if they have NO submitted reflection for the
        // current ISO week.
        const submitted = await WeeklyReflection.findOne({
          organization: orgId,
          user: member._id,
          isoWeek: currentWeek,
          status: 'submitted',
        }).lean();

        if (!submitted) {
          await createNotification({
            organization: orgId,
            recipient: member._id,
            type: 'reflection_due',
            title: 'Weekly Reflection Due',
            message: `Your reflection for ${currentWeek} is due. Please submit it before the week ends.`,
            actionUrl: '/people/me#reflection',
            priority: 'medium',
          }).catch((e) =>
            console.error('[reflectionReminders] notification error:', e.message)
          );
          summary.notified++;
        }
      } catch (err) {
        summary.failed.push({
          org:   String(orgId),
          user:  String(member._id),
          step:  'reflection_due',
          error: err.message,
        });
      }
    }
  }

  console.log('[reflectionReminders]', JSON.stringify(summary));
  return summary;
}

// =============================================================================
// CRON REGISTRATION
// =============================================================================

/**
 * Register the Friday reflection-due reminder cron.
 * Call ONCE from server startup (httpServer.listen), never on import.
 */
export function registerReflectionDueReminderJob() {
  cron.schedule(
    REFLECTION_DUE_CRON,
    () => {
      sendReflectionDueReminders().catch((err) =>
        console.error('[reflectionReminders] fatal:', err.message)
      );
    },
    { timezone: TZ }
  );
  console.log(
    `[reflectionReminders] cron registered (cron='${REFLECTION_DUE_CRON}', tz='${TZ}')`
  );
}

export default { registerReflectionDueReminderJob, sendReflectionDueReminders };
