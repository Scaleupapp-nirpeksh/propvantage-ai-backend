// tests/unit/generateInstance.scope.test.js
// Mock the DB + analytics deps so we can assert generateInstance threads the resolved
// scope into getLeadershipOverview and freezes it on the instance. ESM mocking pattern.
import { jest } from '@jest/globals';

const getLeadershipOverview = jest.fn(async () => ({ _dateRange: { start: null, end: null } }));
const getLeadershipProjectComparison = jest.fn(async () => ({ projects: [{ name: 'P', revenue: {}, salesPipeline: {}, construction: {} }] }));
const create = jest.fn(async (doc) => doc);

jest.unstable_mockModule('../../services/leadershipDashboardService.js', () => ({
  getLeadershipOverview,
  getLeadershipProjectComparison,
}));
jest.unstable_mockModule('../../models/reportInstanceModel.js', () => ({
  default: { create },
}));

const { generateInstance } = await import('../../services/reports/snapshotService.js');

const A = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const B = 'bbbbbbbbbbbbbbbbbbbbbbbb';

const template = (scope) => ({
  _id: 't1', organization: 'org1', name: 'R', blocks: [], scope,
  access: { gate: 'email', expiresAfterDays: 90 },
});

beforeEach(() => { getLeadershipOverview.mockClear(); create.mockClear(); });

describe('generateInstance — scope', () => {
  it('owner portfolio → passes null (all projects) to getLeadershipOverview', async () => {
    await generateInstance(template({ mode: 'portfolio' }), { accessibleProjectIds: null });
    expect(getLeadershipOverview.mock.calls[0][4]).toBeNull();
  });

  it('project scope → passes the access-bounded intersection', async () => {
    await generateInstance(
      template({ mode: 'project', projects: [A, 'cccccccccccccccccccccccc'] }),
      { accessibleProjectIds: [A, B] },
    );
    expect(getLeadershipOverview.mock.calls[0][4]).toEqual([A]);
  });

  it('freezes the resolved scope on the instance', async () => {
    const inst = await generateInstance(
      template({ mode: 'project', projects: [A] }),
      { accessibleProjectIds: [A, B] },
    );
    expect(inst.scope).toEqual({ mode: 'project', projectIds: [A] });
  });

  it('throws when the selection is entirely inaccessible (never silently widens)', async () => {
    await expect(
      generateInstance(template({ mode: 'project', projects: ['cccccccccccccccccccccccc'] }), { accessibleProjectIds: [A] }),
    ).rejects.toThrow(/none of the selected projects/i);
    expect(getLeadershipOverview).not.toHaveBeenCalled();
  });

  it('compare mode fetches project comparison and attaches it to the overview', async () => {
    getLeadershipProjectComparison.mockClear();
    const inst = await generateInstance(
      template({ mode: 'compare', projects: [A, B] }),
      { accessibleProjectIds: [A, B] },
    );
    expect(getLeadershipProjectComparison).toHaveBeenCalled();
    // the resolved project ids are passed (arg index 4)
    expect(getLeadershipProjectComparison.mock.calls[0][4]).toEqual([A, B]);
    expect(inst.scope.mode).toBe('compare');
  });

  it('non-compare modes do not call project comparison', async () => {
    getLeadershipProjectComparison.mockClear();
    await generateInstance(template({ mode: 'portfolio' }), { accessibleProjectIds: null });
    expect(getLeadershipProjectComparison).not.toHaveBeenCalled();
  });
});
