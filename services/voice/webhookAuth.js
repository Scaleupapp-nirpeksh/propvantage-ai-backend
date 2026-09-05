// File: services/voice/webhookAuth.js
// Description: Shared-secret verification for voice-provider webhooks. The
//   assistant is created with a custom header (x-propvantage-secret) on every
//   server URL, so every tool call and end-of-call report carries it back.

import crypto from 'crypto';

export const VOICE_WEBHOOK_HEADER = 'x-propvantage-secret';

/**
 * Constant-time comparison of the request's secret header against the configured
 * secret. Outside production a missing configured secret is permitted so the
 * webhook can be exercised locally; in production it is always required.
 * @param {{ get?: Function, headers?: Object }} req
 * @param {{ secret?: string, env?: string }} [opts]
 * @returns {boolean}
 */
export function verifyVoiceWebhook(req, opts = {}) {
  const configured = opts.secret ?? process.env.VAPI_WEBHOOK_SECRET;
  const env = opts.env ?? process.env.NODE_ENV;
  if (!configured) return env !== 'production';

  const provided =
    (typeof req.get === 'function' ? req.get(VOICE_WEBHOOK_HEADER) : null) ||
    req.headers?.[VOICE_WEBHOOK_HEADER] ||
    '';
  if (!provided) return false;

  const a = Buffer.from(String(provided));
  const b = Buffer.from(String(configured));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
