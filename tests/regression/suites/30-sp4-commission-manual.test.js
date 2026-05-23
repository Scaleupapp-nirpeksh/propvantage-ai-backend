// 30-sp4-commission-manual.test.js — SP4: commission tracking route gates.
// Matches the SP3/SP4 route-gate pattern. Deep behavioural assertions
// (auto-calc, write-off perm) are covered by the manual smoke §8.2.1.
import { describe, test, expect, beforeAll } from '@jest/globals';
import { api, setAuthToken } from '../_lib/api.js';

const FAKE_ID = '000000000000000000000000';

describe('SP4 — commission tracking route gates (no auth)', () => {
  beforeAll(() => setAuthToken(null));

  test('POST /api/cp/prospects/:id/booking rejects unauthenticated requests', async () => {
    const res = await api('POST', `/api/cp/prospects/${FAKE_ID}/booking`, {
      bookedAt: new Date().toISOString(),
      unitInfo: '3BHK Tower A 1204',
      salePrice: 12500000,
    });
    expect(res.status).toBe(401);
  });

  test('POST /api/cp/prospects/:id/commission/payments rejects unauthenticated requests', async () => {
    const res = await api('POST', `/api/cp/prospects/${FAKE_ID}/commission/payments`, {
      amount: 50000,
      receivedAt: new Date().toISOString(),
      method: 'bank_transfer',
    });
    expect(res.status).toBe(401);
  });

  test('PUT /api/cp/prospects/:id/commission rejects unauthenticated requests', async () => {
    const res = await api('PUT', `/api/cp/prospects/${FAKE_ID}/commission`, {
      commissionAgreement: { type: 'percentage', value: 2.5 },
    });
    expect(res.status).toBe(401);
  });
});
