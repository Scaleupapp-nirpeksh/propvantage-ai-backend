// Scenario 5 — Developer invites a brand-new CP (firm) that is NOT yet on the
// platform via POST /api/partnerships/invite-new-cp. While the CP is still
// off-platform, the developer creates leads attributed to the CP shadow
// record. A fresh CP org then registers via the invite link (claimInvite),
// after which both sides should see the same leads with proper tagging.
//
// Cost: this scenario burns one register-limiter slot.

import { http, pickArr } from '../lib/api.mjs';
import { login } from '../lib/auth.mjs';
import { step, assert, note, warn, skip, pass } from '../lib/log.mjs';
import { track } from '../lib/manifest.mjs';

export default async function scenarioFive(ctx, log) {
  step(log, 'Login as Developer Owner');
  const dev = await login(ctx.creds.dev.email, ctx.creds.dev.password);
  pass(log, 'Developer login OK', { org: dev.org.name });

  step(log, 'Developer invites a brand-new off-platform CP firm');
  const tag = `s5-${ctx.runId.slice(0, 16)}`.replace(/[^a-z0-9]/gi, '');
  const cpEmail = `sp4qa-cp-${tag}@scaleupapp.club`;
  const inv = await http('POST', '/partnerships/invite-new-cp', {
    token: dev.token,
    body: {
      firmName: `New CP Firm ${tag}`,
      email: cpEmail,
      category: 'broker_firm',
      commissionTerms: { type: 'percentage', value: 2, notes: 'Verbal' },
      projects: ['6a0c587913c90085c7abfb35'], // Heliconia BKC
    },
    expect: [200, 201],
    note: 'dev invites a new CP firm',
  });
  const cpShadowId = inv.data?.data?.channelPartnerId;
  const inviteLink = inv.data?.data?.inviteLink;
  const inviteToken = inviteLink && (inviteLink.match(/inviteToken=([a-f0-9]+)/) || [])[1];
  assert(log, 'channelPartnerId returned', !!cpShadowId, { cpShadowId });
  assert(log, 'inviteLink contains 64-hex token', typeof inviteToken === 'string' && inviteToken.length === 64);
  log.artifacts.cpShadowId = cpShadowId;
  log.artifacts.inviteToken = inviteToken;
  log.artifacts.inviteLink = inviteLink;
  track(ctx.manifest, 'invites', { cpShadow: cpShadowId, token: inviteToken, scenarioId: log.scenarioId, note: 'dev-invites-cp' });

  step(log, 'Developer creates a CP-attributed Lead while CP is still off-platform');
  const create = await http('POST', '/leads', {
    token: dev.token,
    body: {
      firstName: 'Maya',
      lastName: `OffCP-${tag}`,
      phone: '+91-94000-' + Math.floor(Math.random() * 90000 + 10000),
      project: '6a0c587913c90085c7abfb35',
      source: 'Referral',
      channelPartnerAttribution: {
        viaChannelPartner: true,
        partners: [{ channelPartner: cpShadowId }],
      },
    },
    expect: [200, 201],
    note: 'dev creates lead pre-claim',
  });
  const leadPre = create.data?.data || create.data;
  assert(log, 'Lead created with off-platform CP attribution', !!leadPre?._id);
  log.artifacts.leadIdPreClaim = leadPre?._id;
  track(ctx.manifest, 'leads', { id: leadPre?._id, scenarioId: log.scenarioId, note: 'pre-claim' });

  step(log, 'Fresh CP org registers using the inviteLink (claimInvite path)');
  const reg = await http('POST', '/auth/register', {
    body: {
      firstName: 'Sneha',
      lastName: 'Iyer',
      email: cpEmail,
      password: 'Demo@1234',
      organizationName: `${tag} CP Inc`,
      organizationType: 'channel_partner',
      // RERA, type, category — per registerSchema additions
      channelPartner: { firmName: `New CP Firm ${tag}`, category: 'broker_firm' },
    },
    expect: [200, 201, 429],
    note: 'fresh CP registers',
  });
  if (reg.status === 429) {
    skip(log, 'Hit register rate limiter; cannot complete CP-side claim verification', reg.data);
    return;
  }
  const cpToken = reg.data?.token;
  const cpOrgId = reg.data?.organization?._id || reg.data?.organization;
  assert(log, 'Fresh CP registration succeeded', reg.status === 201 || reg.status === 200, { status: reg.status });
  assert(log, 'Auth token returned', !!cpToken);
  log.artifacts.newCpOrgId = cpOrgId;
  track(ctx.manifest, 'organizations', { id: cpOrgId, name: `${tag} CP Inc`, type: 'channel_partner', scenarioId: log.scenarioId });
  track(ctx.manifest, 'users', { id: reg.data?._id, email: cpEmail, scenarioId: log.scenarioId });

  step(log, 'Newly-registered CP calls claimInvite');
  const claim = await http('POST', '/partnerships/claim-invite', {
    token: cpToken,
    body: { channelPartnerId: cpShadowId, token: inviteToken },
    expect: [200, 201],
    note: 'cp claims dev-issued invite',
  });
  assert(log, 'Claim returned ok', claim.ok, { status: claim.status, data: claim.data });

  step(log, 'After claim: partnership is active from both sides');
  const cpPartners = await http('GET', '/partnerships', { token: cpToken, expect: 200, note: 'new CP lists partnerships' });
  const ourPart = pickArr(cpPartners).find(
    (p) => String(p.developerOrg?._id || p.developerOrg) === String(dev.org._id) && p.status === 'active'
  );
  assert(log, 'New CP sees an active partnership with the developer', !!ourPart);
  log.artifacts.partnershipId = ourPart?._id;
  track(ctx.manifest, 'partnerships', { id: ourPart?._id, scenarioId: log.scenarioId });

  step(log, 'After claim: the pre-claim lead is visible from the new CP side');
  const cpLeads = await http('GET', '/leads?limit=100', { token: cpToken, expect: 200, note: 'new CP lists leads (scoped)' });
  const seen = pickArr(cpLeads).some((l) => String(l._id) === String(leadPre._id));
  assert(log, 'Pre-claim CP-attributed lead is visible to the now-on-platform CP', seen, { totalScoped: pickArr(cpLeads).length });

  step(log, 'Dev continues to see the lead (no orphaning) and advances its status');
  const upd = await http('PUT', `/leads/${leadPre._id}`, { token: dev.token, body: { status: 'Contacted' }, expect: 200, note: 'dev advances post-claim lead' });
  assert(log, 'Dev can still update the lead post-claim', (upd.data?.data || upd.data)?.status === 'Contacted');

  step(log, 'Scenario 5 complete');
  note(log, 'Final artifacts', log.artifacts);
}
