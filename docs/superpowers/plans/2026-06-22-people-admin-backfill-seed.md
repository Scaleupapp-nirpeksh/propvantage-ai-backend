# People Admin: Backfill + Demo Seed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two owner-only admin operations to the People & Performance backend: (1) backfill historical performance snapshots for all active org members, and (2) seed demo-quality reflection + interaction data for demo environments.

**Architecture:** Two new service files (`backfillService.js`, `demoSeedService.js`) each with a single exported async function; two new controller actions (`runBackfill`, `seedDemo`) appended to the existing `peopleController.js`; two new `POST /admin/*` routes in `peopleRoutes.js` behind the existing `router.use(protect)` guard. Three new unit test files cover the services and controller additions.

**Tech Stack:** ESM, Express, Mongoose, Jest (`jest.unstable_mockModule` pattern), `@jest/globals`, existing `performanceSignalsService`, `moraleService`, `isoWeek` utils.

## Global Constraints

- Branch: `feat/people-followups` — commit there, never push or switch.
- ESM throughout: `import`/`export`, no `require()`.
- All new files must pass: `node --experimental-vm-modules node_modules/jest/bin/jest.js --config jest.unit.config.mjs <test file>`.
- Full regression suite (835 tests) must stay green after all commits.
- Owner guard: `isOwnerLevel(req.user)` from `services/people/hierarchyService.js` — return 403 on failure, exact pattern from `getOrg` handler.
- Response shape: `res.json({ success: true, data })` — matches all existing handlers.
- Error shape: `res.status(N); throw new Error('message')` — caught by `asyncHandler`.
- Idempotent: `buildSnapshot` already upserts on `{organization,user,period,periodStart}` unique index. Reflection create uses findOne-then-create. Interactions use count check.
- No real AI/DB calls in tests — mock everything.
- DRY/YAGNI: reuse existing services, never reimplement metric/snapshot/sentiment logic.
- Co-author trailer on every commit: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `services/people/backfillService.js` | `backfillSnapshots(orgId, {weeks})` — iterates active members, calls `buildSnapshot` for past weeks/months/today |
| Create | `services/people/demoSeedService.js` | `seedDemoPeopleData(orgId, {weeks})` — creates reflections + interactions + triggers morale |
| Modify | `controllers/peopleController.js` | Add `runBackfill` and `seedDemo` handlers at bottom |
| Modify | `routes/peopleRoutes.js` | Add `POST /admin/backfill` and `POST /admin/seed-demo` under an `// ─── ADMIN ───` comment |
| Create | `tests/unit/backfillService.test.js` | Unit tests for backfillService |
| Create | `tests/unit/demoSeedService.test.js` | Unit tests for demoSeedService |
| Modify | `tests/unit/peopleController.test.js` | Add tests for `runBackfill` and `seedDemo` handlers |

---

## Task 1: backfillService + tests (TDD)

**Files:**
- Create: `tests/unit/backfillService.test.js`
- Create: `services/people/backfillService.js`

**Interfaces:**
- Consumes: `buildSnapshot(orgId, user, period, periodStart)` from `services/people/performanceSignalsService.js`; `resolveWindow(period, anchor)` from same; `isoWeekOf`, `weekStartOf`, `boundsFromIsoWeek`, `previousIsoWeek` from `utils/isoWeek.js`; `User.find({...})` from `models/userModel.js`
- Produces: `async backfillSnapshots(orgId, { weeks = 8 } = {}) -> { built: number, users: number }`

- [ ] **Step 1: Write the failing test file**

Create `tests/unit/backfillService.test.js`:

```javascript
// tests/unit/backfillService.test.js
// Unit tests for services/people/backfillService.js
// Mocks: User model, performanceSignalsService, isoWeek utils — no DB/network.

import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import mongoose from 'mongoose';

// =============================================================================
// IDs
// =============================================================================
const ORG     = new mongoose.Types.ObjectId();
const USER_1  = new mongoose.Types.ObjectId();
const USER_2  = new mongoose.Types.ObjectId();

const ACTIVE_USERS = [
  { _id: USER_1, organization: ORG, role: 'Sales Executive' },
  { _id: USER_2, organization: ORG, role: 'Sales Head' },
];

// =============================================================================
// MOCKS — registered BEFORE any import of the SUT
// =============================================================================

// User model
const mockUserFind = jest.fn();
jest.unstable_mockModule('../../models/userModel.js', () => ({
  default: { find: mockUserFind },
}));

// performanceSignalsService
const mockBuildSnapshot = jest.fn();
const mockResolveWindow = jest.fn();
jest.unstable_mockModule('../../services/people/performanceSignalsService.js', () => ({
  buildSnapshot:   mockBuildSnapshot,
  resolveWindow:   mockResolveWindow,
  computeMetrics:  jest.fn(),
  teamMedians:     jest.fn(),
  METRIC_KEYS:     [],
}));

// isoWeek utils — deterministic stubs
const CURRENT_ISO_WEEK = '2026-W25';
const mockIsoWeekOf      = jest.fn(() => CURRENT_ISO_WEEK);
const mockWeekStartOf    = jest.fn(() => new Date('2026-06-16T00:00:00Z'));
const mockBoundsFromIsoWeek = jest.fn((isoWeek) => ({
  weekStart: new Date('2026-06-16T00:00:00Z'),
  weekEnd:   new Date('2026-06-22T23:59:59.999Z'),
}));
const mockPreviousIsoWeek = jest.fn((isoWeek) => {
  // Return a predictable prior week for testing
  const [year, wNum] = isoWeek.split('-W');
  const prev = parseInt(wNum, 10) - 1;
  return `${year}-W${String(prev).padStart(2, '0')}`;
});

jest.unstable_mockModule('../../utils/isoWeek.js', () => ({
  isoWeekOf:         mockIsoWeekOf,
  weekStartOf:       mockWeekStartOf,
  weekEndOf:         jest.fn(() => new Date('2026-06-22T23:59:59.999Z')),
  boundsFromIsoWeek: mockBoundsFromIsoWeek,
  previousIsoWeek:   mockPreviousIsoWeek,
}));

// =============================================================================
// IMPORT SUT (after mocks)
// =============================================================================
const { backfillSnapshots } = await import('../../services/people/backfillService.js');

// =============================================================================
// SETUP
// =============================================================================
beforeEach(() => {
  jest.clearAllMocks();
  // User.find(...).lean() chain
  mockUserFind.mockReturnValue({ lean: jest.fn().mockResolvedValue(ACTIVE_USERS) });
  mockBuildSnapshot.mockResolvedValue({ _id: new mongoose.Types.ObjectId() });
  mockResolveWindow.mockImplementation((period, anchor) => ({
    periodStart: new Date('2026-06-01T00:00:00Z'),
    periodEnd:   new Date('2026-07-01T00:00:00Z'),
  }));
  mockIsoWeekOf.mockReturnValue(CURRENT_ISO_WEEK);
  mockWeekStartOf.mockReturnValue(new Date('2026-06-16T00:00:00Z'));
  mockBoundsFromIsoWeek.mockImplementation((isoWeek) => ({
    weekStart: new Date('2026-06-16T00:00:00Z'),
    weekEnd:   new Date('2026-06-22T23:59:59.999Z'),
  }));
  mockPreviousIsoWeek.mockImplementation((isoWeek) => {
    const [year, wNum] = isoWeek.split('-W');
    const prev = parseInt(wNum, 10) - 1;
    return `${year}-W${String(prev).padStart(2, '0')}`;
  });
});

// =============================================================================
// TESTS
// =============================================================================

describe('backfillSnapshots', () => {
  test('queries only active accepted members of the given org', async () => {
    await backfillSnapshots(ORG, { weeks: 2 });
    expect(mockUserFind).toHaveBeenCalledWith({
      organization:     ORG,
      isActive:         true,
      invitationStatus: 'accepted',
    });
  });

  test('returns { built, users } with correct users count', async () => {
    const result = await backfillSnapshots(ORG, { weeks: 2 });
    expect(result).toHaveProperty('built');
    expect(result).toHaveProperty('users');
    expect(result.users).toBe(ACTIVE_USERS.length); // 2 users
  });

  test('builds the expected snapshot count per user: weeks + 3 months + current day/week/month', async () => {
    const weeks = 4;
    // Expected per user:
    //   - 4 weekly snapshots (past weeks)
    //   - 3 monthly snapshots
    //   - 1 current day snapshot
    //   - 1 current week snapshot
    //   - 1 current month snapshot
    // Total per user = weeks + 3 + 3 = 10
    const expectedPerUser = weeks + 3 + 3;
    const result = await backfillSnapshots(ORG, { weeks });
    expect(result.built).toBe(expectedPerUser * ACTIVE_USERS.length);
  });

  test('defaults to 8 weeks when no options provided', async () => {
    const result = await backfillSnapshots(ORG);
    const expectedPerUser = 8 + 3 + 3;
    expect(result.built).toBe(expectedPerUser * ACTIVE_USERS.length);
  });

  test('calls buildSnapshot with period="week" for each prior week anchor', async () => {
    await backfillSnapshots(ORG, { weeks: 2 });
    const weekCalls = mockBuildSnapshot.mock.calls.filter(([,, period]) => period === 'week');
    // 2 past weekly snapshots per user + 1 current week per user = 3 week calls per user
    expect(weekCalls.length).toBe(3 * ACTIVE_USERS.length);
  });

  test('calls buildSnapshot with period="month" for 3 prior months + current month', async () => {
    await backfillSnapshots(ORG, { weeks: 2 });
    const monthCalls = mockBuildSnapshot.mock.calls.filter(([,, period]) => period === 'month');
    // 3 past months + 1 current month = 4 month calls per user
    expect(monthCalls.length).toBe(4 * ACTIVE_USERS.length);
  });

  test('calls buildSnapshot with period="day" for current day only', async () => {
    await backfillSnapshots(ORG, { weeks: 2 });
    const dayCalls = mockBuildSnapshot.mock.calls.filter(([,, period]) => period === 'day');
    // 1 current day per user
    expect(dayCalls.length).toBe(1 * ACTIVE_USERS.length);
  });

  test('passes orgId as first arg to every buildSnapshot call', async () => {
    await backfillSnapshots(ORG, { weeks: 1 });
    for (const [callOrgId] of mockBuildSnapshot.mock.calls) {
      expect(callOrgId.toString()).toBe(ORG.toString());
    }
  });

  test('works when org has no active members — returns built=0, users=0', async () => {
    mockUserFind.mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });
    const result = await backfillSnapshots(ORG, { weeks: 4 });
    expect(result).toEqual({ built: 0, users: 0 });
    expect(mockBuildSnapshot).not.toHaveBeenCalled();
  });

  test('is idempotent — re-running calls buildSnapshot again (upsert is inside buildSnapshot)', async () => {
    await backfillSnapshots(ORG, { weeks: 1 });
    const firstCount = mockBuildSnapshot.mock.calls.length;
    jest.clearAllMocks();
    mockUserFind.mockReturnValue({ lean: jest.fn().mockResolvedValue(ACTIVE_USERS) });
    mockBuildSnapshot.mockResolvedValue({ _id: new mongoose.Types.ObjectId() });
    await backfillSnapshots(ORG, { weeks: 1 });
    expect(mockBuildSnapshot.mock.calls.length).toBe(firstCount);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails (service not yet created)**

```bash
cd "/Users/nirpekshnandan/My Products/propvantage-ai-backend" && \
  node --experimental-vm-modules node_modules/jest/bin/jest.js \
    --config jest.unit.config.mjs \
    tests/unit/backfillService.test.js \
    2>&1 | tail -20
```

Expected: FAIL — `Cannot find module '../../services/people/backfillService.js'`

- [ ] **Step 3: Write the minimal implementation**

Create `services/people/backfillService.js`:

```javascript
// File: services/people/backfillService.js
// Description: Owner-only admin operation to backfill historical performance
//   snapshots for all active org members.
//
//   backfillSnapshots(orgId, { weeks = 8 }) -> { built, users }
//
//   For each active accepted member:
//     - weekly snapshot for each of the last `weeks` ISO weeks
//     - monthly snapshot for each of the last 3 months
//     - current day, week, and month snapshots
//
//   buildSnapshot already upserts on {organization,user,period,periodStart}
//   so this function is safe to re-run (idempotent).

import User from '../../models/userModel.js';
import { buildSnapshot, resolveWindow } from './performanceSignalsService.js';
import {
  isoWeekOf,
  weekStartOf,
  previousIsoWeek,
  boundsFromIsoWeek,
} from '../../utils/isoWeek.js';

/**
 * Backfill performance snapshots for all active members in an org.
 *
 * @param {import('mongoose').Types.ObjectId|string} orgId
 * @param {{ weeks?: number }} [options]
 * @returns {Promise<{ built: number, users: number }>}
 */
export async function backfillSnapshots(orgId, { weeks = 8 } = {}) {
  const members = await User.find({
    organization:     orgId,
    isActive:         true,
    invitationStatus: 'accepted',
  }).lean();

  if (members.length === 0) {
    return { built: 0, users: 0 };
  }

  const now = new Date();
  let built = 0;

  // Compute period anchors once (same for all users)
  // ── Past weekly anchors (Mondays of each prior ISO week) ──────────────
  const weeklyAnchors = [];
  let isoWeek = isoWeekOf(now);
  for (let i = 0; i < weeks; i++) {
    isoWeek = previousIsoWeek(isoWeek);
    const { weekStart } = boundsFromIsoWeek(isoWeek);
    weeklyAnchors.push(weekStart);
  }

  // ── Past monthly anchors (1st of each of the last 3 calendar months) ──
  const monthlyAnchors = [];
  for (let i = 1; i <= 3; i++) {
    const anchor = new Date(now);
    anchor.setUTCMonth(anchor.getUTCMonth() - i);
    const { periodStart } = resolveWindow('month', anchor);
    monthlyAnchors.push(periodStart);
  }

  // ── Current-period anchors ────────────────────────────────────────────
  const { periodStart: currentDayStart }   = resolveWindow('day',   now);
  const currentWeekStart                   = weekStartOf(now);
  const { periodStart: currentMonthStart } = resolveWindow('month', now);

  // ── Per-user snapshot loop ────────────────────────────────────────────
  for (const user of members) {
    // Prior weekly snapshots
    for (const anchor of weeklyAnchors) {
      await buildSnapshot(orgId, user, 'week', anchor);
      built++;
    }

    // Prior monthly snapshots
    for (const anchor of monthlyAnchors) {
      await buildSnapshot(orgId, user, 'month', anchor);
      built++;
    }

    // Current day
    await buildSnapshot(orgId, user, 'day',   currentDayStart);
    built++;

    // Current week
    await buildSnapshot(orgId, user, 'week',  currentWeekStart);
    built++;

    // Current month
    await buildSnapshot(orgId, user, 'month', currentMonthStart);
    built++;
  }

  return { built, users: members.length };
}
```

- [ ] **Step 4: Run the tests and verify they pass**

```bash
cd "/Users/nirpekshnandan/My Products/propvantage-ai-backend" && \
  node --experimental-vm-modules node_modules/jest/bin/jest.js \
    --config jest.unit.config.mjs \
    tests/unit/backfillService.test.js \
    2>&1 | tail -30
```

Expected: All tests PASS (green). Note: the test expects `weeks + 3 + 3` per user. With `weeks=4`, that is `4 + 3 + 3 = 10` per user. With 2 users, `built = 20`. Verify the logic: past-weeks count = `weeks`, past-months = 3, current periods = 3 (day + week + month). Total = `weeks + 6`. Update the test comment if needed but ensure the assertion matches the implementation.

**Important reconciliation:** The test says `expectedPerUser = weeks + 3 + 3` = `weeks + 6`. The implementation builds: `weeks` weekly anchors + `3` monthly anchors + `1` day + `1` week + `1` month = `weeks + 3 + 3 = weeks + 6`. These match.

- [ ] **Step 5: Commit**

```bash
cd "/Users/nirpekshnandan/My Products/propvantage-ai-backend" && \
  git add services/people/backfillService.js tests/unit/backfillService.test.js && \
  git commit -m "$(cat <<'EOF'
feat(people): add backfillSnapshots service with unit tests

Builds historical performance snapshots (weekly x N + monthly x 3 +
current day/week/month) for all active org members. Delegates to the
existing buildSnapshot upsert so re-runs are idempotent.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: demoSeedService + tests (TDD)

**Files:**
- Create: `tests/unit/demoSeedService.test.js`
- Create: `services/people/demoSeedService.js`

**Interfaces:**
- Consumes: `User.find`, `WeeklyReflection.findOne`, `WeeklyReflection.create`, `Interaction.countDocuments`, `Interaction.create`, `Lead.findOne`, `moraleService.analyzeReflection`, `moraleService.buildTeamMorale`, `moraleService.buildOrgMorale`, `isoWeekOf`, `previousIsoWeek`, `boundsFromIsoWeek`, `User` (for HEAD_ROLES lookup via `hierarchyService.isOwnerLevel`)
- Produces: `async seedDemoPeopleData(orgId, { weeks = 4 } = {}) -> { reflections: number, interactions: number, morale: number }`

- [ ] **Step 1: Write the failing test file**

Create `tests/unit/demoSeedService.test.js`:

```javascript
// tests/unit/demoSeedService.test.js
// Unit tests for services/people/demoSeedService.js
// Mocks: User, WeeklyReflection, Interaction, Lead models + moraleService + isoWeek

import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import mongoose from 'mongoose';

// =============================================================================
// IDs & FIXTURES
// =============================================================================
const ORG     = new mongoose.Types.ObjectId();
const USER_1  = new mongoose.Types.ObjectId();
const USER_2  = new mongoose.Types.ObjectId();
const LEAD_ID = new mongoose.Types.ObjectId();

const ACTIVE_USERS = [
  { _id: USER_1, organization: ORG, role: 'Sales Executive', firstName: 'Alice', lastName: 'Patel' },
  { _id: USER_2, organization: ORG, role: 'Sales Head',      firstName: 'Bob',   lastName: 'Shah'  },
];

// =============================================================================
// MOCKS — must be registered BEFORE import of SUT
// =============================================================================

// User model
const mockUserFind = jest.fn();
jest.unstable_mockModule('../../models/userModel.js', () => ({
  default: { find: mockUserFind },
}));

// WeeklyReflection model
const mockReflectionFindOne = jest.fn();
const mockReflectionCreate  = jest.fn();
jest.unstable_mockModule('../../models/weeklyReflectionModel.js', () => ({
  default: {
    findOne: mockReflectionFindOne,
    create:  mockReflectionCreate,
  },
  REQUIRED_ANSWER_FIELDS: ['wins', 'areasToImprove', 'dislikes', 'achievements', 'plansNextWeek'],
  MIN_ANSWER_LENGTH: 500,
}));

// Interaction model
const mockInteractionCountDocuments = jest.fn();
const mockInteractionCreate         = jest.fn();
jest.unstable_mockModule('../../models/interactionModel.js', () => ({
  default: {
    countDocuments: mockInteractionCountDocuments,
    create:         mockInteractionCreate,
  },
}));

// Lead model — findOne to look up an assigned lead
const mockLeadFindOne = jest.fn();
jest.unstable_mockModule('../../models/leadModel.js', () => ({
  default: { findOne: mockLeadFindOne },
}));

// moraleService — best-effort; never throws
const mockAnalyzeReflection = jest.fn();
const mockBuildTeamMorale   = jest.fn();
const mockBuildOrgMorale    = jest.fn();
jest.unstable_mockModule('../../services/people/moraleService.js', () => ({
  analyzeReflection: mockAnalyzeReflection,
  buildTeamMorale:   mockBuildTeamMorale,
  buildOrgMorale:    mockBuildOrgMorale,
}));

// hierarchyService — needed for HEAD_ROLES check
const mockIsOwnerLevel = jest.fn((user) => user.role === 'Business Head');
jest.unstable_mockModule('../../services/people/hierarchyService.js', () => ({
  isOwnerLevel:        mockIsOwnerLevel,
  getSubtree:          jest.fn(),
  getTeam:             jest.fn(),
  DEPARTMENT_BY_ROLE:  {},
  HEAD_ROLE_BY_DEPARTMENT: {},
  HEAD_ROLES: new Set(['Sales Head', 'Finance Head', 'Legal Head', 'CRM Head', 'Marketing Head', 'Project Director']),
}));

// isoWeek utils — deterministic
const CURRENT_ISO_WEEK = '2026-W25';
const mockIsoWeekOf       = jest.fn(() => CURRENT_ISO_WEEK);
const mockPreviousIsoWeek = jest.fn((isoWeek) => {
  const [year, wNum] = isoWeek.split('-W');
  const prev = parseInt(wNum, 10) - 1;
  return `${year}-W${String(prev).padStart(2, '0')}`;
});
const mockBoundsFromIsoWeek = jest.fn(() => ({
  weekStart: new Date('2026-06-16T00:00:00Z'),
  weekEnd:   new Date('2026-06-22T23:59:59.999Z'),
}));

jest.unstable_mockModule('../../utils/isoWeek.js', () => ({
  isoWeekOf:         mockIsoWeekOf,
  weekStartOf:       jest.fn(() => new Date('2026-06-16T00:00:00Z')),
  weekEndOf:         jest.fn(() => new Date('2026-06-22T23:59:59.999Z')),
  boundsFromIsoWeek: mockBoundsFromIsoWeek,
  previousIsoWeek:   mockPreviousIsoWeek,
}));

// =============================================================================
// IMPORT SUT (after mocks)
// =============================================================================
const { seedDemoPeopleData } = await import('../../services/people/demoSeedService.js');

// =============================================================================
// HELPERS
// =============================================================================
const makeReflectionDoc = (userId, isoWeek) => ({
  _id: new mongoose.Types.ObjectId(),
  organization: ORG,
  user: userId,
  isoWeek,
  status: 'submitted',
});

// =============================================================================
// SETUP
// =============================================================================
beforeEach(() => {
  jest.clearAllMocks();

  mockUserFind.mockReturnValue({ lean: jest.fn().mockResolvedValue(ACTIVE_USERS) });

  // Default: no existing reflections → always create
  mockReflectionFindOne.mockResolvedValue(null);
  mockReflectionCreate.mockImplementation(async (doc) => makeReflectionDoc(doc.user, doc.isoWeek));

  // Default: no recent interactions → always create
  mockInteractionCountDocuments.mockResolvedValue(0);
  mockInteractionCreate.mockResolvedValue({ _id: new mongoose.Types.ObjectId() });

  // Lead exists for all users by default
  mockLeadFindOne.mockResolvedValue({ _id: LEAD_ID });

  // Morale calls succeed
  mockAnalyzeReflection.mockResolvedValue({ score: 0.5, label: 'positive', themes: [], riskSignals: [] });
  mockBuildTeamMorale.mockResolvedValue({ _id: new mongoose.Types.ObjectId() });
  mockBuildOrgMorale.mockResolvedValue({ _id: new mongoose.Types.ObjectId() });
});

// =============================================================================
// TESTS
// =============================================================================

describe('seedDemoPeopleData', () => {
  test('returns { reflections, interactions, morale } shape', async () => {
    const result = await seedDemoPeopleData(ORG, { weeks: 2 });
    expect(result).toHaveProperty('reflections');
    expect(result).toHaveProperty('interactions');
    expect(result).toHaveProperty('morale');
  });

  test('queries only active accepted members', async () => {
    await seedDemoPeopleData(ORG, { weeks: 1 });
    expect(mockUserFind).toHaveBeenCalledWith({
      organization:     ORG,
      isActive:         true,
      invitationStatus: 'accepted',
    });
  });

  test('creates one reflection per user per week when none exist', async () => {
    const weeks = 3;
    const result = await seedDemoPeopleData(ORG, { weeks });
    // weeks reflections × 2 users
    expect(mockReflectionCreate).toHaveBeenCalledTimes(weeks * ACTIVE_USERS.length);
    expect(result.reflections).toBe(weeks * ACTIVE_USERS.length);
  });

  test('SKIPS creation when reflection already exists for that user+week (idempotency)', async () => {
    // Only USER_1's reflections already exist; USER_2's do not
    mockReflectionFindOne.mockImplementation(async ({ user }) => {
      if (user.toString() === USER_1.toString()) return makeReflectionDoc(user, '2026-W24');
      return null;
    });

    const result = await seedDemoPeopleData(ORG, { weeks: 2 });
    // USER_1: 0 created (both weeks exist); USER_2: 2 created
    expect(result.reflections).toBe(2);
  });

  test('calls analyzeReflection on each newly created reflection (best-effort)', async () => {
    await seedDemoPeopleData(ORG, { weeks: 2 });
    // 2 weeks × 2 users = 4 reflections created
    expect(mockAnalyzeReflection).toHaveBeenCalledTimes(2 * ACTIVE_USERS.length);
  });

  test('does NOT call analyzeReflection for reflections that already existed (skipped)', async () => {
    mockReflectionFindOne.mockResolvedValue(makeReflectionDoc(USER_1, '2026-W24'));
    await seedDemoPeopleData(ORG, { weeks: 2 });
    // All reflections already exist → nothing created → no analyze calls
    expect(mockAnalyzeReflection).not.toHaveBeenCalled();
  });

  test('analyzeReflection failure does not abort the seed (best-effort)', async () => {
    mockAnalyzeReflection.mockRejectedValue(new Error('AI key missing'));
    // Should still complete without throwing
    await expect(seedDemoPeopleData(ORG, { weeks: 1 })).resolves.not.toThrow();
  });

  test('creates interactions for users who have a lead assigned and low recent count', async () => {
    mockInteractionCountDocuments.mockResolvedValue(0); // below threshold
    mockLeadFindOne.mockResolvedValue({ _id: LEAD_ID });
    const result = await seedDemoPeopleData(ORG, { weeks: 2 });
    expect(mockInteractionCreate).toHaveBeenCalled();
    expect(result.interactions).toBeGreaterThan(0);
  });

  test('SKIPS interactions when user already has >= 3 recent interactions (idempotency)', async () => {
    mockInteractionCountDocuments.mockResolvedValue(3); // at threshold → skip
    const result = await seedDemoPeopleData(ORG, { weeks: 2 });
    expect(mockInteractionCreate).not.toHaveBeenCalled();
    expect(result.interactions).toBe(0);
  });

  test('SKIPS interactions when user has no assigned lead', async () => {
    mockLeadFindOne.mockResolvedValue(null); // no lead
    const result = await seedDemoPeopleData(ORG, { weeks: 2 });
    expect(mockInteractionCreate).not.toHaveBeenCalled();
    expect(result.interactions).toBe(0);
  });

  test('calls buildOrgMorale after reflections are seeded', async () => {
    await seedDemoPeopleData(ORG, { weeks: 1 });
    expect(mockBuildOrgMorale).toHaveBeenCalledWith(ORG, expect.any(String));
  });

  test('buildTeamMorale / buildOrgMorale failure does not abort seed (best-effort)', async () => {
    mockBuildTeamMorale.mockRejectedValue(new Error('AI error'));
    mockBuildOrgMorale.mockRejectedValue(new Error('AI error'));
    await expect(seedDemoPeopleData(ORG, { weeks: 1 })).resolves.not.toThrow();
  });

  test('works when org has no active members', async () => {
    mockUserFind.mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });
    const result = await seedDemoPeopleData(ORG, { weeks: 4 });
    expect(result).toEqual({ reflections: 0, interactions: 0, morale: 0 });
  });

  test('each created reflection has status=submitted and submittedAt set', async () => {
    await seedDemoPeopleData(ORG, { weeks: 1 });
    const firstCall = mockReflectionCreate.mock.calls[0][0];
    expect(firstCall.status).toBe('submitted');
    expect(firstCall.submittedAt).toBeInstanceOf(Date);
  });

  test('each created reflection has all five required answer fields with >= 500 chars', async () => {
    await seedDemoPeopleData(ORG, { weeks: 1 });
    for (const [doc] of mockReflectionCreate.mock.calls) {
      for (const field of ['wins', 'areasToImprove', 'dislikes', 'achievements', 'plansNextWeek']) {
        expect(typeof doc.answers[field]).toBe('string');
        expect(doc.answers[field].length).toBeGreaterThanOrEqual(500);
      }
    }
  });

  test('reflection answers vary across members (not all identical)', async () => {
    // seed 2 users × 2 weeks = 4 reflections; wins text should not all be the same
    await seedDemoPeopleData(ORG, { weeks: 2 });
    const winsValues = mockReflectionCreate.mock.calls.map(([doc]) => doc.answers.wins);
    const unique = new Set(winsValues);
    expect(unique.size).toBeGreaterThan(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd "/Users/nirpekshnandan/My Products/propvantage-ai-backend" && \
  node --experimental-vm-modules node_modules/jest/bin/jest.js \
    --config jest.unit.config.mjs \
    tests/unit/demoSeedService.test.js \
    2>&1 | tail -20
```

Expected: FAIL — `Cannot find module '../../services/people/demoSeedService.js'`

- [ ] **Step 3: Write the minimal implementation**

Create `services/people/demoSeedService.js`:

```javascript
// File: services/people/demoSeedService.js
// Description: Owner-only demo-data seeder for the People & Performance module.
//   Creates realistic WeeklyReflections and Interactions for active org members
//   so demo environments have rich sentiment and morale data to display.
//
//   seedDemoPeopleData(orgId, { weeks = 4 }) -> { reflections, interactions, morale }
//
//   Idempotent: reflections are skipped if they already exist for that user+week;
//   interactions are skipped if the member already has >= 3 in the last 7 days.
//   All AI calls (analyzeReflection, buildTeamMorale, buildOrgMorale) are best-effort
//   (errors are swallowed so a missing API key does not abort the seed).

import User             from '../../models/userModel.js';
import WeeklyReflection from '../../models/weeklyReflectionModel.js';
import Interaction      from '../../models/interactionModel.js';
import Lead             from '../../models/leadModel.js';
import {
  analyzeReflection,
  buildTeamMorale,
  buildOrgMorale,
} from './moraleService.js';
import { isoWeekOf, previousIsoWeek, boundsFromIsoWeek } from '../../utils/isoWeek.js';

// ─── COPY VARIANTS ───────────────────────────────────────────────────────────
// Three tone buckets to ensure sentiment variety across members and weeks.
// Each bucket provides five answer fields (≥500 chars each).

const TONE_UPBEAT = {
  wins: `This week was genuinely energising. I closed three deals with buyers who had been on the fence for months, and the personalised follow-up sequence I ran made a clear difference. The rapport I have built with channel partners is paying dividends — two of them referred clients to me unprompted. I also completed the CRM refresh on all my active leads, which gives me a much cleaner picture of the pipeline. The team energy has been high, and I feel like momentum is on our side heading into the next quarter.`,
  areasToImprove: `I want to tighten the gap between initial enquiry and first site visit. Some leads waited longer than they should have because I was juggling too many tasks at once. I would also benefit from improving my product knowledge on the commercial inventory — a couple of questions from buyers caught me off-guard this week. Blocking focused deep-work time in my calendar and reducing ad-hoc interruptions would help me maintain quality across a larger portfolio without dropping the ball on any single lead.`,
  dislikes: `The manual data-entry burden between calls and the CRM is a real friction point. I end up spending 20-30 minutes every evening just logging call notes, which feels like time stolen from actual client engagement. The approval workflow for booking amendments is also slower than it needs to be — three rounds of emails for what should be a one-click process is demoralising when a client is waiting. Standardising approval SLAs and investing in voice-to-text logging would go a long way.`,
  achievements: `Exceeded my monthly sales target by 15% and secured two referral introductions that are already progressing into qualified opportunities. I conducted a group site tour for six prospects simultaneously, which was efficient and generated positive word-of-mouth. I also mentored a junior team member on objection-handling techniques and watched them close their first independent deal, which was genuinely satisfying. The client satisfaction survey scores I received this week were the highest in the team.`,
  plansNextWeek: `I plan to schedule follow-up calls with eight warm leads from the last quarter who went quiet, using a new angle around the revised payment plan options. I will also prepare a comparative analysis of three projects for a high-intent buyer who is torn between options. Internally, I want to co-facilitate a short product knowledge session with the project team so the whole sales department feels more confident on technical questions. Finally, I will aim to reduce my average response time to inbound enquiries from four hours to under two.`,
};

const TONE_STRESSED = {
  wins: `Despite a challenging week, I managed to keep all active client conversations moving forward. I responded to every inbound enquiry within the same business day, even when the volume was unusually high. I coordinated with the legal team to unblock a documentation issue that had been holding up a booking, and the client was genuinely grateful for the persistence. I also updated all overdue CRM records, which had been accumulating for a couple of weeks because of the workload. Small wins, but they matter when the week has been this demanding.`,
  areasToImprove: `I need to find a more sustainable way to manage the workload spikes. This week I ended up skipping lunch three days running and working late most evenings, which is not a pattern I can maintain. Some of the pressure comes from unclear prioritisation signals from above — when everything is marked urgent, nothing really is. I want to have a direct conversation with my manager about setting realistic expectations and creating a buffer for unexpected tasks so that routine commitments do not fall through the cracks when volume increases.`,
  dislikes: `I am genuinely frustrated by the inconsistency in lead allocation. Some team members seem to receive a disproportionate share of warm inbound leads while others, including me, are working almost entirely cold. The criteria for allocation are opaque, and the informal explanations I have received are not satisfying. I also found this week that a key piece of process documentation was out of date, which caused me to give a client incorrect information — that situation should not be possible if our knowledge base were properly maintained and reviewed regularly.`,
  achievements: `I managed to revive a deal that had stalled for six weeks by identifying a financing option the client had not considered. The deal is now very close to signing. I also delivered a product presentation to a group of corporate buyers on two days' notice, and the feedback was strong. On top of core work, I submitted the quarterly pipeline review on time and identified three leads that are unlikely to convert, freeing up capacity for higher-probability opportunities. Doing all of this during an unusually disruptive week makes these achievements feel meaningful.`,
  plansNextWeek: `My priority next week is to close the revived deal and ensure the booking documentation is completed without delays. I also need to reconnect with five mid-pipeline leads that I was unable to reach this week due to the time pressure. I will prepare a structured weekly plan on Monday morning to reduce context-switching and protect time for deep work. I also intend to speak with my manager about the workload and lead allocation concerns — I want to approach it constructively and with specific suggestions rather than just raising the problem.`,
};

const TONE_NEUTRAL = {
  wins: `The week progressed at a steady pace. I completed all scheduled client calls and follow-ups without any slippage. The pipeline review meeting with the team was productive and gave me a clearer view of where bottlenecks are forming. I updated the project specification documents for two leads who had requested additional information, and both acknowledged receipt and confirmed they are still actively evaluating. The administrative backlog from the previous week has been cleared, which sets me up better for the coming week.`,
  areasToImprove: `I want to spend more time on proactive outreach rather than reacting to incoming requests. My ratio of inbound-to-outbound activity has been skewing too far toward inbound this month, which limits the pipeline I am building independently. I also recognise that my follow-up notes in the CRM are sometimes too brief to be useful as a historical record, and I need to develop the discipline of writing richer summaries immediately after each interaction before the details fade. Small process improvements compounded over time will make a noticeable difference.`,
  dislikes: `The project status updates distributed to the sales team are sometimes delayed or incomplete, which makes it harder to answer client questions accurately. A couple of times this week I had to ask the project team directly for information that should have been in the standard update. The process for requesting marketing collateral is also bureaucratic — it requires multiple approvals for what are often straightforward personalisation requests. Streamlining that workflow would help the sales team look more responsive to clients during the consideration phase.`,
  achievements: `Progressed three mid-stage leads closer to decision point by providing tailored comparisons and arranging virtual walkthroughs. Completed all mandatory compliance training modules that had been pending for a couple of weeks. Supported a colleague during their client presentation when technical issues arose by stepping in seamlessly. These contributions may not all show up as direct metrics, but they keep the team functioning smoothly. I also maintained a response time under two hours for all client communications throughout the week, which I regard as a baseline standard I should always meet.`,
  plansNextWeek: `Next week I will focus on converting two leads that have shown consistent interest but have not yet committed. I will prepare tailored objection-response guides for each and schedule a decision-focused call. I also plan to review my entire pipeline with fresh eyes and update the forecasted close dates — several are overdue for reassessment. I want to make time for at least two outbound prospecting sessions to rebuild the top of the funnel. Finally, I will catch up with a colleague to share notes on common objections we have each encountered, as cross-team knowledge sharing tends to improve our collective effectiveness.`,
};

const TONE_BUCKETS = [TONE_UPBEAT, TONE_STRESSED, TONE_NEUTRAL];

// Interaction copy pools (short, realistic content strings)
const INTERACTION_COPY = [
  { type: 'Call',    direction: 'Outbound', content: 'Follow-up call to discuss revised payment plan options and address outstanding questions on possession timeline.' },
  { type: 'Email',   direction: 'Outbound', content: 'Sent personalised comparison document highlighting the unit specifications and investment returns for the shortlisted options.' },
  { type: 'Meeting', direction: 'Inbound',  content: 'In-person site visit at project location. Client brought family. Discussed floor plan preferences and parking allocation.' },
  { type: 'Call',    direction: 'Inbound',  content: 'Client called to clarify documentation requirements for home loan application. Provided checklist and offered to coordinate with finance team.' },
  { type: 'Email',   direction: 'Outbound', content: 'Shared updated project brochure and construction progress photographs as requested during last call.' },
];

// ─── HELPERS ────────────────────────────────────────────────────────────────

/** Pick a deterministic-ish tone bucket based on user index and week offset. */
function pickTone(userIndex, weekOffset) {
  return TONE_BUCKETS[(userIndex + weekOffset) % TONE_BUCKETS.length];
}

/** Safe wrapper — swallows any error and returns null. */
async function bestEffort(fn) {
  try {
    return await fn();
  } catch {
    return null;
  }
}

// ─── HEAD ROLE SET (duplicated to avoid circular dep with hierarchyService) ──
const HEAD_ROLES = new Set([
  'Sales Head', 'Finance Head', 'Legal Head',
  'CRM Head', 'Marketing Head', 'Project Director',
]);

// ─── MAIN EXPORT ─────────────────────────────────────────────────────────────

/**
 * Seed demo People & Performance data for an org. Idempotent: reflections are
 * only created if they do not already exist for that user+week; interactions are
 * only added if the member has fewer than 3 in the past 7 days.
 *
 * @param {import('mongoose').Types.ObjectId|string} orgId
 * @param {{ weeks?: number }} [options]
 * @returns {Promise<{ reflections: number, interactions: number, morale: number }>}
 */
export async function seedDemoPeopleData(orgId, { weeks = 4 } = {}) {
  const members = await User.find({
    organization:     orgId,
    isActive:         true,
    invitationStatus: 'accepted',
  }).lean();

  if (members.length === 0) {
    return { reflections: 0, interactions: 0, morale: 0 };
  }

  let reflectionsCreated = 0;
  let interactionsCreated = 0;

  // Build the list of ISO weeks to seed (from oldest to newest)
  const isoWeeks = [];
  let currentWeek = isoWeekOf(new Date());
  for (let i = weeks - 1; i >= 0; i--) {
    let w = currentWeek;
    for (let j = 0; j < i; j++) w = previousIsoWeek(w);
    isoWeeks.push(w);
  }
  // Deduplicate while preserving order (in case previousIsoWeek wraps unexpectedly)
  const uniqueWeeks = [...new Set(isoWeeks)];

  // Track created reflections for post-processing (morale analysis)
  const createdReflections = [];

  // ── Reflections ───────────────────────────────────────────────────────────
  for (let ui = 0; ui < members.length; ui++) {
    const user = members[ui];

    for (let wi = 0; wi < uniqueWeeks.length; wi++) {
      const isoWeek = uniqueWeeks[wi];

      // Idempotency check
      const existing = await WeeklyReflection.findOne({
        organization: orgId,
        user:         user._id,
        isoWeek,
      });
      if (existing) continue;

      const { weekStart, weekEnd } = boundsFromIsoWeek(isoWeek);
      const tone     = pickTone(ui, wi);
      const submittedAt = new Date(weekEnd.getTime() - 60 * 60 * 1000); // 1 hr before week end

      const doc = await WeeklyReflection.create({
        organization: orgId,
        user:         user._id,
        isoWeek,
        weekStart,
        weekEnd,
        status:       'submitted',
        submittedAt,
        answers: {
          wins:           tone.wins,
          areasToImprove: tone.areasToImprove,
          dislikes:       tone.dislikes,
          achievements:   tone.achievements,
          plansNextWeek:  tone.plansNextWeek,
        },
      });

      reflectionsCreated++;
      createdReflections.push({ doc, isoWeek });

      // Best-effort sentiment analysis
      await bestEffort(() => analyzeReflection(doc));
    }
  }

  // ── Interactions ──────────────────────────────────────────────────────────
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  for (const user of members) {
    // Look up an assigned lead
    const lead = await Lead.findOne({
      organization: orgId,
      assignedTo:   user._id,
    });
    if (!lead) continue; // skip if no assigned lead

    // Check recent interaction count
    const recentCount = await Interaction.countDocuments({
      organization: orgId,
      user:         user._id,
      createdAt:    { $gte: sevenDaysAgo },
    });
    if (recentCount >= 3) continue; // already has enough

    // Create a few interactions spread over the last ~2 weeks
    const toCreate = Math.min(3 - recentCount, INTERACTION_COPY.length);
    for (let i = 0; i < toCreate; i++) {
      const copy = INTERACTION_COPY[i % INTERACTION_COPY.length];
      const daysAgo = (i + 1) * 3; // 3, 6, 9 days ago
      const createdAt = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);

      await Interaction.create({
        organization: orgId,
        user:         user._id,
        lead:         lead._id,
        type:         copy.type,
        direction:    copy.direction,
        content:      copy.content,
        createdAt,
      });
      interactionsCreated++;
    }
  }

  // ── Morale build (best-effort) ────────────────────────────────────────────
  // Use the most recent seeded week
  const latestWeek = uniqueWeeks[uniqueWeeks.length - 1] ?? isoWeekOf(new Date());
  let moraleBuilt = 0;

  // Team morale: call for each head-level member
  for (const user of members) {
    if (HEAD_ROLES.has(user.role)) {
      const result = await bestEffort(() => buildTeamMorale(orgId, user, latestWeek));
      if (result) moraleBuilt++;
    }
  }

  // Org morale
  const orgResult = await bestEffort(() => buildOrgMorale(orgId, latestWeek));
  if (orgResult) moraleBuilt++;

  return {
    reflections:  reflectionsCreated,
    interactions: interactionsCreated,
    morale:       moraleBuilt,
  };
}
```

- [ ] **Step 4: Run the tests and verify they pass**

```bash
cd "/Users/nirpekshnandan/My Products/propvantage-ai-backend" && \
  node --experimental-vm-modules node_modules/jest/bin/jest.js \
    --config jest.unit.config.mjs \
    tests/unit/demoSeedService.test.js \
    2>&1 | tail -30
```

Expected: All tests PASS (green).

- [ ] **Step 5: Commit**

```bash
cd "/Users/nirpekshnandan/My Products/propvantage-ai-backend" && \
  git add services/people/demoSeedService.js tests/unit/demoSeedService.test.js && \
  git commit -m "$(cat <<'EOF'
feat(people): add seedDemoPeopleData service with unit tests

Seeds realistic WeeklyReflection docs (varied tones: upbeat/stressed/neutral,
each answer >= 500 chars) and Interactions for active org members. Idempotent:
skips existing reflections and members with >= 3 recent interactions.
AI/morale calls are best-effort (errors swallowed).

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Controller handlers + route wiring + controller tests

**Files:**
- Modify: `controllers/peopleController.js` (append `runBackfill` and `seedDemo`)
- Modify: `routes/peopleRoutes.js` (add admin group)
- Modify: `tests/unit/peopleController.test.js` (append tests for the two new handlers)

**Interfaces:**
- Consumes: `backfillSnapshots` from `services/people/backfillService.js`; `seedDemoPeopleData` from `services/people/demoSeedService.js`; `isOwnerLevel` already imported
- Produces: `runBackfill` and `seedDemo` exported from `controllers/peopleController.js`; registered on `POST /admin/backfill` and `POST /admin/seed-demo`

- [ ] **Step 1: Read the bottom of the existing controller test to know where to append**

The file is `tests/unit/peopleController.test.js`. The last test is around the `getMoraleOrg` section. New tests will be appended after the last `describe` block.

Also note: the test file currently imports the SUT with named destructuring. We must add `runBackfill` and `seedDemo` to that import AND mock the two new service modules.

- [ ] **Step 2: Add mock registrations and import extensions to peopleController.test.js**

Open `tests/unit/peopleController.test.js` and make two targeted edits:

**Edit 1 — Add mock registrations** (insert before the `// =============================================================================\n// IMPORT SUT` comment):

```javascript
// backfillService
const mockBackfillSnapshots = jest.fn();
jest.unstable_mockModule('../../services/people/backfillService.js', () => ({
  backfillSnapshots: mockBackfillSnapshots,
}));

// demoSeedService
const mockSeedDemoPeopleData = jest.fn();
jest.unstable_mockModule('../../services/people/demoSeedService.js', () => ({
  seedDemoPeopleData: mockSeedDemoPeopleData,
}));
```

**Edit 2 — Extend the destructured import** (in the existing `await import` block, add `runBackfill` and `seedDemo` to the destructured list):

```javascript
const {
  parseRange,
  getMe,
  getMember,
  getTeam,
  getOrg,
  getFlags,
  getTargets,
  setTargets,
  getMoraleTeam,
  getMoraleOrg,
  runBackfill,
  seedDemo,
} = await import('../../controllers/peopleController.js');
```

**Edit 3 — Add default mock return values in `beforeEach`** (append to the existing `beforeEach` block):

```javascript
  mockBackfillSnapshots.mockResolvedValue({ built: 40, users: 5 });
  mockSeedDemoPeopleData.mockResolvedValue({ reflections: 20, interactions: 10, morale: 3 });
```

**Edit 4 — Append new describe blocks at the bottom of the file** (after the last closing `});`):

```javascript
// =============================================================================
// runBackfill
// =============================================================================
describe('runBackfill', () => {
  test('returns 403 when caller is not owner level', async () => {
    mockIsOwnerLevel.mockReturnValue(false);
    const req = { user: MEMBER_USER, query: {} };
    const res = mockRes();
    await expect(call(runBackfill, req, res)).rejects.toMatchObject({ message: expect.stringContaining('owner') });
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('owner can run backfill — returns { success: true, data }', async () => {
    mockIsOwnerLevel.mockReturnValue(true);
    const req = { user: OWNER_USER, query: {} };
    const res = mockRes();
    await call(runBackfill, req, res);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { built: 40, users: 5 },
    });
  });

  test('passes ?weeks query param to backfillSnapshots', async () => {
    mockIsOwnerLevel.mockReturnValue(true);
    const req = { user: OWNER_USER, query: { weeks: '12' } };
    const res = mockRes();
    await call(runBackfill, req, res);
    expect(mockBackfillSnapshots).toHaveBeenCalledWith(
      OWNER_USER.organization,
      { weeks: 12 },
    );
  });

  test('uses default weeks when ?weeks is absent', async () => {
    mockIsOwnerLevel.mockReturnValue(true);
    const req = { user: OWNER_USER, query: {} };
    const res = mockRes();
    await call(runBackfill, req, res);
    expect(mockBackfillSnapshots).toHaveBeenCalledWith(
      OWNER_USER.organization,
      { weeks: 8 },
    );
  });
});

// =============================================================================
// seedDemo
// =============================================================================
describe('seedDemo', () => {
  test('returns 403 when caller is not owner level', async () => {
    mockIsOwnerLevel.mockReturnValue(false);
    const req = { user: MEMBER_USER, query: { confirm: 'true' } };
    const res = mockRes();
    await expect(call(seedDemo, req, res)).rejects.toMatchObject({ message: expect.stringContaining('owner') });
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('returns 400 when ?confirm=true is missing', async () => {
    mockIsOwnerLevel.mockReturnValue(true);
    const req = { user: OWNER_USER, query: {} };
    const res = mockRes();
    await expect(call(seedDemo, req, res)).rejects.toMatchObject({ message: expect.stringContaining('confirm') });
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('returns 400 when ?confirm is not the string "true"', async () => {
    mockIsOwnerLevel.mockReturnValue(true);
    const req = { user: OWNER_USER, query: { confirm: 'yes' } };
    const res = mockRes();
    await expect(call(seedDemo, req, res)).rejects.toMatchObject({ message: expect.stringContaining('confirm') });
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('owner with confirm=true calls seedDemoPeopleData and returns { success, data }', async () => {
    mockIsOwnerLevel.mockReturnValue(true);
    const req = { user: OWNER_USER, query: { confirm: 'true' } };
    const res = mockRes();
    await call(seedDemo, req, res);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { reflections: 20, interactions: 10, morale: 3 },
    });
  });

  test('passes ?weeks to seedDemoPeopleData', async () => {
    mockIsOwnerLevel.mockReturnValue(true);
    const req = { user: OWNER_USER, query: { confirm: 'true', weeks: '6' } };
    const res = mockRes();
    await call(seedDemo, req, res);
    expect(mockSeedDemoPeopleData).toHaveBeenCalledWith(
      OWNER_USER.organization,
      { weeks: 6 },
    );
  });

  test('uses default weeks=4 when ?weeks is absent', async () => {
    mockIsOwnerLevel.mockReturnValue(true);
    const req = { user: OWNER_USER, query: { confirm: 'true' } };
    const res = mockRes();
    await call(seedDemo, req, res);
    expect(mockSeedDemoPeopleData).toHaveBeenCalledWith(
      OWNER_USER.organization,
      { weeks: 4 },
    );
  });
});
```

- [ ] **Step 3: Run the controller tests to verify the new ones fail**

```bash
cd "/Users/nirpekshnandan/My Products/propvantage-ai-backend" && \
  node --experimental-vm-modules node_modules/jest/bin/jest.js \
    --config jest.unit.config.mjs \
    tests/unit/peopleController.test.js \
    2>&1 | tail -30
```

Expected: existing tests pass; new tests fail with `runBackfill is not a function` or similar.

- [ ] **Step 4: Append the two handler exports to peopleController.js**

Append after the last export (`getMoraleOrg`) in `controllers/peopleController.js`:

```javascript
// ─── ADMIN IMPORTS ────────────────────────────────────────────────
import { backfillSnapshots  } from '../services/people/backfillService.js';
import { seedDemoPeopleData } from '../services/people/demoSeedService.js';

/**
 * @desc    Backfill historical performance snapshots for all active org members.
 *          Safe to re-run; buildSnapshot upserts on unique key.
 * @route   POST /api/people/admin/backfill
 * @access  Owner only
 * @query   ?weeks=8   Number of prior ISO weeks to build (default 8)
 */
export const runBackfill = asyncHandler(async (req, res) => {
  if (!isOwnerLevel(req.user)) {
    res.status(403);
    throw new Error('Only the org owner may run the snapshot backfill');
  }

  const weeks = req.query.weeks ? parseInt(req.query.weeks, 10) : 8;
  const data  = await backfillSnapshots(req.user.organization, { weeks });
  res.json({ success: true, data });
});

/**
 * @desc    Seed demo-quality People & Performance data (reflections + interactions + morale).
 *          Idempotent: skips existing reflections and members with sufficient recent activity.
 * @route   POST /api/people/admin/seed-demo
 * @access  Owner only
 * @query   ?confirm=true  Required safety gate — prevents accidental invocation
 *          ?weeks=4       Number of prior ISO weeks to seed (default 4)
 */
export const seedDemo = asyncHandler(async (req, res) => {
  if (!isOwnerLevel(req.user)) {
    res.status(403);
    throw new Error('Only the org owner may seed demo data');
  }

  if (req.query.confirm !== 'true') {
    res.status(400);
    throw new Error(
      'Pass ?confirm=true to confirm seeding demo People & Performance data. ' +
      'This operation creates WeeklyReflections and Interactions for all active members.'
    );
  }

  const weeks = req.query.weeks ? parseInt(req.query.weeks, 10) : 4;
  const data  = await seedDemoPeopleData(req.user.organization, { weeks });
  res.json({ success: true, data });
});
```

Note: The ESM `import` statements must go at the top of the file, not inside the function. Instead of appending import statements at the bottom, they must be inserted at the top of the file alongside the other imports. Adjust accordingly when editing.

- [ ] **Step 5: Run the controller tests — should all pass now**

```bash
cd "/Users/nirpekshnandan/My Products/propvantage-ai-backend" && \
  node --experimental-vm-modules node_modules/jest/bin/jest.js \
    --config jest.unit.config.mjs \
    tests/unit/peopleController.test.js \
    2>&1 | tail -30
```

Expected: All tests PASS.

- [ ] **Step 6: Wire the routes in peopleRoutes.js**

In `routes/peopleRoutes.js`, add the admin imports and routes. The imports must be added to the existing import block from `peopleController.js`. Then add the admin route group before `export default router;`:

Import addition (to the existing destructured import from `peopleController.js`):
```javascript
import {
  getMe,
  getMember,
  getTeam,
  getOrg,
  getFlags,
  getTargets,
  setTargets,
  getMoraleTeam,
  getMoraleOrg,
  runBackfill,   // ← add
  seedDemo,      // ← add
} from '../controllers/peopleController.js';
```

Route addition (before `export default router;`):
```javascript
// ─── ADMIN (owner only) ───────────────────────────────────────────
// Both handlers enforce isOwnerLevel internally.
// POST /admin/backfill   — backfill historical performance snapshots
// POST /admin/seed-demo  — seed demo reflections + interactions + morale
router.post('/admin/backfill',   runBackfill);
router.post('/admin/seed-demo',  seedDemo);
```

- [ ] **Step 7: Run the three new test files together**

```bash
cd "/Users/nirpekshnandan/My Products/propvantage-ai-backend" && \
  node --experimental-vm-modules node_modules/jest/bin/jest.js \
    --config jest.unit.config.mjs \
    tests/unit/backfillService.test.js \
    tests/unit/demoSeedService.test.js \
    tests/unit/peopleController.test.js \
    2>&1 | tail -40
```

Expected: All tests PASS with a total count matching expectations.

- [ ] **Step 8: Run the full suite to check for regressions**

```bash
cd "/Users/nirpekshnandan/My Products/propvantage-ai-backend" && \
  node --experimental-vm-modules node_modules/jest/bin/jest.js \
    --config jest.unit.config.mjs \
    2>&1 | tail -20
```

Expected: Passes ≥ 835 tests, 0 failures.

- [ ] **Step 9: Commit**

```bash
cd "/Users/nirpekshnandan/My Products/propvantage-ai-backend" && \
  git add controllers/peopleController.js routes/peopleRoutes.js tests/unit/peopleController.test.js && \
  git commit -m "$(cat <<'EOF'
feat(people): add owner-only admin endpoints for backfill + demo seed

POST /api/people/admin/backfill?weeks=8  — backfills performance snapshots
POST /api/people/admin/seed-demo?confirm=true&weeks=4 — seeds demo data

Both are owner-guarded (isOwnerLevel 403), idempotent, and use existing
service building blocks without reimplementing any metric/AI logic.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Write the report file

**Files:**
- Create: `.superpowers/sdd/followup-b-report.md`

- [ ] **Step 1: Write the report**

Create `.superpowers/sdd/followup-b-report.md` with:
- Status summary (DONE / partial / blocked)
- Exact request shapes for both endpoints
- Commit short-hashes
- Full-suite pass count
- Any concerns or known limitations

---

## Self-Review

**Spec coverage:**
- [x] `backfillService.js` with `backfillSnapshots(orgId, {weeks})` → Task 1
- [x] Controller `runBackfill`, owner guard, `?weeks=` → Task 3
- [x] `demoSeedService.js` with `seedDemoPeopleData(orgId, {weeks})` → Task 2
- [x] Reflections: submitted, `≥500` chars, varied tones → Task 2 (TONE_BUCKETS)
- [x] `analyzeReflection` called on each created reflection → Task 2
- [x] Interactions: few per member, assigned-lead check, idempotent count guard → Task 2
- [x] `buildTeamMorale` + `buildOrgMorale` called best-effort → Task 2
- [x] Controller `seedDemo`, owner guard, `?confirm=true` required → Task 3
- [x] Routes: `POST /admin/backfill` and `POST /admin/seed-demo` → Task 3
- [x] Tests: backfillService — snapshot count per user, owner guard → Task 1 + Task 3
- [x] Tests: demoSeedService — idempotency for reflections and interactions → Task 2
- [x] Tests: peopleController — owner guard 403, confirm=true 400 → Task 3
- [x] No real AI/DB calls in tests — all mocked → all tasks
- [x] Report file → Task 4
- [x] Full-suite regression check → Task 3

**Placeholder scan:** No TBDs or fill-in-later patterns.

**Type consistency:** `backfillSnapshots` and `seedDemoPeopleData` signatures are consistent between service files, test files, and controller calls. `isOwnerLevel` used identically to existing `getOrg`/`getMoraleOrg` pattern. `asyncHandler` wraps all new handlers.

**Known risk:** The `import` statements for `backfillService` and `demoSeedService` in `peopleController.js` must be added at the top of the file (ESM hoisting requirement), not at the bottom of the file where the functions are appended. Task 3 Step 4 calls this out explicitly; the implementer must edit the imports block at the top rather than appending imports near the handler functions.
