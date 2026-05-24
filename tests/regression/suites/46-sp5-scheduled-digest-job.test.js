// 46-sp5-scheduled-digest-job.test.js
//
// SP5 Phase 17 — scheduled digest job. Mocks the pipeline + the model
// queries so we test eligibility logic + per-org error isolation + the
// summary report shape, without hitting Mongo or LLM.

import { jest, describe, test, expect, beforeAll } from '@jest/globals';

const mockGetOrGenerate = jest.fn();
const mockOrgFind = jest.fn();
const mockPartnershipCount = jest.fn();
const mockProspectCount = jest.fn();

jest.unstable_mockModule('../../../services/ai/insightPipeline.js', () => ({
  getOrGenerateInsight: mockGetOrGenerate,
}));
jest.unstable_mockModule('../../../models/organizationModel.js', () => ({
  default: { find: mockOrgFind },
}));
jest.unstable_mockModule('../../../models/partnershipModel.js', () => ({
  default: { countDocuments: mockPartnershipCount },
}));
jest.unstable_mockModule('../../../models/prospectModel.js', () => ({
  default: { countDocuments: mockProspectCount },
}));

const chain = (value) => ({
  select: jest.fn().mockReturnThis(),
  lean: jest.fn().mockResolvedValue(value),
});

let runForActiveOrgs;
beforeAll(async () => {
  ({ runForActiveOrgs } = await import('../../../jobs/generateScheduledInsights.js'));
});

describe('SP5 — scheduled digest job', () => {
  test('Skips dormant orgs (no active partnerships AND no active prospects)', async () => {
    mockOrgFind.mockReturnValue(chain([
      { _id: 'orgActive', name: 'Active CP' },
      { _id: 'orgDormant', name: 'Dormant CP' },
    ]));
    mockPartnershipCount.mockImplementation(async (q) => (String(q.channelPartnerOrg) === 'orgActive' ? 1 : 0));
    mockProspectCount.mockResolvedValue(0);
    mockGetOrGenerate.mockResolvedValue({ tokenUsage: { costUsd: 0.005 } });

    const summary = await runForActiveOrgs('weekly_digest');
    expect(summary.totalOrgs).toBe(1);          // only the eligible one
    expect(summary.eligibleOrgs).toBe(1);
    expect(summary.succeeded).toBe(1);
    expect(summary.failedOrgs).toEqual([]);
    expect(mockGetOrGenerate).toHaveBeenCalledTimes(1);
    expect(mockGetOrGenerate.mock.calls[0][0]).toBe('weekly_digest');
  });

  test('Per-org error isolation: one throw does not poison the batch', async () => {
    mockOrgFind.mockReturnValue(chain([
      { _id: 'orgGood', name: 'Good' },
      { _id: 'orgBad',  name: 'Bad' },
      { _id: 'orgAlsoGood', name: 'AlsoGood' },
    ]));
    mockPartnershipCount.mockResolvedValue(1); // all eligible
    mockProspectCount.mockResolvedValue(0);
    mockGetOrGenerate.mockReset();
    mockGetOrGenerate.mockImplementation(async (_, orgId) => {
      if (String(orgId) === 'orgBad') throw new Error('LLM bombed');
      return { tokenUsage: { costUsd: 0.005 } };
    });

    const summary = await runForActiveOrgs('monthly_digest');
    expect(summary.eligibleOrgs).toBe(3);
    expect(summary.succeeded).toBe(2);
    expect(summary.failedOrgs).toHaveLength(1);
    expect(summary.failedOrgs[0].name).toBe('Bad');
    expect(summary.failedOrgs[0].error).toBe('LLM bombed');
  });

  test('Cost totalling sums per-org costUsd', async () => {
    mockOrgFind.mockReturnValue(chain([
      { _id: 'a', name: 'A' },
      { _id: 'b', name: 'B' },
    ]));
    mockPartnershipCount.mockResolvedValue(1);
    mockProspectCount.mockResolvedValue(0);
    mockGetOrGenerate.mockReset();
    mockGetOrGenerate.mockResolvedValueOnce({ tokenUsage: { costUsd: 0.003 } });
    mockGetOrGenerate.mockResolvedValueOnce({ tokenUsage: { costUsd: 0.007 } });

    const summary = await runForActiveOrgs('weekly_digest');
    expect(summary.totalCostUsd).toBeCloseTo(0.010);
  });
});
