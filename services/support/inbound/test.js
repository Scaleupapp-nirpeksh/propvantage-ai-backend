// File: services/support/inbound/test.js
// Description: Test inbound adapter. Accepts the canonical JSON shape directly so
//   the inbound webhook can be exercised end-to-end without a real email provider.
//   verify() is permissive outside production, and gated by a shared secret in
//   production so the test path can't be abused on a live deployment.

/**
 * Verify a test inbound request.
 * @returns {boolean} true outside production, or when X-Test-Secret matches.
 */
export function verify(req) {
  if (process.env.NODE_ENV !== 'production') return true;
  const secret = process.env.SUPPORT_TEST_SECRET;
  if (!secret) return false;
  return req.get && req.get('X-Test-Secret') === secret;
}

/**
 * Normalize a canonical JSON body into the inbound message shape.
 * @returns {{ to, from, fromName, subject, text, html, messageId, inReplyTo, references }|null}
 */
export function normalize(req) {
  const b = req.body || {};
  if (!b.to || !b.from) return null;
  return {
    to: b.to,
    from: b.from,
    fromName: b.fromName,
    subject: b.subject,
    text: b.text,
    html: b.html,
    messageId: b.messageId,
    inReplyTo: b.inReplyTo,
    references: b.references,
  };
}
