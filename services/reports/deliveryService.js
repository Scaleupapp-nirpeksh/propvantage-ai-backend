// File: services/reports/deliveryService.js
// Description: Emails an approved report's public link to its stakeholders.

import ReportTemplate from '../../models/reportTemplateModel.js';
import { sendEmail } from '../../utils/emailService.js';

const publicUrl = (slug) => {
  const base = (process.env.FRONTEND_URL || process.env.CLIENT_URL || 'http://localhost:3001').replace(/\/$/, '');
  return `${base}/r/${slug}`;
};

const buildHtml = ({ reportTitle, periodLabel, link, orgName }) => `
  <div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto">
    <div style="background:#1e88e5;color:#fff;padding:20px 24px;border-radius:12px 12px 0 0">
      <div style="font-size:13px;opacity:.85">${orgName || 'PropVantage AI'}</div>
      <div style="font-size:20px;font-weight:700">${reportTitle || 'Report'}</div>
      ${periodLabel ? `<div style="font-size:13px;opacity:.9">${periodLabel}</div>` : ''}
    </div>
    <div style="border:1px solid #e0e0e0;border-top:none;padding:24px;border-radius:0 0 12px 12px">
      <p>A new report is ready for you to review.</p>
      <p style="text-align:center;margin:28px 0">
        <a href="${link}" style="background:#1e88e5;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600">View report</a>
      </p>
      <p style="font-size:12px;color:#777">If the button doesn't work, paste this link into your browser:<br>${link}</p>
    </div>
  </div>`;

/**
 * Send the report's public link to the template's recipients.
 * Sets instance.distribution.recipients + per-recipient emailStatus and distribution.status.
 * @returns {Promise<{ sent: number, failed: number, total: number }>}
 */
export const sendReportToRecipients = async (instance) => {
  const template = instance.template ? await ReportTemplate.findById(instance.template).select('delivery name organization') : null;
  const recipients = (template?.delivery?.recipients || []).filter((r) => r && r.email);

  if (recipients.length === 0) {
    instance.distribution.status = 'sent';
    instance.distribution.sentAt = new Date();
    instance.distribution.recipients = [];
    await instance.save();
    return { sent: 0, failed: 0, total: 0 };
  }

  const link = publicUrl(instance.publicSlug);
  instance.distribution.status = 'sending';
  await instance.save();

  const results = [];
  for (const r of recipients) {
    const rec = { email: r.email, name: r.name, emailStatus: 'pending', emailedAt: null };
    try {
      await sendEmail({
        to: r.email,
        subject: `${instance.title || 'Your report'} is ready`,
        html: buildHtml({ reportTitle: instance.title, periodLabel: instance.periodLabel, link, orgName: template?.name }),
        text: `${instance.title || 'Your report'} is ready. View it: ${link}`,
      });
      rec.emailStatus = 'sent';
      rec.emailedAt = new Date();
    } catch (err) {
      rec.emailStatus = 'failed';
    }
    results.push(rec);
  }

  instance.distribution.recipients = results;
  const anySent = results.some((r) => r.emailStatus === 'sent');
  instance.distribution.status = anySent ? 'sent' : 'failed';
  if (anySent) instance.distribution.sentAt = new Date();
  await instance.save();

  return {
    sent: results.filter((r) => r.emailStatus === 'sent').length,
    failed: results.filter((r) => r.emailStatus === 'failed').length,
    total: results.length,
  };
};
