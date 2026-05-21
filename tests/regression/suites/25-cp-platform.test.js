// 25-cp-platform.test.js — channel partner platform SP1: registration + portal gates.
import { describe, test, expect, beforeAll } from '@jest/globals';
import { api, setAuthToken } from '../_lib/api.js';

describe('CP platform — registration validation', () => {
  beforeAll(() => setAuthToken(null));

  test('CP registration without RERA is rejected', async () => {
    const res = await api('POST', '/api/auth/register', {
      type: 'channel_partner',
      orgName: `Test CP ${Date.now()}`,
      country: 'India', city: 'Mumbai',
      category: 'broker_firm',
      firstName: 'Test', lastName: 'Owner',
      email: `cp${Date.now()}@example.com`, password: 'StrongPass!234',
    });
    expect(res.status).toBe(400);
  });

  test('CP registration with an invalid category is rejected', async () => {
    const res = await api('POST', '/api/auth/register', {
      type: 'channel_partner',
      orgName: `Test CP ${Date.now()}`,
      country: 'India', city: 'Mumbai',
      category: 'not_a_category',
      reraRegistrationNumber: `RERA${Date.now()}`,
      firstName: 'Test', lastName: 'Owner',
      email: `cp${Date.now()}@example.com`, password: 'StrongPass!234',
    });
    expect(res.status).toBe(400);
  });
});

describe('CP platform — portal route gates', () => {
  beforeAll(() => setAuthToken(null));

  test.each([
    ['/api/cp/org'],
    ['/api/cp/team'],
  ])('GET %s rejects unauthenticated requests', async (path) => {
    const res = await api('GET', path);
    expect([401, 403]).toContain(res.status);
  });
});
