// 45-sp5-cross-tenant-safety.test.js
//
// SP5 Phase 9 — the cross-tenant safety audit. Written immediately after
// the CP Copilot lands (not at Phase 17) per the user brief's directive:
// "the suite sp5-cross-tenant-safety exists specifically to prove this
//  — write it early."
//
// 4 assertions, all static / mocked (no DB, no LLM):
//
// 1. Catalog inspection — cpCopilotTools[*].function.parameters.properties
//    MUST NOT contain organizationId, cpOrgId, orgId, or any equivalent.
//    Scoping comes from middleware (req.user.organization), never from args.
//
// 2. Catalog inspection — the existing dev copilotFunctions tools also do
//    not expose org-id parameters (sanity check that we didn't accidentally
//    introduce one in the SP5 dev-side extension — T10).
//
// 3. executeCpCopilotFunction respects user.organization for scoping —
//    invoked with two different users from different orgs, the underlying
//    service call uses each caller's org, never a fallback / shared value.
//
// 4. find_prospects with a CP Agent caller auto-narrows to assignedAgent
//    even when the caller does NOT supply an assignedAgent arg — defence
//    in depth.

import { jest, describe, test, expect, beforeAll } from '@jest/globals';

// ─── 1. Catalog inspection: no org-id parameter on any CP tool ─────────────

const ORG_ID_KEY_RE = /^(organi[sz]ation|cp_?org|org_?id|tenant_?id|customer_?org|account_?id)$/i;

function findForbiddenKeys(tools) {
  const offences = [];
  for (const tool of tools) {
    const fn = tool.function || {};
    const props = fn.parameters?.properties || {};
    for (const key of Object.keys(props)) {
      if (ORG_ID_KEY_RE.test(key)) {
        offences.push({ tool: fn.name, key });
      }
    }
  }
  return offences;
}

describe('SP5 cross-tenant safety — tool-catalog inspection', () => {
  // Note: imports are DYNAMIC + AFTER the mocks (further down in this file)
  // because importing cpCopilotFunctions statically would eagerly load the
  // analytics services before our mocks register. We re-load both catalogs
  // here through the same dynamic-import path the execution tests use.
  let _cpTools, _devTools;
  beforeAll(async () => {
    _cpTools = (await import('../../../services/cpCopilotFunctions.js')).cpCopilotTools;
    _devTools = (await import('../../../services/copilotFunctions.js')).copilotTools;
  });

  test('CP Copilot tools never accept an organizationId-like parameter', () => {
    expect(findForbiddenKeys(_cpTools)).toEqual([]);
  });

  test('dev Copilot tools (incl. SP5 additions) never accept an organizationId-like parameter', () => {
    expect(findForbiddenKeys(_devTools)).toEqual([]);
  });
});

// ─── 2. Mocked-service execution — each call uses caller's org ────────────

// Mock the analytics + reconciliation + prospect modules so we can verify
// the org the handler passes through, without touching Mongo.
const mockPipelineHealth   = jest.fn(async (orgId) => ({ orgId, surface: 'pipeline_health' }));
const mockCommissionOv     = jest.fn(async (orgId) => ({ orgId, surface: 'commission_overview' }));
const mockAgentPerf        = jest.fn(async (orgId) => ({ orgId, surface: 'agent_performance' }));
const mockDevPerf          = jest.fn(async (orgId) => ({ orgId, surface: 'developer_performance' }));
const mockReconOverview    = jest.fn(async (orgId) => ({ orgId, surface: 'reconciliation_overview' }));
const mockReconDetail      = jest.fn(async (orgId) => ({ orgId, surface: 'reconciliation_detail' }));
const mockProspectFind     = jest.fn();
const mockProspectFindOne  = jest.fn();

jest.unstable_mockModule('../../../services/analytics/cpAnalyticsService.js', () => ({
  getPipelineHealth: mockPipelineHealth,
  getCommissionOverview: mockCommissionOv,
  getAgentPerformance: mockAgentPerf,
  getDeveloperPerformance: mockDevPerf,
}));
jest.unstable_mockModule('../../../services/analytics/commissionReconciliationService.js', () => ({
  getReconciliationOverview: mockReconOverview,
  getReconciliationDetail: mockReconDetail,
}));
jest.unstable_mockModule('../../../models/prospectModel.js', () => {
  const chain = (value) => ({
    select: jest.fn().mockReturnThis(),
    sort:   jest.fn().mockReturnThis(),
    limit:  jest.fn().mockReturnThis(),
    lean:   jest.fn().mockResolvedValue(value),
  });
  mockProspectFind.mockImplementation(() => chain([]));
  mockProspectFindOne.mockImplementation(() => ({
    lean: jest.fn().mockResolvedValue(null),
  }));
  return { default: { find: mockProspectFind, findOne: mockProspectFindOne } };
});

const { executeCpCopilotFunction } = await import('../../../services/cpCopilotFunctions.js');

describe('SP5 cross-tenant safety — execution respects caller.organization', () => {
  test('two distinct users → two distinct org ids passed through', async () => {
    const userA = { _id: 'userA', organization: 'orgA', roleRef: { slug: 'cp-owner' } };
    const userB = { _id: 'userB', organization: 'orgB', roleRef: { slug: 'cp-owner' } };

    await executeCpCopilotFunction('get_pipeline_health', { range: '30d' }, userA);
    await executeCpCopilotFunction('get_pipeline_health', { range: '30d' }, userB);

    expect(mockPipelineHealth).toHaveBeenCalledTimes(2);
    expect(mockPipelineHealth.mock.calls[0][0]).toBe('orgA');
    expect(mockPipelineHealth.mock.calls[1][0]).toBe('orgB');
  });

  test('handler ignores org args even if the LLM somehow passes them', async () => {
    const user = { _id: 'u1', organization: 'realOrg', roleRef: { slug: 'cp-owner' } };
    // Even if a hostile prompt convinces the LLM to send extra keys, the
    // dispatcher does NOT forward them as the orgId — it uses user.organization.
    await executeCpCopilotFunction('get_commission_overview', { range: '30d', organizationId: 'attackerOrg' }, user);
    expect(mockCommissionOv).toHaveBeenCalledTimes(1);
    expect(mockCommissionOv.mock.calls[0][0]).toBe('realOrg');
  });

  test('CP Agent is denied get_agent_performance even via Copilot', async () => {
    const agent = { _id: 'agent1', organization: 'orgA', roleRef: { slug: 'cp-agent' } };
    const result = await executeCpCopilotFunction('get_agent_performance', { range: '30d' }, agent);
    expect(result).toEqual(expect.objectContaining({ error: 'forbidden' }));
    expect(mockAgentPerf).not.toHaveBeenCalled();
  });
});

// ─── 3. find_prospects auto-narrows for CP Agent ──────────────────────────

describe('SP5 cross-tenant safety — CP Agent auto-narrowing in tools', () => {
  test('find_prospects builds a filter with assignedAgent === user._id for CP Agent', async () => {
    const agent = { _id: 'agentXYZ', organization: 'orgA', roleRef: { slug: 'cp-agent' } };
    await executeCpCopilotFunction('find_prospects', { query: 'anaya' }, agent);
    expect(mockProspectFind).toHaveBeenCalledTimes(1);
    const filter = mockProspectFind.mock.calls[0][0];
    expect(filter.organization).toBe('orgA');
    expect(filter.assignedAgent).toBe('agentXYZ'); // even without explicit arg
  });

  test('find_prospects for CP Owner does NOT inject assignedAgent unless explicitly requested', async () => {
    mockProspectFind.mockClear();
    const owner = { _id: 'ownerZZZ', organization: 'orgA', roleRef: { slug: 'cp-owner' } };
    await executeCpCopilotFunction('find_prospects', {}, owner);
    expect(mockProspectFind).toHaveBeenCalledTimes(1);
    const filter = mockProspectFind.mock.calls[0][0];
    expect(filter.organization).toBe('orgA');
    expect(filter.assignedAgent).toBeUndefined();
  });
});
