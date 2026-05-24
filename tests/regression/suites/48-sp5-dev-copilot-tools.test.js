// 48-sp5-dev-copilot-tools.test.js
//
// SP5 Phase 17 — dev Copilot extension (Phase 10). Asserts the 3 new tools
// are registered in the existing copilotTools catalog AND that the
// executeCopilotFunction dispatcher routes them to devAnalyticsService.

import { jest, describe, test, expect, beforeAll } from '@jest/globals';

const mockScorecard = jest.fn(async (orgId) => ({ orgId, partners: [] }));
const mockPayouts = jest.fn(async (orgId) => ({ orgId, summary: {} }));
const mockQuality = jest.fn(async (orgId) => ({ orgId, partners: [] }));

jest.unstable_mockModule('../../../services/analytics/devAnalyticsService.js', () => ({
  getChannelPartnerScorecard: mockScorecard,
  getCommissionPayouts: mockPayouts,
  getLeadQuality: mockQuality,
}));

let copilotTools, executeCopilotFunction;
beforeAll(async () => {
  const mod = await import('../../../services/copilotFunctions.js');
  copilotTools = mod.copilotTools;
  executeCopilotFunction = mod.executeCopilotFunction;
});

describe('SP5 — dev Copilot SP5 tools registered', () => {
  test('get_channel_partner_scorecard exists in copilotTools', () => {
    expect(copilotTools.some((t) => t.function?.name === 'get_channel_partner_scorecard')).toBe(true);
  });
  test('get_commission_paid_out exists in copilotTools', () => {
    expect(copilotTools.some((t) => t.function?.name === 'get_commission_paid_out')).toBe(true);
  });
  test('get_lead_quality_by_partner exists in copilotTools', () => {
    expect(copilotTools.some((t) => t.function?.name === 'get_lead_quality_by_partner')).toBe(true);
  });

  test('None of the SP5 tools expose an organizationId parameter', () => {
    const SP5_TOOL_NAMES = ['get_channel_partner_scorecard', 'get_commission_paid_out', 'get_lead_quality_by_partner'];
    for (const tool of copilotTools.filter((t) => SP5_TOOL_NAMES.includes(t.function?.name))) {
      const props = tool.function?.parameters?.properties || {};
      const offences = Object.keys(props).filter((k) => /^(organi[sz]ation|cp_?org|org_?id|tenant_?id)$/i.test(k));
      expect(offences).toEqual([]);
    }
  });
});

describe('SP5 — dev Copilot dispatcher routes SP5 tools to devAnalyticsService', () => {
  const dev = { _id: 'd1', organization: 'devOrg', roleRef: { slug: 'business-head' } };

  test('get_channel_partner_scorecard → getChannelPartnerScorecard(orgId, ...)', async () => {
    mockScorecard.mockClear();
    await executeCopilotFunction('get_channel_partner_scorecard', { range: '30d' }, dev);
    expect(mockScorecard).toHaveBeenCalledTimes(1);
    expect(mockScorecard.mock.calls[0][0]).toBe('devOrg');
    expect(mockScorecard.mock.calls[0][1].range).toBe('30d');
  });

  test('get_commission_paid_out → getCommissionPayouts(orgId, ...)', async () => {
    mockPayouts.mockClear();
    await executeCopilotFunction('get_commission_paid_out', { range: 'ytd', groupBy: 'cp' }, dev);
    expect(mockPayouts).toHaveBeenCalledTimes(1);
    expect(mockPayouts.mock.calls[0][0]).toBe('devOrg');
  });

  test('get_lead_quality_by_partner → getLeadQuality(orgId, ...)', async () => {
    mockQuality.mockClear();
    await executeCopilotFunction('get_lead_quality_by_partner', { range: 'all' }, dev);
    expect(mockQuality).toHaveBeenCalledTimes(1);
    expect(mockQuality.mock.calls[0][0]).toBe('devOrg');
  });

  test('SP5 dispatcher uses caller.organization, not args', async () => {
    mockScorecard.mockClear();
    // Hostile args: 'organizationId' should be ignored.
    await executeCopilotFunction('get_channel_partner_scorecard', { range: '30d', organizationId: 'attackerOrg' }, dev);
    expect(mockScorecard.mock.calls[0][0]).toBe('devOrg');
  });
});
