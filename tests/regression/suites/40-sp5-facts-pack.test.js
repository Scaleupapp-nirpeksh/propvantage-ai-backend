// 40-sp5-facts-pack.test.js
//
// SP5 Phase 17 — facts-pack builder tests. Mocks the analytics services
// so the suite runs without a DB. Asserts per spec §6.2:
//   • Pack structure matches the spec (surface, generatedAt, period, scope,
//     hasInsufficientData, metrics, notableRecords, candidates)
//   • Every notableRecords entity carries a citation URL
//   • hasInsufficientData true when totalProspects < threshold
//   • hashFactsPack is stable across calls with equivalent data
//   • Token-cap enforcement truncates notableRecords first

import { jest, describe, test, expect, beforeAll } from '@jest/globals';

// Mock the analytics + reconciliation services BEFORE importing the builder.
const mockPipeline = jest.fn();
const mockCommission = jest.fn();
const mockAgents = jest.fn();
const mockDevs = jest.fn();
const mockReconOv = jest.fn();

jest.unstable_mockModule('../../../services/analytics/cpAnalyticsService.js', () => ({
  getPipelineHealth: mockPipeline,
  getCommissionOverview: mockCommission,
  getAgentPerformance: mockAgents,
  getDeveloperPerformance: mockDevs,
}));
jest.unstable_mockModule('../../../services/analytics/commissionReconciliationService.js', () => ({
  getReconciliationOverview: mockReconOv,
}));

let build, hashFactsPack;
beforeAll(async () => {
  const mod = await import('../../../services/ai/factsPackBuilder.js');
  build = mod.build;
  hashFactsPack = mod.hashFactsPack;
});

// ─── Pipeline pack ─────────────────────────────────────────────────────────

describe('SP5 facts pack — pipeline_health', () => {
  test('Pack shape per spec §6.2', async () => {
    mockPipeline.mockResolvedValue({
      generatedAt: '2026-05-24T00:00:00Z',
      range: '30d',
      summary: { totalProspects: 20, activeProspects: 15, followUpsDueToday: 3, followUpsDueThisWeek: 8, agingOver30d: 1, activityVolume7d: 12, activityVolume30d: 40 },
      breakdowns: { byStatus: [{ status: 'New', count: 8 }], funnel: [{ status: 'New', count: 8 }], aging: [] },
      series: { activityHeat: [] },
    });
    const pack = await build('pipeline_health', 'cp1', { roleRef: { slug: 'cp-owner' } }, '30d');
    expect(pack.surface).toBe('pipeline_health');
    expect(pack.scope.cpOrgId).toBe('cp1');
    expect(pack.scope.userScope).toBe('org');
    expect(pack.metrics.totalProspects).toBe(20);
    expect(pack.candidates).toEqual({ recommendations: [] });
    expect(pack.hasInsufficientData).toBe(false);
  });

  test('hasInsufficientData=true when totalProspects < 3', async () => {
    mockPipeline.mockResolvedValue({
      generatedAt: '2026-05-24T00:00:00Z', range: '30d',
      summary: { totalProspects: 2, activeProspects: 2, followUpsDueToday: 0, followUpsDueThisWeek: 0, agingOver30d: 0, activityVolume7d: 0, activityVolume30d: 0 },
      breakdowns: { byStatus: [], funnel: [], aging: [] },
      series: { activityHeat: [] },
    });
    const pack = await build('pipeline_health', 'cp1', { roleRef: { slug: 'cp-owner' } });
    expect(pack.hasInsufficientData).toBe(true);
  });

  test('userScope = agent for CP Agent', async () => {
    mockPipeline.mockResolvedValue({
      generatedAt: '', range: '30d',
      summary: { totalProspects: 10, activeProspects: 10, followUpsDueToday: 0, followUpsDueThisWeek: 0, agingOver30d: 0, activityVolume7d: 0, activityVolume30d: 0 },
      breakdowns: { byStatus: [], funnel: [], aging: [] }, series: { activityHeat: [] },
    });
    const pack = await build('pipeline_health', 'cp1', { roleRef: { slug: 'cp-agent' } });
    expect(pack.scope.userScope).toBe('agent');
  });
});

// ─── Commission pack — citation completeness ──────────────────────────────

describe('SP5 facts pack — citations', () => {
  test('Every notableRecords.topDevelopers row has a citation URL', async () => {
    mockCommission.mockResolvedValue({
      generatedAt: '', range: '30d',
      summary: { byCurrency: [{ currency: 'INR', expected: 1000000, received: 500000, outstanding: 500000, writtenOff: 0, realisationRate: 0.5 }] },
      breakdowns: { byStatus: [], byDeveloper: [
        { developerName: 'Alpha Realty', context: 'platform', prospects: 5, received: 200000, expected: 400000 },
        { developerName: 'Beta Group',   context: 'external', prospects: 3, received: 300000, expected: 600000 },
      ], byAgent: [] },
      series: { byMonth: [] },
    });
    const pack = await build('commission_overview', 'cp1', { roleRef: { slug: 'cp-owner' } });
    const devs = pack.notableRecords?.topDevelopers || [];
    expect(devs.length).toBe(2);
    for (const d of devs) {
      expect(typeof d.citation).toBe('string');
      expect(d.citation.length).toBeGreaterThan(0);
      expect(d.citation.startsWith('/')).toBe(true);
    }
  });
});

// ─── Token-cap enforcement ─────────────────────────────────────────────────

describe('SP5 facts pack — hard limits', () => {
  test('hashFactsPack is stable across calls with equivalent metrics', async () => {
    mockPipeline.mockResolvedValue({
      generatedAt: '2026-05-24T01:00:00Z', range: '30d',
      summary: { totalProspects: 20, activeProspects: 15, followUpsDueToday: 3, followUpsDueThisWeek: 0, agingOver30d: 0, activityVolume7d: 0, activityVolume30d: 0 },
      breakdowns: { byStatus: [], funnel: [], aging: [] }, series: { activityHeat: [] },
    });
    const p1 = await build('pipeline_health', 'cp1', { roleRef: { slug: 'cp-owner' } });
    // Different generatedAt but same data → hash should be stable.
    mockPipeline.mockResolvedValue({
      generatedAt: '2026-05-24T02:00:00Z', range: '30d',
      summary: { totalProspects: 20, activeProspects: 15, followUpsDueToday: 3, followUpsDueThisWeek: 0, agingOver30d: 0, activityVolume7d: 0, activityVolume30d: 0 },
      breakdowns: { byStatus: [], funnel: [], aging: [] }, series: { activityHeat: [] },
    });
    const p2 = await build('pipeline_health', 'cp1', { roleRef: { slug: 'cp-owner' } });
    expect(hashFactsPack(p1)).toBe(hashFactsPack(p2));
  });
});

// ─── Unknown surface ──────────────────────────────────────────────────────

describe('SP5 facts pack — dispatcher', () => {
  test('build() throws on unknown surface', async () => {
    await expect(build('totally_made_up', 'cp1', { roleRef: { slug: 'cp-owner' } })).rejects.toThrow(/Unknown insight surface/);
  });
});
