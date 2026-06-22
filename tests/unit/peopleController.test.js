// tests/unit/peopleController.test.js
// Unit tests for controllers/peopleController.js
// Mocks all service dependencies and models — no DB/network.
//
// Focus areas (per task requirements):
//   • /me returns the caller's own dashboard (self view)
//   • Range parsing: preset strings → correct windows; ?from&to → pass-through
//   • Access control: setTargets delegates guard to targetService.setTarget
//     (which throws for non-managers — controller propagates the error)
//   • getMoraleTeam / getMoraleOrg: scope and owner checks
//   • getFlags: defaults to self, supports ?userId= with guard

import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import mongoose from 'mongoose';

// =============================================================================
// IDs / USER STUBS
// =============================================================================
const ORG       = new mongoose.Types.ObjectId();
const OWNER_ID  = new mongoose.Types.ObjectId();
const HEAD_ID   = new mongoose.Types.ObjectId();
const MEMBER_ID = new mongoose.Types.ObjectId();

const OWNER_USER  = { _id: OWNER_ID,  organization: ORG, role: 'Business Head', roleRef: { isOwnerRole: true  } };
const HEAD_USER   = { _id: HEAD_ID,   organization: ORG, role: 'Sales Head',    roleRef: { isOwnerRole: false } };
const MEMBER_USER = { _id: MEMBER_ID, organization: ORG, role: 'Sales Executive', roleRef: { isOwnerRole: false } };

// =============================================================================
// MOCK SETUP
// =============================================================================

// dashboardService
const mockGetMemberDashboard = jest.fn();
const mockGetTeamDashboard   = jest.fn();
const mockGetOrgDashboard    = jest.fn();
const mockAssertCanView      = jest.fn();

jest.unstable_mockModule('../../services/people/dashboardService.js', () => ({
  getMemberDashboard: mockGetMemberDashboard,
  getTeamDashboard:   mockGetTeamDashboard,
  getOrgDashboard:    mockGetOrgDashboard,
  assertCanView:      mockAssertCanView,
  default: {},
}));

// redFlagService
const mockDetectFlags = jest.fn();
jest.unstable_mockModule('../../services/people/redFlagService.js', () => ({
  detectFlags: mockDetectFlags,
}));

// targetService
const mockGetOrSeedTarget = jest.fn();
const mockSetTarget       = jest.fn();
jest.unstable_mockModule('../../services/people/targetService.js', () => ({
  getOrSeedTarget: mockGetOrSeedTarget,
  setTarget:       mockSetTarget,
  computeAttainment: jest.fn(),
}));

// hierarchyService
const mockIsOwnerLevel = jest.fn();
const mockGetSubtree   = jest.fn();
jest.unstable_mockModule('../../services/people/hierarchyService.js', () => ({
  isOwnerLevel:        mockIsOwnerLevel,
  getSubtree:          mockGetSubtree,
  getTeam:             jest.fn(),
  getManagerChain:     jest.fn(),
  DEPARTMENT_BY_ROLE:  {},
  HEAD_ROLE_BY_DEPARTMENT: {},
}));

// performanceSignalsService — for resolveWindow used in parseRange and controllers
const mockResolveWindow = jest.fn();
jest.unstable_mockModule('../../services/people/performanceSignalsService.js', () => ({
  resolveWindow: mockResolveWindow,
  computeMetrics: jest.fn(),
  teamMedians:    jest.fn(),
  METRIC_KEYS: [
    'leadsWorked', 'leadsConverted', 'conversionRate',
    'salesCount', 'salesValue',
    'tasksCompleted', 'tasksOverdue', 'taskSlaRate',
    'ticketsResolved', 'ticketAvgResolutionHrs', 'interactionsLogged',
  ],
}));

// MoraleSummary model
const mockMoraleFindOne = jest.fn();
jest.unstable_mockModule('../../models/moraleSummaryModel.js', () => ({
  default: {
    findOne: mockMoraleFindOne,
  },
}));

// User model
const mockUserFindById = jest.fn();
jest.unstable_mockModule('../../models/userModel.js', () => ({
  default: {
    findById: mockUserFindById,
    find:     jest.fn(),
    updateOne: jest.fn(),
  },
}));

// =============================================================================
// IMPORT SUT + parseRange (after mocks registered)
// =============================================================================
const {
  parseRange,
  getMe,
  getMember,
  getTeam,
  getOrg,
  getFlags,
  getTargets,
  setTargets,
  getMoraleTeam,
  getMoraleOrg,
} = await import('../../controllers/peopleController.js');

// =============================================================================
// TEST HELPERS
// =============================================================================

/** Create a minimal Express mock res object */
const mockRes = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json   = jest.fn((payload) => { res._json = payload; return res; });
  return res;
};

/** Wrap an asyncHandler so we can await its promise and get thrown errors */
const call = async (handler, req, res) => {
  // asyncHandler wraps the fn; we call it as-is since we already import the fn directly
  try {
    await handler(req, res, (err) => { if (err) throw err; });
  } catch (e) {
    throw e;
  }
};

// =============================================================================
// SHARED RESET
// =============================================================================
beforeEach(() => {
  jest.clearAllMocks();
  // Default resolveWindow: returns a sensible month window
  mockResolveWindow.mockImplementation(() => ({
    periodStart: new Date('2026-06-01T00:00:00Z'),
    periodEnd:   new Date('2026-07-01T00:00:00Z'),
  }));
  mockAssertCanView.mockResolvedValue(undefined); // allow by default
  mockIsOwnerLevel.mockReturnValue(false);
  mockGetSubtree.mockResolvedValue({ scope: 'department', userIds: [MEMBER_ID] });
  mockDetectFlags.mockResolvedValue({ staleLeads: { count: 0 } });
  mockGetOrSeedTarget.mockResolvedValue({ targets: {} });
  mockSetTarget.mockResolvedValue({ targets: {} });
  mockMoraleFindOne.mockReturnValue({
    sort: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(null),
  });
  mockGetMemberDashboard.mockResolvedValue({ user: { _id: MEMBER_ID }, metrics: {} });
  mockGetTeamDashboard.mockResolvedValue({ members: [], rollup: {}, medians: {} });
  mockGetOrgDashboard.mockResolvedValue({ heads: [], orgRollup: {} });
});

// =============================================================================
// parseRange
// =============================================================================
describe('parseRange', () => {
  test('no params → this_month (default)', () => {
    mockResolveWindow.mockReturnValue({
      periodStart: new Date('2026-06-01'),
      periodEnd:   new Date('2026-07-01'),
    });
    const range = parseRange({});
    expect(range.from).toEqual(new Date('2026-06-01'));
    expect(range.to).toEqual(new Date('2026-07-01'));
  });

  test('?range=this_month → resolveWindow(month, now)', () => {
    mockResolveWindow.mockReturnValue({
      periodStart: new Date('2026-06-01'),
      periodEnd:   new Date('2026-07-01'),
    });
    const range = parseRange({ range: 'this_month' });
    expect(mockResolveWindow).toHaveBeenCalledWith('month', expect.any(Date));
    expect(range.from).toEqual(new Date('2026-06-01'));
  });

  test('?range=this_week → resolveWindow(week, now)', () => {
    mockResolveWindow.mockReturnValue({
      periodStart: new Date('2026-06-15'),
      periodEnd:   new Date('2026-06-22'),
    });
    const range = parseRange({ range: 'this_week' });
    expect(mockResolveWindow).toHaveBeenCalledWith('week', expect.any(Date));
    expect(range.from).toEqual(new Date('2026-06-15'));
  });

  test('?range=last_week → resolveWindow(week, 7-days-ago)', () => {
    mockResolveWindow.mockReturnValue({
      periodStart: new Date('2026-06-08'),
      periodEnd:   new Date('2026-06-15'),
    });
    const range = parseRange({ range: 'last_week' });
    expect(mockResolveWindow).toHaveBeenCalledWith('week', expect.any(Date));
    expect(range.from).toEqual(new Date('2026-06-08'));
  });

  test('?range=last_2_weeks → from 14-days-ago Monday, to now', () => {
    mockResolveWindow.mockReturnValue({
      periodStart: new Date('2026-06-08'),
      periodEnd:   new Date('2026-06-22'),
    });
    const range = parseRange({ range: 'last_2_weeks' });
    expect(mockResolveWindow).toHaveBeenCalledWith('week', expect.any(Date));
    // to should be approximately now (within a few ms of test execution)
    expect(range.to.getTime()).toBeCloseTo(Date.now(), -3);
  });

  test('?from&?to → pass-through as Dates', () => {
    const range = parseRange({ from: '2026-05-01', to: '2026-05-31' });
    expect(range.from).toEqual(new Date('2026-05-01'));
    expect(range.to).toEqual(new Date('2026-05-31'));
  });

  test('invalid ?from → throws 400', () => {
    expect(() => parseRange({ from: 'not-a-date', to: '2026-07-01' })).toThrow();
  });
});

// =============================================================================
// getMe
// =============================================================================
describe('getMe', () => {
  test('returns caller own dashboard', async () => {
    const req = { user: MEMBER_USER, query: {} };
    const res = mockRes();

    await call(getMe, req, res);

    expect(mockGetMemberDashboard).toHaveBeenCalledWith(
      MEMBER_USER,
      MEMBER_USER._id,
      expect.any(Object)
    );
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });
});

// =============================================================================
// getMember
// =============================================================================
describe('getMember', () => {
  test('passes userId from params to getMemberDashboard', async () => {
    const req = { user: HEAD_USER, params: { userId: MEMBER_ID.toString() }, query: {} };
    const res = mockRes();

    await call(getMember, req, res);

    expect(mockGetMemberDashboard).toHaveBeenCalledWith(
      HEAD_USER,
      MEMBER_ID.toString(),
      expect.any(Object)
    );
  });

  test('propagates 403 from getMemberDashboard (outside-team access)', async () => {
    const forbidden = new Error('Access denied');
    forbidden.statusCode = 403;
    mockGetMemberDashboard.mockRejectedValueOnce(forbidden);

    const req = { user: MEMBER_USER, params: { userId: HEAD_ID.toString() }, query: {} };
    const res = mockRes();

    await expect(call(getMember, req, res)).rejects.toMatchObject({ statusCode: 403 });
  });
});

// =============================================================================
// getTeam
// =============================================================================
describe('getTeam', () => {
  test('calls getTeamDashboard with req.user and parsed range', async () => {
    const req = { user: HEAD_USER, query: {} };
    const res = mockRes();

    await call(getTeam, req, res);

    expect(mockGetTeamDashboard).toHaveBeenCalledWith(HEAD_USER, expect.any(Object));
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });
});

// =============================================================================
// getOrg
// =============================================================================
describe('getOrg', () => {
  test('owner can access org dashboard', async () => {
    mockIsOwnerLevel.mockReturnValue(true);
    const req = { user: OWNER_USER, query: {} };
    const res = mockRes();

    await call(getOrg, req, res);

    expect(mockGetOrgDashboard).toHaveBeenCalledWith(OWNER_USER, expect.any(Object));
  });

  test('non-owner gets 403', async () => {
    mockIsOwnerLevel.mockReturnValue(false);
    const req = { user: HEAD_USER, query: {} };
    const res = mockRes();

    await expect(call(getOrg, req, res)).rejects.toThrow(/owner/i);
    expect(res.status).toHaveBeenCalledWith(403);
  });
});

// =============================================================================
// getFlags
// =============================================================================
describe('getFlags', () => {
  test('no ?userId → detects flags for self', async () => {
    const req = { user: MEMBER_USER, query: {} };
    const res = mockRes();

    await call(getFlags, req, res);

    expect(mockDetectFlags).toHaveBeenCalledWith(
      MEMBER_USER.organization,
      MEMBER_USER,
      expect.any(Date)
    );
  });

  test('?userId with guard passing → detects flags for that user', async () => {
    const targetUser = { ...HEAD_USER };
    mockAssertCanView.mockResolvedValue(undefined);
    mockUserFindById.mockReturnValue({ lean: jest.fn().mockResolvedValue(targetUser) });

    const req = { user: OWNER_USER, query: { userId: HEAD_ID.toString() } };
    const res = mockRes();

    await call(getFlags, req, res);

    expect(mockAssertCanView).toHaveBeenCalledWith(OWNER_USER, HEAD_ID.toString());
    expect(mockDetectFlags).toHaveBeenCalledWith(
      targetUser.organization,
      targetUser,
      expect.any(Date)
    );
  });

  test('?userId with guard rejecting → propagates 403', async () => {
    const forbidden = new Error('Access denied');
    forbidden.statusCode = 403;
    mockAssertCanView.mockRejectedValueOnce(forbidden);

    const req = { user: MEMBER_USER, query: { userId: STRANGER_ID.toString() } };
    const res = mockRes();

    await expect(call(getFlags, req, res)).rejects.toMatchObject({ statusCode: 403 });
  });
});

// =============================================================================
// getTargets / setTargets
// =============================================================================
describe('getTargets', () => {
  test('calls assertCanView then getOrSeedTarget', async () => {
    mockGetOrSeedTarget.mockResolvedValue({ targets: { salesCount: 5 } });
    const req = { user: HEAD_USER, params: { userId: MEMBER_ID.toString() }, query: {} };
    const res = mockRes();

    await call(getTargets, req, res);

    expect(mockAssertCanView).toHaveBeenCalledWith(HEAD_USER, MEMBER_ID.toString());
    expect(mockGetOrSeedTarget).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  test('propagates 403 from assertCanView', async () => {
    const forbidden = new Error('Access denied');
    forbidden.statusCode = 403;
    mockAssertCanView.mockRejectedValueOnce(forbidden);

    const req = { user: MEMBER_USER, params: { userId: STRANGER_ID.toString() }, query: {} };
    const res = mockRes();

    await expect(call(getTargets, req, res)).rejects.toMatchObject({ statusCode: 403 });
  });
});

describe('setTargets', () => {
  test('delegates guard to targetService.setTarget', async () => {
    mockSetTarget.mockResolvedValue({ targets: { salesCount: 10 } });
    const req = {
      user: HEAD_USER,
      params: { userId: MEMBER_ID.toString() },
      query: {},
      body: { targets: { salesCount: 10 } },
    };
    const res = mockRes();

    await call(setTargets, req, res);

    expect(mockSetTarget).toHaveBeenCalledWith(
      HEAD_USER,
      MEMBER_ID.toString(),
      expect.any(Date),
      { salesCount: 10 }
    );
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  test('propagates error from setTarget (non-manager throws 403)', async () => {
    const forbidden = new Error('Not authorized to set targets');
    forbidden.statusCode = 403;
    mockSetTarget.mockRejectedValueOnce(forbidden);

    const req = {
      user: MEMBER_USER,
      params: { userId: HEAD_ID.toString() },
      query: {},
      body: { targets: { salesCount: 10 } },
    };
    const res = mockRes();

    await expect(call(setTargets, req, res)).rejects.toMatchObject({ statusCode: 403 });
  });
});

// =============================================================================
// getMoraleTeam / getMoraleOrg
// =============================================================================
describe('getMoraleTeam', () => {
  test('Head (scope=department) can read team morale', async () => {
    mockGetSubtree.mockResolvedValue({ scope: 'department', userIds: [MEMBER_ID] });
    const req = { user: HEAD_USER, query: {} };
    const res = mockRes();

    await call(getMoraleTeam, req, res);

    expect(mockMoraleFindOne).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  test('Member (scope=self) gets 403 for team morale', async () => {
    mockGetSubtree.mockResolvedValue({ scope: 'self', userIds: [MEMBER_ID] });
    const req = { user: MEMBER_USER, query: {} };
    const res = mockRes();

    await expect(call(getMoraleTeam, req, res)).rejects.toThrow(/team morale/i);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('Owner (scope=org) can read team morale', async () => {
    mockGetSubtree.mockResolvedValue({ scope: 'org', userIds: [] });
    const req = { user: OWNER_USER, query: {} };
    const res = mockRes();

    await call(getMoraleTeam, req, res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });
});

describe('getMoraleOrg', () => {
  test('Owner can read org morale', async () => {
    mockIsOwnerLevel.mockReturnValue(true);
    const req = { user: OWNER_USER, query: {} };
    const res = mockRes();

    await call(getMoraleOrg, req, res);

    expect(mockMoraleFindOne).toHaveBeenCalledWith(
      expect.objectContaining({ scope: 'org' })
    );
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  test('non-Owner gets 403 for org morale', async () => {
    mockIsOwnerLevel.mockReturnValue(false);
    const req = { user: HEAD_USER, query: {} };
    const res = mockRes();

    await expect(call(getMoraleOrg, req, res)).rejects.toThrow(/owner/i);
    expect(res.status).toHaveBeenCalledWith(403);
  });
});

// Extra: STRANGER_ID used in one scope
const STRANGER_ID = new mongoose.Types.ObjectId();
