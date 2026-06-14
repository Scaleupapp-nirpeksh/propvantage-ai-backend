# Report Agent — Phase 1: Project Scoping (backend) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make report data scopable to a single project, the whole portfolio, or a side-by-side comparison — always bounded by the creator's project access — by activating the dormant `scope.projects` field and threading a resolved, access-checked project set through report generation.

**Architecture:** A new pure function `resolveReportScope(scope, accessibleProjectIds)` turns a template's scope + the caller's access into the effective project-id list that `getLeadershipOverview` already accepts as its 5th argument. `generateInstance` calls it and records the resolved scope as provenance on the `ReportInstance`. Validation gains scope checks. Security is enforced by intersection at generation time (a user can never widen beyond their access), and the `buildProjectFilter([]) === "all projects"` gotcha is avoided by never passing an empty array (the resolver throws on an empty restricted selection).

**Tech Stack:** Node ESM, Mongoose 8, Jest 29 (ESM, DB-free unit tests under `tests/unit/`, run with `node --experimental-vm-modules node_modules/jest/bin/jest.js --config jest.unit.config.mjs <file>`).

**Repo:** `propvantage-ai-backend` (files at repo root: `models/`, `services/`, `controllers/`, `tests/`).

---

## File Structure

- **Create** `services/reports/scopeResolver.js` — pure `resolveReportScope()`. One responsibility: scope + access → effective project ids (or `null` = all). No I/O.
- **Modify** `models/reportTemplateModel.js` — add `scope.mode` + export `SCOPE_MODES`.
- **Modify** `models/reportInstanceModel.js` — add a frozen `scope` provenance field.
- **Modify** `services/reports/templateValidation.js` — validate `scope.mode` + `scope.projects`.
- **Modify** `services/reports/snapshotService.js` — call `resolveReportScope` in `generateInstance`; store provenance.
- **Create** `tests/unit/scopeResolver.test.js`, `tests/unit/templateValidation.scope.test.js`, `tests/unit/reportTemplateModel.scope.test.js`, `tests/unit/generateInstance.scope.test.js`.

Scope boundary: `compare` mode's resolver + provenance land here; the side-by-side comparison *blocks/rendering* are Phase 2 (metric library). In Phase 1, `compare` scopes the overview to the selected projects (combined).

---

## Task 1: Add `scope.mode` to the template model

**Files:**
- Modify: `models/reportTemplateModel.js` (constants block near line 12-19; `scope` sub-schema at lines 64-72)
- Test: `tests/unit/reportTemplateModel.scope.test.js`

- [ ] **Step 1: Write the failing test**

```js
// tests/unit/reportTemplateModel.scope.test.js
// Mongoose instantiation needs no DB connection; defaults apply on `new Model()`.
import ReportTemplate, { SCOPE_MODES } from '../../models/reportTemplateModel.js';

describe('ReportTemplate.scope.mode', () => {
  it('exports the three scope modes', () => {
    expect(SCOPE_MODES).toEqual(['portfolio', 'project', 'compare']);
  });

  it('defaults scope.mode to "portfolio"', () => {
    const doc = new ReportTemplate({ organization: '000000000000000000000000', name: 'T' });
    expect(doc.scope.mode).toBe('portfolio');
  });

  it('accepts an explicit valid mode', () => {
    const doc = new ReportTemplate({
      organization: '000000000000000000000000', name: 'T',
      scope: { mode: 'compare', projects: [] },
    });
    expect(doc.scope.mode).toBe('compare');
  });
});
```

- [ ] **Step 2: Run it; verify it fails**

Run: `node --experimental-vm-modules node_modules/jest/bin/jest.js --config jest.unit.config.mjs tests/unit/reportTemplateModel.scope.test.js`
Expected: FAIL — `SCOPE_MODES` is undefined / `scope.mode` is undefined.

- [ ] **Step 3: Add the constant + field**

In `models/reportTemplateModel.js`, add near the other constants (after line 19, `TEMPLATE_STATUSES`):

```js
export const SCOPE_MODES = ['portfolio', 'project', 'compare'];
```

Then change the `scope` sub-schema (currently lines 64-72) to add `mode` as the first key:

```js
    scope: {
      mode: { type: String, enum: SCOPE_MODES, default: 'portfolio' },
      projects: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Project' }],
      period: {
        preset: { type: String, enum: PERIOD_PRESETS, default: 'last_30d' },
        customStart: { type: Date },
        customEnd: { type: Date },
      },
    },
```

- [ ] **Step 4: Run it; verify it passes**

Run: `node --experimental-vm-modules node_modules/jest/bin/jest.js --config jest.unit.config.mjs tests/unit/reportTemplateModel.scope.test.js`
Expected: PASS (3/3).

- [ ] **Step 5: Commit**

```bash
git add models/reportTemplateModel.js tests/unit/reportTemplateModel.scope.test.js
git commit -m "feat(reports): add scope.mode to report template (portfolio|project|compare)"
```

---

## Task 2: `resolveReportScope` pure function

**Files:**
- Create: `services/reports/scopeResolver.js`
- Test: `tests/unit/scopeResolver.test.js`

- [ ] **Step 1: Write the failing test**

```js
// tests/unit/scopeResolver.test.js
import { resolveReportScope } from '../../services/reports/scopeResolver.js';

// Two real accessible ids + one the user cannot access.
const A = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const B = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const X = 'cccccccccccccccccccccccc';

describe('resolveReportScope', () => {
  it('portfolio + owner (null access) → all projects (null)', () => {
    expect(resolveReportScope({ mode: 'portfolio' }, null)).toEqual({ mode: 'portfolio', projectIds: null });
  });

  it('portfolio + user → their full accessible set', () => {
    expect(resolveReportScope({ mode: 'portfolio' }, [A, B])).toEqual({ mode: 'portfolio', projectIds: [A, B] });
  });

  it('portfolio + user with NO access → throws (never returns [] = "all")', () => {
    expect(() => resolveReportScope({ mode: 'portfolio' }, [])).toThrow(/no accessible projects/i);
  });

  it('project + user → intersection of selection and access', () => {
    expect(resolveReportScope({ mode: 'project', projects: [A, X] }, [A, B]))
      .toEqual({ mode: 'project', projectIds: [A] });
  });

  it('project + owner → the selection as-is', () => {
    expect(resolveReportScope({ mode: 'project', projects: [A, X] }, null))
      .toEqual({ mode: 'project', projectIds: [A, X] });
  });

  it('compare → intersection (same access rule)', () => {
    expect(resolveReportScope({ mode: 'compare', projects: [A, B] }, [A, B]))
      .toEqual({ mode: 'compare', projectIds: [A, B] });
  });

  it('selection with no accessible match → throws', () => {
    expect(() => resolveReportScope({ mode: 'project', projects: [X] }, [A, B]))
      .toThrow(/none of the selected projects/i);
  });

  it('project/compare mode without a selection → throws', () => {
    expect(() => resolveReportScope({ mode: 'project', projects: [] }, [A]))
      .toThrow(/requires scope.projects/i);
  });

  it('back-compat: no mode + projects chosen → treated as project scope', () => {
    expect(resolveReportScope({ projects: [A] }, [A, B])).toEqual({ mode: 'project', projectIds: [A] });
  });

  it('back-compat: no mode + no projects → portfolio', () => {
    expect(resolveReportScope({}, null)).toEqual({ mode: 'portfolio', projectIds: null });
  });
});
```

- [ ] **Step 2: Run it; verify it fails**

Run: `node --experimental-vm-modules node_modules/jest/bin/jest.js --config jest.unit.config.mjs tests/unit/scopeResolver.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the resolver**

```js
// File: services/reports/scopeResolver.js
// Resolve a report template's scope + the caller's project access into the effective
// project-id list to pass to getLeadershipOverview (null = "all projects"). Pure: no I/O.
// SECURITY: a user can never widen beyond their access; an empty restricted set throws
// (never returns [], which buildProjectFilter would treat as "all projects").

const norm = (id) => String(id);

/**
 * @param {object} scope - template.scope ({ mode?, projects?, period? })
 * @param {string[]|null} accessibleProjectIds - null = owner (all projects); array = the
 *        user's accessible project ids (possibly empty).
 * @returns {{ mode: string, projectIds: (string[]|null) }}
 * @throws {Error} when a restricted selection resolves to zero accessible projects.
 */
export const resolveReportScope = (scope = {}, accessibleProjectIds = null) => {
  const selected = Array.isArray(scope.projects) ? scope.projects.map(norm) : [];
  const mode = scope.mode || (selected.length ? 'project' : 'portfolio');
  const isOwner = accessibleProjectIds === null; // null sentinel = full access

  if (mode === 'portfolio') {
    if (isOwner) return { mode, projectIds: null }; // all projects
    if (!accessibleProjectIds.length) throw new Error('No accessible projects for this report.');
    return { mode, projectIds: accessibleProjectIds.map(norm) };
  }

  // 'project' or 'compare' — an explicit selection is required.
  if (!selected.length) throw new Error(`scope.mode "${mode}" requires scope.projects.`);
  const access = isOwner ? null : accessibleProjectIds.map(norm);
  const allowed = isOwner ? selected : selected.filter((id) => access.includes(id));
  if (!allowed.length) throw new Error('None of the selected projects are accessible.');
  return { mode, projectIds: allowed };
};

export default { resolveReportScope };
```

- [ ] **Step 4: Run it; verify it passes**

Run: `node --experimental-vm-modules node_modules/jest/bin/jest.js --config jest.unit.config.mjs tests/unit/scopeResolver.test.js`
Expected: PASS (10/10).

- [ ] **Step 5: Commit**

```bash
git add services/reports/scopeResolver.js tests/unit/scopeResolver.test.js
git commit -m "feat(reports): resolveReportScope — access-bounded effective project set"
```

---

## Task 3: Validate `scope.mode` + `scope.projects`

**Files:**
- Modify: `services/reports/templateValidation.js` (import line 4-6; enum checks near line 44-52)
- Test: `tests/unit/templateValidation.scope.test.js`

- [ ] **Step 1: Write the failing test**

```js
// tests/unit/templateValidation.scope.test.js
import { validateTemplatePayload } from '../../services/reports/templateValidation.js';

const OK_ID = 'aaaaaaaaaaaaaaaaaaaaaaaa';

describe('validateTemplatePayload — scope', () => {
  it('accepts a valid scope', () => {
    const r = validateTemplatePayload({ name: 'T', scope: { mode: 'project', projects: [OK_ID] } });
    expect(r.valid).toBe(true);
  });

  it('rejects an unknown scope.mode', () => {
    const r = validateTemplatePayload({ name: 'T', scope: { mode: 'galaxy' } });
    expect(r.valid).toBe(false);
    expect(r.errors.join(' ')).toMatch(/scope.mode/);
  });

  it('rejects scope.projects that is not an array', () => {
    const r = validateTemplatePayload({ name: 'T', scope: { projects: 'nope' } });
    expect(r.valid).toBe(false);
    expect(r.errors.join(' ')).toMatch(/scope.projects must be an array/);
  });

  it('rejects a malformed project id', () => {
    const r = validateTemplatePayload({ name: 'T', scope: { projects: ['not-an-id'] } });
    expect(r.valid).toBe(false);
    expect(r.errors.join(' ')).toMatch(/scope.projects\[0\]/);
  });
});
```

- [ ] **Step 2: Run it; verify it fails**

Run: `node --experimental-vm-modules node_modules/jest/bin/jest.js --config jest.unit.config.mjs tests/unit/templateValidation.scope.test.js`
Expected: FAIL — the malformed-id and mode cases pass through unvalidated (`valid: true`).

- [ ] **Step 3: Add the validation**

In `services/reports/templateValidation.js`, extend the import (currently lines 4-6) to include `SCOPE_MODES`:

```js
import {
  THEME_PRESETS, GATE_TYPES, DELIVERY_MODES, SCHEDULE_FREQUENCIES, PERIOD_PRESETS, SCOPE_MODES,
} from '../../models/reportTemplateModel.js';
```

Then, immediately after the existing `enumCheck(body.scope?.period?.preset, …)` line (line 51), add:

```js
  enumCheck(body.scope?.mode, SCOPE_MODES, 'scope.mode');
  if (body.scope?.projects !== undefined) {
    if (!Array.isArray(body.scope.projects)) {
      errors.push('scope.projects must be an array');
    } else {
      body.scope.projects.forEach((p, i) => {
        if (!/^[a-f0-9]{24}$/i.test(String(p))) errors.push(`scope.projects[${i}] must be a valid project id`);
      });
    }
  }
```

- [ ] **Step 4: Run it; verify it passes**

Run: `node --experimental-vm-modules node_modules/jest/bin/jest.js --config jest.unit.config.mjs tests/unit/templateValidation.scope.test.js`
Expected: PASS (4/4).

- [ ] **Step 5: Commit**

```bash
git add services/reports/templateValidation.js tests/unit/templateValidation.scope.test.js
git commit -m "feat(reports): validate scope.mode + scope.projects ids"
```

---

## Task 4: Add `scope` provenance to the instance model

**Files:**
- Modify: `models/reportInstanceModel.js` (top-level schema fields; add after `theme:` at line 97)
- Test: covered by Task 5 (the generateInstance test asserts the stored scope). No standalone test needed — this step is a one-line schema addition consumed by Task 5.

- [ ] **Step 1: Add the field**

In `models/reportInstanceModel.js`, immediately after the `theme: { type: mongoose.Schema.Types.Mixed },` line (line 97), add:

```js
    scope: {
      mode: { type: String },
      projectIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Project' }],
    },
```

- [ ] **Step 2: Commit**

```bash
git add models/reportInstanceModel.js
git commit -m "feat(reports): record resolved scope provenance on report instances"
```

---

## Task 5: Wire `resolveReportScope` into `generateInstance`

**Files:**
- Modify: `services/reports/snapshotService.js` (import block lines 5-8; `generateInstance` body lines ~53-88)
- Test: `tests/unit/generateInstance.scope.test.js` (ESM module mocks — no DB)

- [ ] **Step 1: Write the failing test**

```js
// tests/unit/generateInstance.scope.test.js
// Mock the DB + analytics deps so we can assert generateInstance threads the resolved
// scope into getLeadershipOverview and freezes it on the instance. ESM mocking pattern.
import { jest } from '@jest/globals';

const getLeadershipOverview = jest.fn(async () => ({ _dateRange: { start: null, end: null } }));
const create = jest.fn(async (doc) => doc);

jest.unstable_mockModule('../../services/leadershipDashboardService.js', () => ({
  getLeadershipOverview,
  getLeadershipProjectComparison: jest.fn(),
}));
jest.unstable_mockModule('../../models/reportInstanceModel.js', () => ({
  default: { create },
}));

const { generateInstance } = await import('../../services/reports/snapshotService.js');

const A = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const B = 'bbbbbbbbbbbbbbbbbbbbbbbb';

const template = (scope) => ({
  _id: 't1', organization: 'org1', name: 'R', blocks: [], scope,
  access: { gate: 'email', expiresAfterDays: 90 },
});

beforeEach(() => { getLeadershipOverview.mockClear(); create.mockClear(); });

describe('generateInstance — scope', () => {
  it('owner portfolio → passes null (all projects) to getLeadershipOverview', async () => {
    await generateInstance(template({ mode: 'portfolio' }), { accessibleProjectIds: null });
    expect(getLeadershipOverview.mock.calls[0][4]).toBeNull();
  });

  it('project scope → passes the access-bounded intersection', async () => {
    await generateInstance(
      template({ mode: 'project', projects: [A, 'cccccccccccccccccccccccc'] }),
      { accessibleProjectIds: [A, B] },
    );
    expect(getLeadershipOverview.mock.calls[0][4]).toEqual([A]);
  });

  it('freezes the resolved scope on the instance', async () => {
    const inst = await generateInstance(
      template({ mode: 'project', projects: [A] }),
      { accessibleProjectIds: [A, B] },
    );
    expect(inst.scope).toEqual({ mode: 'project', projectIds: [A] });
  });

  it('throws when the selection is entirely inaccessible (never silently widens)', async () => {
    await expect(
      generateInstance(template({ mode: 'project', projects: ['cccccccccccccccccccccccc'] }), { accessibleProjectIds: [A] }),
    ).rejects.toThrow(/none of the selected projects/i);
    expect(getLeadershipOverview).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it; verify it fails**

Run: `node --experimental-vm-modules node_modules/jest/bin/jest.js --config jest.unit.config.mjs tests/unit/generateInstance.scope.test.js`
Expected: FAIL — `getLeadershipOverview` is called with `accessibleProjectIds` (not the resolved set); `inst.scope` is undefined.

- [ ] **Step 3: Wire it in**

In `services/reports/snapshotService.js`, add to the import block (after line 8):

```js
import { resolveReportScope } from './scopeResolver.js';
```

Then in `generateInstance`, replace the first two statements of the body — currently:

```js
  const { period, startDate, endDate } = resolvePeriodArgs(template.scope);
  const overview = await getLeadershipOverview(
    template.organization, period, startDate, endDate, accessibleProjectIds
  );
```

with:

```js
  const { mode, projectIds } = resolveReportScope(template.scope, accessibleProjectIds);
  const { period, startDate, endDate } = resolvePeriodArgs(template.scope);
  const overview = await getLeadershipOverview(
    template.organization, period, startDate, endDate, projectIds
  );
```

Then in the `ReportInstance.create({ ... })` call, add a `scope` provenance field (e.g. right after the `theme: template.theme,` line):

```js
    scope: { mode, projectIds: projectIds || [] },
```

- [ ] **Step 4: Run it; verify it passes**

Run: `node --experimental-vm-modules node_modules/jest/bin/jest.js --config jest.unit.config.mjs tests/unit/generateInstance.scope.test.js`
Expected: PASS (4/4).

- [ ] **Step 5: Run the whole unit suite (no regressions)**

Run: `npm run test:unit`
Expected: PASS — including the existing `tests/unit/snapshotService.test.js` and `tests/unit/templateValidation.test.js`.

- [ ] **Step 6: Commit**

```bash
git add services/reports/snapshotService.js tests/unit/generateInstance.scope.test.js
git commit -m "feat(reports): scope report generation to the resolved project set + provenance"
```

---

## Notes for the implementer

- **Why throw instead of returning `[]`:** `buildProjectFilter([])` (in `leadershipDashboardService.js`) treats an empty list as "no filter = all projects." Returning `[]` for a restricted scope would silently leak the whole org. The resolver throws instead; callers surface a clean error. Owner-portfolio legitimately means "all" and is represented by `null`.
- **Security boundary:** access enforcement is the intersection in `resolveReportScope`. `updateTemplate` does not (and need not) block a user from *saving* `scope.projects` they cannot access — inaccessible ids are dropped at generation, and an all-inaccessible selection throws. (Validation only checks id *format*.)
- **`compare` mode here** only resolves + scopes the project set; the side-by-side comparison blocks/rendering are Phase 2.
- **No `req.accessibleProjectIds` changes** — `generateTemplateInstance` (controller) already passes it; the resolver now consumes it correctly.

## Self-Review (done while writing)

- **Spec coverage:** Covers spec §7 (project scoping, access-bounded, provenance) and the `scope.mode` part of §5. The `compare` *rendering* and metric library are explicitly deferred to Phase 2 (spec §6) — noted, not a gap.
- **Placeholder scan:** none — every step has real code + exact run commands.
- **Type consistency:** `resolveReportScope` returns `{ mode, projectIds }` everywhere; `generateInstance` destructures the same names; instance provenance stores `{ mode, projectIds }`; `SCOPE_MODES` order `['portfolio','project','compare']` is consistent across model, validation, and tests.
