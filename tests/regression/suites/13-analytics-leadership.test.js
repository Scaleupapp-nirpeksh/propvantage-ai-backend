// 13-analytics-leadership.test.js — analytics + leadership dashboards
import { describe, test, expect, beforeAll } from '@jest/globals';
import { api, hasAuthToken } from '../_lib/api.js';
import { tryAcquireToken, disconnectAuth } from '../_lib/auth.js';

describe('analytics + leadership (authenticated read)', () => {
  beforeAll(async () => { await tryAcquireToken(); });
  afterAll(async () => { await disconnectAuth(); });

  const itAuthed = (name, fn) => test(name, async () => {
    if (!hasAuthToken()) { console.warn(`  ⏭️  ${name} skipped — no auth token`); return; }
    return fn();
  });

  itAuthed('GET /api/analytics/dashboard', async () => {
    const res = await api('GET', '/api/analytics/dashboard');
    expect([200, 403]).toContain(res.status);
  });

  itAuthed('GET /api/analytics/predictions/sales-forecast', async () => {
    const res = await api('GET', '/api/analytics/predictions/sales-forecast');
    expect([200, 403]).toContain(res.status);
  });

  itAuthed('GET /api/leadership/overview?period=30', async () => {
    const res = await api('GET', '/api/leadership/overview?period=30');
    expect([200, 403]).toContain(res.status);
  });
});
