// File: tests/unit/narrativeService.test.js
import { buildFacts } from '../../services/reports/narrativeService.js';

describe('buildFacts', () => {
  it('summarizes the key overview figures into a compact string', () => {
    const facts = buildFacts({
      revenue: { totalSalesValue: 124000000, totalCollected: 80000000, totalOutstanding: 44000000, collectionRate: 0.71 },
      salesPipeline: { totalLeads: 320, conversionRate: 0.062, avgBookingValue: 8500000 },
      portfolio: { totalUnits: 200, totalProjects: 4 },
    });
    expect(facts).toContain('Total sales value: 124000000');
    expect(facts).toContain('Collection rate: 71%');
    expect(facts).toContain('Total leads: 320');
    expect(facts).toContain('Conversion rate: 6.2%');
  });
  it('tolerates a missing/partial overview', () => {
    expect(typeof buildFacts({})).toBe('string');
    expect(typeof buildFacts(undefined)).toBe('string');
  });
});
