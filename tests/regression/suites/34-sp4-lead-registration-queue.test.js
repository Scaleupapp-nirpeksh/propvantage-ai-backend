// 34-sp4-lead-registration-queue.test.js — SP4: developer-side registrations
// queue + decide route gates. Deep behaviour (queue filtering, accept/reject
// transitions, duplicate detection, notification fan-out) is exercised via
// manual smoke §8.2.2 and is independently asserted by the unit tests in
// 28-sp4-partner-access-scope.test.js for the security-critical scoping.
import { describe, test, expect, beforeAll } from '@jest/globals';
import { api, setAuthToken } from '../_lib/api.js';

const FAKE_ID = '000000000000000000000000';

describe('SP4 — lead registrations queue route gates', () => {
  beforeAll(() => setAuthToken(null));

  test('GET /api/leads/registrations rejects unauthenticated requests', async () => {
    const res = await api('GET', '/api/leads/registrations');
    expect(res.status).toBe(401);
  });

  test('PATCH /api/leads/:id/registration rejects unauthenticated requests', async () => {
    const res = await api('PATCH', `/api/leads/${FAKE_ID}/registration`, {
      action: 'accept',
    });
    expect(res.status).toBe(401);
  });
});
