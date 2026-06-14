# Report Agent — Phase 3a: Agent Core (deterministic) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the deterministic, LLM-free core the report agent needs: a shared `resolveReportData` (resolve a report definition → real resolved blocks, scoped, without persisting), the three read-only tool functions the agent will call (`listProjects`, `getMetricCatalog`, `getDataPreview`), and a `POST /reports/preview` endpoint so the UI can render a live preview of an unsaved definition.

**Architecture:** `generateInstance` already does scope-resolution → overview fetch → compare fetch → block resolution → DB write. Extract everything except the DB write into a reusable pure-ish `resolveReportData(definition, ctx)`; `generateInstance` then calls it (DRY). The agent tools are thin async functions over existing services (`Project`, `getCatalog`, `resolveReportData`), each taking a `ctx` carrying the caller's org + access + permissions. No Claude here — Phase 3b adds the tool-use loop on top of these functions.

**Tech Stack:** Node ESM, Jest 29 (DB-free unit tests under `tests/unit/`, run with `node --experimental-vm-modules node_modules/jest/bin/jest.js --config jest.unit.config.mjs <file>`). ESM dependency mocking via `jest.unstable_mockModule` (pattern already used in `tests/unit/generateInstance.scope.test.js`).

**Repo:** `propvantage-ai-backend`, branch `feature/report-agent` (already checked out).

**Key facts (verified):**
- `resolveReportScope(scope, accessibleProjectIds)` → `{ mode, projectIds }` (Phase 1); `resolvePeriodArgs(scope)` → `{ period, startDate, endDate }`; `buildSnapshotBlocks(blocks, overview)` → resolved blocks; `getLeadershipOverview(orgId, period, startDate, endDate, projectIds)`; `getLeadershipProjectComparison(orgId, period, startDate, endDate, projectIds)`; `getCatalog(userPermissions, isOwner)` → block metadata; block shape `{ id, type, title?, config, order }`.
- Access: owner → `accessibleProjectIds === null` (= all); else `string[]`. Project access filter for querying `Project` by `_id`: `utils/projectAccessHelper.js:projectIdAccessFilter` returns `{}` (all) / `{_id:{$in:[]}}` (none) / `{_id:{$in:[ObjectId…]}}`.
- Routes: after `router.use(protect)`, add `router.<verb>('/path', hasPermission(PERMISSIONS.REPORTS.MANAGE), handler)`.

---

## File Structure

- **Modify** `services/reports/snapshotService.js` — add `resolveReportData`; refactor `generateInstance` to use it.
- **Create** `services/reports/agent/tools.js` — `listProjects`, `getMetricCatalog`, `getDataPreview` (the agent's read-only toolbox).
- **Modify** `controllers/reportController.js` — add `previewReport` handler.
- **Modify** `routes/reportRoutes.js` — add `POST /preview`.
- **Create** `tests/unit/resolveReportData.test.js`, `tests/unit/agentTools.test.js`.

Testing convention (matches repo): services/pure functions get DB-free unit tests; thin Express controllers are NOT unit-tested here (covered by the UI/e2e phase). No silent gaps — the preview endpoint is glue over the fully-tested `resolveReportData`.

---

## Task 1: `resolveReportData` + refactor `generateInstance`

**Files:**
- Modify: `services/reports/snapshotService.js`
- Test: `tests/unit/resolveReportData.test.js` (+ existing `tests/unit/generateInstance.scope.test.js` must stay green)

- [ ] **Step 1: Write the failing test**

```js
// tests/unit/resolveReportData.test.js
import { jest } from '@jest/globals';

const getLeadershipOverview = jest.fn(async () => ({ _dateRange: { start: 'S', end: 'E' }, revenue: { totalSalesValue: 100 } }));
const getLeadershipProjectComparison = jest.fn(async () => ({ projects: [{ name: 'P' }] }));

jest.unstable_mockModule('../../services/leadershipDashboardService.js', () => ({
  getLeadershipOverview,
  getLeadershipProjectComparison,
}));
// reportInstanceModel is imported by snapshotService; mock so importing doesn't need a DB.
jest.unstable_mockModule('../../models/reportInstanceModel.js', () => ({ default: { create: jest.fn(async (d) => d) } }));

const { resolveReportData } = await import('../../services/reports/snapshotService.js');

const A = 'aaaaaaaaaaaaaaaaaaaaaaaa';

beforeEach(() => { getLeadershipOverview.mockClear(); getLeadershipProjectComparison.mockClear(); });

describe('resolveReportData', () => {
  const def = (scope, blocks = [{ id: 'r', type: 'kpi.revenue', config: {} }]) =>
    ({ organization: 'org1', scope, blocks });

  it('resolves scope + period and returns resolved blocks (no persistence)', async () => {
    const out = await resolveReportData(def({ mode: 'portfolio' }), { accessibleProjectIds: null });
    expect(getLeadershipOverview.mock.calls[0][0]).toBe('org1');
    expect(getLeadershipOverview.mock.calls[0][4]).toBeNull(); // portfolio + owner → all
    expect(out.mode).toBe('portfolio');
    expect(out.blocks[0]).toEqual({ id: 'r', type: 'kpi.revenue', config: {}, data: { value: 100, unit: 'currency' } });
    expect(out.overview.revenue.totalSalesValue).toBe(100);
  });

  it('passes the access-bounded project ids for project scope', async () => {
    await resolveReportData(def({ mode: 'project', projects: [A] }), { accessibleProjectIds: [A, 'bbbbbbbbbbbbbbbbbbbbbbbb'] });
    expect(getLeadershipOverview.mock.calls[0][4]).toEqual([A]);
    expect(getLeadershipProjectComparison).not.toHaveBeenCalled();
  });

  it('fetches comparison only for compare mode and attaches it to overview', async () => {
    const out = await resolveReportData(def({ mode: 'compare', projects: [A] }), { accessibleProjectIds: [A] });
    expect(getLeadershipProjectComparison).toHaveBeenCalled();
    expect(out.overview._comparison).toEqual({ projects: [{ name: 'P' }] });
  });
});
```

- [ ] **Step 2: Run; verify it fails**

Run: `node --experimental-vm-modules node_modules/jest/bin/jest.js --config jest.unit.config.mjs tests/unit/resolveReportData.test.js`
Expected: FAIL — `resolveReportData` is not exported.

- [ ] **Step 3: Add `resolveReportData` and refactor `generateInstance`**

In `services/reports/snapshotService.js`, add this exported function (place it just above `generateInstance`):

```js
/**
 * Resolve a report definition into scoped, real-data blocks WITHOUT persisting.
 * Shared by generateInstance (which then freezes it) and the preview endpoint /
 * the agent's data tools. `definition` has { organization, scope, blocks }.
 * @returns {{ mode, projectIds, overview, blocks }}
 */
export const resolveReportData = async (definition, { accessibleProjectIds = null } = {}) => {
  const { mode, projectIds } = resolveReportScope(definition.scope, accessibleProjectIds);
  const { period, startDate, endDate } = resolvePeriodArgs(definition.scope);
  const overview = await getLeadershipOverview(
    definition.organization, period, startDate, endDate, projectIds
  );
  if (mode === 'compare' && Array.isArray(projectIds) && projectIds.length) {
    try {
      overview._comparison = await getLeadershipProjectComparison(
        definition.organization, period, startDate, endDate, projectIds
      );
    } catch (err) {
      overview._comparison = { error: err.message };
    }
  }
  const blocks = await buildSnapshotBlocks(definition.blocks, overview);
  return { mode, projectIds, overview, blocks };
};
```

Then replace the body of `generateInstance` so it delegates to `resolveReportData` (keeping the DB write + review/expiry logic). The new `generateInstance` is:

```js
export const generateInstance = async (
  template,
  { createdBy = null, accessibleProjectIds = null, autoApprove = false } = {}
) => {
  const { mode, projectIds, overview, blocks } = await resolveReportData(template, { accessibleProjectIds });
  const expiresAfterDays = template.access?.expiresAfterDays || 90;

  // Ad-hoc generations (a user previewing/sharing their own report) are approved on
  // creation so the public link works immediately. Scheduled generations are left in
  // their default 'draft' state and the cron job drives them through review/auto_send.
  const review = autoApprove
    ? { status: 'approved', reviewedBy: createdBy, approvedBy: createdBy, approvedAt: new Date() }
    : undefined;

  return ReportInstance.create({
    organization: template.organization,
    template: template._id,
    createdBy,
    title: template.name,
    periodStart: overview?._dateRange?.start,
    periodEnd: overview?._dateRange?.end,
    blocks,
    theme: template.theme,
    scope: { mode, projectIds: projectIds || [] },
    images: (template.imageSlots || []).map((s) => ({ id: s.id, label: s.label, url: s.url })),
    publicSlug: crypto.randomBytes(9).toString('base64url'),
    accessToken: crypto.randomBytes(24).toString('base64url'),
    gate: template.access?.gate || 'email',
    expiresAt: new Date(Date.now() + expiresAfterDays * 24 * 60 * 60 * 1000),
    ...(review ? { review } : {}),
  });
};
```

(The compare-fetch block that previously lived inline in `generateInstance` now lives only in `resolveReportData` — do not leave a duplicate.)

- [ ] **Step 4: Run; verify it passes (new + existing)**

Run: `node --experimental-vm-modules node_modules/jest/bin/jest.js --config jest.unit.config.mjs tests/unit/resolveReportData.test.js`
Then: `node --experimental-vm-modules node_modules/jest/bin/jest.js --config jest.unit.config.mjs tests/unit/generateInstance.scope.test.js`
Expected: BOTH PASS — the refactor must not regress the Phase 1/2 generateInstance scope + compare tests.

- [ ] **Step 5: Commit**

```bash
git add services/reports/snapshotService.js tests/unit/resolveReportData.test.js
git commit -m "refactor(reports): extract resolveReportData (preview core) from generateInstance"
```

---

## Task 2: Agent tool functions

**Files:**
- Create: `services/reports/agent/tools.js`
- Test: `tests/unit/agentTools.test.js`

- [ ] **Step 1: Write the failing test**

```js
// tests/unit/agentTools.test.js
import { jest } from '@jest/globals';

const find = jest.fn(() => ({ select: () => ({ lean: async () => ([
  { _id: 'p1', name: 'Skyline', status: 'launched' },
  { _id: 'p2', name: 'Marina', status: 'planning' },
]) }) }));
jest.unstable_mockModule('../../models/projectModel.js', () => ({ default: { find } }));

const resolveReportData = jest.fn(async () => ({ blocks: [
  { id: 'kpi.revenue', type: 'kpi.revenue', data: { value: 100, unit: 'currency' } },
] }));
jest.unstable_mockModule('../../services/reports/snapshotService.js', () => ({ resolveReportData }));

const { listProjects, getMetricCatalog, getDataPreview } = await import('../../services/reports/agent/tools.js');

beforeEach(() => { find.mockClear(); resolveReportData.mockClear(); });

describe('agent tools', () => {
  it('listProjects returns {id,name,status} scoped to the org', async () => {
    const out = await listProjects({ organization: 'org1', accessibleProjectIds: null });
    expect(find.mock.calls[0][0]).toMatchObject({ organization: 'org1' });
    expect(out).toEqual([
      { id: 'p1', name: 'Skyline', status: 'launched' },
      { id: 'p2', name: 'Marina', status: 'planning' },
    ]);
  });

  it('listProjects filters by accessible ids for a restricted user', async () => {
    await listProjects({ organization: 'org1', accessibleProjectIds: ['aaaaaaaaaaaaaaaaaaaaaaaa'] });
    const q = find.mock.calls[0][0];
    expect(q._id.$in).toHaveLength(1);
  });

  it('getMetricCatalog returns permission-filtered block metadata (no resolve fns)', () => {
    const cat = getMetricCatalog({ userPermissions: ['analytics:advanced'], isOwner: false });
    expect(Array.isArray(cat)).toBe(true);
    expect(cat.every((b) => b.resolve === undefined)).toBe(true);
    expect(cat.find((b) => b.type === 'kpi.revenue')).toBeDefined();
    expect(cat.find((b) => b.type === 'layout.hero')).toBeDefined(); // always available
  });

  it('getMetricCatalog hides gated blocks without the permission', () => {
    const cat = getMetricCatalog({ userPermissions: [], isOwner: false });
    expect(cat.find((b) => b.type === 'kpi.revenue')).toBeUndefined();
  });

  it('getDataPreview resolves the requested metricIds to real data', async () => {
    const out = await getDataPreview(
      { scope: { mode: 'portfolio' }, metricIds: ['kpi.revenue'] },
      { organization: 'org1', accessibleProjectIds: null },
    );
    // builds a definition of blocks from metricIds and resolves it
    expect(resolveReportData).toHaveBeenCalled();
    const passedDef = resolveReportData.mock.calls[0][0];
    expect(passedDef.organization).toBe('org1');
    expect(passedDef.blocks).toEqual([{ id: 'kpi.revenue', type: 'kpi.revenue', config: {} }]);
    expect(out).toEqual([{ type: 'kpi.revenue', data: { value: 100, unit: 'currency' } }]);
  });
});
```

- [ ] **Step 2: Run; verify it fails**

Run: `node --experimental-vm-modules node_modules/jest/bin/jest.js --config jest.unit.config.mjs tests/unit/agentTools.test.js`
Expected: FAIL — module `services/reports/agent/tools.js` not found.

- [ ] **Step 3: Implement the tools**

```js
// File: services/reports/agent/tools.js
// Read-only tools the report agent (Phase 3b) calls to ground its proposals in real
// data. Each takes a ctx = { organization, accessibleProjectIds, userPermissions, isOwner }.
// Pure-ish: they read existing services; they never write.

import mongoose from 'mongoose';
import Project from '../../../models/projectModel.js';
import { getCatalog } from '../blockRegistry.js';
import { resolveReportData } from '../snapshotService.js';

// Mongo filter on the Project collection by _id, honoring the caller's access.
// owner (null) → all; [] → none; else the explicit set. Mirrors utils/projectAccessHelper.
const projectAccessFilter = (accessibleProjectIds) => {
  if (accessibleProjectIds === null || accessibleProjectIds === undefined) return {};
  if (!accessibleProjectIds.length) return { _id: { $in: [] } };
  return { _id: { $in: accessibleProjectIds.map((id) => new mongoose.Types.ObjectId(id)) } };
};

/** Projects the caller may scope a report to. */
export const listProjects = async (ctx = {}) => {
  const docs = await Project
    .find({ organization: ctx.organization, ...projectAccessFilter(ctx.accessibleProjectIds) })
    .select('name status')
    .lean();
  return docs.map((p) => ({ id: String(p._id), name: p.name, status: p.status }));
};

/** The block palette the caller is permitted to use (metadata only; resolve stripped). */
export const getMetricCatalog = (ctx = {}) => getCatalog(ctx.userPermissions || [], ctx.isOwner || false);

/**
 * Resolve a set of metric (block) ids against a scope/period into REAL numbers, so the
 * agent can ground proposals + write the narrative. Never invents data.
 * @param {{ scope?: object, metricIds?: string[] }} args
 */
export const getDataPreview = async ({ scope = {}, metricIds = [] } = {}, ctx = {}) => {
  const definition = {
    organization: ctx.organization,
    scope,
    blocks: (metricIds || []).map((type) => ({ id: type, type, config: {} })),
  };
  const { blocks } = await resolveReportData(definition, { accessibleProjectIds: ctx.accessibleProjectIds });
  return blocks.map((b) => ({ type: b.type, data: b.data }));
};

export default { listProjects, getMetricCatalog, getDataPreview };
```

- [ ] **Step 4: Run; verify it passes**

Run: `node --experimental-vm-modules node_modules/jest/bin/jest.js --config jest.unit.config.mjs tests/unit/agentTools.test.js`
Expected: PASS (5/5).

- [ ] **Step 5: Commit**

```bash
git add services/reports/agent/tools.js tests/unit/agentTools.test.js
git commit -m "feat(reports): agent read-only tools (listProjects, getMetricCatalog, getDataPreview)"
```

---

## Task 3: `POST /reports/preview` endpoint (live preview of an unsaved definition)

**Files:**
- Modify: `controllers/reportController.js` (add `previewReport`)
- Modify: `routes/reportRoutes.js` (add the route + import)

No unit test (thin Express glue over the fully-tested `resolveReportData`; consistent with the repo's convention of unit-testing services, not controllers — exercised in the UI/e2e phase).

- [ ] **Step 1: Add the controller**

In `controllers/reportController.js`, add the import at the top (next to the existing imports):

```js
import { resolveReportData } from '../services/reports/snapshotService.js';
```

And add the handler:

```js
/**
 * @desc    Resolve an unsaved report definition into real blocks (live preview).
 * @route   POST /api/reports/preview   body: { scope, blocks }
 * @access  Private (reports:manage)
 */
export const previewReport = asyncHandler(async (req, res) => {
  const definition = {
    organization: req.user.organization,
    scope: req.body?.scope || {},
    blocks: Array.isArray(req.body?.blocks) ? req.body.blocks : [],
  };
  try {
    const { mode, projectIds, blocks } = await resolveReportData(definition, {
      accessibleProjectIds: req.accessibleProjectIds,
    });
    res.json({ success: true, data: { scope: { mode, projectIds: projectIds || [] }, blocks } });
  } catch (err) {
    // resolveReportScope throws on an inaccessible/empty restricted selection.
    res.status(400);
    throw new Error(err.message || 'Could not resolve report scope.');
  }
});
```

- [ ] **Step 2: Add the route**

In `routes/reportRoutes.js`, add `previewReport` to the import from `../controllers/reportController.js` (currently `{ getCatalog, uploadReportImage }`):

```js
import { getCatalog, uploadReportImage, previewReport } from '../controllers/reportController.js';
```

And register the route just after the `/catalog` route (line 30):

```js
router.post('/preview', hasPermission(PERMISSIONS.REPORTS.MANAGE), previewReport);
```

- [ ] **Step 3: Verify the app still boots + full unit suite green**

Run: `node --check controllers/reportController.js && node --check routes/reportRoutes.js`
Expected: no syntax errors.
Run: `npm run test:unit`
Expected: PASS — all suites (incl. resolveReportData, agentTools, and the Phase 1/2 suites).

- [ ] **Step 4: Commit**

```bash
git add controllers/reportController.js routes/reportRoutes.js
git commit -m "feat(reports): POST /reports/preview — live preview of an unsaved definition"
```

---

## Self-Review (done while writing)

- **Spec coverage:** Implements the deterministic half of spec §8 — the preview path (`/reports/preview`) and the three read-only tools (`list_projects`, `get_metric_catalog`, `get_data_preview`) with the numbers-integrity property baked in (tools only ever return data resolved by `resolveReportData`; metric ids in, real data out). The Claude tool-use loop + `/reports/agent/message` + session persistence are Phase 3b (explicitly deferred, not a gap).
- **Placeholder scan:** none — full code + exact run commands in every step.
- **Type consistency:** `resolveReportData` returns `{ mode, projectIds, overview, blocks }` and is consumed identically by `generateInstance`, `getDataPreview`, and `previewReport`; `ctx` shape `{ organization, accessibleProjectIds, userPermissions, isOwner }` is consistent across all three tools; `getMetricCatalog` delegates to the real `getCatalog(userPermissions, isOwner)` (resolve stripped); block id/type/config shape matches `blockSchema`.
- **DRY/refactor safety:** the compare-fetch logic now lives only in `resolveReportData` (removed from `generateInstance`); the existing `generateInstance.scope.test.js` must stay green (Step 4 of Task 1 verifies), proving the refactor is behavior-preserving.
