# Leads Refactor — Phase 8 (backend): Hybrid Global Search Endpoint — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add a fast, org-scoped, role-aware global search endpoint (`GET /api/search?q=`) that returns typed, grouped results across leads, projects, units, and people — so the platform search bar can resolve a lead name / phone / email / status / source / priority (and projects/units/people) in one call. The "Ask AI" fallback (routing to the existing copilot) is wired on the frontend in the search-bar phase; this phase delivers the fast path.

**Architecture:** A pure helpers module (`utils/searchHelpers.js`: regex escaping + enum keyword matching) is unit-tested DB-free. A thin `searchController.globalSearch` runs four scoped queries in parallel and shapes uniform result objects (`{type, id, label, sublabel, url}`). Regex search is fine at current scale (hundreds–thousands of docs); a text index / Atlas Search is the future upgrade and is noted, not built.

**Tech Stack:** Node ESM, Express, Mongoose, Jest.

**Scoping/permissions:** `protect` + organization filter on every query; Sales Executives are narrowed to their own assigned leads (mirrors the leads list). Per-entity permission granularity is a deliberate future refinement (noted).

---

## File Structure

**Create:**
- `utils/searchHelpers.js` — `escapeRegex(str)`, `matchEnum(q, values)` (pure).
- `controllers/searchController.js` — `globalSearch`.
- `routes/searchRoutes.js` — `GET /`.
- `tests/unit/searchHelpers.test.js`.

**Modify:**
- `server.js` — import + mount `app.use('/api/search', searchRoutes)`.

---

## Task 1: Search helpers (pure)

**Files:** Create `utils/searchHelpers.js`; Test `tests/unit/searchHelpers.test.js`

- [ ] **Step 1: Write the failing test**

```js
// tests/unit/searchHelpers.test.js
import { escapeRegex, matchEnum } from '../../utils/searchHelpers.js';

const STATUSES = ['New', 'Qualified', 'Site Visit Completed', 'Negotiating', 'Booked', 'Lost', 'Revived'];
const PRIORITIES = ['High', 'Medium', 'Low', 'Very Low'];

describe('search helpers', () => {
  it('escapeRegex neutralises regex metacharacters', () => {
    expect(escapeRegex('a.b*c')).toBe('a\\.b\\*c');
    expect(escapeRegex('John (VIP)')).toBe('John \\(VIP\\)');
    expect(escapeRegex('plain')).toBe('plain');
  });
  it('matchEnum finds a case-insensitive exact or substring match', () => {
    expect(matchEnum('new', STATUSES)).toBe('New');
    expect(matchEnum('QUALIFIED', STATUSES)).toBe('Qualified');
    expect(matchEnum('negoti', STATUSES)).toBe('Negotiating');
    expect(matchEnum('high', PRIORITIES)).toBe('High');
  });
  it('matchEnum returns undefined when nothing matches or input is blank', () => {
    expect(matchEnum('zzz', STATUSES)).toBeUndefined();
    expect(matchEnum('', STATUSES)).toBeUndefined();
    expect(matchEnum('   ', STATUSES)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — `npm run test:unit -- searchHelpers` → FAIL (module not found).

- [ ] **Step 3: Implement**

```js
// File: utils/searchHelpers.js
// Pure helpers for the global search endpoint (2026-06 Leads refactor).

/** Escape a user string so it is safe to use inside a `new RegExp(...)`. */
export function escapeRegex(str) {
  return String(str == null ? '' : str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * If `q` case-insensitively equals or is a substring of one of `values`
 * (or vice-versa), return that value; else undefined. Used to let the search
 * match a lead by a status / source / priority keyword (e.g. "qual" → Qualified).
 */
export function matchEnum(q, values) {
  const ql = String(q == null ? '' : q).trim().toLowerCase();
  if (!ql) return undefined;
  return values.find((v) => {
    const vl = v.toLowerCase();
    return vl === ql || vl.includes(ql) || ql.includes(vl);
  });
}
```

- [ ] **Step 4: Run test to verify it passes** — `npm run test:unit -- searchHelpers` → PASS.

- [ ] **Step 5: Commit**

```bash
git add utils/searchHelpers.js tests/unit/searchHelpers.test.js
git commit -m "feat(search): pure regex-escape + enum-match helpers

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Search controller + route + mount

**Files:** Create `controllers/searchController.js`, `routes/searchRoutes.js`; Modify `server.js`

- [ ] **Step 1: Implement the controller**

```js
// File: controllers/searchController.js
// Fast, org-scoped, role-aware global search across leads, projects, units, people.
// Returns uniform result objects: { type, id, label, sublabel, url }.

import asyncHandler from 'express-async-handler';
import Lead from '../models/leadModel.js';
import Project from '../models/projectModel.js';
import Unit from '../models/unitModel.js';
import User from '../models/userModel.js';
import { escapeRegex, matchEnum } from '../utils/searchHelpers.js';

const LEAD_STATUSES = ['New', 'Qualified', 'Site Visit Completed', 'Negotiating', 'Booked', 'Lost', 'Revived'];
const LEAD_SOURCES = ['Channel Partner', 'Management', 'Direct', 'Referral', 'Marketing', 'Cold Calling'];
const LEAD_PRIORITIES = ['High', 'Medium', 'Low', 'Very Low'];

/**
 * @desc    Global search across the org's leads / projects / units / people.
 * @route   GET /api/search?q=&limit=
 * @access  Private (any authenticated org member; results are org-scoped)
 */
const globalSearch = asyncHandler(async (req, res) => {
  const q = String(req.query.q || '').trim();
  const limit = Math.min(parseInt(req.query.limit, 10) || 5, 20);
  const emptyResults = { leads: [], projects: [], units: [], people: [] };

  if (q.length < 2) {
    return res.json({ success: true, query: q, results: emptyResults, total: 0 });
  }

  const org = req.user.organization;
  const rx = new RegExp(escapeRegex(q), 'i');

  // Leads: name/email/phone regex, plus a status/source/priority keyword match.
  // Sales Executives only see their own assigned leads.
  const leadFilter = { organization: org };
  if (req.user.role === 'Sales Executive') leadFilter.assignedTo = req.user._id;
  const leadOr = [{ firstName: rx }, { lastName: rx }, { email: rx }, { phone: rx }];
  const matchedStatus = matchEnum(q, LEAD_STATUSES);
  if (matchedStatus) leadOr.push({ status: matchedStatus });
  const matchedSource = matchEnum(q, LEAD_SOURCES);
  if (matchedSource) leadOr.push({ source: matchedSource });
  const matchedPriority = matchEnum(q, LEAD_PRIORITIES);
  if (matchedPriority) leadOr.push({ priority: matchedPriority });
  // UI label alias: "booking" → internal status 'Booked'.
  if (/^book/i.test(q) && !matchedStatus) leadOr.push({ status: 'Booked' });
  leadFilter.$or = leadOr;

  const [leads, projects, units, people] = await Promise.all([
    Lead.find(leadFilter).sort({ score: -1 }).limit(limit)
      .select('firstName lastName phone email status priority project')
      .populate('project', 'name').lean(),
    Project.find({ organization: org, name: rx }).limit(limit)
      .select('name location status').lean(),
    Unit.find({ organization: org, unitNumber: rx }).limit(limit)
      .select('unitNumber type status project').populate('project', 'name').lean(),
    User.find({ organization: org, $or: [{ firstName: rx }, { lastName: rx }, { email: rx }] })
      .limit(limit).select('firstName lastName email role').lean(),
  ]);

  const results = {
    leads: leads.map((l) => ({
      type: 'lead',
      id: l._id,
      label: `${l.firstName} ${l.lastName || ''}`.trim(),
      sublabel: [l.status, l.priority, l.project?.name].filter(Boolean).join(' · '),
      url: `/leads/${l._id}`,
    })),
    projects: projects.map((p) => ({
      type: 'project',
      id: p._id,
      label: p.name,
      sublabel: [p.location?.city, p.status].filter(Boolean).join(' · '),
      url: `/projects/${p._id}`,
    })),
    units: units.map((u) => ({
      type: 'unit',
      id: u._id,
      label: u.unitNumber,
      sublabel: [u.type, u.status, u.project?.name].filter(Boolean).join(' · '),
      url: u.project?._id ? `/projects/${u.project._id}` : '',
    })),
    people: people.map((u) => ({
      type: 'person',
      id: u._id,
      label: `${u.firstName} ${u.lastName || ''}`.trim(),
      sublabel: [u.email, u.role].filter(Boolean).join(' · '),
      url: '',
    })),
  };

  const total = results.leads.length + results.projects.length + results.units.length + results.people.length;
  res.json({ success: true, query: q, results, total });
});

export { globalSearch };
```

- [ ] **Step 2: Implement the route**

```js
// File: routes/searchRoutes.js
// Global search across org entities. Authenticated; results are org-scoped.

import express from 'express';
import { globalSearch } from '../controllers/searchController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();
router.use(protect);

router.get('/', globalSearch);

export default router;
```

- [ ] **Step 3: Mount in `server.js`**

Add the import next to the other route imports:
```js
import searchRoutes from './routes/searchRoutes.js';
```
Add the mount near the other `/api/*` mounts (after the amenities mount added in Phase 3). Find:
```js
app.use('/api/amenities', amenityRoutes);
```
Replace with:
```js
app.use('/api/amenities', amenityRoutes);
app.use('/api/search', searchRoutes);
```

- [ ] **Step 4: Syntax + boot smoke**

```bash
node --check controllers/searchController.js && node --check routes/searchRoutes.js && node --check server.js
OPENAI_API_KEY=smoke-test node -e "import('./controllers/searchController.js').then(()=>import('./routes/searchRoutes.js')).then(()=>{console.log('OK');process.exit(0)}).catch(e=>{console.error(e);process.exit(1)})"
```
Expected: parse OK; prints `OK`.

- [ ] **Step 5: Full unit suite** — `npm run test:unit` → all green.

- [ ] **Step 6: Commit**

```bash
git add controllers/searchController.js routes/searchRoutes.js server.js
git commit -m "feat(search): GET /api/search global entity search (leads/projects/units/people)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Verification

- [ ] **Step 1: Full suite** — `npm run test:unit` → all pass (incl. `searchHelpers`).
- [ ] **Step 2: Live smoke (dev DB reachable):** a small node script that loads a real org id and exercises the same queries the controller runs — search a known lead first-name substring → returns the lead with `status · priority · project` sublabel; search a status keyword like "qualified" → returns qualified leads; search a project-name substring → returns the project. (Don't mutate data.)
- [ ] **Step 3: Optional live API smoke (running server + token):** `GET /api/search?q=<name>` → 200, grouped `results` with `total`.

## Self-Review (completed during planning)
- **Coverage (#1, fast path):** lead by name/phone/email ✓, by status/source/priority keyword ✓, projects/units/people ✓, uniform `{type,label,sublabel,url}` for the bar ✓, org-scoped + sales-exec lead scope ✓. The "Ask AI" fallback + dropping the static command-palette actions are frontend (search-bar phase). Regex (not text index) is intentional at this scale — noted as the future upgrade.
- **Placeholders:** none.
- **Consistency:** `escapeRegex`/`matchEnum` shared; status/source/priority lists match the Phase 1 enums; `Booked` internal value (UI "Booking") handled via the `^book` alias.
