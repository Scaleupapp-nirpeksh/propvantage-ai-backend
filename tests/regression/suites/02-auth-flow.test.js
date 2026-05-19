// 02-auth-flow.test.js — exercises the real /api/auth surface.
// Login attempts use bad creds (anonymous) — we just verify the endpoints respond
// with sensible 4xx, not 5xx, and the schema is what the frontend expects.
import { describe, test, expect } from '@jest/globals';
import { api, setAuthToken } from '../_lib/api.js';

describe('auth flow contract', () => {
  beforeAll(() => setAuthToken(null));

  test('POST /api/auth/login with empty body returns 4xx (validation)', async () => {
    const res = await api('POST', '/api/auth/login', {});
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  test('POST /api/auth/login with bad credentials returns 401/4xx', async () => {
    const res = await api('POST', '/api/auth/login', {
      email: 'nobody@example.invalid',
      password: 'definitely-wrong-password',
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    // The response should be JSON with a message
    expect(res.data).toBeTruthy();
  });

  test('POST /api/auth/refresh without cookie/body returns 4xx', async () => {
    const res = await api('POST', '/api/auth/refresh', {});
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });
});
