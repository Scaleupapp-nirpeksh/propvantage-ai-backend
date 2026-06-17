// tests/unit/workspaceController.crud.test.js
// In-process controller tests (repo idiom): mock only DB-touching deps + the
// query engine. validateQueryPlan and getCatalog are pure/fast — used for real
// so that contract drift is caught by these tests, not hidden by mocks.
import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import mongoose from 'mongoose';

// ─── Mock ONLY the DB model and the query engine ──────────────────────────────
const mockCreate = jest.fn();
const mockFind = jest.fn();
const mockFindOne = jest.fn();
const mockDeleteOne = jest.fn();
jest.unstable_mockModule('../../models/workspaceCardModel.js', () => ({
  default: { create: mockCreate, find: mockFind, findOne: mockFindOne, deleteOne: mockDeleteOne },
  WORKSPACE_MODULES: ['leads', 'sales', 'payments', 'tasks', 'channelPartners'],
  RENDER_MODES: ['list', 'metric', 'insight'],
}));

const mockRun = jest.fn();
jest.unstable_mockModule('../../services/workspace/queryEngine.js', () => ({ runQueryPlan: mockRun }));

// Mock the insight source registry so insight branches are exercised without
// touching the underlying analytics services.
const mockSalesForecastRun = jest.fn();
const INSIGHT_PREDICTIVE = 'analytics:predictive';
const FAKE_SOURCES = {
  salesForecast: {
    key: 'salesForecast', label: 'Sales forecast', kind: 'forecast',
    permission: INSIGHT_PREDICTIVE, params: { period: ['3_months', '6_months', '12_months'] },
    run: mockSalesForecastRun,
  },
};
jest.unstable_mockModule('../../services/workspace/insightSources.js', () => ({
  INSIGHT_SOURCES: FAKE_SOURCES,
  listInsightSources: () => Object.values(FAKE_SOURCES).map(({ key, label, kind, params }) => ({ key, label, kind, params })),
  getInsightSource: (k) => FAKE_SOURCES[k],
}));

// validateQueryPlan and getCatalog are NOT mocked — we run the real
// implementations so test failures catch actual contract drift.

const {
  getCatalog, previewCard, createCard, listCards, updateCard, deleteCard, getCardData,
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
  [mockCreate, mockFind, mockFindOne, mockDeleteOne, mockRun, mockSalesForecastRun].forEach((m) => m.mockReset());
});

// A valid minimal query plan — filters has 1 item (schema requires min:1).
const VALID_PLAN = { module: 'leads', filters: [{ field: 'status', op: 'is', value: 'New' }] };
// The coerced version Joi produces: defaults applied, unknown keys stripped.
const COERCED_PLAN = { module: 'leads', logic: 'AND', filters: [{ field: 'status', op: 'is', value: 'New' }], sort: null, limit: 50, nlSource: null };

describe('workspaceController — catalog', () => {
  test('GET /catalog/leads returns serialized fields without function props', async () => {
    const { res } = await run(getCatalog, baseReq({ params: { module: 'leads' } }));
    expect(res._json.success).toBe(true);
    expect(res._json.data.module).toBe('leads');
    expect(res._json.data.label).toBeTruthy();
    // All fields must be plain objects — no functions should leak to the client.
    for (const f of res._json.data.fields) {
      expect(typeof f.toMatch).toBe('undefined');
      expect(typeof f.addFields).toBe('undefined');
      expect(typeof f.scope).toBe('undefined');
      expect(typeof f.key).toBe('string');
      expect(typeof f.label).toBe('string');
    }
    // scope must not appear at the top level either.
    expect(res._json.data.scope).toBeUndefined();
    // The 'status' field should be present in the leads catalog.
    const statusField = res._json.data.fields.find((f) => f.key === 'status');
    expect(statusField).toBeDefined();
    expect(statusField.type).toBe('enum');
  });

  test('GET /catalog/:module 400s on an unknown module (real getCatalog throws)', async () => {
    const { res, thrown } = await run(getCatalog, baseReq({ params: { module: 'bogus' } }));
    // The controller must catch the thrown error and respond 400, not 500.
    expect(res._status).toBe(400);
    expect(thrown).toBeInstanceOf(Error);
    expect(thrown.message).toMatch(/Unknown workspace module/);
    expect(thrown.message).toMatch(/bogus/);
  });
});

describe('workspaceController — preview', () => {
  test('POST /preview with a real valid plan calls runQueryPlan with the COERCED plan + viewer ctx + render opts', async () => {
    mockRun.mockResolvedValue({ rows: [{ _id: 'lead-1' }], total: 1 });
    const body = {
      queryPlan: VALID_PLAN,
      renderMode: 'metric',
      metricConfig: { agg: 'count', field: null },
    };
    const { res } = await run(previewCard, baseReq({ body }));
    expect(res._json).toEqual({ success: true, data: { rows: [{ _id: 'lead-1' }], total: 1 } });

    // Confirm runQueryPlan was called with the coerced plan (Joi defaults: logic:'AND', limit:50, etc.)
    expect(mockRun).toHaveBeenCalledTimes(1);
    const [planArg, ctxArg, optsArg] = mockRun.mock.calls[0];
    expect(planArg).toEqual(COERCED_PLAN);
    // Viewer context must carry the organization from the request user.
    expect(String(ctxArg.organization)).toBe(String(ORG));
    expect(String(ctxArg.userId)).toBe(String(USER));
    expect(ctxArg.isOwner).toBe(false);
    // renderMode and metricConfig must be threaded from the request body.
    expect(optsArg).toEqual({ renderMode: 'metric', metricConfig: { agg: 'count', field: null } });
  });

  test('POST /preview with a real INVALID plan (empty filters) → 400, engine NOT called', async () => {
    // filters:[] violates the real schema's min(1) constraint.
    const { res, thrown } = await run(previewCard, baseReq({ body: { queryPlan: { module: 'leads', filters: [] } } }));
    expect(res._status).toBe(400);
    expect(thrown).toBeInstanceOf(Error);
    expect(thrown.message).toMatch(/Invalid query plan/);
    expect(mockRun).not.toHaveBeenCalled();
  });

  test('POST /preview with completely missing module → 400, engine NOT called', async () => {
    const { res, thrown } = await run(previewCard, baseReq({ body: { queryPlan: { filters: [{ field: 'status', op: 'is', value: 'New' }] } } }));
    expect(res._status).toBe(400);
    expect(thrown).toBeInstanceOf(Error);
    expect(mockRun).not.toHaveBeenCalled();
  });
});

describe('workspaceController — card CRUD', () => {
  test('POST /cards with a valid plan stamps org+owner, derives module from plan, stores coerced plan, returns 201', async () => {
    mockCreate.mockImplementation(async (doc) => ({ _id: new mongoose.Types.ObjectId(), ...doc }));
    const body = { title: 'My Leads Card', queryPlan: VALID_PLAN, renderMode: 'list', columns: ['firstName', 'status', 'daysSinceLastCPFollowUp'] };
    const { res } = await run(createCard, baseReq({ body }));
    expect(res._status).toBe(201);
    expect(res._json.success).toBe(true);

    const created = mockCreate.mock.calls[0][0];
    // Display columns must be persisted from the body.
    expect(created.columns).toEqual(['firstName', 'status', 'daysSinceLastCPFollowUp']);
    // Organization and ownerId must come from req.user (not body).
    expect(String(created.organization)).toBe(String(ORG));
    expect(String(created.ownerId)).toBe(String(USER));
    expect(created.title).toBe('My Leads Card');
    // Module must be derived from the validated plan, not body.module.
    expect(created.module).toBe('leads');
    // queryPlan stored must be the COERCED plan (with Joi defaults like logic:'AND').
    expect(created.queryPlan).toEqual(COERCED_PLAN);
    expect(created.queryPlan.logic).toBe('AND');
    expect(created.queryPlan.limit).toBe(50);
  });

  test('POST /cards without columns defaults them to []', async () => {
    mockCreate.mockImplementation(async (doc) => ({ _id: new mongoose.Types.ObjectId(), ...doc }));
    const body = { title: 'No columns', queryPlan: VALID_PLAN, renderMode: 'list' };
    const { res } = await run(createCard, baseReq({ body }));
    expect(res._status).toBe(201);
    expect(mockCreate.mock.calls[0][0].columns).toEqual([]);
  });

  test('POST /cards with a mismatched body.module — module is ignored; plan module wins', async () => {
    mockCreate.mockImplementation(async (doc) => ({ _id: new mongoose.Types.ObjectId(), ...doc }));
    // body.module says 'sales' but queryPlan.module is 'leads' — the validated plan wins.
    const body = { title: 'Module Mismatch', module: 'sales', queryPlan: VALID_PLAN, renderMode: 'list' };
    const { res } = await run(createCard, baseReq({ body }));
    expect(res._status).toBe(201);
    const created = mockCreate.mock.calls[0][0];
    expect(created.module).toBe('leads'); // from validatedPlan, not body.module
  });

  test('POST /cards 400s when the real schema rejects the plan, never calls create', async () => {
    // filters is required and must have at least 1 item.
    const { res, thrown } = await run(createCard, baseReq({ body: { title: 'bad', queryPlan: { module: 'leads', filters: [] } } }));
    expect(res._status).toBe(400);
    expect(thrown).toBeInstanceOf(Error);
    expect(thrown.message).toMatch(/Invalid query plan/);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test('POST /cards 400s on invalid renderMode', async () => {
    const { res, thrown } = await run(createCard, baseReq({ body: { title: 'x', queryPlan: VALID_PLAN, renderMode: 'chart' } }));
    expect(res._status).toBe(400);
    expect(thrown).toBeInstanceOf(Error);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test('PUT /cards/:id updates mutable fields, ignores immutable fields, stores coerced plan on update', async () => {
    const id = new mongoose.Types.ObjectId();
    const save = jest.fn().mockResolvedValue(true);
    const doc = { _id: id, organization: ORG, ownerId: USER, title: 'old', module: 'sales', queryPlan: {}, save };
    mockFindOne.mockResolvedValue(doc);
    const { res } = await run(updateCard, baseReq({
      params: { id: id.toString() },
      body: {
        title: 'new title',
        // These immutable fields must be silently ignored.
        organization: new mongoose.Types.ObjectId(),
        ownerId: new mongoose.Types.ObjectId(),
        // Providing a new valid queryPlan — module must update to match.
        queryPlan: VALID_PLAN,
        // body.module must be ignored (derived from queryPlan).
        module: 'payments',
        // columns is a mutable field — must be applied via the passthrough loop.
        columns: ['firstName', 'status'],
      },
    }));

    // findOne must be scoped to org + owner.
    expect(mockFindOne).toHaveBeenCalledWith(expect.objectContaining({
      _id: id.toString(),
      organization: ORG,
      ownerId: USER,
    }));
    expect(doc.title).toBe('new title');
    // Immutable fields preserved.
    expect(String(doc.organization)).toBe(String(ORG));
    expect(String(doc.ownerId)).toBe(String(USER));
    // module derived from validatedPlan, not body.module.
    expect(doc.module).toBe('leads');
    // queryPlan stored is the coerced plan.
    expect(doc.queryPlan).toEqual(COERCED_PLAN);
    // columns is mutable and updated via the passthrough loop.
    expect(doc.columns).toEqual(['firstName', 'status']);
    expect(save).toHaveBeenCalled();
    expect(res._json.success).toBe(true);
  });

  test('PUT /cards/:id 400s when the updated queryPlan is invalid', async () => {
    const id = new mongoose.Types.ObjectId();
    const save = jest.fn();
    mockFindOne.mockResolvedValue({ _id: id, organization: ORG, ownerId: USER, title: 'old', save });
    const { res, thrown } = await run(updateCard, baseReq({
      params: { id: id.toString() },
      body: { queryPlan: { module: 'leads', filters: [] } },
    }));
    expect(res._status).toBe(400);
    expect(thrown).toBeInstanceOf(Error);
    expect(save).not.toHaveBeenCalled();
  });

  test('PUT /cards/:id 404s when the card is not owned by the requester', async () => {
    mockFindOne.mockResolvedValue(null);
    const { res, thrown } = await run(updateCard, baseReq({
      params: { id: new mongoose.Types.ObjectId().toString() },
      body: { title: 'x' },
    }));
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
    const { res, thrown } = await run(deleteCard, baseReq({
      params: { id: new mongoose.Types.ObjectId().toString() },
    }));
    expect(res._status).toBe(404);
    expect(thrown).toBeInstanceOf(Error);
  });
});

describe('workspaceController — insight cards', () => {
  const PROJ = new mongoose.Types.ObjectId();
  const NORMALIZED = {
    kind: 'forecast',
    headline: { label: 'Forecasted bookings', value: 42, format: 'number' },
    bands: [], confidence: null, series: null, bullets: [], asOf: '2026-06-17T00:00:00.000Z',
    scope: { period: '6_months', projectId: null },
  };

  test('POST /cards (insight) persists insightConfig, sets sentinel module + empty plan, never validates a query plan', async () => {
    mockCreate.mockImplementation(async (doc) => ({ _id: new mongoose.Types.ObjectId(), ...doc }));
    const body = {
      title: 'Sales forecast', renderMode: 'insight',
      insightConfig: { source: 'salesForecast', period: '6_months', projectId: PROJ },
    };
    const { res } = await run(createCard, baseReq({ body, userPermissions: [INSIGHT_PREDICTIVE] }));
    expect(res._status).toBe(201);
    const created = mockCreate.mock.calls[0][0];
    expect(created.renderMode).toBe('insight');
    expect(created.insightConfig).toEqual({ source: 'salesForecast', period: '6_months', projectId: PROJ });
    // Sentinel module + empty query plan keep the list/metric paths unaffected.
    expect(created.module).toBe('leads');
    expect(created.queryPlan).toEqual({});
    // The insight create path must not call the query engine.
    expect(mockRun).not.toHaveBeenCalled();
  });

  test('POST /cards (insight) 400s on an unknown source, never creates', async () => {
    const { res, thrown } = await run(createCard, baseReq({
      body: { title: 'x', renderMode: 'insight', insightConfig: { source: 'bogus', period: '6_months' } },
    }));
    expect(res._status).toBe(400);
    expect(thrown.message).toMatch(/Unknown insight source/);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test('POST /cards (insight) 400s on a period outside the source allow-list', async () => {
    const { res, thrown } = await run(createCard, baseReq({
      body: { title: 'x', renderMode: 'insight', insightConfig: { source: 'salesForecast', period: '99_months' } },
    }));
    expect(res._status).toBe(400);
    expect(thrown.message).toMatch(/Invalid period/);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test('POST /preview (insight) returns the source payload without query-plan validation', async () => {
    mockSalesForecastRun.mockResolvedValue(NORMALIZED);
    const { res } = await run(previewCard, baseReq({
      body: { renderMode: 'insight', insightConfig: { source: 'salesForecast', period: '6_months' } },
      userPermissions: [INSIGHT_PREDICTIVE],
    }));
    expect(res._json).toEqual({ success: true, data: NORMALIZED });
    expect(mockSalesForecastRun).toHaveBeenCalledTimes(1);
    expect(mockRun).not.toHaveBeenCalled();
  });

  test('getCardData (insight) runs the source under the viewer and returns its payload', async () => {
    mockSalesForecastRun.mockResolvedValue(NORMALIZED);
    const id = new mongoose.Types.ObjectId();
    mockFindOne.mockResolvedValue({
      _id: id, organization: ORG, ownerId: USER, renderMode: 'insight',
      insightConfig: { source: 'salesForecast', period: '6_months', projectId: null },
    });
    const { res } = await run(getCardData, baseReq({
      params: { id: id.toString() }, userPermissions: [INSIGHT_PREDICTIVE],
    }));
    expect(res._json).toEqual({ success: true, data: NORMALIZED });
    expect(mockSalesForecastRun).toHaveBeenCalledTimes(1);
    // Insight branch must not run a query plan.
    expect(mockRun).not.toHaveBeenCalled();
  });

  test('getCardData (insight) 403s when the viewer lacks the source permission', async () => {
    const id = new mongoose.Types.ObjectId();
    mockFindOne.mockResolvedValue({
      _id: id, organization: ORG, ownerId: USER, renderMode: 'insight',
      insightConfig: { source: 'salesForecast', period: '6_months', projectId: null },
    });
    const { res, thrown } = await run(getCardData, baseReq({
      params: { id: id.toString() }, userPermissions: [], // no predictive permission
    }));
    expect(res._status).toBe(403);
    expect(thrown.message).toMatch(/permission/i);
    expect(mockSalesForecastRun).not.toHaveBeenCalled();
  });

  test('getCardData (insight) 403s when a specific projectId is outside accessibleProjectIds for a non-owner', async () => {
    const id = new mongoose.Types.ObjectId();
    mockFindOne.mockResolvedValue({
      _id: id, organization: ORG, ownerId: USER, renderMode: 'insight',
      insightConfig: { source: 'salesForecast', period: '6_months', projectId: PROJ },
    });
    const { res, thrown } = await run(getCardData, baseReq({
      params: { id: id.toString() },
      userPermissions: [INSIGHT_PREDICTIVE],
      isOwner: false,
      accessibleProjectIds: [new mongoose.Types.ObjectId()], // PROJ not included
    }));
    expect(res._status).toBe(403);
    expect(thrown.message).toMatch(/project/i);
    expect(mockSalesForecastRun).not.toHaveBeenCalled();
  });
});

describe('workspaceController — listCards (real implementation)', () => {
  test('GET /cards queries own + shared cards and returns them org-scoped', async () => {
    mockFind.mockReturnValue({ sort: jest.fn().mockResolvedValue([]) });
    const { res } = await run(listCards, baseReq());
    expect(res._json.success).toBe(true);
    expect(Array.isArray(res._json.data)).toBe(true);
    // Verify the query includes org scope and $or with at least the owner clause.
    const query = mockFind.mock.calls[0][0];
    expect(String(query.organization)).toBe(String(ORG));
    expect(query.$or).toEqual(expect.arrayContaining([{ ownerId: USER }]));
  });
});
