// 24-channel-partner-analytics.test.js — channel partner analytics endpoints
import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import { api, hasAuthToken } from '../_lib/api.js';
import { tryAcquireToken, disconnectAuth } from '../_lib/auth.js';

describe('channel partner analytics (authenticated read)', () => {
  beforeAll(async () => { await tryAcquireToken(); });
  afterAll(async () => { await disconnectAuth(); });

  const itAuthed = (name, fn) => test(name, async () => {
    if (!hasAuthToken()) { console.warn(`  ⏭️  ${name} skipped — no auth token`); return; }
    return fn();
  });

  itAuthed('GET /api/analytics/channel-partners/volume', async () => {
    // No date params — the endpoint defaults to start-of-year → now.
    const res = await api('GET', '/api/analytics/channel-partners/volume');
    expect([200, 403]).toContain(res.status);
    if (res.status === 200) {
      expect(res.body?.data).toHaveProperty('sales');
      expect(res.body?.data).toHaveProperty('leads');
      expect(Array.isArray(res.body?.data?.byCategory)).toBe(true);
      expect(res.body?.data?.byCategory).toHaveLength(4);
      expect(Array.isArray(res.body?.data?.byFirm)).toBe(true);
    }
  });

  itAuthed('GET /api/analytics/channel-partners/commission', async () => {
    const res = await api('GET', '/api/analytics/channel-partners/commission');
    expect([200, 403]).toContain(res.status);
    if (res.status === 200) {
      expect(res.body?.data).toHaveProperty('summary');
      expect(Array.isArray(res.body?.data?.topPerformers)).toBe(true);
    }
  });
});
