// File: services/support/supportEmails.js
// Description: Premium, responsive HTML email templates for the support
//   (email-to-ticket) system. Table-based layout + inline styles for broad email-
//   client compatibility (Gmail/Outlook/Apple Mail). Each builder returns
//   { subject, html, text }. Branding is intentionally restrained + luxurious:
//   deep ink header, gold hairline accent, generous spacing, a clear status pill
//   and a single prominent CTA to the live status page.

const BRAND = process.env.SUPPORT_BRAND_NAME || 'PropVantage';
const INK = '#0F172A';        // deep slate ink
const GOLD = '#B08D57';       // muted luxe gold accent
const MUTED = '#6B7280';
const LINE = '#E7E3DC';       // warm hairline
const BG = '#F4F2EE';         // warm paper background
const CARD = '#FFFFFF';

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const STATUS_LABEL = {
  new: 'Received', assigned: 'Received', in_progress: 'In progress',
  waiting_on_client: 'Awaiting your reply', resolved: 'Resolved', closed: 'Closed',
};

// Outer shell — a centered 600px card on a warm paper backdrop.
function shell({ preheader = '', heading, bodyHtml, displayId, statusLabel, ctaLink, ctaText = 'View ticket status' }) {
  const pill = statusLabel
    ? `<span style="display:inline-block;padding:5px 12px;border:1px solid ${GOLD};color:${GOLD};border-radius:999px;font-size:12px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;">${esc(statusLabel)}</span>`
    : '';
  const cta = ctaLink
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 4px;">
         <tr><td style="border-radius:10px;background:${INK};">
           <a href="${esc(ctaLink)}" target="_blank"
              style="display:inline-block;padding:14px 28px;color:#fff;font-size:15px;font-weight:600;text-decoration:none;border-radius:10px;letter-spacing:.01em;">
             ${esc(ctaText)} &nbsp;&rarr;</a>
         </td></tr></table>`
    : '';

  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting"></head>
<body style="margin:0;padding:0;background:${BG};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BG};padding:32px 12px;">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:100%;">
      <!-- header -->
      <tr><td style="padding:4px 8px 18px;">
        <table role="presentation" width="100%"><tr>
          <td style="font-family:Georgia,'Times New Roman',serif;font-size:22px;font-weight:700;color:${INK};letter-spacing:.02em;">${esc(BRAND)}</td>
          <td align="right" style="font-family:Arial,Helvetica,sans-serif;font-size:11px;color:${MUTED};letter-spacing:.12em;text-transform:uppercase;">Support</td>
        </tr></table>
      </td></tr>
      <!-- card -->
      <tr><td style="background:${CARD};border:1px solid ${LINE};border-radius:16px;overflow:hidden;">
        <div style="height:3px;background:linear-gradient(90deg,${GOLD},${INK});"></div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="padding:36px 40px 40px;font-family:Arial,Helvetica,sans-serif;">
          <table role="presentation" width="100%"><tr>
            <td style="font-size:12px;color:${MUTED};letter-spacing:.08em;">TICKET&nbsp;&middot;&nbsp;<strong style="color:${INK};letter-spacing:.04em;">${esc(displayId)}</strong></td>
            <td align="right">${pill}</td>
          </tr></table>
          <h1 style="margin:14px 0 0;font-family:Georgia,'Times New Roman',serif;font-size:24px;line-height:1.3;color:${INK};font-weight:700;">${esc(heading)}</h1>
          <div style="margin:18px 0 0;font-size:15px;line-height:1.7;color:#334155;">${bodyHtml}</div>
          ${cta}
        </td></tr></table>
      </td></tr>
      <!-- footer -->
      <tr><td style="padding:22px 12px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;color:${MUTED};text-align:center;">
        <strong style="color:${INK};">To reply, either way reaches us:</strong> simply reply to this email, or open your status page above and add a message there.<br>
        You're receiving this because you contacted <strong style="color:${INK};">${esc(BRAND)}</strong> support.
      </td></tr>
    </table>
  </td></tr>
</table></body></html>`;
}

// ── Builders ────────────────────────────────────────────────────────────────

export function autoReplyEmail({ displayId, subject, clientName, link }) {
  const hi = clientName ? `Hi ${esc(clientName)},` : 'Hello,';
  const bodyHtml = `
    <p style="margin:0 0 14px;">${hi}</p>
    <p style="margin:0 0 14px;">Thank you for reaching out. We've received your request${subject ? ` regarding <strong>&ldquo;${esc(subject)}&rdquo;</strong>` : ''} and opened a ticket for you. Our team has been notified and will be in touch shortly.</p>
    <p style="margin:0;">You can follow every update in real time on your private status page below — no login required.</p>`;
  return {
    subject: `We've received your request — [${displayId}]`,
    html: shell({
      preheader: `Your request is logged as ${displayId}. Track it anytime.`,
      heading: 'Your request has been received',
      bodyHtml, displayId, statusLabel: STATUS_LABEL.new,
      ctaLink: link, ctaText: 'Track your ticket',
    }),
    text: `${clientName ? `Hi ${clientName},` : 'Hello,'}\n\nWe've received your request${subject ? ` regarding "${subject}"` : ''} — ticket ${displayId}. Our team will be in touch shortly.\n\nTrack it anytime: ${link || `(reference ${displayId})`}\n\n— ${BRAND} Support`,
  };
}

export function clientReplyEmail({ displayId, subject, body, link }) {
  const bodyHtml = `<div style="font-size:15px;line-height:1.7;color:#334155;">${esc(body).replace(/\n/g, '<br>')}</div>`;
  return {
    subject: `Re: ${subject || 'your request'} [${displayId}]`,
    html: shell({
      preheader: `A new update on your ticket ${displayId}.`,
      heading: 'An update on your request',
      bodyHtml, displayId, statusLabel: STATUS_LABEL.in_progress,
      ctaLink: link, ctaText: 'View full conversation',
    }),
    text: `${body}\n\nView your ticket: ${link || `(reference ${displayId})`}\n\n— ${BRAND} Support`,
  };
}

export function statusUpdateEmail({ displayId, status, link }) {
  const label = STATUS_LABEL[status] || status;
  const bodyHtml = `
    <p style="margin:0 0 14px;">There's a new update on your ticket.</p>
    <p style="margin:0;">Its status is now <strong style="color:${INK};">${esc(label)}</strong>. Open your status page for the full timeline.</p>`;
  return {
    subject: `Update on [${displayId}] — ${label}`,
    html: shell({
      preheader: `Your ticket ${displayId} is now ${label}.`,
      heading: `Your ticket is now: ${label}`,
      bodyHtml, displayId, statusLabel: label,
      ctaLink: link, ctaText: 'View ticket status',
    }),
    text: `Your ticket ${displayId} is now: ${label}.\n\nView status: ${link || `(reference ${displayId})`}\n\n— ${BRAND} Support`,
  };
}

export default { autoReplyEmail, clientReplyEmail, statusUpdateEmail };
