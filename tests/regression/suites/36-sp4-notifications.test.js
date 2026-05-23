// 36-sp4-notifications.test.js — SP4: notifications surface is reachable
// (route gates for all the touchpoints; the events fire from within their
// owning handlers and are covered by the per-handler suites + manual
// smoke §8.2). This suite is a cross-cutting smoke that every SP4 event-
// firing endpoint is gated correctly.
import { describe, test, expect, beforeAll } from '@jest/globals';
import { api, setAuthToken } from '../_lib/api.js';

const FAKE_ID = '000000000000000000000000';

describe('SP4 — all 8 notification trigger sites are gated (no auth)', () => {
  beforeAll(() => setAuthToken(null));

  // Note: POST /api/cp/prospects/:id/push (lead_registration_received) is
  // covered by suite 33; external_developer_claimed fires from POST
  // /api/auth/register (public) and is covered by suite 32. The four cases
  // below cover the other 6 event types (each PATCH covers 2 events —
  // accept and reject share the same gate).
  const cases = [
    // lead_registration_accepted / lead_registration_rejected
    ['PATCH', `/api/leads/${FAKE_ID}/registration`, { action: 'accept' }],
    // cp_lead_status_changed (fires from updateLead when status changes on a CP-attributed lead)
    ['PUT', `/api/leads/${FAKE_ID}`, { status: 'Contacted' }],
    // lead_status_proposed
    ['POST', `/api/cp/prospects/${FAKE_ID}/propose-status`, { status: 'Contacted' }],
    // lead_status_proposal_accepted / lead_status_proposal_rejected
    ['PATCH', `/api/leads/${FAKE_ID}/proposal`, { action: 'accept' }],
  ];

  test.each(cases)('%s %s rejects unauthenticated requests', async (method, path, body) => {
    const res = await api(method, path, body);
    expect(res.status).toBe(401);
  });
});
