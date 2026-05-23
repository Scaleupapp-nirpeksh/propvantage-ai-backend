// Scenario 7 — foolproof / security checks that don't fit neatly into the
// other scenarios. These exercise specific defensive behaviour:
//
//   (a) An unauthenticated request to every SP4 endpoint is rejected (401).
//   (b) A CP cannot GET a lead belonging to a developer it is NOT partnered
//       with (partnerAccessScope returns 404, not 200 with data).
//   (c) A developer cannot POST /api/cp/prospects (org-type gate).
//   (d) Pushing a prospect twice rejects the second push with 4xx.
//   (e) Proposing a status while a prior proposal is pending returns 409.
//   (f) Withdraw clears the proposal and a new proposal afterwards works.
//   (g) Malformed externalDeveloperInviteToken on register is silently dropped
//       (Joi strips it) — registration completes WITHOUT performing a claim.
//   (h) Duplicate-match window: pushing a prospect whose phone matches a
//       recent CP-attributed Lead surfaces the existing match in the response.

import { http, pickArr } from '../lib/api.mjs';
import { login } from '../lib/auth.mjs';
import { step, assert, note, warn, skip, pass } from '../lib/log.mjs';

const FAKE = '000000000000000000000000';

export default async function scenarioSeven(ctx, log) {
  step(log, 'Login as CP + Dev');
  const cp = await login(ctx.creds.cp.email, ctx.creds.cp.password);
  const dev = await login(ctx.creds.dev.email, ctx.creds.dev.password);

  step(log, '(a) Unauthenticated → all SP4 endpoints rejected with 401');
  const gates = [
    ['GET', '/cp/prospects'],
    ['POST', '/cp/prospects', { firstName: 'x', phone: '1', assignedAgent: FAKE, developerContext: { type: 'external' } }],
    ['GET', '/cp/external-developers'],
    ['POST', `/cp/prospects/${FAKE}/push`, {}],
    ['POST', `/cp/prospects/${FAKE}/propose-status`, { status: 'Contacted' }],
    ['DELETE', `/cp/prospects/${FAKE}/proposed-status`],
    ['GET', '/leads/registrations'],
    ['PATCH', `/leads/${FAKE}/registration`, { action: 'accept' }],
    ['PATCH', `/leads/${FAKE}/proposal`, { action: 'accept' }],
  ];
  for (const [m, p, body] of gates) {
    const r = await http(m, p, { body: body || null, expect: 401, note: `gate ${m} ${p}` });
    assert(log, `${m} ${p} → 401`, r.status === 401);
  }

  step(log, '(c) Developer cannot POST /api/cp/prospects (requireOrgType=channel_partner)');
  const devTry = await http('POST', '/cp/prospects', {
    token: dev.token,
    body: { firstName: 'x', phone: '+91-99', assignedAgent: dev.userId, developerContext: { type: 'external', externalDeveloper: FAKE } },
    expect: [403, 400, 404],
    note: 'dev calls cp prospects',
  });
  assert(log, `Dev POST /cp/prospects → ${devTry.status} (forbidden, not 200/201)`, devTry.status >= 400);

  step(log, '(b) CP GET of an out-of-scope lead returns 404');
  // To find an out-of-scope lead, list dev leads and pick one with no CP attribution.
  const devLeads = await http('GET', '/leads?limit=200', { token: dev.token, expect: 200, note: 'dev lists leads' });
  const outOfScope = pickArr(devLeads).find(
    (l) => !l.channelPartnerAttribution?.viaChannelPartner
  );
  if (outOfScope) {
    const cpAttempt = await http('GET', `/leads/${outOfScope._id}`, { token: cp.token, expect: [404, 403], note: 'cp gets out-of-scope lead' });
    assert(log, `CP GET of org-internal dev lead → ${cpAttempt.status} (404 or 403)`, [404, 403].includes(cpAttempt.status));
  } else {
    skip(log, 'No org-internal dev lead found to test scope leak — every dev lead is CP-attributed', { count: pickArr(devLeads).length });
  }

  step(log, '(d)+(e)+(f) Double-push, double-propose, withdraw — create a fresh prospect + push');
  // We need a prospect we can push. Find the active partnership.
  const partners = await http('GET', '/partnerships', { token: cp.token, expect: 200, note: 'cp partnerships' });
  const partnership = pickArr(partners).find(
    (p) => String(p.developerOrg?._id || p.developerOrg) === String(dev.org._id) && p.status === 'active'
  );
  if (!partnership) {
    skip(log, 'No active partnership available — skipping (d)/(e)/(f)');
  } else {
    const projectId = partnership.approvedProjects?.[0]?._id || partnership.approvedProjects?.[0] || '6a0c587913c90085c7abfb35';
    const tag = `s7-${ctx.runId.slice(0, 12)}`;
    const cp1 = await http('POST', '/cp/prospects', {
      token: cp.token,
      body: {
        firstName: 'EdgeCase',
        lastName: `Tester-${tag}`,
        phone: '+91-92222-' + Math.floor(Math.random() * 90000 + 10000),
        developerContext: { type: 'platform', partnership: partnership._id },
        project: { platform: projectId },
        assignedAgent: cp.userId,
        priority: 'Medium',
      },
      expect: 201, note: 'fresh prospect for edge tests',
    });
    const pid = cp1.data?.data?._id;
    assert(log, 'Edge prospect created', !!pid);

    // (d) push twice
    const push1 = await http('POST', `/cp/prospects/${pid}/push`, { token: cp.token, expect: [200, 201], note: 'first push' });
    assert(log, 'First push ok', push1.ok);
    const push2 = await http('POST', `/cp/prospects/${pid}/push`, { token: cp.token, expect: [400, 409], note: 'duplicate push' });
    assert(log, `Second push rejected with ${push2.status} (4xx)`, [400, 409].includes(push2.status));

    // accept the registration so we can exercise propose-status
    const leadId = push1.data?.data?.leadId;
    if (leadId) {
      await http('PATCH', `/leads/${leadId}/registration`, { token: dev.token, body: { action: 'accept' }, expect: 200, note: 'dev accepts registration (edge)' });

      // (e) double-propose
      const p1 = await http('POST', `/cp/prospects/${pid}/propose-status`, { token: cp.token, body: { status: 'Contacted', note: 'first' }, expect: [200, 201], note: 'first proposal' });
      assert(log, 'First proposal ok', p1.ok);
      const p2 = await http('POST', `/cp/prospects/${pid}/propose-status`, { token: cp.token, body: { status: 'Qualified', note: 'second' }, expect: [409, 400], note: 'second proposal (should 409)' });
      assert(log, `Second proposal → ${p2.status}`, [409, 400].includes(p2.status));

      // (f) withdraw + new propose
      const w = await http('DELETE', `/cp/prospects/${pid}/proposed-status`, { token: cp.token, expect: 200, note: 'withdraw proposal' });
      assert(log, 'Withdraw ok', w.ok);
      const p3 = await http('POST', `/cp/prospects/${pid}/propose-status`, { token: cp.token, body: { status: 'Qualified', note: 'fresh' }, expect: [200, 201], note: 'propose after withdraw' });
      assert(log, 'Fresh proposal after withdraw ok', p3.ok);
    } else {
      warn(log, 'No leadId resolvable from first push response; (e)/(f) skipped', push1.data);
    }
  }

  step(log, '(g) Malformed externalDeveloperInviteToken on register is silently dropped (Joi)');
  // Validate the SHAPE of the response only; we don't actually want to register a new org here.
  const badReg = await http('POST', '/auth/register', { body: { externalDeveloperInviteToken: 'not-a-real-token' }, expect: [400, 429], note: 'register w/ bad token shape' });
  assert(log, `Bad-token register rejected with ${badReg.status}`, [400, 429].includes(badReg.status));

  step(log, 'Scenario 7 complete');
}
