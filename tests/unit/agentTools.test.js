// tests/unit/agentTools.test.js
import { jest } from '@jest/globals';

const find = jest.fn(() => ({ select: () => ({ lean: async () => ([
  { _id: 'p1', name: 'Skyline', status: 'launched' },
  { _id: 'p2', name: 'Marina', status: 'planning' },
]) }) }));
jest.unstable_mockModule('../../models/projectModel.js', () => ({ default: { find } }));

const resolveReportData = jest.fn(async () => ({ blocks: [
  { id: 'kpi.revenue', type: 'kpi.revenue', data: { value: 100, unit: 'currency' } },
] }));
jest.unstable_mockModule('../../services/reports/snapshotService.js', () => ({ resolveReportData }));

const { listProjects, getMetricCatalog, getDataPreview } = await import('../../services/reports/agent/tools.js');

beforeEach(() => { find.mockClear(); resolveReportData.mockClear(); });

describe('agent tools', () => {
  it('listProjects returns {id,name,status} scoped to the org', async () => {
    const out = await listProjects({ organization: 'org1', accessibleProjectIds: null });
    expect(find.mock.calls[0][0]).toMatchObject({ organization: 'org1' });
    expect(out).toEqual([
      { id: 'p1', name: 'Skyline', status: 'launched' },
      { id: 'p2', name: 'Marina', status: 'planning' },
    ]);
  });

  it('listProjects filters by accessible ids for a restricted user', async () => {
    await listProjects({ organization: 'org1', accessibleProjectIds: ['aaaaaaaaaaaaaaaaaaaaaaaa'] });
    const q = find.mock.calls[0][0];
    expect(q._id.$in).toHaveLength(1);
  });

  it('getMetricCatalog returns permission-filtered block metadata (no resolve fns)', () => {
    const cat = getMetricCatalog({ userPermissions: ['analytics:advanced'], isOwner: false });
    expect(Array.isArray(cat)).toBe(true);
    expect(cat.every((b) => b.resolve === undefined)).toBe(true);
    expect(cat.find((b) => b.type === 'kpi.revenue')).toBeDefined();
    expect(cat.find((b) => b.type === 'layout.hero')).toBeDefined(); // always available
  });

  it('getMetricCatalog hides gated blocks without the permission', () => {
    const cat = getMetricCatalog({ userPermissions: [], isOwner: false });
    expect(cat.find((b) => b.type === 'kpi.revenue')).toBeUndefined();
  });

  it('getDataPreview resolves the requested metricIds to real data', async () => {
    const out = await getDataPreview(
      { scope: { mode: 'portfolio' }, metricIds: ['kpi.revenue'] },
      { organization: 'org1', accessibleProjectIds: null },
    );
    // builds a definition of blocks from metricIds and resolves it
    expect(resolveReportData).toHaveBeenCalled();
    const passedDef = resolveReportData.mock.calls[0][0];
    expect(passedDef.organization).toBe('org1');
    expect(passedDef.blocks).toEqual([{ id: 'kpi.revenue', type: 'kpi.revenue', config: {} }]);
    expect(out).toEqual([{ type: 'kpi.revenue', data: { value: 100, unit: 'currency' } }]);
  });
});
