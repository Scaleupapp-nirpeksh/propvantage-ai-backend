// File: services/support/inbound/ses.js
// Description: AWS SES inbound adapter. SES inbound is delivered via SNS, so the
//   request body is an SNS envelope:
//     - SubscriptionConfirmation: normalize() returns a special signal so the route
//       can confirm the subscription by GETting the SubscribeURL.
//     - Notification: the SNS `Message` is the SES event whose `mail` carries the
//       headers (from/to/subject/messageId), and `content` (when present) is the raw
//       MIME, base64. If the `mailparser` package is installed we parse the MIME for
//       the text/html body; otherwise we fall back to the SES commonHeaders + a note
//       (so a ticket is still created and nothing is silently dropped).
//   verify() is best-effort: it checks the SNS signing certificate URL is an AWS
//   host (`*.amazonaws.com`). Full cryptographic SNS signature verification (fetch
//   the cert, verify the signature over the canonical string) is intentionally
//   deferred to a hardening pass and documented here.

import { Buffer } from 'buffer';

// Special sentinel the route checks for to perform SNS subscription confirmation.
export const SES_SUBSCRIPTION_CONFIRMATION = '__SES_SUBSCRIPTION_CONFIRMATION__';

// Resolve mailparser once (optional dependency). Null when not installed.
let mailparser;
try {
  mailparser = await import('mailparser');
} catch {
  mailparser = null;
}

function parseEnvelope(req) {
  let env = req.body;
  // SNS may POST with Content-Type text/plain; body could be a raw JSON string.
  if (typeof env === 'string') {
    try {
      env = JSON.parse(env);
    } catch {
      return null;
    }
  }
  return env && typeof env === 'object' ? env : null;
}

/**
 * Best-effort verification: confirm the signing certificate is hosted on AWS.
 * Full cryptographic SNS signature verification is intentionally deferred — see
 * the file header. We reject anything whose cert URL host is not *.amazonaws.com.
 */
export function verify(req) {
  const env = parseEnvelope(req);
  if (!env) return false;
  const certUrl = env.SigningCertURL || env.SigningCertUrl;
  if (!certUrl) return false;
  try {
    const host = new URL(certUrl).host;
    return host.endsWith('.amazonaws.com');
  } catch {
    return false;
  }
}

function firstHeader(headers, name) {
  if (!Array.isArray(headers)) return undefined;
  const h = headers.find((x) => (x.name || '').toLowerCase() === name.toLowerCase());
  return h?.value;
}

// `"Jane Doe" <jane@x.com>` → jane@x.com
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

/**
 * Normalize an SNS-wrapped SES inbound event.
 * @returns {Promise<{ to, from, fromName, subject, text, html, messageId,
 *             inReplyTo, references }|{ __signal: string, subscribeURL: string }|null>}
 */
export async function normalize(req) {
  const env = parseEnvelope(req);
  if (!env) return null;

  if (env.Type === 'SubscriptionConfirmation') {
    return { __signal: SES_SUBSCRIPTION_CONFIRMATION, subscribeURL: env.SubscribeURL };
  }
  if (env.Type !== 'Notification') return null;

  let message = env.Message;
  if (typeof message === 'string') {
    try {
      message = JSON.parse(message);
    } catch {
      return null;
    }
  }
  if (!message || !message.mail) return null;

  const mail = message.mail;
  const ch = mail.commonHeaders || {};
  const headers = mail.headers || [];

  const to = (Array.isArray(ch.to) ? ch.to[0] : ch.to) || (mail.destination || [])[0];
  const from = (Array.isArray(ch.from) ? ch.from[0] : ch.from) || mail.source;
  const subject = ch.subject;
  const messageId = ch.messageId || mail.messageId;
  const inReplyTo = firstHeader(headers, 'In-Reply-To');
  const references = firstHeader(headers, 'References');

  let text;
  let html;
  const rawContent = message.content || mail.content;
  if (rawContent && mailparser?.simpleParser) {
    try {
      const raw = Buffer.from(rawContent, 'base64');
      const parsed = await mailparser.simpleParser(raw);
      text = parsed.text;
      html = parsed.html || undefined;
    } catch {
      // fall through to the header-only fallback below
    }
  }
  if (text === undefined) {
    text =
      `(Inbound email body was not parsed — raw MIME requires the 'mailparser' package.)\n` +
      `Subject: ${subject || ''}`;
  }

  return {
    to,
    from: extractAddress(from),
    fromName: extractName(from),
    subject,
    text,
    html,
    messageId,
    inReplyTo,
    references,
  };
}
