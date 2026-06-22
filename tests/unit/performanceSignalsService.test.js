// tests/unit/performanceSignalsService.test.js
// In-process unit tests for the performance signals service. Every data source
// (Lead/Sale/Task/SupportTicket/Interaction/PerformanceSnapshot) and the
// hierarchy resolver is mocked with jest.unstable_mockModule — no live Mongo.
import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import mongoose from 'mongoose';

// ─── Mock the source models ──────────────────────────────────────────────────
const mockLeadAggregate = jest.fn();
jest.unstable_mockModule('../../models/leadModel.js', () => ({
  default: { aggregate: mockLeadAggregate },
}));

const mockSaleAggregate = jest.fn();
jest.unstable_mockModule('../../models/salesModel.js', () => ({
  default: { aggregate: mockSaleAggregate },
}));

const mockTaskAggregate = jest.fn();
jest.unstable_mockModule('../../models/taskModel.js', () => ({
  default: { aggregate: mockTaskAggregate },
}));

const mockTicketAggregate = jest.fn();
jest.unstable_mockModule('../../models/supportTicketModel.js', () => ({
  default: { aggregate: mockTicketAggregate },
}));

const mockInteractionCount = jest.fn();
jest.unstable_mockModule('../../models/interactionModel.js', () => ({
  default: { countDocuments: mockInteractionCount },
}));

const mockSnapshotFindOneAndUpdate = jest.fn();
const mockSnapshotFind = jest.fn();
jest.unstable_mockModule('../../models/performanceSnapshotModel.js', () => ({
  default: {
    findOneAndUpdate: mockSnapshotFindOneAndUpdate,
    find: mockSnapshotFind,
  },
  PERIODS: ['day', 'week', 'month'],
}));

const mockGetTeam = jest.fn();
jest.unstable_mockModule('../../services/people/hierarchyService.js', () => ({
  getTeam: mockGetTeam,
}));

// ─── Import service under test ────────────────────────────────────────────────
const {
  METRIC_KEYS,
  resolveWindow,
  median,
  computeMetrics,
  buildSnapshot,
  teamMedians,
} = await import('../../services/people/performanceSignalsService.js');

const ORG = new mongoose.Types.ObjectId();
const USER = new mongoose.Types.ObjectId();

// Default empty-aggregate responses so a test that only cares about one metric
// doesn't blow up on the others.
const resetAll = () => {
  [
    mockLeadAggregate,
    mockSaleAggregate,
    mockTaskAggregate,
    mockTicketAggregate,
    mockInteractionCount,
    mockSnapshotFindOneAndUpdate,
    mockSnapshotFind,
    mockGetTeam,
  ].forEach((m) => m.mockReset());

  mockLeadAggregate.mockResolvedValue([]);
  mockSaleAggregate.mockResolvedValue([]);
  mockTaskAggregate.mockResolvedValue([]);
  mockTicketAggregate.mockResolvedValue([]);
  mockInteractionCount.mockResolvedValue(0);
};

beforeEach(resetAll);

const user = { _id: USER, organization: ORG };
const start = new Date('2026-06-21T00:00:00.000Z');
const end = new Date('2026-06-22T00:00:00.000Z');

// ─── resolveWindow ─────────────────────────────────────────────────────────
describe('resolveWindow', () => {
  test('day → midnight..next-midnight (UTC)', () => {
    const { periodStart, periodEnd } = resolveWindow('day', new Date('2026-06-21T13:45:00Z'));
    expect(periodStart.toISOString()).toBe('2026-06-21T00:00:00.000Z');
    expect(periodEnd.toISOString()).toBe('2026-06-22T00:00:00.000Z');
  });

  test('week → ISO Monday start, +7 days end', () => {
    // 2026-06-21 is a Sunday → ISO week started Monday 2026-06-15.
    const { periodStart, periodEnd } = resolveWindow('week', new Date('2026-06-21T13:45:00Z'));
    expect(periodStart.toISOString()).toBe('2026-06-15T00:00:00.000Z');
    expect(periodEnd.toISOString()).toBe('2026-06-22T00:00:00.000Z');
  });

  test('week → a Monday anchors to itself', () => {
    const { periodStart } = resolveWindow('week', new Date('2026-06-15T09:00:00Z'));
    expect(periodStart.toISOString()).toBe('2026-06-15T00:00:00.000Z');
  });

  test('month → 1st of month .. 1st of next month', () => {
    const { periodStart, periodEnd } = resolveWindow('month', new Date('2026-06-21T13:45:00Z'));
    expect(periodStart.toISOString()).toBe('2026-06-01T00:00:00.000Z');
    expect(periodEnd.toISOString()).toBe('2026-07-01T00:00:00.000Z');
  });

  test('throws on unknown period', () => {
    expect(() => resolveWindow('decade', new Date())).toThrow();
  });
});

// ─── median ──────────────────────────────────────────────────────────────────
describe('median', () => {
  test('odd count → middle value', () => {
    expect(median([5, 1, 3])).toBe(3);
  });
  test('even count → average of two middle values', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });
  test('empty → 0', () => {
    expect(median([])).toBe(0);
  });
  test('ignores non-finite values', () => {
    expect(median([2, NaN, 4, undefined])).toBe(3);
  });
});

// ─── computeMetrics ────────────────────────────────────────────────────────
describe('computeMetrics', () => {
  test('returns a zero-filled metrics object when no data', async () => {
    const m = await computeMetrics(user, start, end);
    for (const k of METRIC_KEYS) expect(m[k]).toBe(0);
  });

  test('leadsWorked / leadsConverted / conversionRate from lead aggregate', async () => {
    mockLeadAggregate.mockResolvedValue([{ leadsWorked: 10, leadsConverted: 3 }]);
    const m = await computeMetrics(user, start, end);
    expect(m.leadsWorked).toBe(10);
    expect(m.leadsConverted).toBe(3);
    expect(m.conversionRate).toBe(0.3);
  });

  test('conversionRate is 0 when no leads worked', async () => {
    mockLeadAggregate.mockResolvedValue([{ leadsWorked: 0, leadsConverted: 0 }]);
    const m = await computeMetrics(user, start, end);
    expect(m.conversionRate).toBe(0);
  });

  test('salesCount / salesValue from sale aggregate', async () => {
    mockSaleAggregate.mockResolvedValue([{ salesCount: 2, salesValue: 12500000 }]);
    const m = await computeMetrics(user, start, end);
    expect(m.salesCount).toBe(2);
    expect(m.salesValue).toBe(12500000);
  });

  test('sale aggregate match excludes Cancelled and filters by booking window', async () => {
    await computeMetrics(user, start, end);
    const pipeline = mockSaleAggregate.mock.calls[0][0];
    const match = pipeline[0].$match;
    expect(match.status).toEqual({ $ne: 'Cancelled' });
    expect(match.bookingDate).toEqual({ $gte: start, $lt: end });
    expect(String(match.salesPerson)).toBe(String(USER));
  });

  test('tasksCompleted / tasksOverdue / taskSlaRate from task aggregate', async () => {
    // 8 completed, 6 on time → slaRate 0.75; 2 overdue.
    mockTaskAggregate.mockResolvedValue([
      { tasksCompleted: 8, tasksOverdue: 2, completedOnTime: 6 },
    ]);
    const m = await computeMetrics(user, start, end);
    expect(m.tasksCompleted).toBe(8);
    expect(m.tasksOverdue).toBe(2);
    expect(m.taskSlaRate).toBe(0.75);
  });

  test('taskSlaRate is 0 when nothing completed', async () => {
    mockTaskAggregate.mockResolvedValue([
      { tasksCompleted: 0, tasksOverdue: 1, completedOnTime: 0 },
    ]);
    const m = await computeMetrics(user, start, end);
    expect(m.taskSlaRate).toBe(0);
  });

  test('ticketsResolved / ticketAvgResolutionHrs from ticket aggregate', async () => {
    // 3 tickets, 30 total hours → avg 10.
    mockTicketAggregate.mockResolvedValue([
      { ticketsResolved: 3, totalResolutionHrs: 30 },
    ]);
    const m = await computeMetrics(user, start, end);
    expect(m.ticketsResolved).toBe(3);
    expect(m.ticketAvgResolutionHrs).toBe(10);
  });

  test('ticket match filters resolved/closed within closedAt window', async () => {
    await computeMetrics(user, start, end);
    const match = mockTicketAggregate.mock.calls[0][0][0].$match;
    expect(match.status).toEqual({ $in: ['resolved', 'closed'] });
    expect(match.closedAt).toEqual({ $gte: start, $lt: end });
  });

  test('interactionsLogged from countDocuments', async () => {
    mockInteractionCount.mockResolvedValue(17);
    const m = await computeMetrics(user, start, end);
    expect(m.interactionsLogged).toBe(17);
    const q = mockInteractionCount.mock.calls[0][0];
    expect(String(q.user)).toBe(String(USER));
    expect(q.createdAt).toEqual({ $gte: start, $lt: end });
  });
});

// ─── buildSnapshot ───────────────────────────────────────────────────────────
describe('buildSnapshot', () => {
  test('upserts on the {organization,user,period,periodStart} key (idempotent)', async () => {
    mockLeadAggregate.mockResolvedValue([{ leadsWorked: 4, leadsConverted: 1 }]);
    mockSnapshotFindOneAndUpdate.mockResolvedValue({ _id: 'snap1' });

    const result = await buildSnapshot(ORG, user, 'day', new Date('2026-06-21T15:00:00Z'));
    expect(result).toEqual({ _id: 'snap1' });

    const [filter, update, opts] = mockSnapshotFindOneAndUpdate.mock.calls[0];
    // Filter is the unique key, with periodStart normalized to midnight.
    expect(String(filter.organization)).toBe(String(ORG));
    expect(String(filter.user)).toBe(String(USER));
    expect(filter.period).toBe('day');
    expect(filter.periodStart.toISOString()).toBe('2026-06-21T00:00:00.000Z');
    // Upsert options make it idempotent.
    expect(opts).toMatchObject({ upsert: true, new: true });
    // Computed metrics are written.
    expect(update.$set.metrics.leadsWorked).toBe(4);
    expect(update.$set.metrics.conversionRate).toBe(0.25);
    expect(update.$set.periodEnd.toISOString()).toBe('2026-06-22T00:00:00.000Z');
  });

  test('normalizes a week anchor to the ISO Monday in the upsert key', async () => {
    mockSnapshotFindOneAndUpdate.mockResolvedValue({ _id: 'snap2' });
    await buildSnapshot(ORG, user, 'week', new Date('2026-06-21T15:00:00Z')); // Sunday
    const filter = mockSnapshotFindOneAndUpdate.mock.calls[0][0];
    expect(filter.period).toBe('week');
    expect(filter.periodStart.toISOString()).toBe('2026-06-15T00:00:00.000Z');
  });
});

// ─── teamMedians ─────────────────────────────────────────────────────────────
describe('teamMedians', () => {
  const head = { _id: new mongoose.Types.ObjectId(), organization: ORG, role: 'Sales Head' };

  const snapFind = (arr) => mockSnapshotFind.mockReturnValue({ lean: () => Promise.resolve(arr) });

  test('returns zero-filled object when the team is empty', async () => {
    mockGetTeam.mockResolvedValue([]);
    const result = await teamMedians(ORG, head, 'week', start);
    for (const k of METRIC_KEYS) expect(result[k]).toBe(0);
    expect(mockSnapshotFind).not.toHaveBeenCalled();
  });

  test('returns zero-filled object when no snapshots exist for the team', async () => {
    mockGetTeam.mockResolvedValue([{ _id: new mongoose.Types.ObjectId() }]);
    snapFind([]);
    const result = await teamMedians(ORG, head, 'week', start);
    for (const k of METRIC_KEYS) expect(result[k]).toBe(0);
  });

  test('odd member count → middle value per metric', async () => {
    const members = [1, 2, 3].map(() => ({ _id: new mongoose.Types.ObjectId() }));
    mockGetTeam.mockResolvedValue(members);
    snapFind([
      { metrics: { salesCount: 1, salesValue: 100 } },
      { metrics: { salesCount: 5, salesValue: 500 } },
      { metrics: { salesCount: 3, salesValue: 300 } },
    ]);
    const result = await teamMedians(ORG, head, 'week', start);
    expect(result.salesCount).toBe(3);
    expect(result.salesValue).toBe(300);
  });

  test('even member count → average of the two middle values per metric', async () => {
    const members = [1, 2, 3, 4].map(() => ({ _id: new mongoose.Types.ObjectId() }));
    mockGetTeam.mockResolvedValue(members);
    snapFind([
      { metrics: { interactionsLogged: 2 } },
      { metrics: { interactionsLogged: 4 } },
      { metrics: { interactionsLogged: 6 } },
      { metrics: { interactionsLogged: 8 } },
    ]);
    const result = await teamMedians(ORG, head, 'week', start);
    expect(result.interactionsLogged).toBe(5); // (4+6)/2
  });

  test('queries snapshots with the normalized period bucket + team ids', async () => {
    const members = [{ _id: new mongoose.Types.ObjectId() }];
    mockGetTeam.mockResolvedValue(members);
    snapFind([{ metrics: { salesCount: 2 } }]);
    await teamMedians(ORG, head, 'week', new Date('2026-06-21T15:00:00Z')); // Sunday
    const q = mockSnapshotFind.mock.calls[0][0];
    expect(q.period).toBe('week');
    expect(q.periodStart.toISOString()).toBe('2026-06-15T00:00:00.000Z');
    expect(q.user.$in).toHaveLength(1);
  });
});
