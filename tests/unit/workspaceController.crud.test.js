// tests/unit/workspaceController.crud.test.js
// In-process controller tests (repo idiom): mock models + engine, invoke handlers.
import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import mongoose from 'mongoose';

// ─── Mock collaborators ────────────────────────────────────────────────────
const mockCreate = jest.fn();
const mockFind = jest.fn();
const mockFindOne = jest.fn();
const mockDeleteOne = jest.fn();
jest.unstable_mockModule('../../models/workspaceCardModel.js', () => ({
  default: { create: mockCreate, find: mockFind, findOne: mockFindOne, deleteOne: mockDeleteOne },
  WORKSPACE_MODULES: ['leads', 'sales', 'payments', 'tasks', 'channelPartners'],
  RENDER_MODES: ['list', 'metric'],
}));

const mockGetCatalog = jest.fn();
jest.unstable_mockModule('../../services/workspace/catalogs/index.js', () => ({ getCatalog: mockGetCatalog }));

const mockValidate = jest.fn();
jest.unstable_mockModule('../../services/workspace/queryPlanSchema.js', () => ({ validateQueryPlan: mockValidate }));

const mockRun = jest.fn();
jest.unstable_mockModule('../../services/workspace/queryEngine.js', () => ({ runQueryPlan: mockRun }));

const {
  getCatalog, previewCard, createCard, listCards, updateCard, deleteCard,
} = await import('../../controllers/workspaceController.js');

// ─── Test helpers ──────────────────────────────────────────────────────────
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
  user: { _id: USER, organization: ORG, roleRef: { name: 'Sales Manager' } },
  userPermissions: ['sales:view'], userRoleLevel: 30, isOwner: false, accessibleProjectIds: [],
  params: {}, query: {}, body: {}, ...over,
});

beforeEach(() => {
  [mockCreate, mockFind, mockFindOne, mockDeleteOne, mockGetCatalog, mockValidate, mockRun].forEach((m) => m.mockReset());
});

describe('workspaceController — catalog & preview', () => {
  test('GET /catalog/:module returns the catalog as { success, data }', async () => {
    mockGetCatalog.mockReturnValue({
      module: 'sales', label: 'Sales / Bookings',
      fields: [{ key: 'status', label: 'Status', type: 'enum', operators: ['is'], enumValues: ['Booked'], displayable: true, toMatch() {}, addFields() {} }],
      scope() {},
    });
    const { res } = await run(getCatalog, baseReq({ params: { module: 'sales' } }));
    expect(res._json.success).toBe(true);
    expect(res._json.data.module).toBe('sales');
    // function props must NOT leak to the client
    expect(res._json.data.fields[0].toMatch).toBeUndefined();
    expect(res._json.data.fields[0].addFields).toBeUndefined();
    expect(res._json.data.scope).toBeUndefined();
    expect(res._json.data.fields[0].key).toBe('status');
  });

  test('GET /catalog/:module 400s on an unknown module', async () => {
    mockGetCatalog.mockReturnValue(null);
    const { res, thrown } = await run(getCatalog, baseReq({ params: { module: 'bogus' } }));
    expect(res._status).toBe(400);
    expect(thrown).toBeInstanceOf(Error);
  });

  test('POST /preview validates the plan then runs the engine with the viewer ctx', async () => {
    mockValidate.mockReturnValue({ valid: true, errors: [] });
    mockRun.mockResolvedValue({ rows: [{ _id: 'a' }], total: 1 });
    const plan = { module: 'sales', logic: 'AND', filters: [], sort: null, limit: 50 };
    const { res } = await run(previewCard, baseReq({ body: { queryPlan: plan, renderMode: 'list' } }));
    expect(mockValidate).toHaveBeenCalledWith(plan);
    const ctxArg = mockRun.mock.calls[0][1];
    expect(String(ctxArg.organization)).toBe(String(ORG));
    expect(String(ctxArg.userId)).toBe(String(USER));
    expect(ctxArg.isOwner).toBe(false);
    expect(res._json).toEqual({ success: true, data: { rows: [{ _id: 'a' }], total: 1 } });
  });

  test('POST /preview 400s when validation fails (never calls the engine)', async () => {
    mockValidate.mockReturnValue({ valid: false, errors: ['unknown field: bogus'] });
    const { res, thrown } = await run(previewCard, baseReq({ body: { queryPlan: { module: 'sales' } } }));
    expect(res._status).toBe(400);
    expect(thrown.message).toMatch(/unknown field/);
    expect(mockRun).not.toHaveBeenCalled();
  });
});

describe('workspaceController — card CRUD', () => {
  test('POST /cards validates plan, stamps org+owner, returns 201', async () => {
    mockValidate.mockReturnValue({ valid: true, errors: [] });
    mockCreate.mockImplementation(async (doc) => ({ _id: new mongoose.Types.ObjectId(), ...doc }));
    const body = { title: 'Stale CP', module: 'sales', queryPlan: { module: 'sales', logic: 'AND', filters: [] }, renderMode: 'list' };
    const { res } = await run(createCard, baseReq({ body }));
    expect(res._status).toBe(201);
    const created = mockCreate.mock.calls[0][0];
    expect(String(created.organization)).toBe(String(ORG));
    expect(String(created.ownerId)).toBe(String(USER));
    expect(created.title).toBe('Stale CP');
    expect(res._json.success).toBe(true);
  });

  test('POST /cards 400s when the plan is invalid', async () => {
    mockValidate.mockReturnValue({ valid: false, errors: ['bad'] });
    const { res, thrown } = await run(createCard, baseReq({ body: { title: 'x', module: 'sales', queryPlan: {} } }));
    expect(res._status).toBe(400);
    expect(thrown).toBeInstanceOf(Error);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test('PUT /cards/:id updates owner-owned card and ignores immutable fields', async () => {
    const id = new mongoose.Types.ObjectId();
    const save = jest.fn().mockResolvedValue(true);
    const doc = { _id: id, organization: ORG, ownerId: USER, title: 'old', module: 'sales', save };
    mockFindOne.mockResolvedValue(doc);
    mockValidate.mockReturnValue({ valid: true, errors: [] });
    const { res } = await run(updateCard, baseReq({
      params: { id: id.toString() },
      body: { title: 'new', organization: new mongoose.Types.ObjectId(), ownerId: new mongoose.Types.ObjectId() },
    }));
    // findOne scoped to org + owner
    expect(mockFindOne).toHaveBeenCalledWith(expect.objectContaining({ _id: id.toString(), organization: ORG, ownerId: USER }));
    expect(doc.title).toBe('new');
    expect(String(doc.organization)).toBe(String(ORG)); // immutable preserved
    expect(String(doc.ownerId)).toBe(String(USER));     // immutable preserved
    expect(save).toHaveBeenCalled();
    expect(res._json.success).toBe(true);
  });

  test('PUT /cards/:id 404s when the card is not owned by the requester', async () => {
    mockFindOne.mockResolvedValue(null);
    const { res, thrown } = await run(updateCard, baseReq({ params: { id: new mongoose.Types.ObjectId().toString() }, body: { title: 'x' } }));
    expect(res._status).toBe(404);
    expect(thrown).toBeInstanceOf(Error);
  });

  test('DELETE /cards/:id removes an owner-owned card', async () => {
    const id = new mongoose.Types.ObjectId();
    mockFindOne.mockResolvedValue({ _id: id, organization: ORG, ownerId: USER, title: 'gone' });
    mockDeleteOne.mockResolvedValue({ deletedCount: 1 });
    const { res } = await run(deleteCard, baseReq({ params: { id: id.toString() } }));
    expect(mockDeleteOne).toHaveBeenCalledWith({ _id: id });
    expect(res._json.success).toBe(true);
  });

  test('DELETE /cards/:id 404s when not owned', async () => {
    mockFindOne.mockResolvedValue(null);
    const { res } = await run(deleteCard, baseReq({ params: { id: new mongoose.Types.ObjectId().toString() } }));
    expect(res._status).toBe(404);
  });
});
