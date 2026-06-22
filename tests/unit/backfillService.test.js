// tests/unit/backfillService.test.js
// Unit tests for services/people/backfillService.js
// Mocks: User model, performanceSignalsService, isoWeek utils — no DB/network.

import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import mongoose from 'mongoose';

// =============================================================================
// IDs
// =============================================================================
const ORG    = new mongoose.Types.ObjectId();
const USER_1 = new mongoose.Types.ObjectId();
const USER_2 = new mongoose.Types.ObjectId();

const ACTIVE_USERS = [
  { _id: USER_1, organization: ORG, role: 'Sales Executive' },
  { _id: USER_2, organization: ORG, role: 'Sales Head' },
];

// =============================================================================
// MOCKS — registered BEFORE any import of the SUT
// =============================================================================

// User model
const mockUserFind = jest.fn();
jest.unstable_mockModule('../../models/userModel.js', () => ({
  default: { find: mockUserFind },
}));

// performanceSignalsService
const mockBuildSnapshot = jest.fn();
const mockResolveWindow = jest.fn();
jest.unstable_mockModule('../../services/people/performanceSignalsService.js', () => ({
  buildSnapshot:  mockBuildSnapshot,
  resolveWindow:  mockResolveWindow,
  computeMetrics: jest.fn(),
  teamMedians:    jest.fn(),
  METRIC_KEYS:    [],
}));

// isoWeek utils — deterministic stubs
const CURRENT_ISO_WEEK = '2026-W25';
const mockIsoWeekOf         = jest.fn(() => CURRENT_ISO_WEEK);
const mockWeekStartOf       = jest.fn(() => new Date('2026-06-16T00:00:00Z'));
const mockBoundsFromIsoWeek = jest.fn(() => ({
  weekStart: new Date('2026-06-16T00:00:00Z'),
  weekEnd:   new Date('2026-06-22T23:59:59.999Z'),
}));
const mockPreviousIsoWeek   = jest.fn((isoWeek) => {
  const [year, wNum] = isoWeek.split('-W');
  const prev = parseInt(wNum, 10) - 1;
  return `${year}-W${String(prev).padStart(2, '0')}`;
});

jest.unstable_mockModule('../../utils/isoWeek.js', () => ({
  isoWeekOf:         mockIsoWeekOf,
  weekStartOf:       mockWeekStartOf,
  weekEndOf:         jest.fn(() => new Date('2026-06-22T23:59:59.999Z')),
  boundsFromIsoWeek: mockBoundsFromIsoWeek,
  previousIsoWeek:   mockPreviousIsoWeek,
}));

// =============================================================================
// IMPORT SUT (after mocks)
// =============================================================================
const { backfillSnapshots } = await import('../../services/people/backfillService.js');

// =============================================================================
// SETUP
// =============================================================================
beforeEach(() => {
  jest.clearAllMocks();
  // User.find(...).lean() chain
  mockUserFind.mockReturnValue({ lean: jest.fn().mockResolvedValue(ACTIVE_USERS) });
  mockBuildSnapshot.mockResolvedValue({ _id: new mongoose.Types.ObjectId() });
  mockResolveWindow.mockImplementation(() => ({
    periodStart: new Date('2026-06-01T00:00:00Z'),
    periodEnd:   new Date('2026-07-01T00:00:00Z'),
  }));
  mockIsoWeekOf.mockReturnValue(CURRENT_ISO_WEEK);
  mockWeekStartOf.mockReturnValue(new Date('2026-06-16T00:00:00Z'));
  mockBoundsFromIsoWeek.mockImplementation(() => ({
    weekStart: new Date('2026-06-16T00:00:00Z'),
    weekEnd:   new Date('2026-06-22T23:59:59.999Z'),
  }));
  mockPreviousIsoWeek.mockImplementation((isoWeek) => {
    const [year, wNum] = isoWeek.split('-W');
    const prev = parseInt(wNum, 10) - 1;
    return `${year}-W${String(prev).padStart(2, '0')}`;
  });
});

// =============================================================================
// TESTS
// =============================================================================

describe('backfillSnapshots', () => {
  test('queries only active accepted members of the given org', async () => {
    await backfillSnapshots(ORG, { weeks: 2 });
    expect(mockUserFind).toHaveBeenCalledWith({
      organization:     ORG,
      isActive:         true,
      invitationStatus: 'accepted',
    });
  });

  test('returns { built, users } with correct users count', async () => {
    const result = await backfillSnapshots(ORG, { weeks: 2 });
    expect(result).toHaveProperty('built');
    expect(result).toHaveProperty('users');
    expect(result.users).toBe(ACTIVE_USERS.length); // 2 users
  });

  test('builds the expected snapshot count per user: weeks past-weekly + 3 past-monthly + 3 current (day/week/month)', async () => {
    const weeks = 4;
    // Per user: weeks weekly anchors + 3 monthly anchors + 1 day + 1 week + 1 month = weeks + 6
    const expectedPerUser = weeks + 3 + 3;
    const result = await backfillSnapshots(ORG, { weeks });
    expect(result.built).toBe(expectedPerUser * ACTIVE_USERS.length);
  });

  test('defaults to 8 weeks when no options provided', async () => {
    const result = await backfillSnapshots(ORG);
    const expectedPerUser = 8 + 3 + 3;
    expect(result.built).toBe(expectedPerUser * ACTIVE_USERS.length);
  });

  test('calls buildSnapshot with period="week" for each prior week + current week', async () => {
    await backfillSnapshots(ORG, { weeks: 2 });
    const weekCalls = mockBuildSnapshot.mock.calls.filter(([,, period]) => period === 'week');
    // 2 past weekly snapshots per user + 1 current week per user = 3 week calls per user
    expect(weekCalls.length).toBe(3 * ACTIVE_USERS.length);
  });

  test('calls buildSnapshot with period="month" for 3 prior months + current month', async () => {
    await backfillSnapshots(ORG, { weeks: 2 });
    const monthCalls = mockBuildSnapshot.mock.calls.filter(([,, period]) => period === 'month');
    // 3 past months + 1 current month = 4 month calls per user
    expect(monthCalls.length).toBe(4 * ACTIVE_USERS.length);
  });

  test('calls buildSnapshot with period="day" for current day only', async () => {
    await backfillSnapshots(ORG, { weeks: 2 });
    const dayCalls = mockBuildSnapshot.mock.calls.filter(([,, period]) => period === 'day');
    // 1 current day per user
    expect(dayCalls.length).toBe(1 * ACTIVE_USERS.length);
  });

  test('passes orgId as first arg to every buildSnapshot call', async () => {
    await backfillSnapshots(ORG, { weeks: 1 });
    for (const [callOrgId] of mockBuildSnapshot.mock.calls) {
      expect(callOrgId.toString()).toBe(ORG.toString());
    }
  });

  test('works when org has no active members — returns built=0, users=0', async () => {
    mockUserFind.mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });
    const result = await backfillSnapshots(ORG, { weeks: 4 });
    expect(result).toEqual({ built: 0, users: 0 });
    expect(mockBuildSnapshot).not.toHaveBeenCalled();
  });

  test('is idempotent — re-running calls buildSnapshot again (upsert is inside buildSnapshot)', async () => {
    await backfillSnapshots(ORG, { weeks: 1 });
    const firstCount = mockBuildSnapshot.mock.calls.length;
    jest.clearAllMocks();
    mockUserFind.mockReturnValue({ lean: jest.fn().mockResolvedValue(ACTIVE_USERS) });
    mockBuildSnapshot.mockResolvedValue({ _id: new mongoose.Types.ObjectId() });
    mockResolveWindow.mockImplementation(() => ({
      periodStart: new Date('2026-06-01T00:00:00Z'),
      periodEnd:   new Date('2026-07-01T00:00:00Z'),
    }));
    mockIsoWeekOf.mockReturnValue(CURRENT_ISO_WEEK);
    mockWeekStartOf.mockReturnValue(new Date('2026-06-16T00:00:00Z'));
    mockBoundsFromIsoWeek.mockImplementation(() => ({
      weekStart: new Date('2026-06-16T00:00:00Z'),
      weekEnd:   new Date('2026-06-22T23:59:59.999Z'),
    }));
    mockPreviousIsoWeek.mockImplementation((isoWeek) => {
      const [year, wNum] = isoWeek.split('-W');
      const prev = parseInt(wNum, 10) - 1;
      return `${year}-W${String(prev).padStart(2, '0')}`;
    });
    await backfillSnapshots(ORG, { weeks: 1 });
    expect(mockBuildSnapshot.mock.calls.length).toBe(firstCount);
  });
});
