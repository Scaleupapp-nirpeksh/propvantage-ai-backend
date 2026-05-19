// 15-competitive-construction.test.js — competitive analysis + construction
import { describe, test, expect, beforeAll } from '@jest/globals';
import { api, hasAuthToken } from '../_lib/api.js';
import { tryAcquireToken, disconnectAuth } from '../_lib/auth.js';

describe('competitive analysis + construction (authenticated read)', () => {
  beforeAll(async () => { await tryAcquireToken(); });
  afterAll(async () => { await disconnectAuth(); });

  const itAuthed = (name, fn) => test(name, async () => {
    if (!hasAuthToken()) { console.warn(`  ⏭️  ${name} skipped — no auth token`); return; }
    return fn();
  });

  itAuthed('GET /api/competitive-analysis/dashboard', async () => {
    const res = await api('GET', '/api/competitive-analysis/dashboard');
    expect([200, 403]).toContain(res.status);
  });

  itAuthed('GET /api/competitive-analysis/csv-template', async () => {
    const res = await api('GET', '/api/competitive-analysis/csv-template');
    // CSV download — could be 200 with text/csv or non-200; either way not 5xx
    expect(res.status).toBeLessThan(500);
  });

  itAuthed('GET /api/construction/milestones', async () => {
    const res = await api('GET', '/api/construction/milestones?limit=5');
    expect([200, 403]).toContain(res.status);
  });

  itAuthed('GET /api/contractors', async () => {
    const res = await api('GET', '/api/contractors?limit=5');
    expect([200, 403]).toContain(res.status);
  });
});
