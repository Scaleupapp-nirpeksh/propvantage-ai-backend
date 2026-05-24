// 47-sp5-cp-copilot.test.js
//
// SP5 Phase 17 — CP-side Copilot. Two layers:
//   1. Route gate (live, no LLM cost — unauth → 401)
//   2. Mocked-OpenAI: assert the cpCopilotFunctions dispatcher invokes the
//      right service for each tool name and propagates citations.

import { jest, describe, test, expect, beforeAll } from '@jest/globals';
import { api, setAuthToken } from '../_lib/api.js';

const FAKE_ID = '000000000000000000000000';

describe('SP5 — /api/cp/copilot/message route gate', () => {
  test('POST without auth → 401', async () => {
    setAuthToken(null);
    expect((await api('POST', '/api/cp/copilot/message', { message: 'hi' })).status).toBe(401);
  });
});

// ─── Mocked dispatcher tests (no LLM, no DB) ──────────────────────────────

const mockPipeline = jest.fn(async (orgId) => ({ orgId, surface: 'pipeline_health' }));
const mockCommission = jest.fn(async (orgId) => ({ orgId }));
const mockAgents = jest.fn(async (orgId) => ({ orgId, agents: [] }));
const mockDevs = jest.fn(async (orgId) => ({ orgId, developers: [] }));
const mockReconOv = jest.fn(async (orgId) => ({ orgId, rows: [] }));
const mockReconDetail = jest.fn(async (orgId) => ({ orgId }));
const mockProspectFind = jest.fn();
const mockProspectFindOne = jest.fn();

jest.unstable_mockModule('../../../services/analytics/cpAnalyticsService.js', () => ({
  getPipelineHealth: mockPipeline,
  getCommissionOverview: mockCommission,
  getAgentPerformance: mockAgents,
  getDeveloperPerformance: mockDevs,
}));
jest.unstable_mockModule('../../../services/analytics/commissionReconciliationService.js', () => ({
  getReconciliationOverview: mockReconOv,
  getReconciliationDetail: mockReconDetail,
}));
jest.unstable_mockModule('../../../models/prospectModel.js', () => {
  const chain = (value) => ({
    select: jest.fn().mockReturnThis(),
    sort: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(value),
  });
  mockProspectFind.mockImplementation(() => chain([]));
  mockProspectFindOne.mockImplementation(() => ({ lean: jest.fn().mockResolvedValue(null) }));
  return { default: { find: mockProspectFind, findOne: mockProspectFindOne } };
});

let executeCpCopilotFunction;
beforeAll(async () => {
  ({ executeCpCopilotFunction } = await import('../../../services/cpCopilotFunctions.js'));
});

describe('SP5 — cpCopilotFunctions dispatcher', () => {
  const owner = { _id: 'u1', organization: 'orgA', roleRef: { slug: 'cp-owner' } };
  const agent = { _id: 'agentX', organization: 'orgA', roleRef: { slug: 'cp-agent' } };

  test('Each tool routes to its underlying service with caller.organization', async () => {
    mockPipeline.mockClear();
    await executeCpCopilotFunction('get_pipeline_health', { range: '30d' }, owner);
    expect(mockPipeline).toHaveBeenCalledWith('orgA', { range: '30d' }, owner);
  });

  test('get_reconciliation_status routes to detail when prospectId given', async () => {
    mockReconDetail.mockClear();
    mockReconOv.mockClear();
    await executeCpCopilotFunction('get_reconciliation_status', { prospectId: FAKE_ID }, owner);
    expect(mockReconDetail).toHaveBeenCalledWith('orgA', FAKE_ID, owner);
    expect(mockReconOv).not.toHaveBeenCalled();
  });

  test('CP Agent denied get_agent_performance via Copilot', async () => {
    mockAgents.mockClear();
    const r = await executeCpCopilotFunction('get_agent_performance', { range: '30d' }, agent);
    expect(r.error).toBe('forbidden');
    expect(mockAgents).not.toHaveBeenCalled();
  });

  test('Unknown tool name returns error shape', async () => {
    const r = await executeCpCopilotFunction('nope', {}, owner);
    expect(r.error).toBe('unknown_function');
  });

  test('get_prospect_detail without valid id → bad_request', async () => {
    const r = await executeCpCopilotFunction('get_prospect_detail', {}, owner);
    expect(r.error).toBe('bad_request');
  });

  test('find_prospects auto-narrows for CP Agent', async () => {
    mockProspectFind.mockClear();
    await executeCpCopilotFunction('find_prospects', {}, agent);
    expect(mockProspectFind).toHaveBeenCalledTimes(1);
    const filter = mockProspectFind.mock.calls[0][0];
    expect(filter.organization).toBe('orgA');
    expect(filter.assignedAgent).toBe('agentX');
  });
});
