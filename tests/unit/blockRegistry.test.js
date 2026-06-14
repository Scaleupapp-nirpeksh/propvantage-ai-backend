// File: tests/unit/blockRegistry.test.js
import { BLOCKS, getBlock, getCatalog } from '../../services/reports/blockRegistry.js';

const fakeOverview = {
  revenue: { totalSalesValue: 124000000, totalCollected: 80000000, totalOutstanding: 44000000, collectionRate: 0.71 },
  salesPipeline: { totalLeads: 320, conversionRate: 0.062, avgBookingValue: 8500000,
    leadsByStatus: { New: 100, Booked: 20 }, leadsBySource: { Web: 50, Referral: 30 } },
  portfolio: { totalUnits: 200, totalProjects: 4, unitsByStatus: { available: 152, sold: 48 } },
  team: { topWorkload: [{ user: 'A', openTasks: 9 }] },
  invoicing: { totalInvoiced: 50000000, totalPaid: 30000000, totalOverdue: 5000000,
    invoicesByStatus: { paid: 12, pending: 5, overdue: 2 } },
  channelPartner: { totalGrossCommissions: 4000000, totalNetCommissions: 3600000, totalPending: 800000,
    commissionsByStatus: { paid: { count: 8, amount: 2800000 }, pending: { count: 3, amount: 800000 } } },
  construction: { overallProgress: 62.5, delayedCount: 2,
    milestonesByStatus: { completed: 10, in_progress: 4, delayed: 2 } },
  operations: { overdueCount: 7, tasksByStatus: { open: 20, done: 35 }, tasksByPriority: { high: 8, low: 12 } },
};

describe('blockRegistry', () => {
  it('every block has the required metadata and a resolve fn', () => {
    for (const b of BLOCKS) {
      expect(typeof b.type).toBe('string');
      expect(typeof b.category).toBe('string');
      expect(typeof b.label).toBe('string');
      expect(['kpi', 'chart', 'table', 'layout', 'narrative']).toContain(b.kind);
      expect(typeof b.resolve).toBe('function');
    }
  });

  it('block types are unique', () => {
    const types = BLOCKS.map((b) => b.type);
    expect(new Set(types).size).toBe(types.length);
  });

  it('getBlock returns a definition or undefined', () => {
    expect(getBlock('kpi.revenue').label).toBeTruthy();
    expect(getBlock('does.not.exist')).toBeUndefined();
  });

  it('kpi.revenue resolves the total sales value', () => {
    expect(getBlock('kpi.revenue').resolve({ overview: fakeOverview, config: {} }))
      .toEqual({ value: 124000000, unit: 'currency' });
  });

  it('chart.unitsByStatus resolves to chart data', () => {
    expect(getBlock('chart.unitsByStatus').resolve({ overview: fakeOverview, config: {} }))
      .toEqual({ chartKind: 'pie', data: [{ name: 'available', value: 152 }, { name: 'sold', value: 48 }] });
  });

  it('layout.hero echoes its config and needs no overview', () => {
    expect(getBlock('layout.hero').resolve({ config: { title: 'Q2', subtitle: 'FY26', imageSlotId: 'hero' } }))
      .toEqual({ title: 'Q2', subtitle: 'FY26', imageSlotId: 'hero' });
  });

  it('getCatalog strips resolve and filters by permission', () => {
    const noPerms = getCatalog([], false);
    expect(noPerms.every((b) => b.resolve === undefined)).toBe(true);
    expect(noPerms.find((b) => b.type === 'kpi.revenue')).toBeUndefined(); // needs analytics:advanced
    expect(noPerms.find((b) => b.type === 'layout.hero')).toBeDefined();   // no permission required
  });

  it('getCatalog includes gated blocks for owners and permitted users', () => {
    expect(getCatalog([], true).find((b) => b.type === 'kpi.revenue')).toBeDefined();
    expect(getCatalog(['analytics:advanced'], false).find((b) => b.type === 'kpi.revenue')).toBeDefined();
  });

  it('exposes an ai.narrative block gated on ai:insights, returning text', async () => {
    const def = getBlock('ai.narrative');
    expect(def).toBeDefined();
    expect(def.requiredPermission).toBe('ai:insights');
    expect(def.kind).toBe('narrative');
    // With no OPENAI_API_KEY in the test env, resolve returns a best-effort empty text.
    const out = await def.resolve({ overview: fakeOverview, config: {} });
    expect(out).toHaveProperty('text');
    // catalog hides it without the permission, shows it with it
    expect(getCatalog([], false).find((b) => b.type === 'ai.narrative')).toBeUndefined();
    expect(getCatalog(['ai:insights'], false).find((b) => b.type === 'ai.narrative')).toBeDefined();
  });
});

describe('blockRegistry — Phase 2 blocks', () => {
  const r = (type) => getBlock(type).resolve({ overview: fakeOverview, config: {} });

  it('financial extras', () => {
    expect(r('kpi.totalSalesCount')).toBeDefined();
    expect(getBlock('kpi.totalSalesCount').resolve({ overview: { revenue: { totalSalesCount: 248 } } }))
      .toEqual({ value: 248, unit: 'count' });
    expect(getBlock('kpi.overdueAmount').resolve({ overview: { revenue: { totalOverdue: 4400000 } } }))
      .toEqual({ value: 4400000, unit: 'currency' });
  });

  it('invoicing blocks', () => {
    expect(r('kpi.invoiced')).toEqual({ value: 50000000, unit: 'currency' });
    expect(r('kpi.invoicePaid')).toEqual({ value: 30000000, unit: 'currency' });
    expect(r('kpi.invoiceOverdue')).toEqual({ value: 5000000, unit: 'currency' });
    expect(r('chart.invoicesByStatus')).toEqual({
      chartKind: 'bar',
      data: [{ name: 'paid', value: 12 }, { name: 'pending', value: 5 }, { name: 'overdue', value: 2 }],
    });
  });

  it('channel-partner blocks', () => {
    expect(r('kpi.cpGrossCommissions')).toEqual({ value: 4000000, unit: 'currency' });
    expect(r('kpi.cpNetCommissions')).toEqual({ value: 3600000, unit: 'currency' });
    expect(r('kpi.cpPendingCommissions')).toEqual({ value: 800000, unit: 'currency' });
    expect(r('table.cpCommissionsByStatus')).toEqual({
      rows: [
        { status: 'paid', count: 8, amount: 2800000 },
        { status: 'pending', count: 3, amount: 800000 },
      ],
    });
  });

  it('construction blocks (progress is 0-100 → /100 for percent unit)', () => {
    expect(r('kpi.constructionProgress')).toEqual({ value: 0.625, unit: 'percent' });
    expect(r('kpi.delayedMilestones')).toEqual({ value: 2, unit: 'count' });
    expect(r('chart.milestonesByStatus')).toEqual({
      chartKind: 'pie',
      data: [{ name: 'completed', value: 10 }, { name: 'in_progress', value: 4 }, { name: 'delayed', value: 2 }],
    });
  });

  it('operations blocks', () => {
    expect(r('kpi.overdueTasks')).toEqual({ value: 7, unit: 'count' });
    expect(r('chart.tasksByStatus')).toEqual({
      chartKind: 'pie', data: [{ name: 'open', value: 20 }, { name: 'done', value: 35 }],
    });
    expect(r('chart.tasksByPriority')).toEqual({
      chartKind: 'bar', data: [{ name: 'high', value: 8 }, { name: 'low', value: 12 }],
    });
  });

  it('new blocks gate on analytics:advanced and are hidden without it', () => {
    const open = getCatalog([], false).map((b) => b.type);
    expect(open).not.toContain('kpi.cpGrossCommissions');
    const adv = getCatalog(['analytics:advanced'], false).map((b) => b.type);
    expect(adv).toContain('kpi.cpGrossCommissions');
    expect(adv).toContain('chart.tasksByStatus');
  });
});
