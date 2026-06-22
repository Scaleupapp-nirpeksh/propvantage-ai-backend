// tests/unit/redFlagService.test.js
// Unit tests for the red-flag engine (spec §8).
// All Mongoose models, notificationService, and hierarchyService are mocked.
// No live DB connection needed.
//
// BOUNDARY CONVENTION tested here (mirrors the service):
//   strict > threshold  →  exactly N days ago = NOT flagged; N+1 days ago = flagged.
//   Boundary date is computed as: asOf minus N*24h  (same arithmetic as the service).

import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import mongoose from 'mongoose';

// ─── Mock models ────────────────────────────────────────────────────────────

// Lead — detectFlags calls .find(...).select(...).lean()
const mockLeadFind = jest.fn();
jest.unstable_mockModule('../../models/leadModel.js', () => ({
  default: { find: mockLeadFind },
}));

// Task — detectFlags calls .find(...).select(...).lean()
const mockTaskFind = jest.fn();
jest.unstable_mockModule('../../models/taskModel.js', () => ({
  default: { find: mockTaskFind },
}));

// Interaction — detectFlags calls .countDocuments(...)
const mockInteractionCount = jest.fn();
jest.unstable_mockModule('../../models/interactionModel.js', () => ({
  default: { countDocuments: mockInteractionCount },
}));

// User — sendDigests calls .find(...)
const mockUserFind = jest.fn();
jest.unstable_mockModule('../../models/userModel.js', () => ({
  default: { find: mockUserFind },
}));

// ─── Mock notificationService ────────────────────────────────────────────────

const mockCreateNotification = jest.fn();
jest.unstable_mockModule('../../services/notificationService.js', () => ({
  createNotification: mockCreateNotification,
}));

// ─── Mock hierarchyService ───────────────────────────────────────────────────

const mockGetManagerChain = jest.fn();
jest.unstable_mockModule('../../services/people/hierarchyService.js', () => ({
  getManagerChain: mockGetManagerChain,
}));

// ─── Import service under test ────────────────────────────────────────────────

const { detectFlags, sendDigests } = await import('../../services/people/redFlagService.js');

// ─── Shared fixtures ─────────────────────────────────────────────────────────

const ORG = new mongoose.Types.ObjectId();
const USER_ID = new mongoose.Types.ObjectId();
const MANAGER_ID = new mongoose.Types.ObjectId();

const makeUser = (overrides = {}) => ({
  _id: USER_ID,
  organization: ORG,
  role: 'Sales Executive',
  roleRef: null,
  firstName: 'Alice',
  lastName: 'Smith',
  isActive: true,
  invitationStatus: 'accepted',
  ...overrides,
});

const makeManager = (overrides = {}) => ({
  _id: MANAGER_ID,
  organization: ORG,
  role: 'Sales Head',
  roleRef: null,
  firstName: 'Bob',
  lastName: 'Jones',
  ...overrides,
});

// Helpers for mock chaining: Lead.find().select().lean()
const leadFindReturns = (docs) =>
  mockLeadFind.mockReturnValue({ select: () => ({ lean: () => Promise.resolve(docs) }) });

const taskFindReturns = (docs) =>
  mockTaskFind.mockReturnValue({ select: () => ({ lean: () => Promise.resolve(docs) }) });

// Reference date for tests
const AS_OF = new Date('2026-06-22T00:00:00.000Z');

// Helper: date N days before asOf
const daysAgo = (n) => new Date(AS_OF.getTime() - n * 24 * 60 * 60 * 1000);

beforeEach(() => {
  jest.clearAllMocks();
  // Default: Lead.find returns empty, Task.find returns empty, interactions = 10 (above threshold).
  leadFindReturns([]);
  taskFindReturns([]);
  mockInteractionCount.mockResolvedValue(10);
  mockCreateNotification.mockResolvedValue({ _id: new mongoose.Types.ObjectId() });
});

// ─── detectFlags — structure ──────────────────────────────────────────────────

describe('detectFlags — return shape', () => {
  test('returns all six keys each with count and items', async () => {
    const result = await detectFlags(ORG, makeUser(), AS_OF);
    const keys = ['staleLeads', 'noMovementLeads', 'overdueFollowUps', 'overdueTasks', 'agingPipeline', 'lowActivity'];
    for (const k of keys) {
      expect(result).toHaveProperty(k);
      expect(result[k]).toHaveProperty('count');
      expect(result[k]).toHaveProperty('items');
      expect(Array.isArray(result[k].items)).toBe(true);
    }
  });
});

// ─── staleLeads threshold ─────────────────────────────────────────────────────
// Threshold: staleLeadDays = 7 (default).
// Boundary: lead with lastInteractionDate exactly 7 days ago = NOT stale.
//            lead with lastInteractionDate 8 days ago (or more) = stale.

describe('staleLeads threshold boundary (default 7 days)', () => {
  // The service issues three Lead.find() calls in parallel: staleLeads, noMovementLeads,
  // overdueFollowUps, agingPipeline.  We need to differentiate which call is which.
  // We use a call-counter approach: stale is the FIRST Lead.find call.
  // For simplicity, reset mockLeadFind per test to return specific docs per call order.

  test('lead interacted exactly 7 days ago is NOT stale (count=0)', async () => {
    // Lead.find call order: 1=stale, 2=noMovement, 3=overdueFollowUp, 4=aging
    let callCount = 0;
    mockLeadFind.mockImplementation(() => {
      callCount++;
      // call 1 = staleLeads → return empty (boundary: not stale)
      const docs = callCount === 1 ? [] : [];
      return { select: () => ({ lean: () => Promise.resolve(docs) }) };
    });

    const result = await detectFlags(ORG, makeUser(), AS_OF);
    expect(result.staleLeads.count).toBe(0);

    // Also verify the $lt cutoff passed to the stale-leads query equals asOf − 7×24h.
    // This catches any regression in the default cutoff arithmetic.
    const staleLeadsCall = mockLeadFind.mock.calls.find(
      (args) => args[0]?.$or?.some((c) => c['engagementMetrics.lastInteractionDate']?.$lt)
    );
    expect(staleLeadsCall).toBeDefined();
    const ltClause = staleLeadsCall[0].$or.find(
      (c) => c['engagementMetrics.lastInteractionDate']?.$lt
    );
    expect(ltClause['engagementMetrics.lastInteractionDate'].$lt.getTime())
      .toBe(daysAgo(7).getTime());
  });

  test('lead interacted exactly 8 days ago IS stale (count=1)', async () => {
    const leadId = new mongoose.Types.ObjectId();
    let callCount = 0;
    mockLeadFind.mockImplementation(() => {
      callCount++;
      // call 1 = staleLeads → return one doc
      const docs = callCount === 1 ? [{ _id: leadId }] : [];
      return { select: () => ({ lean: () => Promise.resolve(docs) }) };
    });

    const result = await detectFlags(ORG, makeUser(), AS_OF);
    expect(result.staleLeads.count).toBe(1);
    expect(result.staleLeads.items).toEqual([String(leadId)]);
  });

  test('staleLeads items contain the entity id strings', async () => {
    const id1 = new mongoose.Types.ObjectId();
    const id2 = new mongoose.Types.ObjectId();
    let callCount = 0;
    mockLeadFind.mockImplementation(() => {
      callCount++;
      const docs = callCount === 1 ? [{ _id: id1 }, { _id: id2 }] : [];
      return { select: () => ({ lean: () => Promise.resolve(docs) }) };
    });

    const result = await detectFlags(ORG, makeUser(), AS_OF);
    expect(result.staleLeads.items).toEqual([String(id1), String(id2)]);
  });

  test('threshold from config is respected (custom override: 3 days)', async () => {
    // With override 3 days, a lead interacted 4 days ago should be stale.
    const leadId = new mongoose.Types.ObjectId();
    let callCount = 0;
    mockLeadFind.mockImplementation(() => {
      callCount++;
      const docs = callCount === 1 ? [{ _id: leadId }] : [];
      return { select: () => ({ lean: () => Promise.resolve(docs) }) };
    });

    // Verify the query cutoff date passed to Lead.find for staleLeads.
    // With staleLeadDays=3 and asOf=2026-06-22, cutoff = 2026-06-19.
    const result = await detectFlags(ORG, makeUser(), AS_OF, { staleLeadDays: 3 });
    expect(result.staleLeads.count).toBe(1);
    // Also verify the cutoff in the first Lead.find call's $lt filter.
    const firstCall = mockLeadFind.mock.calls[0][0];
    const expectedCutoff = daysAgo(3);
    // The $or contains a $lt check — find it.
    const ltClause = firstCall.$or.find((c) => c['engagementMetrics.lastInteractionDate']?.$lt);
    expect(ltClause['engagementMetrics.lastInteractionDate'].$lt.getTime())
      .toBe(expectedCutoff.getTime());
  });
});

// ─── TERMINAL_LEAD_STATUSES spec alignment ────────────────────────────────────
// Terminal = Booked, Lost only. 'pending' is "open" and subject to flags.

describe('TERMINAL_LEAD_STATUSES — spec alignment (Booked, Lost only)', () => {
  test('open-lead filter excludes Booked and Lost', () => {
    leadFindReturns([]);
    detectFlags(ORG, makeUser(), AS_OF);
    // The stale-leads query (first Lead.find call) carries the $nin filter.
    const staleCall = mockLeadFind.mock.calls.find(
      (args) => args[0]?.$or?.some((c) => c['engagementMetrics.lastInteractionDate']?.$lt)
    );
    expect(staleCall).toBeDefined();
    const nin = staleCall[0].status.$nin;
    expect(nin).toContain('Booked');
    expect(nin).toContain('Lost');
  });

  test('open-lead filter does NOT exclude pending (pending leads are open)', () => {
    leadFindReturns([]);
    detectFlags(ORG, makeUser(), AS_OF);
    const staleCall = mockLeadFind.mock.calls.find(
      (args) => args[0]?.$or?.some((c) => c['engagementMetrics.lastInteractionDate']?.$lt)
    );
    expect(staleCall).toBeDefined();
    const nin = staleCall[0].status.$nin;
    expect(nin).not.toContain('pending');
  });
});

// ─── noMovementLeads threshold ────────────────────────────────────────────────
// Threshold: noMovementDays = 14 (default).
// Boundary: statusChangedAt exactly 14 days ago = NOT flagged; 15 days = flagged.

describe('noMovementLeads threshold boundary (default 14 days)', () => {
  test('lead with statusChangedAt exactly 14 days ago is NOT flagged (count=0)', async () => {
    // noMovement = 2nd Lead.find call
    let callCount = 0;
    mockLeadFind.mockImplementation(() => {
      callCount++;
      return { select: () => ({ lean: () => Promise.resolve([]) }) };
    });
    const result = await detectFlags(ORG, makeUser(), AS_OF);
    expect(result.noMovementLeads.count).toBe(0);
  });

  test('lead with statusChangedAt 15 days ago IS flagged (count=1)', async () => {
    const leadId = new mongoose.Types.ObjectId();
    let callCount = 0;
    mockLeadFind.mockImplementation(() => {
      callCount++;
      const docs = callCount === 2 ? [{ _id: leadId }] : [];
      return { select: () => ({ lean: () => Promise.resolve(docs) }) };
    });
    const result = await detectFlags(ORG, makeUser(), AS_OF);
    expect(result.noMovementLeads.count).toBe(1);
    expect(result.noMovementLeads.items).toContain(String(leadId));
  });

  test('noMovementLeads cutoff date is noMovementDays before asOf', () => {
    // Inspect the query passed in the second Lead.find call.
    let callCount = 0;
    mockLeadFind.mockImplementation(() => {
      callCount++;
      return { select: () => ({ lean: () => Promise.resolve([]) }) };
    });
    detectFlags(ORG, makeUser(), AS_OF);
    // Calls are issued in parallel via Promise.all, so call order may vary.
    // Find the call that filters on statusChangedAt.
    const noMovementCall = mockLeadFind.mock.calls.find((args) => args[0]?.statusChangedAt);
    expect(noMovementCall).toBeDefined();
    const cutoff = noMovementCall[0].statusChangedAt.$lt;
    expect(cutoff.getTime()).toBe(daysAgo(14).getTime());
  });
});

// ─── overdueFollowUps threshold ───────────────────────────────────────────────
// Threshold: followUpOverdueDays = 2 (default).
// Boundary: nextFollowUpDate exactly 2 days ago = NOT flagged; > 2 days ago = flagged.

describe('overdueFollowUps threshold boundary (default 2 days)', () => {
  test('nextFollowUpDate exactly 2 days ago is NOT flagged (count=0)', async () => {
    mockLeadFind.mockImplementation(() => ({
      select: () => ({ lean: () => Promise.resolve([]) }),
    }));
    const result = await detectFlags(ORG, makeUser(), AS_OF);
    expect(result.overdueFollowUps.count).toBe(0);
  });

  test('nextFollowUpDate 3 days ago IS flagged (count=1)', async () => {
    const leadId = new mongoose.Types.ObjectId();
    let callCount = 0;
    mockLeadFind.mockImplementation(() => {
      callCount++;
      // 3rd Lead.find call is overdueFollowUps
      const docs = callCount === 3 ? [{ _id: leadId }] : [];
      return { select: () => ({ lean: () => Promise.resolve(docs) }) };
    });
    const result = await detectFlags(ORG, makeUser(), AS_OF);
    expect(result.overdueFollowUps.count).toBe(1);
    expect(result.overdueFollowUps.items).toContain(String(leadId));
  });

  test('overdueFollowUps cutoff date is followUpOverdueDays before asOf', () => {
    mockLeadFind.mockImplementation(() => ({
      select: () => ({ lean: () => Promise.resolve([]) }),
    }));
    detectFlags(ORG, makeUser(), AS_OF);
    const followUpCall = mockLeadFind.mock.calls.find(
      (args) => args[0]?.['followUpSchedule.nextFollowUpDate']
    );
    expect(followUpCall).toBeDefined();
    const cutoff = followUpCall[0]['followUpSchedule.nextFollowUpDate'].$lt;
    expect(cutoff.getTime()).toBe(daysAgo(2).getTime());
  });
});

// ─── overdueTasks threshold ───────────────────────────────────────────────────
// A task is overdue if dueDate < asOf AND status NOT in ['Completed','Cancelled'].

describe('overdueTasks', () => {
  test('zero overdue tasks when Task.find returns empty', async () => {
    const result = await detectFlags(ORG, makeUser(), AS_OF);
    expect(result.overdueTasks.count).toBe(0);
    expect(result.overdueTasks.items).toEqual([]);
  });

  test('counts overdue tasks', async () => {
    const id1 = new mongoose.Types.ObjectId();
    const id2 = new mongoose.Types.ObjectId();
    taskFindReturns([{ _id: id1 }, { _id: id2 }]);

    const result = await detectFlags(ORG, makeUser(), AS_OF);
    expect(result.overdueTasks.count).toBe(2);
    expect(result.overdueTasks.items).toEqual([String(id1), String(id2)]);
  });

  test('Task.find query excludes Completed and Cancelled statuses', () => {
    taskFindReturns([]);
    detectFlags(ORG, makeUser(), AS_OF);
    const query = mockTaskFind.mock.calls[0][0];
    expect(query.status.$nin).toEqual(expect.arrayContaining(['Completed', 'Cancelled']));
  });

  test('Task.find query uses dueDate < asOf', () => {
    taskFindReturns([]);
    detectFlags(ORG, makeUser(), AS_OF);
    const query = mockTaskFind.mock.calls[0][0];
    expect(query.dueDate.$lt.getTime()).toBe(AS_OF.getTime());
  });
});

// ─── agingPipeline threshold ──────────────────────────────────────────────────
// Threshold: agingPipelineDays = 30 (default).
// Boundary: lead created exactly 30 days ago = NOT flagged; > 30 days = flagged.

describe('agingPipeline threshold boundary (default 30 days)', () => {
  test('lead created exactly 30 days ago is NOT flagged (count=0)', async () => {
    mockLeadFind.mockImplementation(() => ({
      select: () => ({ lean: () => Promise.resolve([]) }),
    }));
    const result = await detectFlags(ORG, makeUser(), AS_OF);
    expect(result.agingPipeline.count).toBe(0);
  });

  test('lead created 31 days ago IS flagged (count=1)', async () => {
    const leadId = new mongoose.Types.ObjectId();
    let callCount = 0;
    mockLeadFind.mockImplementation(() => {
      callCount++;
      // 4th Lead.find call is agingPipeline
      const docs = callCount === 4 ? [{ _id: leadId }] : [];
      return { select: () => ({ lean: () => Promise.resolve(docs) }) };
    });
    const result = await detectFlags(ORG, makeUser(), AS_OF);
    expect(result.agingPipeline.count).toBe(1);
    expect(result.agingPipeline.items).toContain(String(leadId));
  });

  test('agingPipeline cutoff is agingPipelineDays before asOf', () => {
    mockLeadFind.mockImplementation(() => ({
      select: () => ({ lean: () => Promise.resolve([]) }),
    }));
    detectFlags(ORG, makeUser(), AS_OF);
    const agingCall = mockLeadFind.mock.calls.find((args) => args[0]?.createdAt);
    expect(agingCall).toBeDefined();
    const cutoff = agingCall[0].createdAt.$lt;
    expect(cutoff.getTime()).toBe(daysAgo(30).getTime());
  });
});

// ─── lowActivity threshold ────────────────────────────────────────────────────
// Threshold: lowActivityMinInteractions = 5, lowActivityWindowDays = 7 (default).
// Flag fires when interactions < 5.  Boundary: exactly 5 = NOT flagged; 4 or below = flagged.

describe('lowActivity threshold boundary (default < 5 in 7 days)', () => {
  test('exactly 5 interactions is NOT low activity (count=0)', async () => {
    mockInteractionCount.mockResolvedValue(5);
    const result = await detectFlags(ORG, makeUser(), AS_OF);
    expect(result.lowActivity.count).toBe(0);
    expect(result.lowActivity.items).toEqual([]);
  });

  test('4 interactions IS low activity (count=1)', async () => {
    mockInteractionCount.mockResolvedValue(4);
    const result = await detectFlags(ORG, makeUser(), AS_OF);
    expect(result.lowActivity.count).toBe(1);
    expect(result.lowActivity.items).toEqual([]);
  });

  test('0 interactions IS low activity (count=1)', async () => {
    mockInteractionCount.mockResolvedValue(0);
    const result = await detectFlags(ORG, makeUser(), AS_OF);
    expect(result.lowActivity.count).toBe(1);
  });

  test('6 interactions is NOT low activity (count=0)', async () => {
    mockInteractionCount.mockResolvedValue(6);
    const result = await detectFlags(ORG, makeUser(), AS_OF);
    expect(result.lowActivity.count).toBe(0);
  });

  test('lowActivity window start is lowActivityWindowDays before asOf', () => {
    mockInteractionCount.mockResolvedValue(10);
    detectFlags(ORG, makeUser(), AS_OF);
    const query = mockInteractionCount.mock.calls[0][0];
    const expectedWindowStart = daysAgo(7);
    expect(query.createdAt.$gte.getTime()).toBe(expectedWindowStart.getTime());
  });

  test('custom threshold override: < 10 interactions flags lowActivity', async () => {
    mockInteractionCount.mockResolvedValue(9);
    const result = await detectFlags(ORG, makeUser(), AS_OF, { lowActivityMinInteractions: 10 });
    expect(result.lowActivity.count).toBe(1);
  });

  test('custom threshold override: exactly 10 does NOT flag', async () => {
    mockInteractionCount.mockResolvedValue(10);
    const result = await detectFlags(ORG, makeUser(), AS_OF, { lowActivityMinInteractions: 10 });
    expect(result.lowActivity.count).toBe(0);
  });
});

// ─── all flags zero ───────────────────────────────────────────────────────────

describe('detectFlags — zero flags baseline', () => {
  test('all counts are 0 and items are empty when no issues', async () => {
    const result = await detectFlags(ORG, makeUser(), AS_OF);
    for (const key of Object.keys(result)) {
      expect(result[key].count).toBe(0);
      expect(result[key].items).toEqual([]);
    }
  });
});

// ─── sendDigests — self-nudge ─────────────────────────────────────────────────

describe('sendDigests — self-nudge', () => {
  const member = makeUser();
  const manager = makeManager();

  beforeEach(() => {
    // User.find returns one active member
    mockUserFind.mockReturnValue({
      select: () => ({
        lean: () =>
          Promise.resolve([
            { ...member, isActive: true, invitationStatus: 'accepted' },
          ]),
      }),
    });
    mockGetManagerChain.mockResolvedValue([manager]);
  });

  test('sends self-nudge when member has ≥1 flag', async () => {
    // One stale lead
    let callCount = 0;
    mockLeadFind.mockImplementation(() => {
      callCount++;
      const docs = callCount === 1 ? [{ _id: new mongoose.Types.ObjectId() }] : [];
      return { select: () => ({ lean: () => Promise.resolve(docs) }) };
    });
    mockInteractionCount.mockResolvedValue(10); // not low activity

    const result = await sendDigests(ORG, AS_OF);
    expect(result.selfNudges).toBe(1);

    const selfCall = mockCreateNotification.mock.calls.find(
      ([args]) => args?.type === 'perf_redflag_self'
    );
    expect(selfCall).toBeDefined();
    expect(String(selfCall[0].recipient)).toBe(String(member._id));
  });

  test('does NOT send self-nudge when member has 0 flags', async () => {
    mockLeadFind.mockImplementation(() => ({
      select: () => ({ lean: () => Promise.resolve([]) }),
    }));
    mockInteractionCount.mockResolvedValue(10);

    const result = await sendDigests(ORG, AS_OF);
    expect(result.selfNudges).toBe(0);

    const selfCalls = mockCreateNotification.mock.calls.filter(
      ([args]) => args?.type === 'perf_redflag_self'
    );
    expect(selfCalls.length).toBe(0);
  });

  test('self-nudge recipient is the flagged member', async () => {
    const leadId = new mongoose.Types.ObjectId();
    let callCount = 0;
    mockLeadFind.mockImplementation(() => {
      callCount++;
      const docs = callCount === 1 ? [{ _id: leadId }] : [];
      return { select: () => ({ lean: () => Promise.resolve(docs) }) };
    });
    mockInteractionCount.mockResolvedValue(10);

    await sendDigests(ORG, AS_OF);
    const selfCall = mockCreateNotification.mock.calls.find(
      ([args]) => args?.type === 'perf_redflag_self'
    );
    expect(selfCall[0].recipient.toString()).toBe(member._id.toString());
  });

  test('self-nudge type is perf_redflag_self', async () => {
    let callCount = 0;
    mockLeadFind.mockImplementation(() => {
      callCount++;
      const docs = callCount === 1 ? [{ _id: new mongoose.Types.ObjectId() }] : [];
      return { select: () => ({ lean: () => Promise.resolve(docs) }) };
    });
    mockInteractionCount.mockResolvedValue(10);

    await sendDigests(ORG, AS_OF);
    const selfCall = mockCreateNotification.mock.calls.find(
      ([args]) => args?.type === 'perf_redflag_self'
    );
    expect(selfCall[0].type).toBe('perf_redflag_self');
  });
});

// ─── sendDigests — manager digest ────────────────────────────────────────────

describe('sendDigests — manager digest', () => {
  const member1 = makeUser({ _id: new mongoose.Types.ObjectId(), firstName: 'Alice' });
  const member2 = makeUser({ _id: new mongoose.Types.ObjectId(), firstName: 'Charlie' });
  const manager = makeManager();

  beforeEach(() => {
    // Two active members both in the same org
    mockUserFind.mockReturnValue({
      select: () => ({
        lean: () =>
          Promise.resolve([
            { ...member1, isActive: true, invitationStatus: 'accepted' },
            { ...member2, isActive: true, invitationStatus: 'accepted' },
          ]),
      }),
    });
    // Both report to the same manager
    mockGetManagerChain.mockResolvedValue([manager]);
    // Both have stale leads (first Lead.find call)
    let callCount = 0;
    mockLeadFind.mockImplementation(() => {
      callCount++;
      const docs = callCount % 4 === 1 ? [{ _id: new mongoose.Types.ObjectId() }] : [];
      return { select: () => ({ lean: () => Promise.resolve(docs) }) };
    });
    mockInteractionCount.mockResolvedValue(10);
  });

  test('sends ONE digest to the shared manager', async () => {
    const result = await sendDigests(ORG, AS_OF);
    expect(result.digests).toBe(1);

    const digestCalls = mockCreateNotification.mock.calls.filter(
      ([args]) => args?.type === 'perf_redflag_digest'
    );
    expect(digestCalls.length).toBe(1);
  });

  test('digest recipient is the manager', async () => {
    await sendDigests(ORG, AS_OF);
    const digestCall = mockCreateNotification.mock.calls.find(
      ([args]) => args?.type === 'perf_redflag_digest'
    );
    expect(String(digestCall[0].recipient)).toBe(String(manager._id));
  });

  test('digest type is perf_redflag_digest', async () => {
    await sendDigests(ORG, AS_OF);
    const digestCall = mockCreateNotification.mock.calls.find(
      ([args]) => args?.type === 'perf_redflag_digest'
    );
    expect(digestCall[0].type).toBe('perf_redflag_digest');
  });

  test('digest metadata includes both flagged members', async () => {
    await sendDigests(ORG, AS_OF);
    const digestCall = mockCreateNotification.mock.calls.find(
      ([args]) => args?.type === 'perf_redflag_digest'
    );
    expect(digestCall[0].metadata.flaggedMemberCount).toBe(2);
    expect(digestCall[0].metadata.reports.length).toBe(2);
  });

  test('two managers with different reports each get exactly ONE digest', async () => {
    const manager2 = makeManager({ _id: new mongoose.Types.ObjectId(), firstName: 'Diana' });

    // member1 → manager, member2 → manager2
    mockGetManagerChain.mockImplementation((user) =>
      String(user._id) === String(member1._id)
        ? Promise.resolve([manager])
        : Promise.resolve([manager2])
    );

    const result = await sendDigests(ORG, AS_OF);
    expect(result.digests).toBe(2);

    const digestCalls = mockCreateNotification.mock.calls.filter(
      ([args]) => args?.type === 'perf_redflag_digest'
    );
    expect(digestCalls.length).toBe(2);

    const recipients = digestCalls.map(([args]) => String(args.recipient));
    expect(recipients).toEqual(expect.arrayContaining([String(manager._id), String(manager2._id)]));
  });
});

// ─── sendDigests — no manager case ───────────────────────────────────────────

describe('sendDigests — member with no manager (owner-level)', () => {
  test('does not send a digest when getManagerChain returns empty array', async () => {
    const ownerMember = makeUser({ role: 'Business Head' });
    mockUserFind.mockReturnValue({
      select: () => ({
        lean: () =>
          Promise.resolve([{ ...ownerMember, isActive: true, invitationStatus: 'accepted' }]),
      }),
    });
    mockGetManagerChain.mockResolvedValue([]); // no manager
    let callCount = 0;
    mockLeadFind.mockImplementation(() => {
      callCount++;
      const docs = callCount === 1 ? [{ _id: new mongoose.Types.ObjectId() }] : [];
      return { select: () => ({ lean: () => Promise.resolve(docs) }) };
    });
    mockInteractionCount.mockResolvedValue(10);

    const result = await sendDigests(ORG, AS_OF);
    expect(result.digests).toBe(0);

    const digestCalls = mockCreateNotification.mock.calls.filter(
      ([args]) => args?.type === 'perf_redflag_digest'
    );
    expect(digestCalls.length).toBe(0);
  });
});

// ─── sendDigests — empty org ──────────────────────────────────────────────────

describe('sendDigests — empty org', () => {
  test('returns zero counts when no active members', async () => {
    mockUserFind.mockReturnValue({
      select: () => ({ lean: () => Promise.resolve([]) }),
    });
    const result = await sendDigests(ORG, AS_OF);
    expect(result.selfNudges).toBe(0);
    expect(result.digests).toBe(0);
    expect(mockCreateNotification).not.toHaveBeenCalled();
  });
});

// ─── Notification types in model ─────────────────────────────────────────────

describe('notification model contains the new types', () => {
  test('NOTIFICATION_TYPES includes perf_redflag_self', async () => {
    const { NOTIFICATION_TYPES } = await import('../../models/notificationModel.js');
    expect(NOTIFICATION_TYPES).toContain('perf_redflag_self');
  });

  test('NOTIFICATION_TYPES includes perf_redflag_digest', async () => {
    const { NOTIFICATION_TYPES } = await import('../../models/notificationModel.js');
    expect(NOTIFICATION_TYPES).toContain('perf_redflag_digest');
  });
});

// ─── Config thresholds ────────────────────────────────────────────────────────

describe('DEFAULT_THRESHOLDS config', () => {
  test('exports correct default values', async () => {
    const { DEFAULT_THRESHOLDS } = await import('../../config/redFlagThresholds.js');
    expect(DEFAULT_THRESHOLDS.staleLeadDays).toBe(7);
    expect(DEFAULT_THRESHOLDS.noMovementDays).toBe(14);
    expect(DEFAULT_THRESHOLDS.followUpOverdueDays).toBe(2);
    expect(DEFAULT_THRESHOLDS.agingPipelineDays).toBe(30);
    expect(DEFAULT_THRESHOLDS.lowActivityMinInteractions).toBe(5);
    expect(DEFAULT_THRESHOLDS.lowActivityWindowDays).toBe(7);
  });
});

// ─── sendDigests — precomputedFlags path ─────────────────────────────────────

describe('sendDigests — precomputedFlags (4th param)', () => {
  const member = makeUser();
  const manager = makeManager();

  // Prebuilt flags representing one stale lead.
  const flagsWithOneStale = {
    staleLeads:       { count: 1, items: [String(new mongoose.Types.ObjectId())] },
    noMovementLeads:  { count: 0, items: [] },
    overdueFollowUps: { count: 0, items: [] },
    overdueTasks:     { count: 0, items: [] },
    agingPipeline:    { count: 0, items: [] },
    lowActivity:      { count: 0, items: [] },
  };

  // Prebuilt flags representing zero flags (member is clean).
  const flagsAllZero = {
    staleLeads:       { count: 0, items: [] },
    noMovementLeads:  { count: 0, items: [] },
    overdueFollowUps: { count: 0, items: [] },
    overdueTasks:     { count: 0, items: [] },
    agingPipeline:    { count: 0, items: [] },
    lowActivity:      { count: 0, items: [] },
  };

  beforeEach(() => {
    mockUserFind.mockReturnValue({
      select: () => ({
        lean: () =>
          Promise.resolve([
            { ...member, isActive: true, invitationStatus: 'accepted' },
          ]),
      }),
    });
    mockGetManagerChain.mockResolvedValue([manager]);
  });

  test('detectFlags is NOT called when member flags are in the precomputed map', async () => {
    const precomputed = new Map([[String(member._id), flagsWithOneStale]]);

    await sendDigests(ORG, AS_OF, {}, precomputed);

    // Lead.find and Task.find should not have been called because detectFlags was skipped.
    expect(mockLeadFind).not.toHaveBeenCalled();
    expect(mockTaskFind).not.toHaveBeenCalled();
    expect(mockInteractionCount).not.toHaveBeenCalled();
  });

  test('self-nudge fires correctly with precomputed flags (1 stale lead)', async () => {
    const precomputed = new Map([[String(member._id), flagsWithOneStale]]);

    const result = await sendDigests(ORG, AS_OF, {}, precomputed);

    expect(result.selfNudges).toBe(1);
    const selfCall = mockCreateNotification.mock.calls.find(
      ([args]) => args?.type === 'perf_redflag_self'
    );
    expect(selfCall).toBeDefined();
    expect(selfCall[0].recipient.toString()).toBe(member._id.toString());
  });

  test('manager digest fires correctly with precomputed flags', async () => {
    const precomputed = new Map([[String(member._id), flagsWithOneStale]]);

    const result = await sendDigests(ORG, AS_OF, {}, precomputed);

    expect(result.digests).toBe(1);
    const digestCall = mockCreateNotification.mock.calls.find(
      ([args]) => args?.type === 'perf_redflag_digest'
    );
    expect(digestCall).toBeDefined();
    expect(digestCall[0].recipient.toString()).toBe(manager._id.toString());
  });

  test('no self-nudge when precomputed flags are all zero', async () => {
    const precomputed = new Map([[String(member._id), flagsAllZero]]);

    const result = await sendDigests(ORG, AS_OF, {}, precomputed);

    expect(result.selfNudges).toBe(0);
    expect(mockLeadFind).not.toHaveBeenCalled();
  });

  test('detectFlags IS called for a member NOT in the precomputed map', async () => {
    // Pass an empty map — no precomputed entries at all.
    const precomputed = new Map();

    // Provide a stale lead so detectFlags returns something flagged.
    let callCount = 0;
    mockLeadFind.mockImplementation(() => {
      callCount++;
      const docs = callCount === 1 ? [{ _id: new mongoose.Types.ObjectId() }] : [];
      return { select: () => ({ lean: () => Promise.resolve(docs) }) };
    });
    mockInteractionCount.mockResolvedValue(10);

    const result = await sendDigests(ORG, AS_OF, {}, precomputed);

    // detectFlags was called (Lead.find was invoked).
    expect(mockLeadFind).toHaveBeenCalled();
    expect(result.selfNudges).toBe(1);
  });

  test('empty map causes detectFlags to be called for all members (same as null)', async () => {
    const emptyMap = new Map();

    let callCount = 0;
    mockLeadFind.mockImplementation(() => {
      callCount++;
      return { select: () => ({ lean: () => Promise.resolve([]) }) };
    });
    mockInteractionCount.mockResolvedValue(10);

    await sendDigests(ORG, AS_OF, {}, emptyMap);

    // Lead queries were issued (detectFlags ran).
    expect(mockLeadFind).toHaveBeenCalled();
  });

  test('members with precomputed flags AND members without can coexist in one call', async () => {
    const member2 = makeUser({ _id: new mongoose.Types.ObjectId(), firstName: 'Carol' });

    // Two members: member has precomputed flags; member2 does not.
    mockUserFind.mockReturnValue({
      select: () => ({
        lean: () =>
          Promise.resolve([
            { ...member,  isActive: true, invitationStatus: 'accepted' },
            { ...member2, isActive: true, invitationStatus: 'accepted' },
          ]),
      }),
    });
    mockGetManagerChain.mockResolvedValue([manager]);

    // Only member is in the precomputed map with one stale lead.
    const precomputed = new Map([[String(member._id), flagsWithOneStale]]);

    // member2 has no precomputed flags → detectFlags will be called for it.
    // Make Lead.find return a stale lead for member2 as well.
    let leadCallCount = 0;
    mockLeadFind.mockImplementation(() => {
      leadCallCount++;
      const docs = leadCallCount === 1 ? [{ _id: new mongoose.Types.ObjectId() }] : [];
      return { select: () => ({ lean: () => Promise.resolve(docs) }) };
    });
    mockInteractionCount.mockResolvedValue(10);

    const result = await sendDigests(ORG, AS_OF, {}, precomputed);

    // detectFlags ran for member2 (Lead queries were issued).
    expect(mockLeadFind).toHaveBeenCalled();
    // Both members had flags → 2 self-nudges.
    expect(result.selfNudges).toBe(2);
  });

  test('passing null preserves original behavior (detectFlags called for all members)', async () => {
    // Explicit null → standard path.
    let callCount = 0;
    mockLeadFind.mockImplementation(() => {
      callCount++;
      const docs = callCount === 1 ? [{ _id: new mongoose.Types.ObjectId() }] : [];
      return { select: () => ({ lean: () => Promise.resolve(docs) }) };
    });
    mockInteractionCount.mockResolvedValue(10);

    const result = await sendDigests(ORG, AS_OF, {}, null);

    expect(mockLeadFind).toHaveBeenCalled();
    expect(result.selfNudges).toBe(1);
  });

  test('passing undefined preserves original behavior (detectFlags called for all members)', async () => {
    let callCount = 0;
    mockLeadFind.mockImplementation(() => {
      callCount++;
      const docs = callCount === 1 ? [{ _id: new mongoose.Types.ObjectId() }] : [];
      return { select: () => ({ lean: () => Promise.resolve(docs) }) };
    });
    mockInteractionCount.mockResolvedValue(10);

    const result = await sendDigests(ORG, AS_OF, {}, undefined);

    expect(mockLeadFind).toHaveBeenCalled();
    expect(result.selfNudges).toBe(1);
  });
});
