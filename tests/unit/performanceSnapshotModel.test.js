// tests/unit/performanceSnapshotModel.test.js
// Schema-level tests (no DB) for the PerformanceSnapshot model.
import mongoose from 'mongoose';
import PerformanceSnapshot, { PERIODS } from '../../models/performanceSnapshotModel.js';

const valid = (over = {}) => ({
  organization: new mongoose.Types.ObjectId(),
  user: new mongoose.Types.ObjectId(),
  period: 'day',
  periodStart: new Date('2026-06-21T00:00:00.000Z'),
  periodEnd: new Date('2026-06-22T00:00:00.000Z'),
  ...over,
});

describe('PerformanceSnapshot model', () => {
  it('validates a minimal valid document', () => {
    expect(new PerformanceSnapshot(valid()).validateSync()).toBeUndefined();
  });

  it('requires organization, user, period, periodStart, periodEnd', () => {
    const err = new PerformanceSnapshot({}).validateSync();
    expect(err.errors.organization).toBeDefined();
    expect(err.errors.user).toBeDefined();
    expect(err.errors.period).toBeDefined();
    expect(err.errors.periodStart).toBeDefined();
    expect(err.errors.periodEnd).toBeDefined();
  });

  it('rejects an invalid period', () => {
    const err = new PerformanceSnapshot(valid({ period: 'fortnight' })).validateSync();
    expect(err.errors.period).toBeDefined();
  });

  it('accepts day, week, and month periods', () => {
    for (const p of ['day', 'week', 'month']) {
      expect(new PerformanceSnapshot(valid({ period: p })).validateSync()).toBeUndefined();
    }
  });

  it('defaults all metrics to 0', () => {
    const doc = new PerformanceSnapshot(valid());
    expect(doc.metrics.leadsWorked).toBe(0);
    expect(doc.metrics.leadsConverted).toBe(0);
    expect(doc.metrics.conversionRate).toBe(0);
    expect(doc.metrics.salesCount).toBe(0);
    expect(doc.metrics.salesValue).toBe(0);
    expect(doc.metrics.tasksCompleted).toBe(0);
    expect(doc.metrics.tasksOverdue).toBe(0);
    expect(doc.metrics.taskSlaRate).toBe(0);
    expect(doc.metrics.ticketsResolved).toBe(0);
    expect(doc.metrics.ticketAvgResolutionHrs).toBe(0);
    expect(doc.metrics.interactionsLogged).toBe(0);
  });

  it('defaults all red-flags to 0', () => {
    const doc = new PerformanceSnapshot(valid());
    expect(doc.redFlags.staleLeads).toBe(0);
    expect(doc.redFlags.noMovementLeads).toBe(0);
    expect(doc.redFlags.overdueFollowUps).toBe(0);
    expect(doc.redFlags.overdueTasks).toBe(0);
    expect(doc.redFlags.agingPipeline).toBe(0);
    expect(doc.redFlags.lowActivity).toBe(0);
  });

  it('defaults computedAt to a Date', () => {
    const doc = new PerformanceSnapshot(valid());
    expect(doc.computedAt).toBeInstanceOf(Date);
  });

  it('stores raw money in salesValue', () => {
    const doc = new PerformanceSnapshot(valid({ metrics: { salesValue: 12500000 } }));
    expect(doc.metrics.salesValue).toBe(12500000);
  });

  it('declares a unique index on {organization,user,period,periodStart}', () => {
    const idx = PerformanceSnapshot.schema.indexes();
    const match = idx.find(([fields, opts]) => {
      return (
        fields.organization === 1 &&
        fields.user === 1 &&
        fields.period === 1 &&
        fields.periodStart === 1 &&
        opts &&
        opts.unique === true
      );
    });
    expect(match).toBeDefined();
  });

  it('exports the PERIODS enum', () => {
    expect(PERIODS).toEqual(['day', 'week', 'month']);
  });
});
