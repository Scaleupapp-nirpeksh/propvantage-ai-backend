// tests/unit/workspaceController.sharing.test.js
import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import mongoose from 'mongoose';

const mockFind = jest.fn();
const mockFindOne = jest.fn();
jest.unstable_mockModule('../../models/workspaceCardModel.js', () => ({
  default: { find: mockFind, findOne: mockFindOne },
  WORKSPACE_MODULES: ['leads', 'sales', 'payments', 'tasks', 'channelPartners'],
  RENDER_MODES: ['list', 'metric'],
}));
jest.unstable_mockModule('../../services/workspace/catalogs/index.js', () => ({ getCatalog: jest.fn() }));
jest.unstable_mockModule('../../services/workspace/queryPlanSchema.js', () => ({ validateQueryPlan: jest.fn() }));
const mockRun = jest.fn();
jest.unstable_mockModule('../../services/workspace/queryEngine.js', () => ({ runQueryPlan: mockRun }));
jest.unstable_mockModule('../../services/workspace/nlToQueryPlan.js', () => ({ nlToQueryPlan: jest.fn() }));

const { listCards, getCardData } = await import('../../controllers/workspaceController.js');

const mockRes = () => {
  const res = {};
  res.json = (p) => { res._json = p; return res; };
  res.status = (c) => { res._status = c; return res; };
  return res;
};
const run = async (handler, req) => {
  const res = mockRes();
  let thrown = null;
  await handler(req, res, (e) => { thrown = e; }).catch((e) => { thrown = e; });
  return { res, thrown };
};

const ORG = new mongoose.Types.ObjectId();
const OWNER = new mongoose.Types.ObjectId();
const RECIP_A = new mongoose.Types.ObjectId();
const RECIP_B = new mongoose.Types.ObjectId();
const STRANGER = new mongoose.Types.ObjectId();
const PROJ_A = new mongoose.Types.ObjectId();
const PROJ_B = new mongoose.Types.ObjectId();

const reqFor = (userId, over = {}) => ({
  user: { _id: userId, organization: ORG, roleRef: { name: 'Sales Manager' } },
  userPermissions: ['sales:view'], isOwner: false, accessibleProjectIds: [],
  params: {}, query: {}, body: {}, ...over,
});

beforeEach(() => { mockFind.mockReset(); mockFindOne.mockReset(); mockRun.mockReset(); });

describe('listCards — visibility', () => {
  test('queries own cards OR shared-to-me (by user id or current role name), org-scoped', async () => {
    mockFind.mockReturnValue({ sort: jest.fn().mockResolvedValue([]) });
    await run(listCards, reqFor(RECIP_A));
    const query = mockFind.mock.calls[0][0];
    expect(query.organization).toEqual(ORG);
    expect(query.$or).toEqual(expect.arrayContaining([
      { ownerId: RECIP_A },
      { visibility: 'shared', sharedWithUsers: RECIP_A },
      { visibility: 'shared', sharedWithRoles: 'Sales Manager' },
    ]));
  });
});

describe('getCardData — recipient-scoped re-execution + 403', () => {
  // One shared card owned by OWNER, shared with RECIP_A (by user) and the
  // "Sales Manager" role (which RECIP_B holds). Not shared with STRANGER.
  const sharedCard = () => ({
    _id: new mongoose.Types.ObjectId(),
    organization: ORG,
    ownerId: OWNER,
    module: 'sales',
    queryPlan: { module: 'sales', logic: 'AND', filters: [], sort: null, limit: 50 },
    renderMode: 'metric',
    metricConfig: { agg: 'count', field: null },
    visibility: 'shared',
    sharedWithUsers: [RECIP_A],
    sharedWithRoles: ['Sales Manager'],
  });

  test('recipient A (shared by user, access=PROJ_A) gets rows scoped to PROJ_A', async () => {
    const card = sharedCard();
    mockFindOne.mockResolvedValue(card);
    mockRun.mockResolvedValue({ rows: [{ _id: 'a-row' }], total: 1 });
    const req = reqFor(RECIP_A, { params: { id: 'cardId' }, accessibleProjectIds: [PROJ_A.toString()] });
    const { res } = await run(getCardData, req);
    const [, ctx, opts] = mockRun.mock.calls[0];
    expect(String(ctx.userId)).toBe(String(RECIP_A));
    expect(ctx.accessibleProjectIds).toEqual([PROJ_A.toString()]); // recipient's own scope
    // renderMode/metricConfig must be taken from the saved card, not the request.
    expect(opts).toEqual({ renderMode: card.renderMode, metricConfig: card.metricConfig });
    expect(res._json.data.rows).toEqual([{ _id: 'a-row' }]);
  });

  test('recipient B (shared by role, access=PROJ_B) re-runs under B scope → DIFFERENT rows', async () => {
    const card = sharedCard();
    mockFindOne.mockResolvedValue(card);
    mockRun.mockResolvedValue({ rows: [{ _id: 'b-row' }], total: 1 });
    const req = reqFor(RECIP_B, { params: { id: 'cardId' }, accessibleProjectIds: [PROJ_B.toString()] });
    const { res } = await run(getCardData, req);
    const [, ctx, opts] = mockRun.mock.calls[0];
    expect(String(ctx.userId)).toBe(String(RECIP_B)); // NOT the owner
    expect(ctx.accessibleProjectIds).toEqual([PROJ_B.toString()]); // B's scope, not A's, not owner's
    // renderMode/metricConfig must be taken from the saved card.
    expect(opts).toEqual({ renderMode: card.renderMode, metricConfig: card.metricConfig });
    expect(res._json.data.rows).toEqual([{ _id: 'b-row' }]);
  });

  test('owner can always read their own card data', async () => {
    mockFindOne.mockResolvedValue(sharedCard());
    mockRun.mockResolvedValue({ rows: [], total: 0 });
    const { res } = await run(getCardData, reqFor(OWNER, { params: { id: 'cardId' }, accessibleProjectIds: null, isOwner: true }));
    expect(res._json.success).toBe(true);
    expect(mockRun).toHaveBeenCalled();
  });

  test('a non-recipient gets 403 and the engine is never called', async () => {
    mockFindOne.mockResolvedValue(sharedCard());
    // STRANGER has a different role — not in sharedWithUsers and not in sharedWithRoles.
    const req = reqFor(STRANGER, {
      params: { id: 'cardId' },
      accessibleProjectIds: [PROJ_A.toString()],
      user: { _id: STRANGER, organization: ORG, roleRef: { name: 'Viewer' } },
    });
    const { res, thrown } = await run(getCardData, req);
    expect(res._status).toBe(403);
    expect(thrown).toBeInstanceOf(Error);
    expect(mockRun).not.toHaveBeenCalled();
  });

  test('a private card is 403 for everyone except the owner', async () => {
    const priv = { ...sharedCard(), visibility: 'private', sharedWithUsers: [], sharedWithRoles: [] };
    mockFindOne.mockResolvedValue(priv);
    const { res } = await run(getCardData, reqFor(RECIP_A, { params: { id: 'cardId' }, accessibleProjectIds: [PROJ_A.toString()] }));
    expect(res._status).toBe(403);
  });

  test('404 when the card does not exist in the org', async () => {
    mockFindOne.mockResolvedValue(null);
    const { res } = await run(getCardData, reqFor(RECIP_A, { params: { id: 'missing' } }));
    expect(res._status).toBe(404);
  });
});
