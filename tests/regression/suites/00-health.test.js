// 00-health.test.js — public, no-auth sanity check
import { describe, test, expect } from '@jest/globals';
import { api, expectOk } from '../_lib/api.js';

describe('public health endpoint', () => {
  test('GET /api/health returns 200 with status:OK and a version', async () => {
    const res = await api('GET', '/api/health');
    expectOk(res, 'health');
    expect(res.data.status).toBe('OK');
    expect(typeof res.data.version).toBe('string');
    expect(Array.isArray(res.data.features)).toBe(true);
    expect(res.data.features.length).toBeGreaterThan(20);
  });

  test('GET / returns 404 (no root route — expected)', async () => {
    const res = await api('GET', '/');
    expect(res.status).toBe(404);
  });
});
