// 01-auth-gates.test.js — verify every protected route prefix rejects unauthenticated requests.
// This is the most valuable safety net for catching accidental route exposure.
import { describe, test, expect } from '@jest/globals';
import { api, setAuthToken } from '../_lib/api.js';

// One representative GET per protected mount. If any of these ever returns 200
// without a Bearer token, that's a regression.
const PROTECTED = [
  ['/api/projects',                            'projects'],
  ['/api/towers',                              'towers'],
  ['/api/units',                               'units'],
  ['/api/leads',                               'leads'],
  ['/api/sales',                               'sales'],
  ['/api/payments/reports/overdue',            'payments'],
  ['/api/invoices',                            'invoices'],
  ['/api/commissions',                         'commissions'],
  ['/api/tasks/my',                            'tasks'],
  ['/api/notifications',                       'notifications'],
  ['/api/notifications/unread-count',          'notifications unread'],
  ['/api/users',                               'users'],
  ['/api/roles',                               'roles'],
  ['/api/invitations',                         'invitations'],
  ['/api/documents',                           'documents'],
  ['/api/construction/milestones',             'construction'],
  ['/api/contractors',                         'contractors'],
  ['/api/analytics/dashboard',                 'analytics'],
  ['/api/analytics/predictions/sales-forecast','analytics predictions'],
  ['/api/leadership/overview',                 'leadership'],
  ['/api/competitive-analysis/dashboard',      'competitive analysis'],
  ['/api/chat/conversations',                  'chat'],
  ['/api/files',                               'files'],
  ['/api/project-access/my-projects',          'project access'],
  ['/api/ai/copilot/suggestions',              'ai copilot'],
];

describe('auth gates — every protected route prefix must reject anonymous requests', () => {
  beforeAll(() => setAuthToken(null));

  test.each(PROTECTED)('GET %s rejects no-auth (label: %s)', async (path, _label) => {
    const res = await api('GET', path);
    // 401 (no token) or 403 (token present but no permission) — both are auth gates working.
    // 404 means the route is missing — a regression.
    // 5xx means a crash.
    expect([401, 403]).toContain(res.status);
  });
});
