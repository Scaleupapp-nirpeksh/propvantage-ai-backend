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

// Lead model
const mockLeadFind              = jest.fn();
const mockLeadFindOne           = jest.fn();
const mockLeadFindByIdAndUpdate = jest.fn();
const mockLeadCreate            = jest.fn();
jest.unstable_mockModule('../../models/leadModel.js', () => ({
  default: {
    find:              mockLeadFind,
    findOne:           mockLeadFindOne,
    findByIdAndUpdate: mockLeadFindByIdAndUpdate,
    create:            mockLeadCreate,
  },
}));

// Organization
const mockOrgFindById = jest.fn();
jest.unstable_mockModule('../../models/organizationModel.js', () => ({
  default: { findById: mockOrgFindById },
}));

// Sale
const mockSaleCountDocuments = jest.fn();
const mockSaleCreate         = jest.fn();
jest.unstable_mockModule('../../models/salesModel.js', () => ({
  default: { countDocuments: mockSaleCountDocuments, create: mockSaleCreate },
}));

// Unit
const mockUnitFind              = jest.fn();
const mockUnitFindByIdAndUpdate = jest.fn();
jest.unstable_mockModule('../../models/unitModel.js', () => ({
  default: { find: mockUnitFind, findByIdAndUpdate: mockUnitFindByIdAndUpdate },
}));

// Task
const mockTaskCountDocuments = jest.fn();
const mockTaskCreate         = jest.fn();
jest.unstable_mockModule('../../models/taskModel.js', () => ({
  default: { countDocuments: mockTaskCountDocuments, create: mockTaskCreate },
}));

// Project
const mockProjectFindOne = jest.fn();
jest.unstable_mockModule('../../models/projectModel.js', () => ({
  default: { findOne: mockProjectFindOne },
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

  // New defaults for activity seeding mocks
  const LEAD_ID_2 = new mongoose.Types.ObjectId();
  mockLeadFind.mockResolvedValue([
    { _id: LEAD_ID, status: 'New', assignedTo: USER_1 },
    { _id: LEAD_ID_2, status: 'Qualified', assignedTo: USER_1 },
  ]);
  mockOrgFindById.mockResolvedValue({ _id: ORG, name: 'PropVantage Demo Org' });
  mockProjectFindOne.mockResolvedValue({ _id: new mongoose.Types.ObjectId() });
  mockUnitFind.mockResolvedValue([
    { _id: new mongoose.Types.ObjectId(), status: 'available' },
    { _id: new mongoose.Types.ObjectId(), status: 'available' },
  ]);
  mockTaskCountDocuments.mockResolvedValue(0);
  mockTaskCreate.mockResolvedValue({});
  mockLeadFindByIdAndUpdate.mockResolvedValue({});
  mockLeadCreate.mockResolvedValue({ _id: new mongoose.Types.ObjectId(), status: 'New' });
  mockSaleCountDocuments.mockResolvedValue(0);
  mockSaleCreate.mockResolvedValue({});
  mockUnitFindByIdAndUpdate.mockResolvedValue({});

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

  test('SKIPS interactions when user already has >= 10 recent interactions (idempotency)', async () => {
    mockInteractionCountDocuments.mockResolvedValue(10); // at threshold → skip
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
    expect(result).toMatchObject({ reflections: 0, interactions: 0, morale: 0 });
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

// =============================================================================
// DEMO-ACTIVITY SEEDING TESTS
// =============================================================================

describe('demo-activity seeding', () => {
  test('safety gate — non-demo org skips activity seeding but reflections still run', async () => {
    mockOrgFindById.mockResolvedValue({ name: 'Prestige Realty' }); // no "demo" in name
    const result = await seedDemoPeopleData(ORG, { weeks: 1 });
    expect(result.activitySeeded).toBe(false);
    expect(mockReflectionCreate).toHaveBeenCalled();
    expect(mockTaskCreate).not.toHaveBeenCalled();
    expect(mockSaleCreate).not.toHaveBeenCalled();
  });

  test('safety gate — demo org proceeds with activity seeding', async () => {
    mockOrgFindById.mockResolvedValue({ name: 'Demo PropVantage' });
    const result = await seedDemoPeopleData(ORG, { weeks: 1 });
    expect(result.activitySeeded).toBe(true);
    expect(mockTaskCreate).toHaveBeenCalled();
  });

  test('tasks created for all active members with valid shape', async () => {
    await seedDemoPeopleData(ORG, { weeks: 1 });
    expect(mockTaskCreate.mock.calls.length).toBeGreaterThanOrEqual(1);
    const VALID_TASK_CATEGORIES = [
      'Lead & Sales', 'Payment & Collection', 'Construction',
      'Document & Compliance', 'Customer Service', 'Approval', 'General',
    ];
    const VALID_TASK_STATUSES = ['Open', 'In Progress', 'Completed'];
    const validUserIds = ACTIVE_USERS.map(u => u._id.toString());
    const firstCall = mockTaskCreate.mock.calls[0][0];
    const assignedToStr = firstCall.assignedTo.toString();
    expect(validUserIds).toContain(assignedToStr);
    for (const [doc] of mockTaskCreate.mock.calls) {
      expect(doc.organization.toString()).toBe(ORG.toString());
      expect(VALID_TASK_CATEGORIES).toContain(doc.category);
      expect(VALID_TASK_STATUSES).toContain(doc.status);
      expect(doc.tags).toContain('demo_seed');
    }
  });

  test('idempotency — existing demo tasks skip task creation', async () => {
    mockTaskCountDocuments.mockResolvedValue(3); // already has demo tasks
    const result = await seedDemoPeopleData(ORG, { weeks: 1 });
    expect(mockTaskCreate).not.toHaveBeenCalled();
  });

  test('lead conversions happen (Booked statusHistory entry pushed)', async () => {
    const result = await seedDemoPeopleData(ORG, { weeks: 1 });
    const updateCalls = mockLeadFindByIdAndUpdate.mock.calls;
    expect(updateCalls.length).toBeGreaterThan(0);
    const pushArg = updateCalls[0][1].$push;
    expect(pushArg).toBeDefined();
    expect(pushArg.statusHistory).toMatchObject({ status: 'Booked' });
    expect(result.leadsConverted).toBeGreaterThan(0);
  });

  test('sales only for sales-capable roles', async () => {
    // Override ACTIVE_USERS: USER_1 = non-sales, USER_2 = sales
    mockUserFind.mockReturnValue({
      lean: jest.fn().mockResolvedValue([
        { _id: USER_1, organization: ORG, role: 'Finance Executive' },
        { _id: USER_2, organization: ORG, role: 'Sales Manager' },
      ]),
    });
    // USER_2 has a booked lead
    mockLeadFindOne.mockImplementation(async (query) => {
      if (query.assignedTo?.toString() === USER_2.toString()) {
        return { _id: LEAD_ID, status: 'Booked' };
      }
      return null;
    });
    await seedDemoPeopleData(ORG, { weeks: 1 });
    // At least one sale must have been created for the sales-capable member
    expect(mockSaleCreate).toHaveBeenCalled();
    for (const [doc] of mockSaleCreate.mock.calls) {
      expect(doc.salesPerson.toString()).toBe(USER_2.toString());
    }
  });

  test('unit shortage — creates fewer sales, no crash', async () => {
    mockUnitFind.mockResolvedValue([]); // no available units
    await expect(seedDemoPeopleData(ORG, { weeks: 1 })).resolves.not.toThrow();
    expect(mockSaleCreate).not.toHaveBeenCalled();
  });

  test('no project in org — Lead.create and Sale.create skipped gracefully', async () => {
    mockProjectFindOne.mockResolvedValue(null); // no project exists
    // Users have no existing leads (force Lead.create path)
    mockLeadFind.mockResolvedValue([]);
    await expect(seedDemoPeopleData(ORG, { weeks: 1 })).resolves.not.toThrow();
    expect(mockLeadCreate).not.toHaveBeenCalled();
    expect(mockSaleCreate).not.toHaveBeenCalled();
  });

  test('idempotency — existing demo sales skip sale creation', async () => {
    mockSaleCountDocuments.mockResolvedValue(2); // already has sales
    const result = await seedDemoPeopleData(ORG, { weeks: 1 });
    expect(mockSaleCreate).not.toHaveBeenCalled();
  });

  test('lead-conversion idempotency — leads already Booked with demo_seed note are not converted again', async () => {
    // Simulate a second run: all leads for every user are already Booked with the demo_seed note
    const bookedLead1 = {
      _id:           new mongoose.Types.ObjectId(),
      status:        'Booked',
      assignedTo:    USER_1,
      statusHistory: [{ status: 'Booked', note: 'demo_seed' }],
    };
    const bookedLead2 = {
      _id:           new mongoose.Types.ObjectId(),
      status:        'Booked',
      assignedTo:    USER_2,
      statusHistory: [{ status: 'Booked', note: 'demo_seed' }],
    };
    // Lead.find returns already-converted leads for every user
    mockLeadFind.mockImplementation(async (query) => {
      const assignedTo = query?.assignedTo;
      if (assignedTo?.toString() === USER_1.toString()) return [bookedLead1];
      if (assignedTo?.toString() === USER_2.toString()) return [bookedLead2];
      return [];
    });

    const result = await seedDemoPeopleData(ORG, { weeks: 1 });

    // The conversion update must NOT be called for any lead
    expect(mockLeadFindByIdAndUpdate).not.toHaveBeenCalled();
    expect(result.leadsConverted).toBe(0);
  });

  test('interactions threshold updated to 10/14-day window', async () => {
    mockInteractionCountDocuments.mockResolvedValue(0);
    mockLeadFindOne.mockResolvedValue({ _id: LEAD_ID });
    const result = await seedDemoPeopleData(ORG, { weeks: 1 });
    // With new threshold of 12 interactions over 14 days, should create more than 3
    expect(mockInteractionCreate.mock.calls.length).toBeGreaterThan(3);
  });

  test('summary object contains new fields', async () => {
    const result = await seedDemoPeopleData(ORG, { weeks: 1 });
    expect(result).toHaveProperty('tasks');
    expect(result).toHaveProperty('leadsConverted');
    expect(result).toHaveProperty('salesCreated');
    expect(result).toHaveProperty('activitySeeded');
    expect(result).toHaveProperty('activitySkipReason');
  });
});
