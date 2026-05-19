// 12-payments-tasks-notifications.test.js — read-only contract tests
import { describe, test, expect, beforeAll } from '@jest/globals';
import { api, hasAuthToken } from '../_lib/api.js';
import { tryAcquireToken, disconnectAuth } from '../_lib/auth.js';

describe('payments + tasks + notifications (authenticated read)', () => {
  beforeAll(async () => { await tryAcquireToken(); });
  afterAll(async () => { await disconnectAuth(); });

  const itAuthed = (name, fn) => test(name, async () => {
    if (!hasAuthToken()) { console.warn(`  ⏭️  ${name} skipped — no auth token`); return; }
    return fn();
  });

  itAuthed('GET /api/payments/reports/overdue', async () => {
    const res = await api('GET', '/api/payments/reports/overdue');
    expect([200, 403]).toContain(res.status);
  });

  itAuthed('GET /api/invoices', async () => {
    const res = await api('GET', '/api/invoices?limit=5');
    expect([200, 403]).toContain(res.status);
  });

  itAuthed('GET /api/tasks/my', async () => {
    const res = await api('GET', '/api/tasks/my');
    expect([200, 403]).toContain(res.status);
  });

  itAuthed('GET /api/tasks/analytics', async () => {
    const res = await api('GET', '/api/tasks/analytics');
    expect([200, 403]).toContain(res.status);
  });

  itAuthed('GET /api/notifications', async () => {
    const res = await api('GET', '/api/notifications?limit=5');
    expect([200, 403]).toContain(res.status);
  });

  itAuthed('GET /api/notifications/unread-count', async () => {
    const res = await api('GET', '/api/notifications/unread-count');
    expect([200, 403]).toContain(res.status);
    if (res.status === 200) {
      const count = res.data?.count ?? res.data?.data?.count ?? res.data?.unreadCount;
      expect(typeof count === 'number' || count === undefined).toBe(true);
    }
  });
});
