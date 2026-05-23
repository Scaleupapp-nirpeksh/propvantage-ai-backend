// Scenario 6 — Both CP and Developer are on the platform but NOT yet
// connected. We can't fully exercise this with only the one developer org
// (PropVantage Demo Realty) the user provided, because that pair is already
// connected. We verify what we can without a second builder org, and clearly
// flag what's deferred.
//
// What we CAN verify here:
//   (a) The CP can still discover the developer in the marketplace and
//       initiate a partnership request (POST /partnerships) — even though
//       the immediate result will be "already exists" since they're already
//       partnered.
//   (b) The 409 / "already exists" path for partnership creation works.
//   (c) The developer marketplace endpoint returns partnershipStatus=active
//       for already-connected pairs (we already verified this in scenario 1
//       but doing it again here documents the not-connected case is detected).
//
// What's DEFERRED (requires a second builder org with creds):
//   (d) Full "CP requests access → dev grants" flow against an unconnected
//       developer. This is already covered in SP3 regression suite 27.
//   (e) Full "dev invites already-on-platform CP" flow against an unconnected
//       CP. Also covered separately in SP3.

import { http, pickArr } from '../lib/api.mjs';
import { login } from '../lib/auth.mjs';
import { step, assert, note, warn, skip, pass } from '../lib/log.mjs';

export default async function scenarioSix(ctx, log) {
  step(log, 'Login CP + Dev (existing already-connected pair)');
  const cp = await login(ctx.creds.cp.email, ctx.creds.cp.password);
  const dev = await login(ctx.creds.dev.email, ctx.creds.dev.password);

  step(log, 'CP attempts to create a second partnership to the same already-connected dev — expect 4xx');
  const dup = await http('POST', '/partnerships', {
    token: cp.token,
    body: { developerOrg: dev.org._id, initiatedBy: 'channel_partner', commissionTerms: { type: 'percentage', value: 1.5 } },
    expect: [200, 201, 400, 409],
    note: 'cp re-request existing partnership',
  });
  assert(log, 'API returns 4xx on duplicate partnership request', [400, 409].includes(dup.status), { status: dup.status, message: dup.data?.message });

  step(log, 'Marketplace correctly labels existing pair as partnershipStatus=active');
  const browse = await http('GET', '/marketplace/developers?limit=20', { token: cp.token, expect: 200, note: 'cp marketplace browse' });
  const t = pickArr(browse, "developers").find((d) => d.organizationId === dev.org._id);
  assert(log, 'Marketplace shows active status for the connected pair', t?.partnershipStatus === 'active');

  // We cannot test "CP requests access from unconnected dev" or "dev invites
  // unconnected CP" without a second builder org and a second CP org. Flag
  // the deferred parts clearly so the report is honest about coverage.
  warn(log, 'DEFERRED — fresh "CP requests access" against unconnected dev', 'Requires a second builder org on prod; covered separately by SP3 regression suite 27.');
  warn(log, 'DEFERRED — fresh "dev invites already-on-platform CP" against unconnected CP', 'Requires a second CP org on prod; covered separately by SP3 regression suite 27.');

  step(log, 'Scenario 6 complete (partial — deferred items flagged)');
}
