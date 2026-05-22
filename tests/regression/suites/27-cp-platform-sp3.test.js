// 27-cp-platform-sp3.test.js — channel partner platform SP3: marketplace &
// partnership lifecycle route gates. Read-only: asserts the new routes reject
// unauthenticated requests. The mutating lifecycle (apply → approve → terminate)
// is exercised against a token-backed environment when API_TEST_TOKEN is set.
import { describe, test, expect, beforeAll } from '@jest/globals';
import { api, setAuthToken } from '../_lib/api.js';

const FAKE_ID = '000000000000000000000000';

describe('CP platform SP3 — partnership route gates', () => {
  beforeAll(() => setAuthToken(null));

  test('GET /api/partnerships rejects unauthenticated requests', async () => {
    const res = await api('GET', '/api/partnerships');
    expect(res.status).toBe(401);
  });

  test('POST /api/partnerships rejects unauthenticated requests', async () => {
    const res = await api('POST', '/api/partnerships', { counterpartyOrgId: FAKE_ID });
    expect(res.status).toBe(401);
  });

  test('GET /api/partnerships/:id rejects unauthenticated requests', async () => {
    const res = await api('GET', `/api/partnerships/${FAKE_ID}`);
    expect(res.status).toBe(401);
  });

  test('PATCH /api/partnerships/:id rejects unauthenticated requests', async () => {
    const res = await api('PATCH', `/api/partnerships/${FAKE_ID}`, { action: 'approve' });
    expect(res.status).toBe(401);
  });
});

describe('CP platform SP3 — marketplace route gates', () => {
  beforeAll(() => setAuthToken(null));

  test.each([
    ['/api/marketplace/developers'],
    ['/api/marketplace/channel-partners'],
  ])('GET %s rejects unauthenticated requests', async (path) => {
    const res = await api('GET', path);
    expect(res.status).toBe(401);
  });
});
