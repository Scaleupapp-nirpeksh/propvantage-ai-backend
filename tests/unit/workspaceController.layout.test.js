// tests/unit/workspaceController.layout.test.js
import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import mongoose from 'mongoose';

// Card model is imported by the controller module; stub it so import resolves.
jest.unstable_mockModule('../../models/workspaceCardModel.js', () => ({
  default: {}, WORKSPACE_MODULES: ['leads', 'sales', 'payments', 'tasks', 'channelPartners'], RENDER_MODES: ['list', 'metric'],
}));
jest.unstable_mockModule('../../services/workspace/catalogs/index.js', () => ({ getCatalog: jest.fn() }));
jest.unstable_mockModule('../../services/workspace/queryPlanSchema.js', () => ({ validateQueryPlan: jest.fn() }));
jest.unstable_mockModule('../../services/workspace/queryEngine.js', () => ({ runQueryPlan: jest.fn() }));
jest.unstable_mockModule('../../services/workspace/nlToQueryPlan.js', () => ({ nlToQueryPlan: jest.fn() }));

const mockLayoutFindOne = jest.fn();
const mockLayoutFindOneAndUpdate = jest.fn();
jest.unstable_mockModule('../../models/workspaceLayoutModel.js', () => ({
  default: { findOne: mockLayoutFindOne, findOneAndUpdate: mockLayoutFindOneAndUpdate },
  CARD_SIZES: ['sm', 'md', 'lg'],
}));

const { getLayout, saveLayout } = await import('../../controllers/workspaceController.js');

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
const USER = new mongoose.Types.ObjectId();
const baseReq = (over = {}) => ({
  user: { _id: USER, organization: ORG }, params: {}, query: {}, body: {}, ...over,
});

beforeEach(() => { mockLayoutFindOne.mockReset(); mockLayoutFindOneAndUpdate.mockReset(); });

describe('getLayout', () => {
  test('returns the existing layout for the user', async () => {
    const items = [{ cardId: new mongoose.Types.ObjectId(), order: 0, size: 'lg' }];
    mockLayoutFindOne.mockResolvedValue({ organization: ORG, userId: USER, items });
    const { res } = await run(getLayout, baseReq());
    expect(mockLayoutFindOne).toHaveBeenCalledWith({ organization: ORG, userId: USER });
    expect(res._json.success).toBe(true);
    expect(res._json.data.items).toBe(items);
  });

  test('returns an empty layout (items: []) when none exists yet', async () => {
    mockLayoutFindOne.mockResolvedValue(null);
    const { res } = await run(getLayout, baseReq());
    expect(res._json).toEqual({ success: true, data: { items: [] } });
  });
});

describe('saveLayout', () => {
  test('upserts the caller layout with the provided items (org+user scoped)', async () => {
    const items = [
      { cardId: new mongoose.Types.ObjectId().toString(), order: 0, size: 'md' },
      { cardId: new mongoose.Types.ObjectId().toString(), order: 1, size: 'sm' },
    ];
    mockLayoutFindOneAndUpdate.mockResolvedValue({ organization: ORG, userId: USER, items });
    const { res } = await run(saveLayout, baseReq({ body: { items } }));
    const [filter, update, opts] = mockLayoutFindOneAndUpdate.mock.calls[0];
    expect(filter).toEqual({ organization: ORG, userId: USER });
    expect(update.$set.organization).toEqual(ORG);
    expect(update.$set.items).toEqual(items);
    expect(opts).toMatchObject({ upsert: true, new: true });
    expect(res._json.success).toBe(true);
  });

  test('400s when items is not an array', async () => {
    const { res, thrown } = await run(saveLayout, baseReq({ body: { items: 'nope' } }));
    expect(res._status).toBe(400);
    expect(thrown).toBeInstanceOf(Error);
    expect(mockLayoutFindOneAndUpdate).not.toHaveBeenCalled();
  });

  test('400s when an item is missing cardId', async () => {
    const { res } = await run(saveLayout, baseReq({ body: { items: [{ order: 0, size: 'md' }] } }));
    expect(res._status).toBe(400);
  });

  test('400s when an item has an invalid size', async () => {
    const { res } = await run(saveLayout, baseReq({
      body: { items: [{ cardId: new mongoose.Types.ObjectId().toString(), order: 0, size: 'xl' }] },
    }));
    expect(res._status).toBe(400);
  });
});
