// 35-sp4-status-proposal.test.js — SP4: status proposal route gates.
// Behaviour (proposal creation, 409 on double-propose, withdraw auth,
// dev accept/reject + clears + notifications) is exercised via manual
// smoke §8.2.2.
import { describe, test, expect, beforeAll } from '@jest/globals';
import { api, setAuthToken } from '../_lib/api.js';

const FAKE_ID = '000000000000000000000000';

describe('SP4 — status proposal route gates', () => {
  beforeAll(() => setAuthToken(null));

  test('POST /api/cp/prospects/:id/propose-status rejects unauthenticated requests', async () => {
    const res = await api('POST', `/api/cp/prospects/${FAKE_ID}/propose-status`, {
      status: 'Contacted',
      note: 'spoke today',
    });
    expect(res.status).toBe(401);
  });

  test('DELETE /api/cp/prospects/:id/proposed-status rejects unauthenticated requests', async () => {
    const res = await api('DELETE', `/api/cp/prospects/${FAKE_ID}/proposed-status`);
    expect(res.status).toBe(401);
  });

  test('PATCH /api/leads/:id/proposal rejects unauthenticated requests', async () => {
    const res = await api('PATCH', `/api/leads/${FAKE_ID}/proposal`, {
      action: 'accept',
    });
    expect(res.status).toBe(401);
  });
});
