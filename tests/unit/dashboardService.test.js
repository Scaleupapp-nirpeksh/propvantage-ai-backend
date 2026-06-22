// tests/unit/dashboardService.test.js
// Unit tests for services/people/dashboardService.js
// Mocks all upstream services and models — no DB/network.
//
// Focus areas (per task requirements):
//   • assertCanView: member vs another member → 403; Head vs outside-team → 403;
//     Head vs own team member → ok; Owner vs anyone → ok; self-view → ok.
//   • getMemberDashboard: returns the expected shape; calls computeMetrics twice
//     (current + prior window), getOrSeedTarget, detectFlags, currentStatus.
//   • getTeamDashboard: iterates getTeam members; produces rollup + medians.
//   • getOrgDashboard: owner-only; iterates all members.

import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import mongoose from 'mongoose';

// =============================================================================
// IDs
// =============================================================================
const ORG         = new mongoose.Types.ObjectId();
const OWNER_ID    = new mongoose.Types.ObjectId();
const HEAD_ID     = new mongoose.Types.ObjectId();
const MEMBER_ID   = new mongoose.Types.ObjectId();
const STRANGER_ID = new mongoose.Types.ObjectId(); // different team

const OWNER  = { _id: OWNER_ID,    organization: ORG, role: 'Business Head', roleRef: { isOwnerRole: true }  };
const HEAD   = { _id: HEAD_ID,     organization: ORG, role: 'Sales Head',    roleRef: { isOwnerRole: false } };
const MEMBER = { _id: MEMBER_ID,   organization: ORG, role: 'Sales Executive', roleRef: { isOwnerRole: false } };

// =============================================================================
// MOCK SETUP
// =============================================================================

// hierarchyService
const mockGetSubtree = jest.fn();
const mockGetTeam    = jest.fn();
const mockIsOwner    = jest.fn();

jest.unstable_mockModule('../../services/people/hierarchyService.js', () => ({
  getSubtree:          mockGetSubtree,
  getTeam:             mockGetTeam,
  isOwnerLevel:        mockIsOwner,
  getManagerChain:     jest.fn().mockResolvedValue([]),
  DEPARTMENT_BY_ROLE:  {},
  HEAD_ROLE_BY_DEPARTMENT: {
    'Sales Head':       'Sales Head',
    'Finance Head':     'Finance Head',
    'Legal Head':       'Legal Head',
    'CRM Head':         'CRM Head',
    'Marketing Head':   'Marketing Head',
    'Project Director': 'Project Director',
    'Business Head':    'Business Head',
  },
}));

// performanceSignalsService
const mockComputeMetrics = jest.fn();
const mockTeamMedians    = jest.fn();
const mockResolveWindow  = jest.fn();

jest.unstable_mockModule('../../services/people/performanceSignalsService.js', () => ({
  computeMetrics:  mockComputeMetrics,
  teamMedians:     mockTeamMedians,
  resolveWindow:   mockResolveWindow,
  METRIC_KEYS: [
    'leadsWorked', 'leadsConverted', 'conversionRate',
    'salesCount', 'salesValue',
    'tasksCompleted', 'tasksOverdue', 'taskSlaRate',
    'ticketsResolved', 'ticketAvgResolutionHrs', 'interactionsLogged',
  ],
}));

// targetService
const mockGetOrSeedTarget    = jest.fn();
const mockComputeAttainment  = jest.fn();

jest.unstable_mockModule('../../services/people/targetService.js', () => ({
  getOrSeedTarget:    mockGetOrSeedTarget,
  computeAttainment:  mockComputeAttainment,
  setTarget:          jest.fn(),
}));

// redFlagService
const mockDetectFlags = jest.fn();
jest.unstable_mockModule('../../services/people/redFlagService.js', () => ({
  detectFlags: mockDetectFlags,
}));

// reflectionService
const mockCurrentStatus = jest.fn();
jest.unstable_mockModule('../../services/people/reflectionService.js', () => ({
  currentStatus: mockCurrentStatus,
  isoWeekOf:     jest.fn(() => '2026-W26'),
  upsertDraft:   jest.fn(),
  submit:        jest.fn(),
  ack:           jest.fn(),
  transcribe:    jest.fn(),
}));

// User model
const mockUserFindById = jest.fn();
const mockUserFind     = jest.fn();
jest.unstable_mockModule('../../models/userModel.js', () => ({
  default: {
    findById: mockUserFindById,
    find:     mockUserFind,
  },
}));

// =============================================================================
// IMPORT SUT (after mocks are registered)
// =============================================================================
const {
  assertCanView,
  getMemberDashboard,
  getTeamDashboard,
  getOrgDashboard,
} = await import('../../services/people/dashboardService.js');

// =============================================================================
// SHARED RESET
// =============================================================================
const ZERO_METRICS = {
  leadsWorked: 0, leadsConverted: 0, conversionRate: 0,
  salesCount: 0, salesValue: 0,
  tasksCompleted: 0, tasksOverdue: 0, taskSlaRate: 0,
  ticketsResolved: 0, ticketAvgResolutionHrs: 0, interactionsLogged: 0,
};

const SAMPLE_METRICS = {
  leadsWorked: 10, leadsConverted: 3, conversionRate: 0.3,
  salesCount: 2, salesValue: 50000,
  tasksCompleted: 5, tasksOverdue: 1, taskSlaRate: 0.8,
  ticketsResolved: 4, ticketAvgResolutionHrs: 2, interactionsLogged: 20,
};

beforeEach(() => {
  jest.clearAllMocks();
  // Default resolveWindow stub — returns sensible dates
  mockResolveWindow.mockImplementation((period) => {
    const periodStart = new Date('2026-06-01T00:00:00Z');
    const periodEnd   = new Date('2026-07-01T00:00:00Z');
    return { periodStart, periodEnd };
  });
  // Default computeMetrics — returns SAMPLE_METRICS for current, ZERO for prior
  mockComputeMetrics.mockResolvedValue(SAMPLE_METRICS);
  mockTeamMedians.mockResolvedValue({ ...ZERO_METRICS });
  mockGetOrSeedTarget.mockResolvedValue({ targets: { salesCount: 5, salesValue: 100000 } });
  mockComputeAttainment.mockReturnValue({ salesCount: { actual: 2, target: 5, pct: 0.4 } });
  mockDetectFlags.mockResolvedValue({
    staleLeads:      { count: 0, items: [] },
    noMovementLeads: { count: 1, items: [new mongoose.Types.ObjectId()] },
    overdueFollowUps:{ count: 0, items: [] },
    overdueTasks:    { count: 0, items: [] },
    agingPipeline:   { count: 0, items: [] },
    lowActivity:     { count: 0, items: [] },
  });
  mockCurrentStatus.mockResolvedValue({ isoWeek: '2026-W26', status: 'draft', overdue: false });
});

// =============================================================================
// assertCanView
// =============================================================================
describe('assertCanView', () => {
  test('self-view is always allowed', async () => {
    // Should not even call getSubtree for self-view
    await expect(assertCanView(MEMBER, MEMBER_ID)).resolves.toBeUndefined();
    expect(mockGetSubtree).not.toHaveBeenCalled();
  });

  test('Owner (scope=org) can view any user', async () => {
    mockGetSubtree.mockResolvedValue({ scope: 'org', userIds: [] });
    await expect(assertCanView(OWNER, MEMBER_ID)).resolves.toBeUndefined();
  });

  test('Head can view a member in their subtree', async () => {
    mockGetSubtree.mockResolvedValue({ scope: 'department', userIds: [MEMBER_ID] });
    await expect(assertCanView(HEAD, MEMBER_ID)).resolves.toBeUndefined();
  });

  test('Head requesting a member OUTSIDE their team → 403', async () => {
    mockGetSubtree.mockResolvedValue({ scope: 'department', userIds: [MEMBER_ID] }); // only MEMBER_ID
    const err = await assertCanView(HEAD, STRANGER_ID).catch((e) => e);
    expect(err).toBeDefined();
    expect(err.statusCode).toBe(403);
  });

  test('Member requesting another member → 403', async () => {
    mockGetSubtree.mockResolvedValue({ scope: 'self', userIds: [MEMBER_ID] });
    const err = await assertCanView(MEMBER, STRANGER_ID).catch((e) => e);
    expect(err).toBeDefined();
    expect(err.statusCode).toBe(403);
  });

  test('Member requesting a known-team member (still not in their subtree) → 403', async () => {
    mockGetSubtree.mockResolvedValue({ scope: 'self', userIds: [MEMBER_ID] });
    const err = await assertCanView(MEMBER, HEAD_ID).catch((e) => e);
    expect(err.statusCode).toBe(403);
  });
});

// =============================================================================
// getMemberDashboard
// =============================================================================
describe('getMemberDashboard', () => {
  const RANGE = { from: new Date('2026-06-01'), to: new Date('2026-07-01') };

  // For self-view, no assertCanView / getSubtree call needed
  const memberUserDoc = {
    ...MEMBER,
    firstName: 'Alice',
    lastName: 'Smith',
    email: 'alice@example.com',
    lastActiveAt: null,
  };

  beforeEach(() => {
    // User.findById returns a chainable object with lean()
    mockUserFindById.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      populate: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue(memberUserDoc),
    });
  });

  test('/me: returns own dashboard — calls computeMetrics twice (current + prior)', async () => {
    // Simulate self-view: assertCanView does not call getSubtree
    mockComputeMetrics
      .mockResolvedValueOnce(SAMPLE_METRICS)  // current
      .mockResolvedValueOnce(ZERO_METRICS);   // prior

    const result = await getMemberDashboard(MEMBER, MEMBER_ID, RANGE);

    // computeMetrics called twice: once for current, once for prior window
    expect(mockComputeMetrics).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      metrics: SAMPLE_METRICS,
      flagCount: expect.any(Number),
      reflectionStatus: expect.any(Object),
    });
    expect(result.range).toEqual(RANGE);
  });

  test('returns attainment, trend, vsTeamMedian, flags, and reflectionStatus', async () => {
    mockComputeMetrics
      .mockResolvedValueOnce(SAMPLE_METRICS)
      .mockResolvedValueOnce(ZERO_METRICS);

    const result = await getMemberDashboard(MEMBER, MEMBER_ID, RANGE);

    expect(result.attainment).toBeDefined();
    expect(result.trend).toBeDefined();
    expect(result.vsTeamMedian).toBeDefined();
    expect(result.flags).toBeDefined();
    expect(result.reflectionStatus).toBeDefined();
  });

  test('Head can view a team member — assertCanView passes', async () => {
    mockGetSubtree.mockResolvedValue({ scope: 'department', userIds: [MEMBER_ID] });
    mockComputeMetrics.mockResolvedValue(SAMPLE_METRICS);

    const result = await getMemberDashboard(HEAD, MEMBER_ID, RANGE);
    expect(result.user._id.toString()).toBe(MEMBER_ID.toString());
  });

  test('throws 403 when Head requests a user outside their team', async () => {
    mockGetSubtree.mockResolvedValue({ scope: 'department', userIds: [MEMBER_ID] });

    const err = await getMemberDashboard(HEAD, STRANGER_ID, RANGE).catch((e) => e);
    expect(err.statusCode).toBe(403);
  });

  test('Owner requesting anyone → resolves (scope=org)', async () => {
    mockGetSubtree.mockResolvedValue({ scope: 'org', userIds: [] });
    mockComputeMetrics.mockResolvedValue(SAMPLE_METRICS);

    // User.findById returns member doc even when called by owner
    const result = await getMemberDashboard(OWNER, MEMBER_ID, RANGE);
    expect(result).toBeDefined();
    expect(result.user._id.toString()).toBe(MEMBER_ID.toString());
  });
});

// =============================================================================
// getTeamDashboard
// =============================================================================
describe('getTeamDashboard', () => {
  const RANGE = { from: new Date('2026-06-01'), to: new Date('2026-07-01') };

  const teamMember = {
    _id: MEMBER_ID,
    organization: ORG,
    role: 'Sales Executive',
    firstName: 'Bob',
    lastName: 'Jones',
    email: 'bob@example.com',
    lastActiveAt: null,
  };

  beforeEach(() => {
    mockGetTeam.mockResolvedValue([teamMember]);
    mockComputeMetrics.mockResolvedValue(SAMPLE_METRICS);
    mockTeamMedians.mockResolvedValue({ ...SAMPLE_METRICS });
  });

  test('builds a scorecard per team member', async () => {
    const result = await getTeamDashboard(HEAD, RANGE);
    expect(result.members).toHaveLength(1);
    expect(result.members[0].user._id.toString()).toBe(MEMBER_ID.toString());
  });

  test('rollup sums non-rate metrics across team members', async () => {
    const result = await getTeamDashboard(HEAD, RANGE);
    expect(result.rollup.salesCount).toBe(SAMPLE_METRICS.salesCount);
    expect(result.rollup.leadsWorked).toBe(SAMPLE_METRICS.leadsWorked);
  });

  test('medians are included in the result', async () => {
    const result = await getTeamDashboard(HEAD, RANGE);
    expect(result.medians).toBeDefined();
    expect(mockTeamMedians).toHaveBeenCalled();
  });

  test('empty team → empty members array, zero rollup', async () => {
    mockGetTeam.mockResolvedValue([]);
    const result = await getTeamDashboard(HEAD, RANGE);
    expect(result.members).toHaveLength(0);
    expect(result.rollup.salesCount).toBe(0);
  });

  test('reflectionIn is true when status is submitted', async () => {
    mockCurrentStatus.mockResolvedValue({ isoWeek: '2026-W26', status: 'submitted', overdue: false });
    const result = await getTeamDashboard(HEAD, RANGE);
    expect(result.members[0].reflectionIn).toBe(true);
  });

  test('reflectionIn is false when status is draft', async () => {
    mockCurrentStatus.mockResolvedValue({ isoWeek: '2026-W26', status: 'draft', overdue: false });
    const result = await getTeamDashboard(HEAD, RANGE);
    expect(result.members[0].reflectionIn).toBe(false);
  });
});

// =============================================================================
// getOrgDashboard
// =============================================================================
describe('getOrgDashboard', () => {
  const RANGE = { from: new Date('2026-06-01'), to: new Date('2026-07-01') };

  const HEAD_ROLES = ['Sales Head', 'Finance Head', 'Legal Head', 'CRM Head', 'Marketing Head', 'Project Director'];

  const salesHead = {
    _id: HEAD_ID,
    organization: ORG,
    role: 'Sales Head',
    firstName: 'Carol',
    lastName: 'White',
    email: 'carol@example.com',
    lastActiveAt: null,
  };

  const teamMemberDoc = {
    _id: MEMBER_ID,
    organization: ORG,
    role: 'Sales Executive',
    firstName: 'Bob',
    lastName: 'Jones',
    email: 'bob@example.com',
    lastActiveAt: null,
  };

  const nonHeadMember = {
    _id: STRANGER_ID,
    organization: ORG,
    role: 'Sales Executive',
    firstName: 'Dan',
    lastName: 'Brown',
    email: 'dan@example.com',
    lastActiveAt: null,
  };

  const SAMPLE_MEDIANS = {
    ...ZERO_METRICS,
    conversionRate: 0.25,
    taskSlaRate: 0.75,
    ticketAvgResolutionHrs: 3,
  };

  beforeEach(() => {
    mockIsOwner.mockReturnValue(true);
    // User.find returns head-role users (called by getOrgDashboard to get head users)
    mockUserFind.mockReturnValue({
      lean: jest.fn().mockResolvedValue([salesHead]),
    });
    // getTeam returns the team members for the head
    mockGetTeam.mockResolvedValue([teamMemberDoc]);
    mockComputeMetrics.mockResolvedValue(SAMPLE_METRICS);
    mockTeamMedians.mockResolvedValue(SAMPLE_MEDIANS);
  });

  test('throws 403 for a non-owner', async () => {
    mockIsOwner.mockReturnValue(false);
    const err = await getOrgDashboard(HEAD, RANGE).catch((e) => e);
    expect(err.statusCode).toBe(403);
  });

  test('resolves for an Owner and returns heads + orgRollup', async () => {
    const result = await getOrgDashboard(OWNER, RANGE);
    expect(result.heads).toBeDefined();
    expect(result.orgRollup).toBeDefined();
    expect(result.heads).toHaveLength(1);
  });

  test('heads contains only head-role users (user.role is one of HEAD_ROLES)', async () => {
    const result = await getOrgDashboard(OWNER, RANGE);
    for (const entry of result.heads) {
      expect(HEAD_ROLES).toContain(entry.user.role);
    }
  });

  test('each head entry has user, metrics, attainment, teamSize, teamRollup', async () => {
    const result = await getOrgDashboard(OWNER, RANGE);
    expect(result.heads).toHaveLength(1);
    const head = result.heads[0];
    expect(head.user).toBeDefined();
    expect(head.metrics).toBeDefined();
    expect(head.attainment).toBeDefined();
    expect(head.teamSize).toBeDefined();
    expect(head.teamRollup).toBeDefined();
  });

  test('teamSize equals the number of team members returned by getTeam', async () => {
    mockGetTeam.mockResolvedValue([teamMemberDoc, nonHeadMember]);
    const result = await getOrgDashboard(OWNER, RANGE);
    expect(result.heads[0].teamSize).toBe(2);
  });

  test('teamRollup sums additive metrics across team members', async () => {
    // Two team members, each with SAMPLE_METRICS
    mockGetTeam.mockResolvedValue([teamMemberDoc, nonHeadMember]);
    const result = await getOrgDashboard(OWNER, RANGE);
    const rollup = result.heads[0].teamRollup;
    // Additive metrics should be doubled (2 members × SAMPLE_METRICS)
    expect(rollup.salesCount).toBe(SAMPLE_METRICS.salesCount * 2);
    expect(rollup.leadsWorked).toBe(SAMPLE_METRICS.leadsWorked * 2);
    expect(rollup.salesValue).toBe(SAMPLE_METRICS.salesValue * 2);
    expect(rollup.tasksCompleted).toBe(SAMPLE_METRICS.tasksCompleted * 2);
  });

  test('teamRollup uses medians for rate metrics (not sum)', async () => {
    mockGetTeam.mockResolvedValue([teamMemberDoc, nonHeadMember]);
    const result = await getOrgDashboard(OWNER, RANGE);
    const rollup = result.heads[0].teamRollup;
    expect(rollup.conversionRate).toBe(SAMPLE_MEDIANS.conversionRate);
    expect(rollup.taskSlaRate).toBe(SAMPLE_MEDIANS.taskSlaRate);
    expect(rollup.ticketAvgResolutionHrs).toBe(SAMPLE_MEDIANS.ticketAvgResolutionHrs);
  });

  test('teamRollup contains all METRIC_KEYS plus teamSize', async () => {
    const METRIC_KEYS_LIST = [
      'leadsWorked', 'leadsConverted', 'conversionRate',
      'salesCount', 'salesValue',
      'tasksCompleted', 'tasksOverdue', 'taskSlaRate',
      'ticketsResolved', 'ticketAvgResolutionHrs', 'interactionsLogged',
    ];
    const result = await getOrgDashboard(OWNER, RANGE);
    const rollup = result.heads[0].teamRollup;
    for (const key of METRIC_KEYS_LIST) {
      expect(rollup).toHaveProperty(key);
    }
    expect(rollup).toHaveProperty('teamSize');
  });

  test('non-head-role users are NOT in heads (User.find is called with head roles only)', async () => {
    // User.find should be called with $in: HEAD_ROLES_LIST (excluding Business Head)
    await getOrgDashboard(OWNER, RANGE);
    expect(mockUserFind).toHaveBeenCalledWith(
      expect.objectContaining({
        role: expect.objectContaining({ $in: expect.arrayContaining(['Sales Head']) }),
      }),
    );
    // The $in list should NOT contain 'Business Head'
    const callArgs = mockUserFind.mock.calls[0][0];
    expect(callArgs.role.$in).not.toContain('Business Head');
    // It should also not include regular member roles
    expect(callArgs.role.$in).not.toContain('Sales Executive');
  });

  test('orgRollup is present and sums additive teamRollup metrics across heads', async () => {
    const result = await getOrgDashboard(OWNER, RANGE);
    expect(result.orgRollup).toBeDefined();
    // orgRollup.salesValue should equal the salesValue from the one head's teamRollup
    expect(result.orgRollup.salesValue).toBe(result.heads[0].teamRollup.salesValue);
  });

  test('orgRollup uses global teamMedians for rate metrics', async () => {
    const result = await getOrgDashboard(OWNER, RANGE);
    expect(result.orgRollup.conversionRate).toBe(SAMPLE_MEDIANS.conversionRate);
    expect(result.orgRollup.taskSlaRate).toBe(SAMPLE_MEDIANS.taskSlaRate);
    expect(result.orgRollup.ticketAvgResolutionHrs).toBe(SAMPLE_MEDIANS.ticketAvgResolutionHrs);
  });

  test('empty heads array when no head-role users exist', async () => {
    mockUserFind.mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });
    const result = await getOrgDashboard(OWNER, RANGE);
    expect(result.heads).toHaveLength(0);
    expect(result.orgRollup).toBeDefined();
  });
});
