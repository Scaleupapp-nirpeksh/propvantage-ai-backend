// 16-users-roles.test.js — users + roles surface (read-only)
import { describe, test, expect, beforeAll } from '@jest/globals';
import { api, hasAuthToken } from '../_lib/api.js';
import { tryAcquireToken, disconnectAuth } from '../_lib/auth.js';

describe('users + roles + invitations (authenticated read)', () => {
  beforeAll(async () => { await tryAcquireToken(); });
  afterAll(async () => { await disconnectAuth(); });

  const itAuthed = (name, fn) => test(name, async () => {
    if (!hasAuthToken()) { console.warn(`  ⏭️  ${name} skipped — no auth token`); return; }
    return fn();
  });

  itAuthed('GET /api/users', async () => {
    const res = await api('GET', '/api/users');
    expect([200, 403]).toContain(res.status);
  });

  itAuthed('GET /api/roles', async () => {
    const res = await api('GET', '/api/roles');
    expect([200, 403]).toContain(res.status);
  });

  itAuthed('GET /api/roles/permissions/catalog', async () => {
    const res = await api('GET', '/api/roles/permissions/catalog');
    expect([200, 403]).toContain(res.status);
  });

  itAuthed('GET /api/project-access/my-projects', async () => {
    const res = await api('GET', '/api/project-access/my-projects');
    expect([200, 403]).toContain(res.status);
  });
});
