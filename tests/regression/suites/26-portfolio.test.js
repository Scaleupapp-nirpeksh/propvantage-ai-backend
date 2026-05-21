// 26-portfolio.test.js — developer public portfolio (SP2): route gates.
import { describe, test, expect, beforeAll } from '@jest/globals';
import { api, setAuthToken } from '../_lib/api.js';

describe('portfolio — route gates', () => {
  beforeAll(() => setAuthToken(null));

  test.each([
    ['GET', '/api/portfolio/profile'],
    ['GET', '/api/portfolio/view/000000000000000000000000'],
  ])('%s %s rejects unauthenticated requests', async (method, path) => {
    const res = await api(method, path);
    expect([401, 403]).toContain(res.status);
  });

  test('PUT /api/portfolio/profile rejects unauthenticated requests', async () => {
    const res = await api('PUT', '/api/portfolio/profile', { about: 'x' });
    expect([401, 403]).toContain(res.status);
  });
});
