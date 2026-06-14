# Report Agent — Phase 2: Expanded Metric Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Widen the report block palette by surfacing analytics the system already computes but never exposed (channel-partner, invoicing, construction, operations, plus extra financial KPIs), and complete `compare` scope by feeding per-project comparison data into a comparison block.

**Architecture:** Every existing data block is a pure resolver over the `getLeadershipOverview()` snapshot (`resolve({ overview, config })`). `getLeadershipOverview` already returns `construction`, `invoicing`, `channelPartner`, and `operations` sections that no block reads — so new blocks are pure resolvers over already-fetched data (no new service calls, no resolver-context change). `compare` scope is the one exception: comparison data is computed by a separate function, so `generateInstance` fetches it for `compare` mode and attaches it to `overview._comparison` for a comparison block to read.

**Tech Stack:** Node ESM, Jest 29 (DB-free unit tests under `tests/unit/`, run with `node --experimental-vm-modules node_modules/jest/bin/jest.js --config jest.unit.config.mjs <file>`). Frontend: CRA/Jest for the one frontend file.

**Repos:** `propvantage-ai-backend` (blocks, compare wiring) + `propvantage-ai-frontend` (palette category order). Branch `feature/report-agent` in BOTH repos (create it in the frontend repo as part of Task 2).

**Data traps to respect (from the audit — do not violate):**
- All-time booking count is `overview.revenue.totalSalesCount` — NOT `overview.salesPipeline.totalSales` (which is mislabeled period data). Do not surface the latter.
- `overview.channelPartner.commissionsByStatus` and `overview.construction.milestonesByPhase` are **nested** objects (`{count,amount}` / `{...}`) — `objectMapToChartData` (which expects a flat `{key:number}` map) won't work on them; use a table or pick a numeric sub-field.
- `overview.construction.overallProgress` is a 0–100 percentage; the renderer's `'percent'` unit multiplies by 100, so divide by 100 when using `unit:'percent'`.
- Skip construction contractor metrics (`activeContractors`, `avgContractorRating`) — they are computed org-wide (not project-scoped), so they'd be wrong in a project-scoped report.

**Deferred to a later phase (NOT in this plan):** budget-vs-actual, forecasts/predictive, unit/inventory detail, lead-scoring, source-ROI. These require calling services beyond `getLeadershipOverview`, i.e. a resolver-context change — they belong with the agent engine (its `get_data_preview` tool) or a Phase 2b. Don't build them here (YAGNI for this phase).

---

## File Structure

- **Modify** `services/reports/blockRegistry.js` — append the new block definitions to the `BLOCKS` array (one clear place; existing pattern).
- **Modify** `tests/unit/blockRegistry.test.js` — extend `fakeOverview` + assert each new resolver.
- **Modify** `services/reports/snapshotService.js` — `generateInstance`: fetch comparison for `compare` mode → `overview._comparison`.
- **Modify** `tests/unit/generateInstance.scope.test.js` — assert the compare fetch + attachment.
- **Modify** (frontend) `src/utils/reportCatalog.js` — extend `CATEGORY_ORDER` with the new categories.
- **Modify** (frontend) `src/utils/reportCatalog.test.js` — assert the new ordering.

---

## Task 1: New overview-derived blocks (Financial, Invoicing, Channel Partners, Construction, Operations)

**Files:**
- Modify: `services/reports/blockRegistry.js` (append to `BLOCKS`, before the `// ─── Layout / Media` section at line 86)
- Test: `tests/unit/blockRegistry.test.js`

- [ ] **Step 1: Write the failing tests**

In `tests/unit/blockRegistry.test.js`, extend the `fakeOverview` object (lines 4–10) to add the four sections (place inside the object):

```js
  invoicing: { totalInvoiced: 50000000, totalPaid: 30000000, totalOverdue: 5000000,
    invoicesByStatus: { paid: 12, pending: 5, overdue: 2 } },
  channelPartner: { totalGrossCommissions: 4000000, totalNetCommissions: 3600000, totalPending: 800000,
    commissionsByStatus: { paid: { count: 8, amount: 2800000 }, pending: { count: 3, amount: 800000 } } },
  construction: { overallProgress: 62.5, delayedCount: 2,
    milestonesByStatus: { completed: 10, in_progress: 4, delayed: 2 } },
  operations: { overdueCount: 7, tasksByStatus: { open: 20, done: 35 }, tasksByPriority: { high: 8, low: 12 } },
```

Then add this `describe` block at the end of the file (before the final closing `});` of the top-level describe is fine, or as a new top-level describe):

```js
describe('blockRegistry — Phase 2 blocks', () => {
  const r = (type) => getBlock(type).resolve({ overview: fakeOverview, config: {} });

  it('financial extras', () => {
    expect(r('kpi.totalSalesCount')).toBeDefined();
    expect(getBlock('kpi.totalSalesCount').resolve({ overview: { revenue: { totalSalesCount: 248 } } }))
      .toEqual({ value: 248, unit: 'count' });
    expect(getBlock('kpi.overdueAmount').resolve({ overview: { revenue: { totalOverdue: 4400000 } } }))
      .toEqual({ value: 4400000, unit: 'currency' });
  });

  it('invoicing blocks', () => {
    expect(r('kpi.invoiced')).toEqual({ value: 50000000, unit: 'currency' });
    expect(r('kpi.invoicePaid')).toEqual({ value: 30000000, unit: 'currency' });
    expect(r('kpi.invoiceOverdue')).toEqual({ value: 5000000, unit: 'currency' });
    expect(r('chart.invoicesByStatus')).toEqual({
      chartKind: 'bar',
      data: [{ name: 'paid', value: 12 }, { name: 'pending', value: 5 }, { name: 'overdue', value: 2 }],
    });
  });

  it('channel-partner blocks', () => {
    expect(r('kpi.cpGrossCommissions')).toEqual({ value: 4000000, unit: 'currency' });
    expect(r('kpi.cpNetCommissions')).toEqual({ value: 3600000, unit: 'currency' });
    expect(r('kpi.cpPendingCommissions')).toEqual({ value: 800000, unit: 'currency' });
    expect(r('table.cpCommissionsByStatus')).toEqual({
      rows: [
        { status: 'paid', count: 8, amount: 2800000 },
        { status: 'pending', count: 3, amount: 800000 },
      ],
    });
  });

  it('construction blocks (progress is 0-100 → /100 for percent unit)', () => {
    expect(r('kpi.constructionProgress')).toEqual({ value: 0.625, unit: 'percent' });
    expect(r('kpi.delayedMilestones')).toEqual({ value: 2, unit: 'count' });
    expect(r('chart.milestonesByStatus')).toEqual({
      chartKind: 'pie',
      data: [{ name: 'completed', value: 10 }, { name: 'in_progress', value: 4 }, { name: 'delayed', value: 2 }],
    });
  });

  it('operations blocks', () => {
    expect(r('kpi.overdueTasks')).toEqual({ value: 7, unit: 'count' });
    expect(r('chart.tasksByStatus')).toEqual({
      chartKind: 'pie', data: [{ name: 'open', value: 20 }, { name: 'done', value: 35 }],
    });
    expect(r('chart.tasksByPriority')).toEqual({
      chartKind: 'bar', data: [{ name: 'high', value: 8 }, { name: 'low', value: 12 }],
    });
  });

  it('new blocks gate on analytics:advanced and are hidden without it', () => {
    const open = getCatalog([], false).map((b) => b.type);
    expect(open).not.toContain('kpi.cpGrossCommissions');
    const adv = getCatalog(['analytics:advanced'], false).map((b) => b.type);
    expect(adv).toContain('kpi.cpGrossCommissions');
    expect(adv).toContain('chart.tasksByStatus');
  });
});
```

- [ ] **Step 2: Run; verify it fails**

Run: `node --experimental-vm-modules node_modules/jest/bin/jest.js --config jest.unit.config.mjs tests/unit/blockRegistry.test.js`
Expected: FAIL — `getBlock('kpi.invoiced')` etc. return `undefined` → `.resolve` throws.

- [ ] **Step 3: Append the new blocks**

In `services/reports/blockRegistry.js`, insert these entries into the `BLOCKS` array immediately BEFORE the `// ─── Layout / Media (always available) ──` comment (line 86). `num` and `objectMapToChartData` are already imported (line 6); `ADV` is already defined (line 9).

```js
  // ─── Financial (extra) ──────────────────────────────
  {
    type: 'kpi.totalSalesCount', category: 'Financial', label: 'Bookings', kind: 'kpi',
    description: 'Number of bookings (all-time).', requiredPermission: ADV, defaultConfig: {},
    resolve: ({ overview }) => ({ value: num(overview?.revenue?.totalSalesCount), unit: 'count' }),
  },
  {
    type: 'kpi.overdueAmount', category: 'Financial', label: 'Overdue', kind: 'kpi',
    description: 'Total overdue receivables.', requiredPermission: ADV, defaultConfig: {},
    resolve: ({ overview }) => ({ value: num(overview?.revenue?.totalOverdue), unit: 'currency' }),
  },
  // ─── Invoicing ──────────────────────────────────────
  {
    type: 'kpi.invoiced', category: 'Invoicing', label: 'Total Invoiced', kind: 'kpi',
    description: 'Total invoiced amount.', requiredPermission: ADV, defaultConfig: {},
    resolve: ({ overview }) => ({ value: num(overview?.invoicing?.totalInvoiced), unit: 'currency' }),
  },
  {
    type: 'kpi.invoicePaid', category: 'Invoicing', label: 'Invoices Paid', kind: 'kpi',
    description: 'Total paid against invoices.', requiredPermission: ADV, defaultConfig: {},
    resolve: ({ overview }) => ({ value: num(overview?.invoicing?.totalPaid), unit: 'currency' }),
  },
  {
    type: 'kpi.invoiceOverdue', category: 'Invoicing', label: 'Invoices Overdue', kind: 'kpi',
    description: 'Overdue invoice amount.', requiredPermission: ADV, defaultConfig: {},
    resolve: ({ overview }) => ({ value: num(overview?.invoicing?.totalOverdue), unit: 'currency' }),
  },
  {
    type: 'chart.invoicesByStatus', category: 'Invoicing', label: 'Invoices by Status', kind: 'chart',
    description: 'Invoice count by status.', requiredPermission: ADV, defaultConfig: {},
    resolve: ({ overview }) => ({ chartKind: 'bar', data: objectMapToChartData(overview?.invoicing?.invoicesByStatus) }),
  },
  // ─── Channel Partners ───────────────────────────────
  {
    type: 'kpi.cpGrossCommissions', category: 'Channel Partners', label: 'Gross Commissions', kind: 'kpi',
    description: 'Total gross channel-partner commissions.', requiredPermission: ADV, defaultConfig: {},
    resolve: ({ overview }) => ({ value: num(overview?.channelPartner?.totalGrossCommissions), unit: 'currency' }),
  },
  {
    type: 'kpi.cpNetCommissions', category: 'Channel Partners', label: 'Net Commissions', kind: 'kpi',
    description: 'Total net channel-partner commissions.', requiredPermission: ADV, defaultConfig: {},
    resolve: ({ overview }) => ({ value: num(overview?.channelPartner?.totalNetCommissions), unit: 'currency' }),
  },
  {
    type: 'kpi.cpPendingCommissions', category: 'Channel Partners', label: 'Pending Commissions', kind: 'kpi',
    description: 'Commissions pending payout.', requiredPermission: ADV, defaultConfig: {},
    resolve: ({ overview }) => ({ value: num(overview?.channelPartner?.totalPending), unit: 'currency' }),
  },
  {
    type: 'table.cpCommissionsByStatus', category: 'Channel Partners', label: 'Commissions by Status', kind: 'table',
    description: 'Commission count and amount by status.', requiredPermission: ADV, defaultConfig: {},
    resolve: ({ overview }) => ({
      rows: Object.entries(overview?.channelPartner?.commissionsByStatus || {})
        .map(([status, v]) => ({ status, count: num(v?.count), amount: num(v?.amount) })),
    }),
  },
  // ─── Construction ───────────────────────────────────
  {
    type: 'kpi.constructionProgress', category: 'Construction', label: 'Construction Progress', kind: 'kpi',
    description: 'Average construction progress across milestones.', requiredPermission: ADV, defaultConfig: {},
    resolve: ({ overview }) => ({ value: num(overview?.construction?.overallProgress) / 100, unit: 'percent' }),
  },
  {
    type: 'kpi.delayedMilestones', category: 'Construction', label: 'Delayed Milestones', kind: 'kpi',
    description: 'Count of delayed construction milestones.', requiredPermission: ADV, defaultConfig: {},
    resolve: ({ overview }) => ({ value: num(overview?.construction?.delayedCount), unit: 'count' }),
  },
  {
    type: 'chart.milestonesByStatus', category: 'Construction', label: 'Milestones by Status', kind: 'chart',
    description: 'Milestone count by status.', requiredPermission: ADV, defaultConfig: {},
    resolve: ({ overview }) => ({ chartKind: 'pie', data: objectMapToChartData(overview?.construction?.milestonesByStatus) }),
  },
  // ─── Operations ─────────────────────────────────────
  {
    type: 'kpi.overdueTasks', category: 'Operations', label: 'Overdue Tasks', kind: 'kpi',
    description: 'Tasks past their due date.', requiredPermission: ADV, defaultConfig: {},
    resolve: ({ overview }) => ({ value: num(overview?.operations?.overdueCount), unit: 'count' }),
  },
  {
    type: 'chart.tasksByStatus', category: 'Operations', label: 'Tasks by Status', kind: 'chart',
    description: 'Task count by status.', requiredPermission: ADV, defaultConfig: {},
    resolve: ({ overview }) => ({ chartKind: 'pie', data: objectMapToChartData(overview?.operations?.tasksByStatus) }),
  },
  {
    type: 'chart.tasksByPriority', category: 'Operations', label: 'Tasks by Priority', kind: 'chart',
    description: 'Task count by priority.', requiredPermission: ADV, defaultConfig: {},
    resolve: ({ overview }) => ({ chartKind: 'bar', data: objectMapToChartData(overview?.operations?.tasksByPriority) }),
  },
```

- [ ] **Step 4: Run; verify it passes**

Run: `node --experimental-vm-modules node_modules/jest/bin/jest.js --config jest.unit.config.mjs tests/unit/blockRegistry.test.js`
Expected: PASS (existing + new describe).

- [ ] **Step 5: Commit**

```bash
git add services/reports/blockRegistry.js tests/unit/blockRegistry.test.js
git commit -m "feat(reports): expose invoicing/CP/construction/operations + financial blocks"
```

---

## Task 2: Order the new palette categories (frontend)

**Files:**
- Modify: `propvantage-ai-frontend/src/utils/reportCatalog.js` (line 4, `CATEGORY_ORDER`)
- Test: `propvantage-ai-frontend/src/utils/reportCatalog.test.js`

Work in the **frontend** repo. First create the branch: `git checkout -b feature/report-agent` (from `main`).

- [ ] **Step 1: Write the failing test**

Add to `src/utils/reportCatalog.test.js`:

```js
import { groupCatalogByCategory } from './reportCatalog';

it('orders the expanded categories ahead of Layout and after the core ones', () => {
  const catalog = [
    { type: 'a', category: 'Layout', label: 'L' },
    { type: 'b', category: 'Operations', label: 'O' },
    { type: 'c', category: 'Financial', label: 'F' },
    { type: 'd', category: 'Channel Partners', label: 'CP' },
    { type: 'e', category: 'Comparison', label: 'Cmp' },
  ];
  const order = groupCatalogByCategory(catalog).map((g) => g.category);
  expect(order).toEqual(['Financial', 'Channel Partners', 'Comparison', 'Operations', 'Layout']);
});
```

- [ ] **Step 2: Run; verify it fails**

Run: `CI=true npm test -- --watchAll=false --testPathPattern="reportCatalog"`
Expected: FAIL — current order puts the unlisted categories (Operations, Channel Partners, Comparison) alphabetically after Financial but the test expects the explicit order.

- [ ] **Step 3: Extend `CATEGORY_ORDER`**

In `src/utils/reportCatalog.js`, change line 4:

```js
const CATEGORY_ORDER = ['Financial', 'Sales', 'Inventory', 'Channel Partners', 'Invoicing', 'Construction', 'Operations', 'Comparison', 'Team', 'AI', 'Layout'];
```

- [ ] **Step 4: Run; verify it passes**

Run: `CI=true npm test -- --watchAll=false --testPathPattern="reportCatalog"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/reportCatalog.js src/utils/reportCatalog.test.js
git commit -m "feat(reports): order expanded block-palette categories"
```

---

## Task 3: Complete `compare` scope — comparison data + block

**Files:**
- Modify: `services/reports/snapshotService.js` (import line 8; `generateInstance` body after the `getLeadershipOverview` call)
- Modify: `services/reports/blockRegistry.js` (add one comparison block)
- Test: `tests/unit/blockRegistry.test.js` (comparison block) + `tests/unit/generateInstance.scope.test.js` (compare fetch)

- [ ] **Step 1: Write the failing tests**

(a) In `tests/unit/blockRegistry.test.js`, add to the Phase 2 describe:

```js
  it('table.projectComparison reads overview._comparison.projects', () => {
    const ov = { _comparison: { projects: [
      { name: 'Skyline', revenue: { actualRevenue: 100, totalCollected: 60 }, salesPipeline: { conversionRate: 0.06 }, construction: { overallProgress: 50 } },
    ] } };
    expect(getBlock('table.projectComparison').resolve({ overview: ov, config: {} })).toEqual({
      rows: [{ project: 'Skyline', sales: 100, collected: 60, conversion: 0.06, progress: 50 }],
    });
  });
  it('table.projectComparison is empty when no comparison data', () => {
    expect(getBlock('table.projectComparison').resolve({ overview: {}, config: {} })).toEqual({ rows: [] });
  });
```

(b) In `tests/unit/generateInstance.scope.test.js`, the existing mock already mocks `getLeadershipProjectComparison: jest.fn()`. Give it a return + assert it's called for compare mode. Replace its mock line with a captured fn and add a test:

```js
// near the other mock fns at the top:
const getLeadershipProjectComparison = jest.fn(async () => ({ projects: [{ name: 'P', revenue: {}, salesPipeline: {}, construction: {} }] }));
// in the jest.unstable_mockModule('../../services/leadershipDashboardService.js', ...) factory,
// return getLeadershipProjectComparison instead of jest.fn():
//   getLeadershipProjectComparison,

it('compare mode fetches project comparison and attaches it to the overview', async () => {
  getLeadershipProjectComparison.mockClear();
  const inst = await generateInstance(
    template({ mode: 'compare', projects: [A, B] }),
    { accessibleProjectIds: [A, B] },
  );
  expect(getLeadershipProjectComparison).toHaveBeenCalled();
  // the resolved project ids are passed (arg index 4)
  expect(getLeadershipProjectComparison.mock.calls[0][4]).toEqual([A, B]);
  expect(inst.scope.mode).toBe('compare');
});

it('non-compare modes do not call project comparison', async () => {
  getLeadershipProjectComparison.mockClear();
  await generateInstance(template({ mode: 'portfolio' }), { accessibleProjectIds: null });
  expect(getLeadershipProjectComparison).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run; verify they fail**

Run both:
`node --experimental-vm-modules node_modules/jest/bin/jest.js --config jest.unit.config.mjs tests/unit/blockRegistry.test.js`
`node --experimental-vm-modules node_modules/jest/bin/jest.js --config jest.unit.config.mjs tests/unit/generateInstance.scope.test.js`
Expected: FAIL — block undefined; comparison fn not called.

- [ ] **Step 3a: Add the comparison block**

In `services/reports/blockRegistry.js`, add after the Operations blocks (still before Layout):

```js
  // ─── Comparison (compare scope) ─────────────────────
  {
    type: 'table.projectComparison', category: 'Comparison', label: 'Project Comparison', kind: 'table',
    description: 'Side-by-side key metrics per project (used with a "compare" scope).', requiredPermission: ADV, defaultConfig: {},
    resolve: ({ overview }) => ({
      rows: (overview?._comparison?.projects || []).map((p) => ({
        project: p?.name,
        sales: num(p?.revenue?.actualRevenue),
        collected: num(p?.revenue?.totalCollected),
        conversion: num(p?.salesPipeline?.conversionRate),
        progress: num(p?.construction?.overallProgress),
      })),
    }),
  },
```

- [ ] **Step 3b: Fetch comparison for compare mode**

In `services/reports/snapshotService.js`, extend the import on line 8:

```js
import { getLeadershipOverview, getLeadershipProjectComparison } from '../leadershipDashboardService.js';
```

Then in `generateInstance`, immediately AFTER the `const overview = await getLeadershipOverview(...)` statement, add:

```js
  if (mode === 'compare' && Array.isArray(projectIds) && projectIds.length) {
    try {
      overview._comparison = await getLeadershipProjectComparison(
        template.organization, period, startDate, endDate, projectIds
      );
    } catch (err) {
      overview._comparison = { error: err.message };
    }
  }
```

(`overview` is a plain object from `getLeadershipOverview`; attaching `_comparison` is safe and the per-block resolver isolation already guards a bad block.)

- [ ] **Step 4: Run; verify they pass + full suite green**

Run the two files above (PASS), then the whole suite:
Run: `npm run test:unit`
Expected: PASS — all suites, no regressions (incl. Phase 1's `scopeResolver`, `generateInstance.scope`).

- [ ] **Step 5: Commit**

```bash
git add services/reports/snapshotService.js services/reports/blockRegistry.js tests/unit/blockRegistry.test.js tests/unit/generateInstance.scope.test.js
git commit -m "feat(reports): complete compare scope — project comparison data + block"
```

---

## Self-Review (done while writing)

- **Spec coverage:** Implements spec §6 (expanded metric library) for the overview-derived sections + completes §6/§7 `compare` rendering. Cross-service metrics (budget-vs-actual, forecasts, unit/lead detail) are explicitly deferred (they need the resolver-context/agent work) — flagged, not a silent gap.
- **Placeholder scan:** none — every block + test has exact code, every run command is concrete.
- **Type consistency:** resolver shape `{ value, unit }` / `{ chartKind, data }` / `{ rows }` matches the existing renderer contract and `objectMapToChartData` output `[{name,value}]`; `num` import already present; `unit` values (`currency`/`count`/`percent`) match the frontend `formatValue`; construction progress `/100` matches the `percent` (×100) renderer; `table.cpCommissionsByStatus` + `table.projectComparison` return `{ rows }` like the existing `table.topWorkload`.
- **Data-trap compliance:** uses `revenue.totalSalesCount` (not the mislabeled `salesPipeline.totalSales`); tables (not `objectMapToChartData`) for the nested `commissionsByStatus`; `/100` for the 0–100 `overallProgress`; no contractor (org-wide) metrics surfaced.
