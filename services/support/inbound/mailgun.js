// File: services/support/inbound/mailgun.js
// Description: Mailgun inbound (routes → store/forward) adapter. Mailgun posts the
//   parsed message as form fields. verify() validates Mailgun's HMAC signature
//   (sha256 of `timestamp + token` keyed by MAILGUN_SIGNING_KEY).

import crypto from 'crypto';

/**
 * Verify the Mailgun webhook signature.
 * @returns {boolean}
 */
export function verify(req) {
  const key = process.env.MAILGUN_SIGNING_KEY;
  if (!key) return false;
  const b = req.body || {};
  const timestamp = b.timestamp;
  const token = b.token;
  const signature = b.signature;
  if (!timestamp || !token || !signature) return false;
  const expected = crypto
    .createHmac('sha256', key)
    .update(`${timestamp}${token}`)
    .digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(String(signature)));
  } catch {
    return false;
  }
}

/**
 * Normalize Mailgun inbound form fields.
 * @returns {{ to, from, fromName, subject, text, html, messageId, inReplyTo,
 *             references }|null}
 */
export function normalize(req) {
  const b = req.body || {};
  const recipient = b.recipient || b.To || b.to;
  const sender = b.sender || b.from || b.From;
  if (!recipient || !sender) return null;
  return {
    to: recipient,
    from: extractAddress(sender),
    fromName: extractName(sender) || b.from,
    subject: b.subject || b.Subject,
    text: b['body-plain'] ?? b['stripped-text'],
    html: b['stripped-html'] ?? b['body-html'],
    messageId: b['Message-Id'] || b['message-id'] || b['Message-ID'],
    inReplyTo: b['In-Reply-To'] || b['in-reply-to'],
    references: b.References || b.references,
  };
}

function extractAddress(value) {
  if (!value) return value;
  const m = String(value).match(/<([^>]+)>/);
  return (m ? m[1] : value).trim();
}
function extractName(value) {
  if (!value) return undefined;
  const m = String(value).match(/^\s*"?([^"<]+?)"?\s*</);
  return m ? m[1].trim() : undefined;
}
