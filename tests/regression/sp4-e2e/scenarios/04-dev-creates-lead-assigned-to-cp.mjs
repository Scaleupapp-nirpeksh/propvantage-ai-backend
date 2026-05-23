// Scenario 4 — Developer creates a Lead directly, attributing it to the
// active CP. Lead becomes visible on the CP side via partnerAccessScope.
// Then the CP proposes a status, developer rejects with reason, CP can see
// the rejection, dev advances the lead status, CP gets cp_lead_status_changed.

import { http, pickArr } from '../lib/api.mjs';
import { login } from '../lib/auth.mjs';
import { step, assert, note, pass, warn, skip, fail } from '../lib/log.mjs';
import { track } from '../lib/manifest.mjs';

export default async function scenarioFour(ctx, log) {
  step(log, 'Login as CP Owner');
  const cp = await login(ctx.creds.cp.email, ctx.creds.cp.password);
  step(log, 'Login as Developer Owner');
  const dev = await login(ctx.creds.dev.email, ctx.creds.dev.password);

  step(log, 'Resolve the active partnership + CP shadow record');
  const partners = await http('GET', '/partnerships', { token: dev.token, expect: 200, note: 'dev list partnerships' });
  const partnership = pickArr(partners).find(
    (p) => String(p.channelPartnerOrg?._id || p.channelPartnerOrg) === String(cp.org._id) && p.status === 'active'
  );
  if (!assert(log, 'Active partnership exists from dev side', !!partnership)) return;
  log.artifacts.partnershipId = partnership._id;

  // Find the CP shadow record id (referenced by Lead.channelPartnerAttribution.partners[].channelPartner)
  const cpShadowList = await http('GET', '/channel-partners', { token: dev.token, expect: 200, note: 'dev lists CPs' });
  const cpShadow = pickArr(cpShadowList).find((c) => String(c.channelPartnerOrg?._id || c.channelPartnerOrg) === String(cp.org._id));
  if (!assert(log, 'CP shadow record resolvable', !!cpShadow)) return;
  log.artifacts.cpShadowId = cpShadow._id;

  // Project id — pick one approved under partnership
  const projectId = partnership.approvedProjects?.[0]?._id || partnership.approvedProjects?.[0] || '6a0c587913c90085c7abfb35';
  log.artifacts.projectId = projectId;

  step(log, 'Developer creates a Lead and attributes it to the CP');
  const tag = `s4-${ctx.runId.slice(0, 16)}`;
  const create = await http('POST', '/leads', {
    token: dev.token,
    body: {
      firstName: 'Devansh',
      lastName: `Direct-${tag}`,
      phone: '+91-93333-' + Math.floor(Math.random() * 90000 + 10000),
      email: `devansh.${tag}@example.test`,
      project: projectId,
      source: 'Referral',
      channelPartnerAttribution: {
        viaChannelPartner: true,
        partners: [{ channelPartner: cpShadow._id }],
      },
    },
    expect: [200, 201],
    note: 'dev creates CP-attributed lead',
  });
  const lead = create.data?.data || create.data;
  if (!assert(log, 'Lead created', !!lead?._id, lead && { id: lead._id, status: lead.status })) return;
  log.artifacts.leadId = lead._id;
  track(ctx.manifest, 'leads', { id: lead._id, scenarioId: log.scenarioId, source: 'dev-attributed' });

  step(log, 'CP can see the dev-attributed lead in /leads (partnerAccessScope)');
  const cpLeads = await http('GET', '/leads?limit=200', { token: cp.token, expect: 200, note: 'cp lists scoped leads' });
  const seen = pickArr(cpLeads).some((l) => String(l._id) === String(lead._id));
  assert(log, 'CP sees the dev-created lead in its own /leads', seen, { totalScoped: pickArr(cpLeads).length });

  step(log, 'CP can GET the lead by id (in-scope)');
  const cpGet = await http('GET', `/leads/${lead._id}`, { token: cp.token, expect: [200, 404], note: 'cp gets lead by id' });
  assert(log, 'CP receives 200 on in-scope lead GET', cpGet.status === 200);

  // We need the prospectId on the CP side. Lead was created by dev — no sourceProspect.
  // CP-side prospect doesn't exist for this lead. Status proposal in SP4 fires from
  // POST /cp/prospects/:id/propose-status — which means CP must own a prospect that
  // points at this lead. The push direction creates that link. For a dev-originated
  // lead, the CP cannot "propose status" without first having a prospect; the
  // current SP4 design treats dev-originated leads as "view + comment via activity"
  // on the CP side, not "propose status".
  warn(log, 'Dev-originated lead: CP propose-status flow is not available (CP has no source Prospect for this lead) — verifying read-only visibility instead');

  step(log, 'Developer updates the lead status (Contacted) — should fire cp_lead_status_changed');
  const upd1 = await http('PUT', `/leads/${lead._id}`, { token: dev.token, body: { status: 'Contacted' }, expect: 200, note: 'dev sets Contacted' });
  assert(log, 'Lead status updated -> Contacted', (upd1.data?.data || upd1.data)?.status === 'Contacted');

  step(log, 'CP notification list should mention the status change');
  // wait a moment for async notification fan-out
  await new Promise((r) => setTimeout(r, 1500));
  const notif = await http('GET', '/notifications?limit=20', { token: cp.token, expect: 200, note: 'cp notifications' });
  const hits = pickArr(notif, "notifications").filter(
    (n) => /cp_lead_status_changed|status changed/i.test(String(n.type || n.message || ''))
  );
  assert(log, `CP has at least one cp_lead_status_changed notification (got ${hits.length})`, hits.length >= 1, { sample: hits[0] });

  step(log, 'Developer advances further (Qualified → Negotiating)');
  for (const s of ['Qualified', 'Negotiating']) {
    const r = await http('PUT', `/leads/${lead._id}`, { token: dev.token, body: { status: s }, expect: 200, note: `dev sets ${s}` });
    assert(log, `Lead -> ${s}`, (r.data?.data || r.data)?.status === s);
  }

  step(log, 'Scenario 4 complete');
  note(log, 'Final artifacts', log.artifacts);
}
