// 28-sp4-partner-access-scope.test.js — SP4: isolated unit tests for the
// partnerAccessScope helper. Mocks Organization / Partnership / ChannelPartner
// so the suite runs without any DB connection (deterministic, milliseconds).
//
// Phase I (T36/T37) will extend with integration-style assertions through
// /api/leads and /api/leads/:id against a live token (token-gated, opt-in).
import { jest, describe, test, expect, beforeEach } from '@jest/globals';

// ─── Mock the three Mongoose models the helper imports ─────────────────────
const mockOrgFindById = jest.fn();
const mockPartnershipFind = jest.fn();
const mockChannelPartnerFind = jest.fn();

jest.unstable_mockModule('../../../models/organizationModel.js', () => ({
  default: { findById: mockOrgFindById },
}));
jest.unstable_mockModule('../../../models/partnershipModel.js', () => ({
  default: { find: mockPartnershipFind },
}));
jest.unstable_mockModule('../../../models/channelPartnerModel.js', () => ({
  default: { find: mockChannelPartnerFind },
}));

// Import the helper AFTER the mocks are registered.
const { partnerAccessScope } = await import('../../../utils/partnerAccessHelper.js');

// Tiny chainable mock — emulates `.select(...).lean()`-style fluent queries.
const chainQ = (value) => ({
  select: jest.fn().mockReturnThis(),
  lean: jest.fn().mockResolvedValue(value),
});

describe('SP4 — partnerAccessScope (isolated unit tests)', () => {
  beforeEach(() => {
    mockOrgFindById.mockReset();
    mockPartnershipFind.mockReset();
    mockChannelPartnerFind.mockReset();
  });

  test('returns null when there is no user', async () => {
    expect(await partnerAccessScope({})).toBeNull();
    expect(await partnerAccessScope({ user: {} })).toBeNull();
  });

  test('returns null for a non-CP (builder) caller', async () => {
    mockOrgFindById.mockReturnValue(chainQ({ _id: 'devOrg', type: 'builder' }));
    const req = { user: { organization: 'devOrg' } };
    expect(await partnerAccessScope(req)).toBeNull();
  });

  test('CP caller with 0 active partnerships → empty scope, no ChannelPartner lookup', async () => {
    mockOrgFindById.mockReturnValue(chainQ({ _id: 'cpOrg', type: 'channel_partner' }));
    mockPartnershipFind.mockReturnValue(chainQ([]));
    const req = { user: { organization: 'cpOrg', _id: 'u1' } };
    const result = await partnerAccessScope(req);
    expect(result).toEqual({ _id: { $in: [] } });
    expect(mockChannelPartnerFind).not.toHaveBeenCalled();
  });

  test('CP caller with active partnerships but no shadow record → empty scope', async () => {
    mockOrgFindById.mockReturnValue(chainQ({ _id: 'cpOrg', type: 'channel_partner' }));
    mockPartnershipFind.mockReturnValue(chainQ([{ developerOrg: 'devA' }]));
    mockChannelPartnerFind.mockReturnValue(chainQ([]));
    const req = { user: { organization: 'cpOrg', _id: 'u1' } };
    expect(await partnerAccessScope(req)).toEqual({ _id: { $in: [] } });
  });

  test('CP Owner/Manager → scoped to shadow records; NO agent narrowing', async () => {
    mockOrgFindById.mockReturnValue(chainQ({ _id: 'cpOrg', type: 'channel_partner' }));
    mockPartnershipFind.mockReturnValue(chainQ([{ developerOrg: 'devA' }]));
    mockChannelPartnerFind.mockReturnValue(chainQ([{ _id: 'cpRec1' }]));
    const req = {
      user: { organization: 'cpOrg', _id: 'managerUser', roleRef: { name: 'CP Manager' } },
    };
    const result = await partnerAccessScope(req);
    expect(result).toEqual({
      'channelPartnerAttribution.partners.channelPartner': { $in: ['cpRec1'] },
    });
    expect(result['channelPartnerAttribution.partners.agentUser']).toBeUndefined();
  });

  test('CP Agent (roleRef.name="CP Agent") → narrows agentUser=self', async () => {
    mockOrgFindById.mockReturnValue(chainQ({ _id: 'cpOrg', type: 'channel_partner' }));
    mockPartnershipFind.mockReturnValue(chainQ([{ developerOrg: 'devA' }]));
    mockChannelPartnerFind.mockReturnValue(chainQ([{ _id: 'cpRec1' }]));
    const req = {
      user: { organization: 'cpOrg', _id: 'agentX', roleRef: { name: 'CP Agent' } },
    };
    const result = await partnerAccessScope(req);
    expect(result['channelPartnerAttribution.partners.channelPartner']).toEqual({ $in: ['cpRec1'] });
    expect(result['channelPartnerAttribution.partners.agentUser']).toBe('agentX');
  });

  test('CP Agent identified by roleRef.slug="cp-agent" also narrows', async () => {
    mockOrgFindById.mockReturnValue(chainQ({ _id: 'cpOrg', type: 'channel_partner' }));
    mockPartnershipFind.mockReturnValue(chainQ([{ developerOrg: 'devA' }]));
    mockChannelPartnerFind.mockReturnValue(chainQ([{ _id: 'cpRec1' }]));
    const req = {
      user: { organization: 'cpOrg', _id: 'agentY', roleRef: { slug: 'cp-agent' } },
    };
    const result = await partnerAccessScope(req);
    expect(result['channelPartnerAttribution.partners.agentUser']).toBe('agentY');
  });

  test('CP caller with multiple active partnerships → unions shadow ids', async () => {
    mockOrgFindById.mockReturnValue(chainQ({ _id: 'cpOrg', type: 'channel_partner' }));
    mockPartnershipFind.mockReturnValue(
      chainQ([{ developerOrg: 'devA' }, { developerOrg: 'devB' }])
    );
    mockChannelPartnerFind.mockReturnValue(chainQ([{ _id: 'cpRecA' }, { _id: 'cpRecB' }]));
    const req = {
      user: { organization: 'cpOrg', _id: 'mgr', roleRef: { name: 'CP Manager' } },
    };
    const result = await partnerAccessScope(req);
    expect(result['channelPartnerAttribution.partners.channelPartner']).toEqual({
      $in: ['cpRecA', 'cpRecB'],
    });
  });

  test('Partnership lookup is constrained to status:"active" (terminated excluded)', async () => {
    mockOrgFindById.mockReturnValue(chainQ({ _id: 'cpOrg', type: 'channel_partner' }));
    mockPartnershipFind.mockReturnValue(chainQ([]));
    const req = { user: { organization: 'cpOrg', _id: 'u' } };
    await partnerAccessScope(req);
    expect(mockPartnershipFind).toHaveBeenCalledWith(
      expect.objectContaining({ channelPartnerOrg: 'cpOrg', status: 'active' })
    );
  });

  test('uses req.organization when pre-loaded by middleware (skips Organization.findById)', async () => {
    mockPartnershipFind.mockReturnValue(chainQ([]));
    const req = {
      user: { organization: 'cpOrg', _id: 'u' },
      organization: { _id: 'cpOrg', type: 'channel_partner' },
    };
    await partnerAccessScope(req);
    expect(mockOrgFindById).not.toHaveBeenCalled();
  });

  test('ChannelPartner lookup is keyed by both developer orgs AND this CP org', async () => {
    mockOrgFindById.mockReturnValue(chainQ({ _id: 'cpOrg', type: 'channel_partner' }));
    mockPartnershipFind.mockReturnValue(chainQ([{ developerOrg: 'devA' }, { developerOrg: 'devB' }]));
    mockChannelPartnerFind.mockReturnValue(chainQ([{ _id: 'cpRec' }]));
    const req = {
      user: { organization: 'cpOrg', _id: 'mgr', roleRef: { name: 'CP Manager' } },
    };
    await partnerAccessScope(req);
    expect(mockChannelPartnerFind).toHaveBeenCalledWith(
      expect.objectContaining({
        organization: { $in: ['devA', 'devB'] },
        channelPartnerOrg: 'cpOrg',
      })
    );
  });
});
