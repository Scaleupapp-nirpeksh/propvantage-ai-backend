// 33-sp4-prospect-push.test.js — SP4: prospect-push route gate.
// Behaviour (creates Lead with status:'pending', sets pushedToLead, blocks
// non-active partnership, blocks double-push) is exercised via manual smoke
// in §8.2.2. This file asserts the gate at the HTTP layer.
import { describe, test, expect, beforeAll } from '@jest/globals';
import { api, setAuthToken } from '../_lib/api.js';

const FAKE_ID = '000000000000000000000000';

describe('SP4 — prospect push route gate', () => {
  beforeAll(() => setAuthToken(null));

  test('POST /api/cp/prospects/:id/push rejects unauthenticated requests', async () => {
    const res = await api('POST', `/api/cp/prospects/${FAKE_ID}/push`);
    expect(res.status).toBe(401);
  });
});
