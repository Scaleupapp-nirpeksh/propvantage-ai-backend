// File: tests/unit/blockRegistry.test.js
import { BLOCKS, getBlock, getCatalog } from '../../services/reports/blockRegistry.js';

const fakeOverview = {
  revenue: { totalSalesValue: 124000000, totalCollected: 80000000, totalOutstanding: 44000000, collectionRate: 0.71 },
  salesPipeline: { totalLeads: 320, conversionRate: 0.062, avgBookingValue: 8500000,
    leadsByStatus: { New: 100, Booked: 20 }, leadsBySource: { Web: 50, Referral: 30 } },
  portfolio: { totalUnits: 200, totalProjects: 4, unitsByStatus: { available: 152, sold: 48 } },
  team: { topWorkload: [{ user: 'A', openTasks: 9 }] },
};

describe('blockRegistry', () => {
  it('every block has the required metadata and a resolve fn', () => {
    for (const b of BLOCKS) {
      expect(typeof b.type).toBe('string');
      expect(typeof b.category).toBe('string');
      expect(typeof b.label).toBe('string');
      expect(['kpi', 'chart', 'table', 'layout']).toContain(b.kind);
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
});
