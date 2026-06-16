// tests/unit/workspaceQueryEngine.test.js
// Engine integration test against an in-memory Mongo. Seeds leads across two
// orgs/projects and asserts: cross-org isolation, project-access scoping, a
// derived-field filter (daysSinceLastCPFollowUp gte 15), and metric count mode.
import { jest } from '@jest/globals';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import Lead from '../../models/leadModel.js';
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
});
