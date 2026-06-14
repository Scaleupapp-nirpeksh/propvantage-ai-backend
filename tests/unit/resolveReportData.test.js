// tests/unit/resolveReportData.test.js
import { jest } from '@jest/globals';

const getLeadershipOverview = jest.fn(async () => ({ _dateRange: { start: 'S', end: 'E' }, revenue: { totalSalesValue: 100 } }));
const getLeadershipProjectComparison = jest.fn(async () => ({ projects: [{ name: 'P' }] }));

jest.unstable_mockModule('../../services/leadershipDashboardService.js', () => ({
  getLeadershipOverview,
  getLeadershipProjectComparison,
}));
// reportInstanceModel is imported by snapshotService; mock so importing doesn't need a DB.
jest.unstable_mockModule('../../models/reportInstanceModel.js', () => ({ default: { create: jest.fn(async (d) => d) } }));

const { resolveReportData } = await import('../../services/reports/snapshotService.js');

const A = 'aaaaaaaaaaaaaaaaaaaaaaaa';

beforeEach(() => { getLeadershipOverview.mockClear(); getLeadershipProjectComparison.mockClear(); });

describe('resolveReportData', () => {
  const def = (scope, blocks = [{ id: 'r', type: 'kpi.revenue', config: {} }]) =>
    ({ organization: 'org1', scope, blocks });

  it('resolves scope + period and returns resolved blocks (no persistence)', async () => {
    const out = await resolveReportData(def({ mode: 'portfolio' }), { accessibleProjectIds: null });
    expect(getLeadershipOverview.mock.calls[0][0]).toBe('org1');
    expect(getLeadershipOverview.mock.calls[0][4]).toBeNull(); // portfolio + owner → all
    expect(out.mode).toBe('portfolio');
    expect(out.blocks[0]).toEqual({ id: 'r', type: 'kpi.revenue', config: {}, data: { value: 100, unit: 'currency' } });
    expect(out.overview.revenue.totalSalesValue).toBe(100);
  });

  it('passes the access-bounded project ids for project scope', async () => {
    await resolveReportData(def({ mode: 'project', projects: [A] }), { accessibleProjectIds: [A, 'bbbbbbbbbbbbbbbbbbbbbbbb'] });
    expect(getLeadershipOverview.mock.calls[0][4]).toEqual([A]);
    expect(getLeadershipProjectComparison).not.toHaveBeenCalled();
  });

  it('fetches comparison only for compare mode and attaches it to overview', async () => {
    const out = await resolveReportData(def({ mode: 'compare', projects: [A] }), { accessibleProjectIds: [A] });
    expect(getLeadershipProjectComparison).toHaveBeenCalled();
    expect(out.overview._comparison).toEqual({ projects: [{ name: 'P' }] });
  });
});
