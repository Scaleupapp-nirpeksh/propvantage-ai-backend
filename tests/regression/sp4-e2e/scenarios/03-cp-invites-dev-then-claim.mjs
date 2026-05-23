// Scenario 3 — CP creates an external developer, generates an invite, builds
// several prospects against that external dev, then a NEW developer org
// registers using the invite token (triggering claimExternalDeveloper). After
// the claim, the same prospects should show developerContext.type='platform'
// AND be linked to a freshly-created active Partnership.
//
// This is the only scenario that requires a fresh developer org registration
// (counts toward the 3/hr per-IP register limiter).

import { http, pickArr } from '../lib/api.mjs';
import { login } from '../lib/auth.mjs';
import { step, pass, fail, warn, assert, note, skip } from '../lib/log.mjs';
import { track } from '../lib/manifest.mjs';

export default async function scenarioThree(ctx, log) {
  step(log, 'Login as CP Owner');
  const cp = await login(ctx.creds.cp.email, ctx.creds.cp.password);
  pass(log, 'CP login OK', { org: cp.org.name });

  step(log, 'CP creates an ExternalDeveloper (will later be claimed)');
  const tag = `s3-${ctx.runId.slice(0, 16)}`;
  const cd = await http('POST', '/cp/external-developers', {
    token: cp.token,
    body: {
      name: `Riverstone Group ${tag}`,
      contact: { primaryName: 'Aarav Khanna', email: `aarav.${tag}@riverstone.test`, phone: '+91-93000-44441' },
      projects: [{ name: 'Riverstone Towers', location: 'Bengaluru', type: 'apartment' }],
      notes: 'Met CFO at conference; agreed to 1.75%',
    },
    expect: 201,
    note: 'cp creates external dev (claimable)',
  });
  const xdev = cd.data?.data;
  assert(log, 'ExternalDeveloper created', !!xdev?._id, { id: xdev?._id });
  log.artifacts.externalDeveloperId = xdev?._id;
  track(ctx.manifest, 'externalDevelopers', { id: xdev?._id, scenarioId: log.scenarioId, name: xdev?.name });

  step(log, 'CP creates THREE external-context Prospects against this developer');
  const prospectIds = [];
  for (let i = 1; i <= 3; i++) {
    const r = await http('POST', '/cp/prospects', {
      token: cp.token,
      body: {
        firstName: `Lead${i}`,
        lastName: `Riverstone-${tag}`,
        phone: '+91-91100-' + (10000 + i),
        email: `lead${i}.${tag}@example.test`,
        developerContext: { type: 'external', externalDeveloper: xdev._id },
        project: { external: { name: 'Riverstone Towers', location: 'Bengaluru', type: 'apartment' } },
        assignedAgent: cp.userId,
        priority: i === 1 ? 'High' : 'Medium',
        commissionAgreement: { type: 'percentage', value: 1.75, currency: 'INR' },
      },
      expect: 201,
      note: `prospect ${i}`,
    });
    const pid = r.data?.data?._id;
    assert(log, `Prospect ${i} created (external-context)`, !!pid);
    prospectIds.push(pid);
    track(ctx.manifest, 'prospects', { id: pid, scenarioId: log.scenarioId, externalDev: xdev._id });
  }
  log.artifacts.prospectIds = prospectIds;

  step(log, 'CP generates an invite link for the external developer');
  const inv = await http('POST', `/cp/external-developers/${xdev._id}/invite`, { token: cp.token, expect: [200, 201], note: 'cp generates invite' });
  const inviteUrl = inv.data?.data?.inviteUrl || inv.data?.data?.url || inv.data?.url;
  const inviteToken = inv.data?.data?.token || (inviteUrl && (inviteUrl.match(/[a-f0-9]{64}/i) || [])[0]);
  assert(log, 'Invite URL returned', !!inviteUrl, { inviteUrl });
  assert(log, 'Invite token is 64-hex', typeof inviteToken === 'string' && /^[a-f0-9]{64}$/i.test(inviteToken), { inviteToken });
  log.artifacts.inviteToken = inviteToken;
  log.artifacts.inviteUrl = inviteUrl;
  track(ctx.manifest, 'invites', { externalDev: xdev._id, token: inviteToken, scenarioId: log.scenarioId });

  step(log, 'Public invite-lookup endpoint returns valid metadata for the token');
  const lookup = await http('GET', `/external-developer-invites/${inviteToken}`, { expect: 200, note: 'public lookup' });
  assert(log, 'Lookup returns external dev name', (lookup.data?.data?.externalDeveloper?.name || lookup.data?.externalDeveloperName || '').includes('Riverstone'), lookup.data);

  step(log, 'Fresh developer org registers with the invite token (transactional claim)');
  const devEmail = `sp4qa-dev-${tag.replace(/[^a-z0-9]/gi, '')}@scaleupapp.club`;
  const devPassword = 'Demo@1234';
  const regPayload = {
    firstName: 'Aarav',
    lastName: 'Khanna',
    email: devEmail,
    password: devPassword,
    organizationName: `Riverstone Group OnPlatform ${tag}`,
    organizationType: 'builder',
    externalDeveloperInviteToken: inviteToken,
  };
  const reg = await http('POST', '/auth/register', { body: regPayload, expect: [200, 201, 429], note: 'fresh dev registers with token' });
  if (reg.status === 429) {
    skip(log, 'Hit register rate limiter (3/hr per IP) — scenario blocked, deferring claim verification', reg.data);
    return;
  }
  assert(log, 'Register returned 201 with token', reg.status === 201 || reg.status === 200, { status: reg.status });
  const newDevOrgId = reg.data?.organization?._id || reg.data?.organization;
  const newDevToken = reg.data?.token;
  assert(log, 'Response contains new org id', !!newDevOrgId);
  assert(log, 'Response contains auth token', !!newDevToken);
  log.artifacts.newDevOrgId = newDevOrgId;
  track(ctx.manifest, 'organizations', { id: newDevOrgId, name: regPayload.organizationName, type: 'builder', scenarioId: log.scenarioId });
  track(ctx.manifest, 'users', { id: reg.data?._id, email: devEmail, scenarioId: log.scenarioId });
  if (reg.data?.claimWarning) warn(log, 'Claim warning attached to registration response', reg.data.claimWarning);
  else pass(log, 'No claimWarning on response (claim was clean)');

  step(log, 'After claim: ExternalDeveloper.claimedByOrg now points at new org');
  const xdevAfter = await http('GET', `/cp/external-developers/${xdev._id}`, { token: cp.token, expect: 200, note: 'reload external dev post-claim' });
  const cl = xdevAfter.data?.data?.claimedByOrg;
  assert(log, 'claimedByOrg is set to new dev org', cl && String(cl._id || cl) === String(newDevOrgId), { claimedByOrg: cl });

  step(log, 'After claim: invite token cleared');
  assert(log, 'invite.token cleared post-claim', !xdevAfter.data?.data?.invite?.token, { invite: xdevAfter.data?.data?.invite });

  step(log, 'After claim: all 3 prospects retagged to developerContext.type=platform');
  let retaggedCount = 0;
  let partnershipIds = new Set();
  for (const pid of prospectIds) {
    const r = await http('GET', `/cp/prospects/${pid}`, { token: cp.token, expect: 200, note: `reload prospect ${pid}` });
    const p = r.data?.data;
    if (p?.developerContext?.type === 'platform') retaggedCount++;
    if (p?.developerContext?.partnership) partnershipIds.add(String(p.developerContext.partnership._id || p.developerContext.partnership));
  }
  assert(log, 'All 3 prospects now have type=platform', retaggedCount === 3, { retaggedCount });
  assert(log, 'All retagged prospects share a single Partnership doc', partnershipIds.size === 1, { partnershipIds: [...partnershipIds] });
  log.artifacts.newPartnershipId = [...partnershipIds][0];
  track(ctx.manifest, 'partnerships', { id: [...partnershipIds][0], scenarioId: log.scenarioId, note: 'created by claim' });

  step(log, 'After claim: claimed dev sees the partnership too');
  const devPartners = await http('GET', '/channel-partners', { token: newDevToken, expect: 200, note: 'new dev lists CPs' });
  const cpVisibleToDev = pickArr(devPartners).some((cpRec) => String(cpRec.channelPartnerOrg?._id || cpRec.channelPartnerOrg) === String(cp.org._id));
  assert(log, 'New dev sees the CP shadow record', cpVisibleToDev, { count: pickArr(devPartners).length });

  step(log, 'Scenario 3 complete');
  note(log, 'Final artifacts', log.artifacts);
}
