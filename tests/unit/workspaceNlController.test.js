// tests/unit/workspaceNlController.test.js
import { jest } from '@jest/globals';

// Mock the NL service (ESM) so the controller test never touches the Anthropic SDK.
// Matches the repo's jest.unstable_mockModule approach (tests/unit/resolveReportData.test.js).
const nlToQueryPlan = jest.fn();
jest.unstable_mockModule('../../services/workspace/nlToQueryPlan.js', () => ({
  nlToQueryPlan,
  default: { nlToQueryPlan },
}));

const { postNlToQueryPlan } = await import('../../controllers/workspaceController.js');

const mockRes = () => {
  const res = {};
  res.json = (payload) => { res._json = payload; return res; };
  res.status = (code) => { res._status = code; return res; };
  return res;
};

const baseReq = (body) => ({
  body,
  user: { _id: 'u1', organization: 'org1', role: 'Sales Manager' },
  accessibleProjectIds: ['p1'],
  userPermissions: ['leads:read'],
  isOwner: false,
});

describe('workspaceController.postNlToQueryPlan', () => {
  beforeEach(() => nlToQueryPlan.mockReset());

  it('returns 200 with a plan for a good sentence', async () => {
    const plan = {
      module: 'leads', logic: 'AND',
      filters: [{ field: 'daysSinceLastCPFollowUp', op: 'gte', value: 15 }],
      sort: null, limit: 50, nlSource: 'cp not followed up in 15 days',
    };
    nlToQueryPlan.mockResolvedValue({ plan, clarification: null });

    const req = baseReq({ text: 'cp not followed up in 15 days', module: 'leads' });
    const res = mockRes();
    await postNlToQueryPlan(req, res, () => {});

    expect(res._json.success).toBe(true);
    expect(res._json.data.plan).toEqual(plan);
    expect(res._json.data.clarification).toBeNull();
    // service was called with the body text/module and a viewer context derived from the request
    const [textArg, opts] = nlToQueryPlan.mock.calls[0];
    expect(textArg).toBe('cp not followed up in 15 days');
    expect(opts.module).toBe('leads');
    expect(opts.viewerCtx).toMatchObject({ organization: 'org1' });
  });

  it('returns 200 with a clarification (plan null) for an unmappable sentence', async () => {
    nlToQueryPlan.mockResolvedValue({ plan: null, clarification: 'Which project did you mean?' });

    const req = baseReq({ text: 'show me the good ones', module: 'leads' });
    const res = mockRes();
    await postNlToQueryPlan(req, res, () => {});

    expect(res._json.success).toBe(true);
    expect(res._json.data.plan).toBeNull();
    expect(res._json.data.clarification).toBe('Which project did you mean?');
  });

  it('returns 400 when text is missing or blank (and does not call the service)', async () => {
    // missing text — controller sets res.status(400) then throws; asyncHandler
    // passes the error to next (our no-op), so _status is 400 before the throw.
    let res = mockRes();
    await postNlToQueryPlan(baseReq({ module: 'leads' }), res, () => {});
    expect(res._status).toBe(400);

    // whitespace-only text
    res = mockRes();
    await postNlToQueryPlan(baseReq({ text: '   ', module: 'leads' }), res, () => {});
    expect(res._status).toBe(400);

    expect(nlToQueryPlan).not.toHaveBeenCalled();
  });
});
