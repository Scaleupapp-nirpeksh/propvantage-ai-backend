// Scenario 2 — CP onboards an off-platform developer entirely on its own,
// creates a Prospect tagged to that external dev, runs the full pipeline,
// records a manual commission. Developer never joins the platform. This
// covers the "CP-only" pathway: external dev → prospect → status updates →
// booking → manual commission ledger.

import { http, pickArr } from '../lib/api.mjs';
import { login } from '../lib/auth.mjs';
import { step, pass, fail, warn, assert, note } from '../lib/log.mjs';
import { track } from '../lib/manifest.mjs';

export default async function scenarioTwo(ctx, log) {
  step(log, 'Login as CP Owner');
  const cp = await login(ctx.creds.cp.email, ctx.creds.cp.password);
  pass(log, 'CP login OK', { org: cp.org.name });

  step(log, 'CP creates a brand-new ExternalDeveloper (no invite yet)');
  const tag = `s2-${ctx.runId.slice(0, 16)}`;
  const createDev = await http('POST', '/cp/external-developers', {
    token: cp.token,
    body: {
      name: `Skyrise Builders ${tag}`,
      contact: { primaryName: 'Mahesh Iyer', email: `mahesh.${tag}@skyrise.test`, phone: '+91-99000-22221' },
      projects: [{ name: 'Skyrise Heights', location: 'Pune', type: 'apartment' }],
      notes: 'Met at Pune Realty Expo; verbal commission 1.5%',
    },
    expect: 201,
    note: 'cp creates external developer',
  });
  const xdev = createDev.data?.data;
  assert(log, 'ExternalDeveloper created with claimedByOrg=null', !!xdev?._id && !xdev?.claimedByOrg, { id: xdev?._id, claimedByOrg: xdev?.claimedByOrg });
  log.artifacts.externalDeveloperId = xdev?._id;
  track(ctx.manifest, 'externalDevelopers', { id: xdev?._id, scenarioId: log.scenarioId, name: xdev?.name });

  step(log, 'CP creates an external-context Prospect tagged to that developer');
  const prospect = await http('POST', '/cp/prospects', {
    token: cp.token,
    body: {
      firstName: 'Yash',
      lastName: `Patel-${tag}`,
      phone: '+91-90111-' + Math.floor(Math.random() * 90000 + 10000),
      email: `yash.${tag}@example.test`,
      developerContext: { type: 'external', externalDeveloper: xdev._id },
      project: { external: { name: 'Skyrise Heights', location: 'Pune', type: 'apartment' } },
      assignedAgent: cp.userId,
      priority: 'High',
      commissionAgreement: { type: 'percentage', value: 1.5, currency: 'INR', notes: 'Verbal' },
    },
    expect: 201,
    note: 'cp creates external-context prospect',
  });
  const p = prospect.data?.data;
  assert(log, 'External-context prospect created', p?.developerContext?.type === 'external');
  assert(log, 'project.external preserved', p?.project?.external?.name === 'Skyrise Heights');
  log.artifacts.prospectId = p?._id;
  track(ctx.manifest, 'prospects', { id: p?._id, scenarioId: log.scenarioId, name: `${p?.firstName} ${p?.lastName}`, context: 'external' });

  step(log, 'CP runs the prospect through statuses (Contacted → Qualified → Negotiating) via PUT');
  for (const s of ['Contacted', 'Qualified', 'Negotiating']) {
    const upd = await http('PUT', `/cp/prospects/${p._id}`, { token: cp.token, body: { status: s }, expect: 200, note: `cp sets status ${s}` });
    assert(log, `Status -> ${s}`, upd.data?.data?.status === s, { got: upd.data?.data?.status });
  }

  step(log, 'CP adds an activity (note) to the prospect');
  const activity = await http('POST', `/cp/prospects/${p._id}/activities`, {
    token: cp.token,
    body: { type: 'note', note: 'Site visit completed today, will revert with offer by Mon' },
    expect: [200, 201],
    note: 'cp adds activity',
  });
  const acts = activity.data?.data?.activities || [];
  assert(log, 'Activity appended (push-only)', acts.length >= 1, { count: acts.length });

  step(log, 'CP records the booking → expects auto status flip + auto commission compute');
  const booking = await http('POST', `/cp/prospects/${p._id}/booking`, {
    token: cp.token,
    body: { bookedAt: new Date().toISOString(), unitInfo: '2BHK Block C 805', salePrice: 9500000, currency: 'INR', notes: 'Agreement signed' },
    expect: [200, 201],
    note: 'cp records booking',
  });
  const bp = booking.data?.data;
  assert(log, 'Booking flips status -> Booked', bp?.status === 'Booked', { status: bp?.status });
  const expected = bp?.commission?.expectedAmount;
  assert(log, `Expected commission auto-derived (1.5% of 9.5M = ₹1,42,500) got ${expected}`, expected === 142500, { expected });

  step(log, 'CP records full commission payment in one go');
  const pay = await http('POST', `/cp/prospects/${p._id}/commission/payments`, {
    token: cp.token,
    body: { amount: 142500, receivedAt: new Date().toISOString(), reference: 'NEFT-S2-FULL', notes: 'Full settlement' },
    expect: [200, 201],
    note: 'cp full commission payment',
  });
  const finalP = pay.data?.data;
  // commission.paidAmount is NOT a persisted field; it's derived from payments[].
  const totalPaid = (finalP?.commission?.payments || []).reduce((a, x) => a + (x.amount || 0), 0);
  assert(log, 'sum of commission.payments[].amount = expectedAmount', totalPaid === 142500, { totalPaid });
  assert(log, 'commission.status="paid"', finalP?.commission?.status === 'paid', { status: finalP?.commission?.status });

  step(log, 'CP can list its prospects and the external-only one appears');
  const list = await http('GET', '/cp/prospects?limit=50', { token: cp.token, expect: 200, note: 'cp lists prospects' });
  const got = pickArr(list).some((x) => String(x._id) === String(p._id));
  assert(log, 'External-context prospect appears in /cp/prospects list', got);

  step(log, 'Scenario 2 complete');
  note(log, 'Final artifacts', log.artifacts);
}
