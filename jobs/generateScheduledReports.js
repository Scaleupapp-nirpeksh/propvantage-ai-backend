// File: jobs/generateScheduledReports.js
// Description: node-cron — generate scheduled report instances and route them
//   to auto-send or review. Mirrors jobs/generateScheduledInsights.js.

import cron from 'node-cron';
import ReportTemplate from '../models/reportTemplateModel.js';
import { generateInstance } from '../services/reports/snapshotService.js';
import { computeNextRunAt } from '../services/reports/scheduleHelper.js';
import { sendReportToRecipients } from '../services/reports/deliveryService.js';
import { notifyUsersWithPermission } from '../services/notificationService.js';

const REPORTS_CRON = process.env.REPORT_SCHEDULE_CRON || '0 * * * *'; // hourly
const TZ = process.env.INSIGHT_DEFAULT_TIMEZONE || 'Asia/Kolkata';

export async function runDueReports(now = new Date()) {
  const due = await ReportTemplate.find({
    status: 'active',
    'schedule.enabled': true,
    'schedule.nextRunAt': { $lte: now },
  });

  const summary = { due: due.length, generated: 0, autoSent: 0, queuedForReview: 0, failed: [] };

  for (const template of due) {
    try {
      const instance = await generateInstance(template, { createdBy: template.createdBy, accessibleProjectIds: null });
      summary.generated++;

      template.schedule.nextRunAt = computeNextRunAt(template.schedule, now);
      await template.save();

      if (template.delivery?.mode === 'auto_send') {
        instance.review.status = 'approved';
        instance.review.approvedAt = now;
        await instance.save();
        await sendReportToRecipients(instance);
        summary.autoSent++;
      } else {
        instance.review.status = 'in_review';
        await instance.save();
        await notifyUsersWithPermission({
          organizationId: template.organization,
          permission: 'reports:approve',
          type: 'report_ready_for_review',
          title: 'A scheduled report is ready for review',
          message: `${instance.title || 'A report'} was generated on schedule and awaits approval.`,
          actionUrl: `/reports/generated/${instance._id}/review`,
          relatedEntity: { entityType: 'ReportInstance', entityId: instance._id, displayLabel: instance.title || 'Report' },
        });
        summary.queuedForReview++;
      }
    } catch (err) {
      summary.failed.push({ templateId: String(template._id), error: err.message });
    }
  }

  console.log('[generateScheduledReports]', JSON.stringify(summary));
  return summary;
}

export function registerScheduledReportJobs() {
  cron.schedule(REPORTS_CRON, () => {
    runDueReports().catch((err) => console.error('[generateScheduledReports] fatal:', err.message));
  }, { timezone: TZ });
  console.log(`[generateScheduledReports] cron registered (cron='${REPORTS_CRON}', tz='${TZ}')`);
}

export default { registerScheduledReportJobs, runDueReports };
