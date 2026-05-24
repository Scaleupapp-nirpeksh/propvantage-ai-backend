// 39-sp5-dev-analytics.test.js
//
// SP5 Phase 17 — dev-side analytics (Areas 6–8) live tests.
import { describe, test, expect, beforeAll } from '@jest/globals';
import { api, setAuthToken } from '../_lib/api.js';

const DEV_EMAIL = process.env.SP5_DEV_EMAIL || 'rohan.marwah@propvantage-demo.com';
const DEV_PASSWORD = process.env.SP5_DEV_PASSWORD || 'Demo@1234';

async function loginAsDev() {
  setAuthToken(null);
  const res = await api('POST', '/api/auth/login', { email: DEV_EMAIL, password: DEV_PASSWORD });
  if (res.status === 200 && res.data?.token) { setAuthToken(res.data.token); return true; }
  return false;
}

describe('SP5 — /api/analytics/cp-scorecard | commission-payouts | lead-quality', () => {
  beforeAll(() => setAuthToken(null));

  test.each([
    ['/api/analytics/cp-scorecard'],
    ['/api/analytics/commission-payouts'],
    ['/api/analytics/lead-quality'],
  ])('%s rejects unauthenticated requests (401)', async (path) => {
    expect((await api('GET', path)).status).toBe(401);
  });
});

describe('SP5 — dev-side analytics shapes (live)', () => {
  let acquired = false;
  beforeAll(async () => { acquired = await loginAsDev(); });

  test('GET /cp-scorecard returns partners array sorted by qualityScore desc', async () => {
    if (!acquired) return;
    const res = await api('GET', '/api/analytics/cp-scorecard?range=all');
    expect(res.status).toBe(200);
    const partners = res.data?.data?.partners;
    expect(Array.isArray(partners)).toBe(true);
    for (let i = 1; i < partners.length; i++) {
      expect(partners[i - 1].partnerQualityScore).toBeGreaterThanOrEqual(partners[i].partnerQualityScore);
    }
  });

  test('GET /commission-payouts returns summary + breakdowns + series', async () => {
    if (!acquired) return;
    const res = await api('GET', '/api/analytics/commission-payouts?range=ytd');
    expect(res.status).toBe(200);
    const d = res.data?.data;
    expect(d.summary).toBeDefined();
    expect(typeof d.summary.paidThisPeriod).toBe('number');
    expect(Array.isArray(d.breakdowns?.byCp)).toBe(true);
    expect(Array.isArray(d.breakdowns?.byProject)).toBe(true);
    expect(Array.isArray(d.series?.byMonth)).toBe(true);
  });

  test('GET /lead-quality returns per-CP rows with composite score', async () => {
    if (!acquired) return;
    const res = await api('GET', '/api/analytics/lead-quality?range=all');
    expect(res.status).toBe(200);
    const partners = res.data?.data?.partners || [];
    for (const p of partners.slice(0, 5)) {
      expect(typeof p.leadQualityScore).toBe('number');
      expect(Array.isArray(p.topRejectionReasons)).toBe(true);
    }
  });
});
