// Scenario 1 — CP and Developer are both on the platform AND already actively
// partnered. We use the existing pair (Offplatform Test Partner ⇄ PropVantage
// Demo Realty) and exercise the full lead lifecycle: CP creates prospect →
// pushes it to the developer → developer accepts the registration → CP
// proposes a status change → developer accepts → CP records booking + manual
// commission. This is the "happy path" through every SP4 endpoint.
//
// The original SP3 "request access → grant" arc is verified separately in
// suite 27 — we don't redo it here (it would require an unconnected CP,
// burning a register-limit slot; the user explicitly OK'd reusing creds).

import { http, pickArr } from '../lib/api.mjs';
import { login } from '../lib/auth.mjs';
import { step, pass, fail, warn, assert, note, skip } from '../lib/log.mjs';
import { track } from '../lib/manifest.mjs';

export default async function scenarioOne(ctx, log) {
  step(log, 'Login as CP Owner (Offplatform Test Partner)');
  const cp = await login(ctx.creds.cp.email, ctx.creds.cp.password);
  pass(log, 'CP login OK', { userId: cp.userId, org: cp.org.name, role: cp.role });
  log.artifacts.cpOrgId = cp.org._id;

  step(log, 'Login as Developer Owner (Rohan / PropVantage Demo Realty)');
  const dev = await login(ctx.creds.dev.email, ctx.creds.dev.password);
  pass(log, 'Developer login OK', { userId: dev.userId, org: dev.org.name, role: dev.role });
  log.artifacts.devOrgId = dev.org._id;

  step(log, 'Confirm an active partnership exists between the two orgs');
  const partnersList = await http('GET', '/marketplace/developers?limit=20', { token: cp.token, expect: 200, note: 'cp browses developers' });
  const target = pickArr(partnersList, "developers").find((d) => d.organizationId === dev.org._id);
  assert(log, 'Developer is visible in CP marketplace', !!target, target);
  assert(log, 'Partnership status is active', target?.partnershipStatus === 'active', target?.partnershipStatus);

  // Resolve the Partnership document id (needed to create platform-context prospect)
  const partnersResp = await http('GET', '/partnerships', { token: cp.token, expect: 200, note: 'cp list partnerships' });
  const partnership = pickArr(partnersResp).find(
    (p) => String(p.developerOrg?._id || p.developerOrg) === String(dev.org._id) && p.status === 'active'
  );
  assert(log, 'Partnership doc resolvable from CP side', !!partnership, partnership && { id: partnership._id, status: partnership.status });
  log.artifacts.partnershipId = partnership?._id;

  // Pick a project allowed under the partnership
  const projectId = (partnership?.approvedProjects?.[0]?._id || partnership?.approvedProjects?.[0])
    || '6a0c587913c90085c7abfb35'; // Heliconia BKC fallback (from discovery)
  log.artifacts.projectId = projectId;
  note(log, 'Using project for platform-context prospect', { projectId });

  step(log, 'CP creates a platform-context Prospect');
  const tag = `s1-${ctx.runId.slice(0, 16)}`;
  const prospectPayload = {
    firstName: 'Anaya',
    lastName: `Joshi-${tag}`,
    phone: '+91-90000-' + Math.floor(Math.random() * 90000 + 10000),
    email: `anaya.${tag}@example.test`,
    developerContext: { type: 'platform', partnership: partnership._id },
    project: { platform: projectId },
    assignedAgent: cp.userId,
    priority: 'High',
    creationNote: 'SP4-E2E S1: spoke at site visit, very interested in 3BHK',
    commissionAgreement: { type: 'percentage', value: 2, currency: 'INR', notes: 'Per active partnership terms' },
  };
  const create = await http('POST', '/cp/prospects', { token: cp.token, body: prospectPayload, expect: 201, note: 'CP creates prospect' });
  const prospect = create.data?.data;
  assert(log, 'Prospect created with developerContext.type=platform', prospect?.developerContext?.type === 'platform');
  log.artifacts.prospectId = prospect?._id;
  track(ctx.manifest, 'prospects', { id: prospect?._id, scenarioId: log.scenarioId, name: `${prospect?.firstName} ${prospect?.lastName}` });

  step(log, 'CP pushes the Prospect to the developer (creates pending Lead)');
  const push = await http('POST', `/cp/prospects/${prospect._id}/push`, { token: cp.token, expect: [200, 201], note: 'push to developer' });
  const lead = push.data?.data?.lead || push.data?.data;
  assert(log, 'Push response carries a Lead id', !!lead?._id, lead && { id: lead._id, status: lead.status });
  assert(log, 'Created Lead has status="pending"', lead?.status === 'pending', { status: lead?.status });
  log.artifacts.leadId = lead?._id;
  track(ctx.manifest, 'leads', { id: lead?._id, scenarioId: log.scenarioId, status: lead?.status });

  step(log, 'Developer sees the pending Lead in /api/leads/registrations');
  const regs = await http('GET', '/leads/registrations', { token: dev.token, expect: 200, note: 'developer registrations queue' });
  const found = pickArr(regs, "leads").some((l) => String(l._id) === String(lead._id));
  assert(log, 'Pending Lead appears in developer registrations queue', found, { totalShown: pickArr(regs, "leads").length });

  step(log, 'Developer accepts the registration');
  const accept = await http('PATCH', `/leads/${lead._id}/registration`, { token: dev.token, body: { action: 'accept' }, expect: 200, note: 'dev accepts registration' });
  assert(log, 'Acceptance API returned ok', accept.ok);
  // Reload lead to confirm status flipped off pending
  const reload = await http('GET', `/leads/${lead._id}`, { token: dev.token, expect: 200, note: 'reload lead post-accept' });
  const leadAfterAccept = reload.data?.data || reload.data;
  assert(log, 'Lead status no longer "pending" after accept', leadAfterAccept?.status && leadAfterAccept.status !== 'pending', { status: leadAfterAccept?.status });

  step(log, 'CP can see the same Lead in its leads list (cross-org visibility via partnerAccessScope)');
  const cpLeads = await http('GET', '/leads?limit=100', { token: cp.token, expect: 200, note: 'cp lists leads (scoped)' });
  const cpSawIt = pickArr(cpLeads).some((l) => String(l._id) === String(lead._id));
  assert(log, 'CP sees the cross-org lead in its own /leads list', cpSawIt, { totalScoped: pickArr(cpLeads).length });

  step(log, 'CP proposes a status change (Qualified)');
  const propose = await http('POST', `/cp/prospects/${prospect._id}/propose-status`, {
    token: cp.token,
    body: { status: 'Qualified', note: 'Budget confirmed, agreement on amenities' },
    expect: [200, 201],
    note: 'cp proposes status change',
  });
  assert(log, 'Proposal accepted by API', propose.ok);

  step(log, 'Developer sees the proposed-status on the Lead');
  const leadWithProp = await http('GET', `/leads/${lead._id}`, { token: dev.token, expect: 200, note: 'dev reads lead with proposal' });
  const propStatus = (leadWithProp.data?.data || leadWithProp.data)?.proposedStatusChange?.status;
  assert(log, 'proposedStatusChange.status === "Qualified" from dev side', propStatus === 'Qualified', { propStatus });

  step(log, 'Developer accepts the proposed status change');
  const decideProp = await http('PATCH', `/leads/${lead._id}/proposal`, { token: dev.token, body: { action: 'accept' }, expect: 200, note: 'dev accepts proposal' });
  assert(log, 'Decide-proposal API returned ok', decideProp.ok);
  const leadAfterProp = await http('GET', `/leads/${lead._id}`, { token: dev.token, expect: 200, note: 'reload lead post-proposal-accept' });
  const ls = (leadAfterProp.data?.data || leadAfterProp.data)?.status;
  const ps = (leadAfterProp.data?.data || leadAfterProp.data)?.proposedStatusChange;
  assert(log, 'Lead.status promoted to Qualified', ls === 'Qualified', { status: ls });
  assert(log, 'proposedStatusChange cleared after accept', !ps || !ps.status, { ps });

  step(log, 'Developer advances the lead status to Negotiating directly (cp_lead_status_changed should fire)');
  const updLead = await http('PUT', `/leads/${lead._id}`, { token: dev.token, body: { status: 'Negotiating' }, expect: 200, note: 'dev updates lead status' });
  assert(log, 'Lead status accepted as "Negotiating"', (updLead.data?.data || updLead.data)?.status === 'Negotiating');

  step(log, 'CP records a booking on the prospect');
  const booking = await http('POST', `/cp/prospects/${prospect._id}/booking`, {
    token: cp.token,
    body: { bookedAt: new Date().toISOString(), unitInfo: '3BHK Tower A 1204', salePrice: 35000000, currency: 'INR', notes: 'Agreement signed' },
    expect: [200, 201],
    note: 'cp records booking',
  });
  const booked = booking.data?.data;
  assert(log, 'Booking recorded', !!booked?.booking?.bookedAt);
  assert(log, 'Prospect status auto-flipped to Booked', booked?.status === 'Booked', { status: booked?.status });
  assert(log, 'Commission expectedAmount auto-derived from agreement', typeof booked?.commission?.expectedAmount === 'number' && booked.commission.expectedAmount > 0, booked?.commission);

  step(log, 'CP records two partial commission payments');
  const pay1 = await http('POST', `/cp/prospects/${prospect._id}/commission/payments`, {
    token: cp.token, body: { amount: 350000, receivedAt: new Date().toISOString(), reference: 'NEFT-001', notes: 'First tranche' }, expect: [200, 201], note: 'cp commission payment 1',
  });
  assert(log, 'First payment recorded', pay1.ok);
  const pay2 = await http('POST', `/cp/prospects/${prospect._id}/commission/payments`, {
    token: cp.token, body: { amount: 350000, receivedAt: new Date().toISOString(), reference: 'NEFT-002', notes: 'Second tranche' }, expect: [200, 201], note: 'cp commission payment 2',
  });
  const afterPay = pay2.data?.data;
  assert(log, 'paidAmount accumulates across payments', (afterPay?.commission?.paidAmount || 0) >= 700000, afterPay?.commission);
  // status should be 'partial' (paid < expected) or 'paid' (>=)
  const cs = afterPay?.commission?.status;
  assert(log, `commission.status reflects payment progress (got "${cs}")`, ['partial', 'paid'].includes(cs), { commissionStatus: cs });

  step(log, 'Scenario 1 complete');
  note(log, 'Final artifacts', log.artifacts);
}
