// tests/unit/demoSeedService.test.js
// Unit tests for services/people/demoSeedService.js
// Mocks: User, WeeklyReflection, Interaction, Lead models + moraleService + isoWeek

import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import mongoose from 'mongoose';

// =============================================================================
// IDs & FIXTURES
// =============================================================================
const ORG     = new mongoose.Types.ObjectId();
const USER_1  = new mongoose.Types.ObjectId();
const USER_2  = new mongoose.Types.ObjectId();
const LEAD_ID = new mongoose.Types.ObjectId();

const ACTIVE_USERS = [
  { _id: USER_1, organization: ORG, role: 'Sales Executive', firstName: 'Alice', lastName: 'Patel' },
  { _id: USER_2, organization: ORG, role: 'Sales Head',      firstName: 'Bob',   lastName: 'Shah'  },
];

// =============================================================================
// MOCKS — must be registered BEFORE import of SUT
// =============================================================================

// User model
const mockUserFind = jest.fn();
jest.unstable_mockModule('../../models/userModel.js', () => ({
  default: { find: mockUserFind },
}));

// WeeklyReflection model
const mockReflectionFindOne = jest.fn();
const mockReflectionCreate  = jest.fn();
jest.unstable_mockModule('../../models/weeklyReflectionModel.js', () => ({
  default: {
    findOne: mockReflectionFindOne,
    create:  mockReflectionCreate,
  },
  REQUIRED_ANSWER_FIELDS: ['wins', 'areasToImprove', 'dislikes', 'achievements', 'plansNextWeek'],
  MIN_ANSWER_LENGTH: 500,
}));

// Interaction model
const mockInteractionCountDocuments = jest.fn();
const mockInteractionCreate         = jest.fn();
jest.unstable_mockModule('../../models/interactionModel.js', () => ({
  default: {
    countDocuments: mockInteractionCountDocuments,
    create:         mockInteractionCreate,
  },
}));

// Lead model — findOne to look up an assigned lead
const mockLeadFindOne = jest.fn();
jest.unstable_mockModule('../../models/leadModel.js', () => ({
  default: { findOne: mockLeadFindOne },
}));

// moraleService — best-effort; never throws
const mockAnalyzeReflection = jest.fn();
const mockBuildTeamMorale   = jest.fn();
const mockBuildOrgMorale    = jest.fn();
jest.unstable_mockModule('../../services/people/moraleService.js', () => ({
  analyzeReflection: mockAnalyzeReflection,
  buildTeamMorale:   mockBuildTeamMorale,
  buildOrgMorale:    mockBuildOrgMorale,
}));

// hierarchyService — needed for HEAD_ROLES check
jest.unstable_mockModule('../../services/people/hierarchyService.js', () => ({
  isOwnerLevel:        jest.fn((user) => user.role === 'Business Head'),
  getSubtree:          jest.fn(),
  getTeam:             jest.fn(),
  DEPARTMENT_BY_ROLE:  {},
  HEAD_ROLE_BY_DEPARTMENT: {},
}));

// isoWeek utils — deterministic
const CURRENT_ISO_WEEK = '2026-W25';
const mockIsoWeekOf       = jest.fn(() => CURRENT_ISO_WEEK);
const mockPreviousIsoWeek = jest.fn((isoWeek) => {
  const [year, wNum] = isoWeek.split('-W');
  const prev = parseInt(wNum, 10) - 1;
  return `${year}-W${String(prev).padStart(2, '0')}`;
});
const mockBoundsFromIsoWeek = jest.fn(() => ({
  weekStart: new Date('2026-06-16T00:00:00Z'),
  weekEnd:   new Date('2026-06-22T23:59:59.999Z'),
}));

jest.unstable_mockModule('../../utils/isoWeek.js', () => ({
  isoWeekOf:         mockIsoWeekOf,
  weekStartOf:       jest.fn(() => new Date('2026-06-16T00:00:00Z')),
  weekEndOf:         jest.fn(() => new Date('2026-06-22T23:59:59.999Z')),
  boundsFromIsoWeek: mockBoundsFromIsoWeek,
  previousIsoWeek:   mockPreviousIsoWeek,
}));

// =============================================================================
// IMPORT SUT (after mocks)
// =============================================================================
const { seedDemoPeopleData } = await import('../../services/people/demoSeedService.js');

// =============================================================================
// HELPERS
// =============================================================================
const makeReflectionDoc = (userId, isoWeek) => ({
  _id:          new mongoose.Types.ObjectId(),
  organization: ORG,
  user:         userId,
  isoWeek,
  status:       'submitted',
});

// =============================================================================
// SETUP
// =============================================================================
beforeEach(() => {
  jest.clearAllMocks();

  mockUserFind.mockReturnValue({ lean: jest.fn().mockResolvedValue(ACTIVE_USERS) });

  // Default: no existing reflections → always create
  mockReflectionFindOne.mockResolvedValue(null);
  mockReflectionCreate.mockImplementation(async (doc) =>
    makeReflectionDoc(doc.user, doc.isoWeek)
  );

  // Default: no recent interactions → always create
  mockInteractionCountDocuments.mockResolvedValue(0);
  mockInteractionCreate.mockResolvedValue({ _id: new mongoose.Types.ObjectId() });

  // Lead exists for all users by default
  mockLeadFindOne.mockResolvedValue({ _id: LEAD_ID });

  // Morale calls succeed
  mockAnalyzeReflection.mockResolvedValue({
    score: 0.5, label: 'positive', themes: [], riskSignals: [],
  });
  mockBuildTeamMorale.mockResolvedValue({ _id: new mongoose.Types.ObjectId() });
  mockBuildOrgMorale.mockResolvedValue({ _id: new mongoose.Types.ObjectId() });

  // Deterministic isoWeek sequence
  mockIsoWeekOf.mockReturnValue(CURRENT_ISO_WEEK);
  mockPreviousIsoWeek.mockImplementation((isoWeek) => {
    const [year, wNum] = isoWeek.split('-W');
    const prev = parseInt(wNum, 10) - 1;
    return `${year}-W${String(prev).padStart(2, '0')}`;
  });
  mockBoundsFromIsoWeek.mockImplementation(() => ({
    weekStart: new Date('2026-06-16T00:00:00Z'),
    weekEnd:   new Date('2026-06-22T23:59:59.999Z'),
  }));
});

// =============================================================================
// TESTS
// =============================================================================

describe('seedDemoPeopleData', () => {
  test('returns { reflections, interactions, morale } shape', async () => {
    const result = await seedDemoPeopleData(ORG, { weeks: 2 });
    expect(result).toHaveProperty('reflections');
    expect(result).toHaveProperty('interactions');
    expect(result).toHaveProperty('morale');
  });

  test('queries only active accepted members', async () => {
    await seedDemoPeopleData(ORG, { weeks: 1 });
    expect(mockUserFind).toHaveBeenCalledWith({
      organization:     ORG,
      isActive:         true,
      invitationStatus: 'accepted',
    });
  });

  test('creates one reflection per user per week when none exist', async () => {
    const weeks = 3;
    const result = await seedDemoPeopleData(ORG, { weeks });
    // weeks reflections × 2 users
    expect(mockReflectionCreate).toHaveBeenCalledTimes(weeks * ACTIVE_USERS.length);
    expect(result.reflections).toBe(weeks * ACTIVE_USERS.length);
  });

  test('SKIPS creation when reflection already exists for that user+week (idempotency)', async () => {
    // All reflections already exist → should create none
    mockReflectionFindOne.mockResolvedValue(makeReflectionDoc(USER_1, '2026-W24'));
    const result = await seedDemoPeopleData(ORG, { weeks: 2 });
    expect(mockReflectionCreate).not.toHaveBeenCalled();
    expect(result.reflections).toBe(0);
  });

  test('SKIPS only weeks that already have a reflection, creates the rest', async () => {
    let callCount = 0;
    // First call per user returns existing doc; subsequent calls return null
    mockReflectionFindOne.mockImplementation(async () => {
      callCount++;
      // Return existing for the first week of each user, null for the rest
      return callCount % 2 === 1 ? makeReflectionDoc(USER_1, '2026-W25') : null;
    });

    const result = await seedDemoPeopleData(ORG, { weeks: 2 });
    // 2 users × 2 weeks = 4 checks; half return existing → 2 created
    expect(result.reflections).toBe(2);
  });

  test('calls analyzeReflection on each newly created reflection (best-effort)', async () => {
    await seedDemoPeopleData(ORG, { weeks: 2 });
    // 2 weeks × 2 users = 4 reflections created
    expect(mockAnalyzeReflection).toHaveBeenCalledTimes(2 * ACTIVE_USERS.length);
  });

  test('does NOT call analyzeReflection for reflections that already existed', async () => {
    mockReflectionFindOne.mockResolvedValue(makeReflectionDoc(USER_1, '2026-W24'));
    await seedDemoPeopleData(ORG, { weeks: 2 });
    expect(mockAnalyzeReflection).not.toHaveBeenCalled();
  });

  test('analyzeReflection failure does not abort the seed (best-effort)', async () => {
    mockAnalyzeReflection.mockRejectedValue(new Error('AI key missing'));
    await expect(seedDemoPeopleData(ORG, { weeks: 1 })).resolves.not.toThrow();
  });

  test('creates interactions for users who have a lead and low recent count', async () => {
    mockInteractionCountDocuments.mockResolvedValue(0); // below threshold
    mockLeadFindOne.mockResolvedValue({ _id: LEAD_ID });
    const result = await seedDemoPeopleData(ORG, { weeks: 2 });
    expect(mockInteractionCreate).toHaveBeenCalled();
    expect(result.interactions).toBeGreaterThan(0);
  });

  test('SKIPS interactions when user already has >= 3 recent interactions (idempotency)', async () => {
    mockInteractionCountDocuments.mockResolvedValue(3); // at threshold → skip
    const result = await seedDemoPeopleData(ORG, { weeks: 2 });
    expect(mockInteractionCreate).not.toHaveBeenCalled();
    expect(result.interactions).toBe(0);
  });

  test('SKIPS interactions when user has no assigned lead', async () => {
    mockLeadFindOne.mockResolvedValue(null); // no lead
    const result = await seedDemoPeopleData(ORG, { weeks: 2 });
    expect(mockInteractionCreate).not.toHaveBeenCalled();
    expect(result.interactions).toBe(0);
  });

  test('calls buildOrgMorale after reflections are seeded', async () => {
    await seedDemoPeopleData(ORG, { weeks: 1 });
    expect(mockBuildOrgMorale).toHaveBeenCalledWith(ORG, expect.any(String));
  });

  test('buildTeamMorale failure does not abort seed (best-effort)', async () => {
    mockBuildTeamMorale.mockRejectedValue(new Error('AI error'));
    await expect(seedDemoPeopleData(ORG, { weeks: 1 })).resolves.not.toThrow();
  });

  test('buildOrgMorale failure does not abort seed (best-effort)', async () => {
    mockBuildOrgMorale.mockRejectedValue(new Error('AI error'));
    await expect(seedDemoPeopleData(ORG, { weeks: 1 })).resolves.not.toThrow();
  });

  test('works when org has no active members', async () => {
    mockUserFind.mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });
    const result = await seedDemoPeopleData(ORG, { weeks: 4 });
    expect(result).toEqual({ reflections: 0, interactions: 0, morale: 0 });
  });

  test('each created reflection has status=submitted and submittedAt set', async () => {
    await seedDemoPeopleData(ORG, { weeks: 1 });
    const firstCall = mockReflectionCreate.mock.calls[0][0];
    expect(firstCall.status).toBe('submitted');
    expect(firstCall.submittedAt).toBeInstanceOf(Date);
  });

  test('each created reflection has all five required answer fields with >= 500 chars', async () => {
    await seedDemoPeopleData(ORG, { weeks: 1 });
    for (const [doc] of mockReflectionCreate.mock.calls) {
      for (const field of ['wins', 'areasToImprove', 'dislikes', 'achievements', 'plansNextWeek']) {
        expect(typeof doc.answers[field]).toBe('string');
        expect(doc.answers[field].length).toBeGreaterThanOrEqual(500);
      }
    }
  });

  test('reflection answers vary across members/weeks (not all identical)', async () => {
    // 2 users × 3 weeks = 6 reflections; wins text must not all be the same
    await seedDemoPeopleData(ORG, { weeks: 3 });
    const winsValues = mockReflectionCreate.mock.calls.map(([doc]) => doc.answers.wins);
    const unique = new Set(winsValues);
    expect(unique.size).toBeGreaterThan(1);
  });
});
