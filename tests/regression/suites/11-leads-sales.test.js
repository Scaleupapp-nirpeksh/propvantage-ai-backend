// 11-leads-sales.test.js — read-only authenticated tests for leads + sales.
import { describe, test, expect, beforeAll } from '@jest/globals';
import { api, hasAuthToken } from '../_lib/api.js';
import { tryAcquireToken, disconnectAuth } from '../_lib/auth.js';

describe('leads + sales (authenticated read)', () => {
  beforeAll(async () => { await tryAcquireToken(); });
  afterAll(async () => { await disconnectAuth(); });

  const itAuthed = (name, fn) => test(name, async () => {
    if (!hasAuthToken()) { console.warn(`  ⏭️  ${name} skipped — no auth token`); return; }
    return fn();
  });

  itAuthed('GET /api/leads', async () => {
    const res = await api('GET', '/api/leads?limit=5');
    expect([200, 403]).toContain(res.status);
  });

  itAuthed('GET /api/leads/needs-attention', async () => {
    const res = await api('GET', '/api/leads/needs-attention?limit=5');
    expect([200, 403]).toContain(res.status);
  });

  itAuthed('GET /api/sales', async () => {
    const res = await api('GET', '/api/sales?limit=5');
    expect([200, 403]).toContain(res.status);
  });

  itAuthed('GET /api/sales/analytics', async () => {
    const res = await api('GET', '/api/sales/analytics');
    expect([200, 403]).toContain(res.status);
  });
});
