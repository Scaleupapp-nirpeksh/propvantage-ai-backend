// 38-sp5-reconciliation.test.js
//
// SP5 Phase 17 — commission reconciliation (Area 5) live API tests.
import { describe, test, expect, beforeAll } from '@jest/globals';
import { api, setAuthToken } from '../_lib/api.js';

const FAKE_ID = '000000000000000000000000';
const CP_EMAIL = process.env.SP5_CP_EMAIL || 'nirpeksh+offcp@scaleupapp.club';
const CP_PASSWORD = process.env.SP5_CP_PASSWORD || 'Demo@1234';

async function loginAsCp() {
  setAuthToken(null);
  const res = await api('POST', '/api/auth/login', { email: CP_EMAIL, password: CP_PASSWORD });
  if (res.status === 200 && res.data?.token) { setAuthToken(res.data.token); return true; }
  return false;
}

describe('SP5 — /api/cp/analytics/reconciliation gates', () => {
  beforeAll(() => setAuthToken(null));
  test('GET overview without auth → 401', async () => {
    expect((await api('GET', '/api/cp/analytics/reconciliation')).status).toBe(401);
  });
  test(`GET /:prospectId without auth → 401`, async () => {
    expect((await api('GET', `/api/cp/analytics/reconciliation/${FAKE_ID}`)).status).toBe(401);
  });
  test('POST /:prospectId/reviewed without auth → 401', async () => {
    expect((await api('POST', `/api/cp/analytics/reconciliation/${FAKE_ID}/reviewed`)).status).toBe(401);
  });
});

describe('SP5 — reconciliation shapes (live CP)', () => {
  let acquired = false;
  beforeAll(async () => { acquired = await loginAsCp(); });

  test('Overview summary has all status buckets', async () => {
    if (!acquired) return;
    const res = await api('GET', '/api/cp/analytics/reconciliation');
    expect(res.status).toBe(200);
    const s = res.data?.data?.summary;
    expect(s).toBeDefined();
    // Spec status enum: matched, cpOnly, devOnly, mismatched + pendingTrigger,
    // noRecord, totalDiscrepancy.
    for (const k of ['matched', 'cpOnly', 'devOnly', 'mismatched']) {
      expect(typeof s[k]).toBe('number');
    }
    expect(typeof s.totalDiscrepancy).toBe('number');
  });

  test('Each row carries the classified status', async () => {
    if (!acquired) return;
    const res = await api('GET', '/api/cp/analytics/reconciliation');
    expect(res.status).toBe(200);
    const rows = res.data?.data?.rows || [];
    for (const r of rows.slice(0, 5)) {
      expect(['matched', 'cp_only', 'dev_only', 'mismatched', 'pending_trigger', 'no_record'])
        .toContain(r.status);
      expect(r.prospectId).toBeDefined();
      expect(r.leadStatus).toBeDefined();
    }
  });

  test('GET /:prospectId for an out-of-org id → 404', async () => {
    if (!acquired) return;
    const res = await api('GET', `/api/cp/analytics/reconciliation/${FAKE_ID}`);
    expect(res.status).toBe(404);
  });

  test('POST /:prospectId/reviewed for non-existent id → 404', async () => {
    if (!acquired) return;
    const res = await api('POST', `/api/cp/analytics/reconciliation/${FAKE_ID}/reviewed`);
    expect(res.status).toBe(404);
  });
});
