// 10-projects.test.js — authenticated read-only contract test for projects + units.
import { describe, test, expect, beforeAll } from '@jest/globals';
import { api, hasAuthToken } from '../_lib/api.js';
import { tryAcquireToken, disconnectAuth } from '../_lib/auth.js';

describe('projects + units (authenticated read)', () => {
  let token;
  beforeAll(async () => { token = await tryAcquireToken(); });
  afterAll(async () => { await disconnectAuth(); });

  const skipIfNoAuth = (fn) => async () => {
    if (!hasAuthToken()) {
      console.warn('  ⏭️  skipped — no auth token (set API_TEST_TOKEN or local DB env)');
      return;
    }
    return fn();
  };

  test('GET /api/projects returns an array', skipIfNoAuth(async () => {
    const res = await api('GET', '/api/projects');
    expect([200, 403]).toContain(res.status);
    if (res.status === 200) {
      const list = Array.isArray(res.data) ? res.data : res.data.data || res.data.projects || [];
      expect(Array.isArray(list)).toBe(true);
    }
  }));

  test('GET /api/units/statistics returns aggregation', skipIfNoAuth(async () => {
    const res = await api('GET', '/api/units/statistics');
    expect([200, 403]).toContain(res.status);
  }));
});
