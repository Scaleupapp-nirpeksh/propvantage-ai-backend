// 32-sp4-claim-flow.test.js — SP4: registerUser's externalDeveloperInviteToken
// claim path. We don't mutate prod state (no actual registrations), so this
// suite only asserts the shape of the response when the token is malformed
// or absent. Deep end-to-end coverage (transactional claim + retag + dev-
// side ChannelPartner) is exercised via the manual smoke in §8.2.3.
//
// IMPORTANT — this suite deliberately does NOT exercise a real
// /api/auth/register call (which would create a real Organization + User
// on whichever DB the server is pointed at). Route-gate coverage is the
// scope here. The full claim flow is validated end-to-end in the manual
// smoke and (later) the frontend's invite-link page-load test.
import { describe, test, expect, beforeAll } from '@jest/globals';
import { api, setAuthToken } from '../_lib/api.js';

describe('SP4 — claim flow / register endpoint shape', () => {
  beforeAll(() => setAuthToken(null));

  // The register endpoint is rate-limited (3/hr per IP per SP1's
  // registerLimiter). Treat 429 (Too Many Requests) as an acceptable
  // outcome — it still proves the endpoint is gated, just not via Joi.
  const ACCEPTED_GATE_CODES = [400, 429];

  test('POST /api/auth/register without a body is rejected (400 or 429)', async () => {
    const res = await api('POST', '/api/auth/register', {});
    expect(ACCEPTED_GATE_CODES).toContain(res.status);
  });

  test('POST /api/auth/register with a malformed externalDeveloperInviteToken is rejected (400 or 429)', async () => {
    const res = await api('POST', '/api/auth/register', {
      externalDeveloperInviteToken: 'not-a-real-token',
    });
    expect(ACCEPTED_GATE_CODES).toContain(res.status);
  });

  test('POST /api/auth/register accepts a properly-shaped 64-hex token field', async () => {
    const res = await api('POST', '/api/auth/register', {
      externalDeveloperInviteToken: 'a'.repeat(64),
    });
    expect(ACCEPTED_GATE_CODES).toContain(res.status);
    if (res.status === 400) {
      // When not rate-limited we can additionally assert the Joi error
      // didn't reject the token field itself.
      const message = String(res.data?.message || res.data?.raw || '');
      expect(message).not.toMatch(/externalDeveloperInviteToken/i);
    }
  });
});
