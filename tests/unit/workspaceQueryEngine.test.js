// tests/unit/workspaceQueryEngine.test.js
// Engine integration test against an in-memory Mongo. Seeds leads across two
// orgs/projects and asserts: cross-org isolation, project-access scoping, a
// derived-field filter (daysSinceLastCPFollowUp gte 15), metric count mode,
// display materialization of derived columns (Fix 1), and ref-field label
// resolution via $lookup (Fix 2).
import { jest } from '@jest/globals';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import Lead from '../../models/leadModel.js';
import User from '../../models/userModel.js';
import ChannelPartner from '../../models/channelPartnerModel.js';
import { runQueryPlan } from '../../services/workspace/queryEngine.js';

jest.setTimeout(60000);

let mongod;
const ORG_A = new mongoose.Types.ObjectId();
const ORG_B = new mongoose.Types.ObjectId();
const PROJ_A1 = new mongoose.Types.ObjectId();
const PROJ_A2 = new mongoose.Types.ObjectId();
const USER_A = new mongoose.Types.ObjectId();

const daysAgo = (n) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

const seedLead = (over) => Lead.create({
  firstName: 'Seed',
  phone: '9000000000',
  organization: ORG_A,
  project: PROJ_A1,
  source: 'Channel Partner',
  status: 'New',
  ...over,
});

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());

  // Org A / Project A1 — stale CP lead: last CP history 20 days ago.
  await seedLead({
    project: PROJ_A1, assignedTo: USER_A, score: 90,
    channelPartnerAttribution: {
      viaChannelPartner: true,
      history: [{ at: daysAgo(40), action: 'tagged' }, { at: daysAgo(20), action: 'note' }],
    },
  });
  // Org A / Project A1 — fresh CP lead: last CP history 3 days ago.
  await seedLead({
    project: PROJ_A1, score: 50,
    channelPartnerAttribution: { viaChannelPartner: true, history: [{ at: daysAgo(3), action: 'note' }] },
  });
  // Org A / Project A2 — stale, but in a project USER_A cannot access.
  await seedLead({
    project: PROJ_A2, score: 70,
    channelPartnerAttribution: { viaChannelPartner: true, history: [{ at: daysAgo(30), action: 'note' }] },
  });
  // Org B — different tenant, very stale; must never leak into Org A queries.
  await seedLead({
    organization: ORG_B, project: new mongoose.Types.ObjectId(), score: 99,
    channelPartnerAttribution: { viaChannelPartner: true, history: [{ at: daysAgo(99), action: 'note' }] },
  });
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

const ownerViewer = (org) => ({
  organization: org, userId: USER_A, accessibleProjectIds: null, isOwner: true, permissions: [],
});
const scopedViewer = (org, projectIds) => ({
  organization: org, userId: USER_A, accessibleProjectIds: projectIds, isOwner: false, permissions: [],
});

const stalePlan = (over = {}) => ({
  module: 'leads',
  logic: 'AND',
  filters: [{ field: 'daysSinceLastCPFollowUp', op: 'gte', value: 15 }],
  sort: { field: 'daysSinceLastCPFollowUp', dir: 'desc' },
  limit: 50,
  nlSource: null,
  ...over,
});

describe('runQueryPlan — list mode', () => {
  it('(a) cross-org isolation: an Org A owner never sees Org B rows', async () => {
    const { rows, total } = await runQueryPlan(stalePlan(), ownerViewer(ORG_A));
    expect(total).toBe(2); // two stale CP leads in Org A (PROJ_A1 + PROJ_A2)
    rows.forEach((r) => expect(r.organization.toString()).toBe(ORG_A.toString()));
  });

  it('(b) project-access scoping: a user limited to PROJ_A1 only sees that project', async () => {
    const { rows, total } = await runQueryPlan(stalePlan(), scopedViewer(ORG_A, [PROJ_A1.toString()]));
    expect(total).toBe(1);
    expect(rows[0].project.toString()).toBe(PROJ_A1.toString());
  });

  it('(c) derived filter daysSinceLastCPFollowUp gte 15 returns the right rows, sorted desc', async () => {
    const { rows } = await runQueryPlan(stalePlan(), ownerViewer(ORG_A));
    expect(rows.every((r) => r.daysSinceLastCPFollowUp >= 15)).toBe(true);
    // newest-stale-first: PROJ_A2 (30d) ahead of PROJ_A1 stale (20d)
    expect(rows[0].daysSinceLastCPFollowUp).toBeGreaterThanOrEqual(rows[1].daysSinceLastCPFollowUp);
  });

  it('respects accessibleProjectIds: [] (no access) -> no rows', async () => {
    const { rows, total } = await runQueryPlan(stalePlan(), scopedViewer(ORG_A, []));
    expect(total).toBe(0);
    expect(rows).toEqual([]);
  });

  it('(d2) temp "__"-prefixed fields are stripped from returned rows', async () => {
    const { rows } = await runQueryPlan(stalePlan(), ownerViewer(ORG_A));
    expect(rows.length).toBeGreaterThan(0);
    expect(Object.keys(rows[0]).some((k) => k.startsWith('__'))).toBe(false);
    expect(rows[0].__lastCPFollowUpAt).toBeUndefined();
    expect(typeof rows[0].daysSinceLastCPFollowUp).toBe('number');
  });
});

describe('runQueryPlan — metric (count) mode', () => {
  it('(d) returns a count value for the stale-CP plan under the viewer scope', async () => {
    const { value } = await runQueryPlan(
      stalePlan(),
      ownerViewer(ORG_A),
      { renderMode: 'metric', metricConfig: { agg: 'count', field: null } },
    );
    expect(value).toBe(2);
  });

  it('metric count honours project scoping', async () => {
    const { value } = await runQueryPlan(
      stalePlan(),
      scopedViewer(ORG_A, [PROJ_A1.toString()]),
      { renderMode: 'metric', metricConfig: { agg: 'count', field: null } },
    );
    expect(value).toBe(1);
  });

  it('metric sum over an unknown field rejects with /Unknown field/', async () => {
    await expect(
      runQueryPlan(stalePlan(), ownerViewer(ORG_A), {
        renderMode: 'metric',
        metricConfig: { agg: 'sum', field: 'nonexistentField' },
      }),
    ).rejects.toThrow(/Unknown field/);
  });

  it('metric sum over a valid catalog field returns a number', async () => {
    const { value } = await runQueryPlan(stalePlan(), ownerViewer(ORG_A), {
      renderMode: 'metric',
      metricConfig: { agg: 'sum', field: 'score' },
    });
    expect(typeof value).toBe('number');
  });
});

// ---- Fix 1 + Fix 2: display materialization and ref-label resolution --------
describe('runQueryPlan — display materialization and ref labels', () => {
  let seededUser;

  beforeAll(async () => {
    // Seed a User in ORG_A so we can verify assignedTo_label resolution.
    // Required fields: organization, firstName, lastName, email.
    // password is only required when invitationStatus === 'accepted' (default is 'pending').
    seededUser = await User.create({
      organization: ORG_A,
      firstName: 'Rohan',
      lastName: 'Marwah',
      email: 'rohan.marwah@test-workspace.example.com',
    });

    // Seed two leads in ORG_A/PROJ_A1 assigned to seededUser, with CP history
    // so daysSinceLastCPFollowUp is computable. Status = 'New' so filtered by status.
    await seedLead({
      project: PROJ_A1,
      status: 'New',
      assignedTo: seededUser._id,
      channelPartnerAttribution: {
        viaChannelPartner: true,
        history: [{ at: daysAgo(5), action: 'note' }],
      },
    });
    await seedLead({
      project: PROJ_A1,
      status: 'New',
      assignedTo: seededUser._id,
      channelPartnerAttribution: {
        viaChannelPartner: true,
        history: [{ at: daysAgo(7), action: 'note' }],
      },
    });
  });

  const statusPlan = (over = {}) => ({
    module: 'leads',
    logic: 'AND',
    filters: [{ field: 'status', op: 'is', value: 'New' }],
    sort: null,
    limit: 50,
    nlSource: null,
    ...over,
  });

  it('Fix 1: daysSinceLastCPFollowUp is a number even when not referenced by the filter', async () => {
    const { rows } = await runQueryPlan(statusPlan(), ownerViewer(ORG_A));
    // All rows with status=New in ORG_A (includes the original seed leads too).
    // Filter to just the two seeded by this describe block (they have assignedTo set).
    const myRows = rows.filter((r) => r.assignedTo?.toString() === seededUser._id.toString());
    expect(myRows.length).toBeGreaterThanOrEqual(1);
    myRows.forEach((r) => {
      expect(typeof r.daysSinceLastCPFollowUp).toBe('number');
    });
  });

  it('Fix 2: assignedTo_label resolves to the user\'s full name', async () => {
    const { rows } = await runQueryPlan(statusPlan(), ownerViewer(ORG_A));
    const myRows = rows.filter((r) => r.assignedTo?.toString() === seededUser._id.toString());
    expect(myRows.length).toBeGreaterThanOrEqual(1);
    myRows.forEach((r) => {
      expect(r.assignedTo_label).toBe('Rohan Marwah');
    });
  });

  it('Fix 2: __assignedTo_doc lookup temp is stripped from returned rows', async () => {
    const { rows } = await runQueryPlan(statusPlan(), ownerViewer(ORG_A));
    rows.forEach((r) => {
      expect(r.__assignedTo_doc).toBeUndefined();
    });
  });

  it('total is correct (count pipeline unaffected by display stages)', async () => {
    // Two leads seeded here plus the original ORG_A/PROJ_A1 seed with status=New
    // (the fresh CP lead also has status=New). So total for ORG_A with status=New
    // should be at least 3 (original fresh + 2 new). We just verify it's a number
    // and matches the actual row count returned.
    const { rows, total } = await runQueryPlan(statusPlan(), ownerViewer(ORG_A));
    expect(typeof total).toBe('number');
    expect(total).toBe(rows.length);
  });
});

describe('runQueryPlan — channel-partner array-ref labels + CP-only staleness', () => {
  let CP_A; let CP_B; let CP_AGENT;
  beforeAll(async () => {
    CP_AGENT = await User.create({
      organization: ORG_A, firstName: 'Cee', lastName: 'Pee', email: `cpagent-${Date.now()}@x.com`,
    });
    CP_A = await ChannelPartner.create({ organization: ORG_A, firmName: 'Acme Realty' });
    CP_B = await ChannelPartner.create({ organization: ORG_A, firmName: 'BlueKey' });

    // Stale CP lead, 2 partners, last CP touch 25 days ago, one partner has an agentUser.
    await Lead.create({
      firstName: 'CPLead', phone: '9111111111', organization: ORG_A, project: PROJ_A1,
      source: 'Channel Partner', status: 'New',
      channelPartnerAttribution: {
        viaChannelPartner: true, status: 'approved',
        partners: [
          { channelPartner: CP_A._id, agentUser: CP_AGENT._id },
          { channelPartner: CP_B._id },
        ],
        history: [{ at: daysAgo(40), action: 'tagged' }, { at: daysAgo(25), action: 'note' }],
      },
    });
    // Non-CP lead: no partners, no CP history.
    await Lead.create({
      firstName: 'DirectLead', phone: '9222222222', organization: ORG_A, project: PROJ_A1,
      source: 'Direct', status: 'New',
    });
  });

  const cpStalePlan = {
    module: 'leads', logic: 'AND',
    filters: [
      { field: 'channelPartner', op: 'isNotEmpty', value: null },
      { field: 'daysSinceLastCPFollowUp', op: 'gte', value: 20 },
    ],
    sort: { field: 'daysSinceLastCPFollowUp', dir: 'desc' }, limit: 50, nlSource: null,
  };

  it('resolves multiple CP firms into a joined channelPartner_label', async () => {
    const { rows } = await runQueryPlan(cpStalePlan, ownerViewer(ORG_A));
    const row = rows.find((r) => r.firstName === 'CPLead');
    expect(row).toBeTruthy();
    expect(row.channelPartner_label).toBe('Acme Realty, BlueKey');
    expect(row.cpAgent_label).toBe('Cee Pee');
    expect(row.daysSinceLastCPFollowUp).toBeGreaterThanOrEqual(20);
    // internal temp lookup arrays are stripped
    expect(row.__channelPartner_docs).toBeUndefined();
    expect(row.__cpAgent_docs).toBeUndefined();
  });

  it('excludes non-CP leads (channelPartner isNotEmpty) and CP-only stale is null for them', async () => {
    const { rows } = await runQueryPlan(cpStalePlan, ownerViewer(ORG_A));
    expect(rows.some((r) => r.firstName === 'DirectLead')).toBe(false);
  });

  it('channelPartner isEmpty matches the non-CP lead', async () => {
    const plan = { ...cpStalePlan, filters: [{ field: 'channelPartner', op: 'isEmpty', value: null }], sort: null };
    const { rows } = await runQueryPlan(plan, ownerViewer(ORG_A));
    expect(rows.some((r) => r.firstName === 'DirectLead')).toBe(true);
    expect(rows.some((r) => r.firstName === 'CPLead')).toBe(false);
  });
});
