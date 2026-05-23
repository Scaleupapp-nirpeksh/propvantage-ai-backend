// 31-sp4-external-developer.test.js — SP4: ExternalDeveloper route gates
// + public invite lookup behaviour. Auth tests follow the SP3/SP4
// route-gate pattern; the public lookup is testable without a token.
import { describe, test, expect, beforeAll } from '@jest/globals';
import { api, setAuthToken } from '../_lib/api.js';

const FAKE_ID = '000000000000000000000000';
const FAKE_TOKEN = 'a'.repeat(64);

describe('SP4 — /api/cp/external-developers route gates (no auth)', () => {
  beforeAll(() => setAuthToken(null));

  test('GET /api/cp/external-developers rejects unauthenticated requests', async () => {
    const res = await api('GET', '/api/cp/external-developers');
    expect(res.status).toBe(401);
  });

  test('POST /api/cp/external-developers rejects unauthenticated requests', async () => {
    const res = await api('POST', '/api/cp/external-developers', { name: 'Acme Builders' });
    expect(res.status).toBe(401);
  });

  test('GET /api/cp/external-developers/:id rejects unauthenticated requests', async () => {
    const res = await api('GET', `/api/cp/external-developers/${FAKE_ID}`);
    expect(res.status).toBe(401);
  });

  test('PUT /api/cp/external-developers/:id rejects unauthenticated requests', async () => {
    const res = await api('PUT', `/api/cp/external-developers/${FAKE_ID}`, { name: 'X' });
    expect(res.status).toBe(401);
  });

  test('DELETE /api/cp/external-developers/:id rejects unauthenticated requests', async () => {
    const res = await api('DELETE', `/api/cp/external-developers/${FAKE_ID}`);
    expect(res.status).toBe(401);
  });

  test('POST /api/cp/external-developers/:id/invite rejects unauthenticated requests', async () => {
    const res = await api('POST', `/api/cp/external-developers/${FAKE_ID}/invite`, {
      email: 'a@b.com',
    });
    expect(res.status).toBe(401);
  });
});

describe('SP4 — public invite lookup', () => {
  beforeAll(() => setAuthToken(null));

  test('GET /api/external-developer-invites/:token returns 404 for an unknown token', async () => {
    const res = await api('GET', `/api/external-developer-invites/${FAKE_TOKEN}`);
    expect(res.status).toBe(404);
  });

  test('GET /api/external-developer-invites/:token returns 404 for a malformed token', async () => {
    const res = await api('GET', '/api/external-developer-invites/not-a-real-token');
    expect(res.status).toBe(404);
  });
});
