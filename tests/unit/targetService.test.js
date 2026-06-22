// tests/unit/targetService.test.js
// Unit tests for services/people/targetService.js
// Uses jest.unstable_mockModule to replace all DB/service deps — no live Mongo.
import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import mongoose from 'mongoose';

// ─── Mock: PerformanceTarget model ───────────────────────────────
const mockPTFindOne = jest.fn();
const mockPTCreate = jest.fn();
const mockPTFindOneAndUpdate = jest.fn();
jest.unstable_mockModule('../../models/performanceTargetModel.js', () => ({
  default: {
    findOne: mockPTFindOne,
    create: mockPTCreate,
    findOneAndUpdate: mockPTFindOneAndUpdate,
  },
}));

// ─── Mock: User model ─────────────────────────────────────────────
const mockUserFindById = jest.fn();
jest.unstable_mockModule('../../models/userModel.js', () => ({
  default: { findById: mockUserFindById },
}));

// ─── Mock: hierarchyService ───────────────────────────────────────
const mockGetSubtree = jest.fn();
jest.unstable_mockModule('../../services/people/hierarchyService.js', () => ({
  getSubtree: mockGetSubtree,
  // other exports not needed by targetService
  isOwnerLevel: jest.fn(),
  resolveDepartment: jest.fn(),
  getTeam: jest.fn(),
  getManagerChain: jest.fn(),
  DEPARTMENT_BY_ROLE: {},
  HEAD_ROLE_BY_DEPARTMENT: {},
}));

// ─── Import after mocks are in place ─────────────────────────────
const { getOrSeedTarget, setTarget, computeAttainment } = await import(
  '../../services/people/targetService.js'
);

// ─── Shared fixtures ─────────────────────────────────────────────
const ORG = new mongoose.Types.ObjectId();
const USER_ID = new mongoose.Types.ObjectId();
const ACTOR_ID = new mongoose.Types.ObjectId();
const PERIOD_START = new Date('2026-06-01T00:00:00.000Z');

// Helper: a mock findById chain that chains .lean()
function mockUserWith(role) {
  mockUserFindById.mockReturnValue({ lean: () => Promise.resolve({ _id: USER_ID, role }) });
}

beforeEach(() => {
  [
    mockPTFindOne,
    mockPTCreate,
    mockPTFindOneAndUpdate,
    mockUserFindById,
    mockGetSubtree,
  ].forEach((m) => m.mockReset());
});

// ─── getOrSeedTarget ─────────────────────────────────────────────
describe('getOrSeedTarget', () => {
  test('returns existing document without touching User or create', async () => {
    const existing = { _id: new mongoose.Types.ObjectId(), source: 'template' };
    mockPTFindOne.mockResolvedValue(existing);

    const result = await getOrSeedTarget(ORG, USER_ID, PERIOD_START);

    expect(result).toBe(existing);
    expect(mockUserFindById).not.toHaveBeenCalled();
    expect(mockPTCreate).not.toHaveBeenCalled();
  });

  test('seeds from Sales Executive template when no target exists', async () => {
    mockPTFindOne.mockResolvedValue(null);
    mockUserWith('Sales Executive');

    const seeded = { _id: new mongoose.Types.ObjectId(), source: 'template' };
    mockPTFindOneAndUpdate.mockResolvedValue(seeded);

    const result = await getOrSeedTarget(ORG, USER_ID, PERIOD_START);

    expect(result).toBe(seeded);
    expect(mockPTCreate).not.toHaveBeenCalled();
    const setOnInsert = mockPTFindOneAndUpdate.mock.calls[0][1].$setOnInsert;
    // Sales Executive template (from config/performanceTargetTemplates.js)
    expect(setOnInsert.targets.salesCount).toBe(4);
    expect(setOnInsert.targets.salesValue).toBe(4_000_000);
    expect(setOnInsert.targets.leadsWorked).toBe(60);
    expect(setOnInsert.targets.conversions).toBe(4);
    expect(setOnInsert.source).toBe('template');
    expect(setOnInsert.setBy).toBeNull();
    expect(setOnInsert.period).toBe('month');
    // Must use upsert:true, new:true
    const opts = mockPTFindOneAndUpdate.mock.calls[0][2];
    expect(opts.upsert).toBe(true);
    expect(opts.new).toBe(true);
  });

  test('seeds from Sales Manager template for Sales Manager role', async () => {
    mockPTFindOne.mockResolvedValue(null);
    mockUserWith('Sales Manager');

    const seeded = { _id: new mongoose.Types.ObjectId(), source: 'template' };
    mockPTFindOneAndUpdate.mockResolvedValue(seeded);

    await getOrSeedTarget(ORG, USER_ID, PERIOD_START);

    expect(mockPTCreate).not.toHaveBeenCalled();
    const setOnInsert = mockPTFindOneAndUpdate.mock.calls[0][1].$setOnInsert;
    expect(setOnInsert.targets.salesCount).toBe(8);
    expect(setOnInsert.targets.salesValue).toBe(8_000_000);
    expect(setOnInsert.source).toBe('template');
  });

  test('uses generic fallback template for unknown/custom role', async () => {
    mockPTFindOne.mockResolvedValue(null);
    mockUserWith('Custom Role XYZ');

    mockPTFindOneAndUpdate.mockResolvedValue({});

    await getOrSeedTarget(ORG, USER_ID, PERIOD_START);

    expect(mockPTCreate).not.toHaveBeenCalled();
    const setOnInsert = mockPTFindOneAndUpdate.mock.calls[0][1].$setOnInsert;
    // Generic fallback from getTemplateForRole
    expect(setOnInsert.targets.salesCount).toBe(2);
    expect(setOnInsert.targets.leadsWorked).toBe(20);
    expect(setOnInsert.source).toBe('template');
  });
});

// ─── setTarget ───────────────────────────────────────────────────
describe('setTarget', () => {
  const actor = { _id: ACTOR_ID, organization: ORG };
  const newTargets = {
    salesCount: 10,
    salesValue: 10_000_000,
    leadsWorked: 50,
    conversions: 10,
    taskSlaRate: 0.9,
  };
  const upserted = { _id: new mongoose.Types.ObjectId(), source: 'manual' };

  test('succeeds when actor scope is "org" (owner)', async () => {
    mockGetSubtree.mockResolvedValue({ scope: 'org', userIds: [] });
    mockPTFindOneAndUpdate.mockResolvedValue(upserted);

    const result = await setTarget(actor, USER_ID, PERIOD_START, newTargets);

    expect(result).toBe(upserted);
    const updateArg = mockPTFindOneAndUpdate.mock.calls[0][1].$set;
    expect(updateArg.source).toBe('manual');
    expect(updateArg.setBy.equals(ACTOR_ID)).toBe(true);
    expect(updateArg.targets).toBe(newTargets);
  });

  test('succeeds when userId is in actor department subtree', async () => {
    mockGetSubtree.mockResolvedValue({
      scope: 'department',
      userIds: [USER_ID, new mongoose.Types.ObjectId()],
    });
    mockPTFindOneAndUpdate.mockResolvedValue(upserted);

    const result = await setTarget(actor, USER_ID, PERIOD_START, newTargets);

    expect(result).toBe(upserted);
  });

  test('throws 403 when actor is a peer (same scope, user not in subtree)', async () => {
    const someOtherId = new mongoose.Types.ObjectId();
    mockGetSubtree.mockResolvedValue({
      scope: 'department',
      userIds: [someOtherId], // USER_ID not included
    });

    await expect(setTarget(actor, USER_ID, PERIOD_START, newTargets)).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(mockPTFindOneAndUpdate).not.toHaveBeenCalled();
  });

  test('throws 403 when actor scope is "self" (member targeting another user)', async () => {
    mockGetSubtree.mockResolvedValue({
      scope: 'self',
      userIds: [ACTOR_ID],
    });

    await expect(setTarget(actor, USER_ID, PERIOD_START, newTargets)).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(mockPTFindOneAndUpdate).not.toHaveBeenCalled();
  });

  test('throws 403 when actor attempts to set their own target (self-targeting)', async () => {
    // No getSubtree call should be needed — guard fires before it
    await expect(setTarget(actor, ACTOR_ID, PERIOD_START, newTargets)).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(mockGetSubtree).not.toHaveBeenCalled();
    expect(mockPTFindOneAndUpdate).not.toHaveBeenCalled();
  });

  test('passes upsert:true and new:true to findOneAndUpdate', async () => {
    mockGetSubtree.mockResolvedValue({ scope: 'org', userIds: [] });
    mockPTFindOneAndUpdate.mockResolvedValue(upserted);

    await setTarget(actor, USER_ID, PERIOD_START, newTargets);

    const opts = mockPTFindOneAndUpdate.mock.calls[0][2];
    expect(opts.upsert).toBe(true);
    expect(opts.new).toBe(true);
  });
});

// ─── computeAttainment ───────────────────────────────────────────
describe('computeAttainment', () => {
  test('calculates correct pct for all tracked metrics', () => {
    const metrics = {
      salesCount: 2,
      salesValue: 1_000_000,
      leadsWorked: 30,
      conversions: 2,
      taskSlaRate: 0.8,
    };
    const target = {
      targets: {
        salesCount: 4,
        salesValue: 4_000_000,
        leadsWorked: 60,
        conversions: 4,
        taskSlaRate: 1,
      },
    };

    const result = computeAttainment(metrics, target);

    expect(result.salesCount).toEqual({ actual: 2, target: 4, pct: 0.5 });
    expect(result.salesValue).toEqual({ actual: 1_000_000, target: 4_000_000, pct: 0.25 });
    expect(result.leadsWorked).toEqual({ actual: 30, target: 60, pct: 0.5 });
    expect(result.conversions).toEqual({ actual: 2, target: 4, pct: 0.5 });
    expect(result.taskSlaRate).toEqual({ actual: 0.8, target: 1, pct: 0.8 });
  });

  test('pct is null when target value is 0 (no divide-by-zero)', () => {
    const metrics = { salesCount: 5, salesValue: 0, leadsWorked: 0, conversions: 0, taskSlaRate: 0 };
    const target = {
      targets: { salesCount: 0, salesValue: 0, leadsWorked: 0, conversions: 0, taskSlaRate: 0 },
    };

    const result = computeAttainment(metrics, target);

    expect(result.salesCount.pct).toBeNull();
    expect(result.salesValue.pct).toBeNull();
    expect(result.leadsWorked.pct).toBeNull();
  });

  test('pct is null when target key is missing entirely', () => {
    const metrics = { salesCount: 3 };
    const target = { targets: {} }; // no salesCount target

    const result = computeAttainment(metrics, target);

    expect(result.salesCount.pct).toBeNull();
    expect(result.salesCount.actual).toBe(3);
  });

  test('pct > 1 when actual exceeds target (over-attainment)', () => {
    const metrics = { salesCount: 10, salesValue: 0, leadsWorked: 0, conversions: 0, taskSlaRate: 0 };
    const target = { targets: { salesCount: 4, salesValue: 0, leadsWorked: 0, conversions: 0, taskSlaRate: 0 } };

    const result = computeAttainment(metrics, target);

    expect(result.salesCount.pct).toBeCloseTo(2.5);
  });

  test('accepts a plain targets object (not wrapped in .targets)', () => {
    const metrics = { salesCount: 2, salesValue: 0, leadsWorked: 0, conversions: 0, taskSlaRate: 0 };
    const flatTarget = { salesCount: 4, salesValue: 0, leadsWorked: 0, conversions: 0, taskSlaRate: 0 };

    const result = computeAttainment(metrics, flatTarget);

    expect(result.salesCount.pct).toBeCloseTo(0.5);
  });

  test('handles null/undefined metrics gracefully (actual defaults to 0)', () => {
    const target = { targets: { salesCount: 4, salesValue: 4_000_000, leadsWorked: 60, conversions: 4, taskSlaRate: 1 } };
    const result = computeAttainment(null, target);

    expect(result.salesCount.actual).toBe(0);
    expect(result.salesCount.pct).toBe(0);
  });
});
