# Leads Refactor — Phase 1: Model & Status-Machine Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-base the backend `Lead` data model on the new "developer-ready" enums (source, budget source, status, priority), introduce a real status state-machine + status history, make priority occupancy-timeline-driven, enforce mandatory assignment, wire the missing assign route + a quick status-change route, and migrate existing/demo leads — without breaking channel-partner, sales, or scoring flows.

**Architecture:** Pure, DB-free logic lives in small `utils/` and `data/` modules (unit-tested with the existing `tests/unit` Jest harness via `validateSync()` and plain function assertions). The Mongoose `pre('save')` hook remains the single source of truth for priority on `.save()` paths; because `updateLead` uses `findByIdAndUpdate` (which bypasses hooks), status transitions / history / timeline-priority are enforced explicitly in the controller too. A one-time idempotent migration rewrites legacy enum values using the raw driver (bypassing validators/hooks).

**Tech Stack:** Node ESM (`"type": "module"`), Express, Mongoose, Jest (`npm run test:unit`, runs `tests/unit/**/*.test.js` with `--experimental-vm-modules`).

**Out of scope for Phase 1 (handled by later phase plans, and safe to defer because they are non-breaking string matches that simply go empty after migration):** scoring weight rebalance + removing the `'Critical'` bucket from `leadScoringController`/`copilotFunctions` analytics (Phase 2); references to removed statuses in `analyticsService`/`predictiveAnalyticsService`/`leadershipDashboardService` (later display/analytics phases); all frontend; demo reseed (Phase 9). **Do NOT** change `'Critical'` in task/approval/construction/projectBudget code — those are unrelated enums.

---

## File Structure

**Create:**
- `utils/leadPriority.js` — `derivePriorityFromTimeline()` + `LEAD_PRIORITIES`. One responsibility: timeline→priority.
- `utils/leadStatusMachine.js` — `LEAD_STATUSES`, `LEAD_STATUS_TRANSITIONS`, `canTransition()`, `assertTransition()`, `allowedNextStatuses()`. One responsibility: status transition rules.
- `data/leadEnumMigrationMaps.js` — pure legacy→new value maps + `mapSource/mapBudgetSource/mapStatus/mapFollowUpType` + `NEW_SOURCES`.
- `data/migrateLeadsDeveloperReady.js` — one-time idempotent runner that applies the maps to existing leads.
- `tests/unit/leadPriority.test.js`, `tests/unit/leadStatusMachine.test.js`, `tests/unit/leadEnumMigrationMaps.test.js`, `tests/unit/leadModel.developerReady.test.js`.

**Modify:**
- `models/leadModel.js` — enums (source, budget.budgetSource, status, proposedStatusChange.status, priority), drop `requirements.floor.specific`, add `statusHistory`, `revivedCount`, `sourceDetail`; repoint `updatePriority()` to timeline; repurpose `scoreStatus` virtual; tidy `$nin` statics.
- `services/leadScoringService.js` — `getLeadPriority()` 4-level (drop Critical) so the service never assigns an out-of-enum value.
- `controllers/leadController.js` — `createLead` (force status `New`, seed history, mandatory `assignedTo`, fix budgetSource default), `updateLead` (transition guard + history + timeline-priority), new `changeLeadStatus`, export it.
- `routes/leadRoutes.js` — register `PUT /:id/assign` (currently unwired) + `PATCH /:id/status`; fix inline `'Critical'`/`'Unqualified'` enum references.

---

## Task 1: Timeline→priority utility

**Files:**
- Create: `utils/leadPriority.js`
- Test: `tests/unit/leadPriority.test.js`

- [ ] **Step 1: Write the failing test**

```js
// tests/unit/leadPriority.test.js
import { derivePriorityFromTimeline, LEAD_PRIORITIES } from '../../utils/leadPriority.js';

describe('derivePriorityFromTimeline', () => {
  it('maps immediate and 1-3 months to High', () => {
    expect(derivePriorityFromTimeline('immediate')).toBe('High');
    expect(derivePriorityFromTimeline('1-3_months')).toBe('High');
  });
  it('maps 3-6 months to Medium, 6-12 to Low, 12+ to Very Low', () => {
    expect(derivePriorityFromTimeline('3-6_months')).toBe('Medium');
    expect(derivePriorityFromTimeline('6-12_months')).toBe('Low');
    expect(derivePriorityFromTimeline('12+_months')).toBe('Very Low');
  });
  it('defaults unknown/missing timeline to Very Low', () => {
    expect(derivePriorityFromTimeline(undefined)).toBe('Very Low');
    expect(derivePriorityFromTimeline('garbage')).toBe('Very Low');
  });
  it('exposes the 4 priority levels (no Critical)', () => {
    expect(LEAD_PRIORITIES).toEqual(['High', 'Medium', 'Low', 'Very Low']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- leadPriority`
Expected: FAIL — `Cannot find module '../../utils/leadPriority.js'`.

- [ ] **Step 3: Write the implementation**

```js
// File: utils/leadPriority.js
// Maps a lead's occupancy timeline to its priority. Single source of truth for
// the timeline-driven priority introduced in the 2026-06 Leads refactor.
// Pure + DB-free so it can be reused by the model pre-save hook, the scoring
// service, controllers, and seeders.

export const LEAD_PRIORITIES = ['High', 'Medium', 'Low', 'Very Low'];

// Occupancy timeline → priority. Immediate & 1-3 months both map to "High".
const TIMELINE_TO_PRIORITY = {
  immediate: 'High',
  '1-3_months': 'High',
  '3-6_months': 'Medium',
  '6-12_months': 'Low',
  '12+_months': 'Very Low',
};

/**
 * Derive a lead's priority from its occupancy timeline.
 * Unknown/missing timeline → 'Very Low'.
 * @param {string} timeline one of the requirements.timeline enum values
 * @returns {'High'|'Medium'|'Low'|'Very Low'}
 */
export function derivePriorityFromTimeline(timeline) {
  return TIMELINE_TO_PRIORITY[timeline] || 'Very Low';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- leadPriority`
Expected: PASS (4 passing).

- [ ] **Step 5: Commit**

```bash
git add utils/leadPriority.js tests/unit/leadPriority.test.js
git commit -m "feat(leads): timeline-driven priority utility"
```

---

## Task 2: Lead status state machine

**Files:**
- Create: `utils/leadStatusMachine.js`
- Test: `tests/unit/leadStatusMachine.test.js`

- [ ] **Step 1: Write the failing test**

```js
// tests/unit/leadStatusMachine.test.js
import {
  LEAD_STATUSES, canTransition, assertTransition, allowedNextStatuses,
} from '../../utils/leadStatusMachine.js';

describe('lead status machine', () => {
  it('lists the new status set (internal Booked value, no Contacted/Site Visit Scheduled/Unqualified)', () => {
    expect(LEAD_STATUSES).toEqual([
      'pending', 'New', 'Qualified', 'Site Visit Completed',
      'Negotiating', 'Booked', 'Lost', 'Revived',
    ]);
  });
  it('allows the happy-path funnel transitions', () => {
    expect(canTransition('New', 'Qualified')).toBe(true);
    expect(canTransition('Qualified', 'Site Visit Completed')).toBe(true);
    expect(canTransition('Site Visit Completed', 'Negotiating')).toBe(true);
    expect(canTransition('Negotiating', 'Booked')).toBe(true);
  });
  it('only allows Revived from Lost, and only to Site Visit Completed/Negotiating', () => {
    expect(canTransition('Lost', 'Revived')).toBe(true);
    expect(canTransition('New', 'Revived')).toBe(false);
    expect(canTransition('Revived', 'Site Visit Completed')).toBe(true);
    expect(canTransition('Revived', 'Negotiating')).toBe(true);
    expect(canTransition('Revived', 'New')).toBe(false);
  });
  it('treats a no-op (same status) as allowed', () => {
    expect(canTransition('Negotiating', 'Negotiating')).toBe(true);
  });
  it('rejects unknown target statuses', () => {
    expect(canTransition('New', 'Contacted')).toBe(false);
  });
  it('assertTransition throws on an invalid move', () => {
    expect(() => assertTransition('New', 'Booked')).toThrow(/Invalid lead status transition/);
    expect(assertTransition('New', 'Qualified')).toBe(true);
  });
  it('allowedNextStatuses returns the forward set', () => {
    expect(allowedNextStatuses('Site Visit Completed')).toEqual(['Negotiating', 'Booked', 'Lost']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- leadStatusMachine`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```js
// File: utils/leadStatusMachine.js
// Centralised Lead status state machine for the 2026-06 Leads refactor.
// Pure + DB-free. Used by the lead controller (updateLead, changeLeadStatus)
// so every status mutation goes through one set of rules.
//
// 'pending' is the CP intake queue (not a sales-funnel UI stage). The internal
// terminal value stays 'Booked'; the UI labels it "Booking".

export const LEAD_STATUSES = [
  'pending',
  'New',
  'Qualified',
  'Site Visit Completed',
  'Negotiating',
  'Booked',
  'Lost',
  'Revived',
];

export const LEAD_STATUS_TRANSITIONS = {
  pending: ['New', 'Lost'],
  New: ['Qualified', 'Lost'],
  Qualified: ['Site Visit Completed', 'Lost'],
  'Site Visit Completed': ['Negotiating', 'Booked', 'Lost'],
  Negotiating: ['Booked', 'Lost'],
  Booked: ['Lost'],
  Lost: ['Revived'],
  Revived: ['Site Visit Completed', 'Negotiating'],
};

/** Is moving from `from` → `to` allowed? A no-op (from === to) is always allowed. */
export function canTransition(from, to) {
  if (!LEAD_STATUSES.includes(to)) return false;
  if (from === to) return true;
  return (LEAD_STATUS_TRANSITIONS[from] || []).includes(to);
}

/** Throw a descriptive Error if the transition is not allowed; return true otherwise. */
export function assertTransition(from, to) {
  if (!canTransition(from, to)) {
    throw new Error(`Invalid lead status transition: ${from} → ${to}`);
  }
  return true;
}

/** The statuses a lead in `from` may move to next (excludes itself). */
export function allowedNextStatuses(from) {
  return LEAD_STATUS_TRANSITIONS[from] || [];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- leadStatusMachine`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add utils/leadStatusMachine.js tests/unit/leadStatusMachine.test.js
git commit -m "feat(leads): status state machine with Revived transitions"
```

---

## Task 3: Legacy→new enum migration maps

**Files:**
- Create: `data/leadEnumMigrationMaps.js`
- Test: `tests/unit/leadEnumMigrationMaps.test.js`

- [ ] **Step 1: Write the failing test**

```js
// tests/unit/leadEnumMigrationMaps.test.js
import {
  mapSource, mapBudgetSource, mapStatus, mapFollowUpType, NEW_SOURCES,
} from '../../data/leadEnumMigrationMaps.js';

describe('lead enum migration maps', () => {
  it('maps legacy sources onto the 6 new sources', () => {
    expect(mapSource('Walk-in')).toBe('Direct');
    expect(mapSource('Cold Call')).toBe('Cold Calling');
    expect(mapSource('Website')).toBe('Marketing');
    expect(mapSource('Property Portal')).toBe('Marketing');
    expect(mapSource('Social Media')).toBe('Marketing');
    expect(mapSource('Advertisement')).toBe('Marketing');
    expect(mapSource('Other')).toBe('Direct');
    expect(mapSource('Referral')).toBe('Referral');
    expect(mapSource('Channel Partner')).toBe('Channel Partner');
  });
  it('passes through already-new sources and defaults the unknown to Direct', () => {
    NEW_SOURCES.forEach((s) => expect(mapSource(s)).toBe(s));
    expect(mapSource('???')).toBe('Direct');
  });
  it('collapses budget source to self_funded / bank_loan', () => {
    expect(mapBudgetSource('self_reported')).toBe('self_funded');
    expect(mapBudgetSource('pre_approved')).toBe('bank_loan');
    expect(mapBudgetSource('loan_approved')).toBe('bank_loan');
    expect(mapBudgetSource('verified')).toBe('bank_loan');
    expect(mapBudgetSource('bank_loan')).toBe('bank_loan');
  });
  it('remaps removed statuses (conservative) and passes valid ones through', () => {
    expect(mapStatus('Contacted')).toBe('New');
    expect(mapStatus('Site Visit Scheduled')).toBe('Qualified');
    expect(mapStatus('Unqualified')).toBe('Lost');
    expect(mapStatus('Negotiating')).toBe('Negotiating');
    expect(mapStatus('Booked')).toBe('Booked');
  });
  it('remaps follow-up types whatsapp→text, site_visit→meeting', () => {
    expect(mapFollowUpType('whatsapp')).toBe('text');
    expect(mapFollowUpType('site_visit')).toBe('meeting');
    expect(mapFollowUpType('call')).toBe('call');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- leadEnumMigrationMaps`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```js
// File: data/leadEnumMigrationMaps.js
// Pure legacy→new value maps for the 2026-06 "developer-ready" Lead refactor.
// Imported by data/migrateLeadsDeveloperReady.js. Pure + DB-free so the
// mappings are unit-tested in isolation.

export const NEW_SOURCES = ['Channel Partner', 'Management', 'Direct', 'Referral', 'Marketing', 'Cold Calling'];

const SOURCE_MAP = {
  Referral: 'Referral',
  'Channel Partner': 'Channel Partner',
  'Walk-in': 'Direct',
  'Cold Call': 'Cold Calling',
  Website: 'Marketing',
  'Property Portal': 'Marketing',
  'Social Media': 'Marketing',
  Advertisement: 'Marketing',
  Other: 'Direct',
};

const BUDGET_SOURCE_MAP = {
  self_reported: 'self_funded',
  pre_approved: 'bank_loan',
  loan_approved: 'bank_loan',
  verified: 'bank_loan',
};

// Conservative status remap (decision 2026-06-15).
const STATUS_MAP = {
  Contacted: 'New',
  'Site Visit Scheduled': 'Qualified',
  Unqualified: 'Lost',
};

const FOLLOWUP_TYPE_MAP = {
  whatsapp: 'text',
  site_visit: 'meeting',
};

export function mapSource(old) {
  if (NEW_SOURCES.includes(old)) return old;
  return SOURCE_MAP[old] || 'Direct';
}
export function mapBudgetSource(old) {
  if (old === 'self_funded' || old === 'bank_loan') return old;
  return BUDGET_SOURCE_MAP[old] || 'self_funded';
}
export function mapStatus(old) {
  return STATUS_MAP[old] || old; // valid/unmapped statuses pass through
}
export function mapFollowUpType(old) {
  return FOLLOWUP_TYPE_MAP[old] || old;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- leadEnumMigrationMaps`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add data/leadEnumMigrationMaps.js tests/unit/leadEnumMigrationMaps.test.js
git commit -m "feat(leads): pure legacy→new enum migration maps"
```

---

## Task 4: Update the Lead model schema

**Files:**
- Modify: `models/leadModel.js`
- Test: `tests/unit/leadModel.developerReady.test.js`

- [ ] **Step 1: Write the failing test**

```js
// tests/unit/leadModel.developerReady.test.js
import mongoose from 'mongoose';
import Lead from '../../models/leadModel.js';

const validLead = (over = {}) => ({
  organization: new mongoose.Types.ObjectId(),
  project: new mongoose.Types.ObjectId(),
  firstName: 'Asha',
  phone: '9876543210',
  ...over,
});

describe('Lead model — developer-ready refactor', () => {
  it('validates a minimal valid document', () => {
    expect(new Lead(validLead()).validateSync()).toBeUndefined();
  });
  it('defaults source to Direct and accepts the 6 new sources', () => {
    expect(new Lead(validLead()).source).toBe('Direct');
    ['Channel Partner', 'Management', 'Direct', 'Referral', 'Marketing', 'Cold Calling']
      .forEach((s) => expect(new Lead(validLead({ source: s })).validateSync()).toBeUndefined());
  });
  it('rejects a legacy source value', () => {
    expect(new Lead(validLead({ source: 'Walk-in' })).validateSync().errors.source).toBeDefined();
  });
  it('defaults budgetSource to self_funded and rejects legacy values', () => {
    expect(new Lead(validLead()).budget.budgetSource).toBe('self_funded');
    expect(new Lead(validLead({ budget: { budgetSource: 'pre_approved' } }))
      .validateSync().errors['budget.budgetSource']).toBeDefined();
  });
  it('uses the 4-level priority enum (no Critical)', () => {
    expect(new Lead(validLead({ priority: 'Critical' })).validateSync().errors.priority).toBeDefined();
    ['High', 'Medium', 'Low', 'Very Low']
      .forEach((p) => expect(new Lead(validLead({ priority: p })).validateSync()).toBeUndefined());
  });
  it('uses the new status set: accepts Revived, rejects removed statuses', () => {
    expect(new Lead(validLead({ status: 'Revived' })).validateSync()).toBeUndefined();
    ['Contacted', 'Site Visit Scheduled', 'Unqualified']
      .forEach((s) => expect(new Lead(validLead({ status: s })).validateSync().errors.status).toBeDefined());
  });
  it('drops the floor.specific path', () => {
    const doc = new Lead(validLead({ requirements: { floor: { preference: 'high', specific: 12 } } }));
    expect(doc.requirements.floor.preference).toBe('high');
    expect(doc.requirements.floor.specific).toBeUndefined();
  });
  it('derives priority from occupancy timeline via updatePriority()', () => {
    const hi = new Lead(validLead({ requirements: { timeline: 'immediate' } }));
    hi.updatePriority();
    expect(hi.priority).toBe('High');
    const lo = new Lead(validLead({ requirements: { timeline: '12+_months' } }));
    lo.updatePriority();
    expect(lo.priority).toBe('Very Low');
  });
  it('scoreStatus virtual no longer returns a temperature label', () => {
    const doc = new Lead(validLead({ score: 95 }));
    expect(['High', 'Medium', 'Low', 'Very Low']).toContain(doc.scoreStatus);
    expect(doc.scoreStatus).not.toMatch(/Lead/);
  });
  it('supports statusHistory and sourceDetail', () => {
    const doc = new Lead(validLead({
      statusHistory: [{ status: 'New' }],
      sourceDetail: { management: { contactName: 'Promoter A' } },
    }));
    expect(doc.validateSync()).toBeUndefined();
    expect(doc.statusHistory[0].status).toBe('New');
    expect(doc.sourceDetail.management.contactName).toBe('Promoter A');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- leadModel.developerReady`
Expected: FAIL (legacy `source` accepted, `Critical` accepted, `scoreStatus` returns "Hot Lead", etc.).

- [ ] **Step 3a: Add the import at the top of `models/leadModel.js`**

Find (line 6):
```js
import mongoose from 'mongoose';
```
Replace with:
```js
import mongoose from 'mongoose';
import { derivePriorityFromTimeline } from '../utils/leadPriority.js';
```

- [ ] **Step 3b: Replace the `source` enum**

Find:
```js
    source: {
      type: String,
      enum: [
        'Website',
        'Property Portal',
        'Referral',
        'Walk-in',
        'Social Media',
        'Advertisement',
        'Cold Call',
        'Channel Partner',
        'Other',
      ],
      default: 'Other',
    },
```
Replace with:
```js
    source: {
      type: String,
      enum: [
        'Channel Partner',
        'Management',
        'Direct',
        'Referral',
        'Marketing',
        'Cold Calling',
      ],
      default: 'Direct',
    },
    // 2026-06 refactor: extra detail captured behind the single "Add source
    // details" toggle. CP details still live in channelPartnerAttribution.
    sourceDetail: {
      text: { type: String, trim: true, default: '' },
      management: {
        contactName: { type: String, trim: true, default: '' },
        note: { type: String, trim: true, default: '' },
      },
    },
```

- [ ] **Step 3c: Replace the `status` enum** (the `proposedStatusChange.status` enum is updated in Step 3d)

Find the main status block:
```js
    status: {
      type: String,
      enum: [
        // SP4: 'pending' is the awaiting-review state for CP-pushed leads
        // (created by services/prospectService.pushProspectToDeveloper).
        // The developer accepts → 'New'; rejects → 'Lost'. Pending leads are
        // surfaced only via GET /api/leads/registrations; the default
        // /api/leads list excludes them for non-CP callers.
        'pending',
        'New',
        'Contacted',
        'Qualified',
        'Site Visit Scheduled',
        'Site Visit Completed',
        'Negotiating',
        'Booked',
        'Lost',
        'Unqualified',
      ],
      default: 'New',
    },
```
Replace with:
```js
    status: {
      type: String,
      enum: [
        // 'pending' = CP-pushed intake queue (services/prospectService).
        // 2026-06 refactor: removed Contacted / Site Visit Scheduled /
        // Unqualified; added Revived. Internal terminal value stays 'Booked'
        // (UI labels it "Booking").
        'pending',
        'New',
        'Qualified',
        'Site Visit Completed',
        'Negotiating',
        'Booked',
        'Lost',
        'Revived',
      ],
      default: 'New',
    },
```

- [ ] **Step 3d: Replace the `proposedStatusChange.status` enum**

Find:
```js
      status: {
        type: String,
        enum: [
          'pending', 'New', 'Contacted', 'Qualified', 'Site Visit Scheduled',
          'Site Visit Completed', 'Negotiating', 'Booked', 'Lost', 'Unqualified',
        ],
      },
```
Replace with:
```js
      status: {
        type: String,
        enum: [
          'pending', 'New', 'Qualified', 'Site Visit Completed',
          'Negotiating', 'Booked', 'Lost', 'Revived',
        ],
      },
```

- [ ] **Step 3e: Add `statusHistory` + `revivedCount` after the `statusChangedAt` block**

Find:
```js
    statusChangedAt: {
      type: Date,
      default: Date.now,
    },
    
```
Replace with:
```js
    statusChangedAt: {
      type: Date,
      default: Date.now,
    },

    // 2026-06 refactor: append-only status history. Powers the "Lost → Revived"
    // report and a future status audit trail (previously changes were only
    // logged as Interactions).
    statusHistory: [
      {
        status: { type: String },
        changedAt: { type: Date, default: Date.now },
        changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
        note: { type: String, trim: true },
      },
    ],
    // Number of times this lead has entered 'Revived'.
    revivedCount: { type: Number, default: 0 },

```

- [ ] **Step 3f: Replace the `priority` enum** (drop Critical)

Find:
```js
    priority: {
      type: String,
      enum: ['Critical', 'High', 'Medium', 'Low', 'Very Low'],
      default: 'Very Low',
      index: true  // Index for efficient querying by priority
    },
```
Replace with:
```js
    priority: {
      type: String,
      // 2026-06 refactor: timeline-derived (see updatePriority). 'Critical'
      // removed — 4 levels only.
      enum: ['High', 'Medium', 'Low', 'Very Low'],
      default: 'Very Low',
      index: true
    },
```

- [ ] **Step 3g: Replace the `budget.budgetSource` enum**

Find:
```js
      budgetSource: { 
        type: String, 
        enum: ['self_reported', 'pre_approved', 'loan_approved', 'verified'],
        default: 'self_reported' 
      },
```
Replace with:
```js
      budgetSource: {
        type: String,
        // 2026-06 refactor: two values only.
        enum: ['self_funded', 'bank_loan'],
        default: 'self_funded'
      },
```

- [ ] **Step 3h: Drop `requirements.floor.specific`**

Find:
```js
      floor: {
        preference: { 
          type: String, 
          enum: ['low', 'medium', 'high', 'any'],
          default: 'any' 
        },
        specific: { type: Number } // Specific floor number if any
      },
```
Replace with:
```js
      floor: {
        preference: {
          type: String,
          enum: ['low', 'medium', 'high', 'any'],
          default: 'any'
        }
        // `specific` floor number removed in 2026-06 refactor — floor is
        // category-only (Any / Lower / Mid / Higher); numbering differs per project.
      },
```

- [ ] **Step 3i: Repurpose the `scoreStatus` virtual** (remove Hot/Warm/Cold)

Find:
```js
// NEW: Virtual for score status
leadSchema.virtual('scoreStatus').get(function() {
  if (this.confidence < 70) return 'Low Confidence';
  if (this.score >= 85) return 'Hot Lead';
  if (this.score >= 70) return 'Warm Lead';
  if (this.score >= 50) return 'Moderate Lead';
  return 'Cold Lead';
});
```
Replace with:
```js
// Score band as High/Medium/Low/Very Low (2026-06 refactor — no more
// Hot/Warm/Cold "temperature"). The primary signal on UI surfaces is the
// timeline-derived `priority`; this remains for any score-band consumer.
leadSchema.virtual('scoreStatus').get(function() {
  if (this.score >= 75) return 'High';
  if (this.score >= 50) return 'Medium';
  if (this.score >= 30) return 'Low';
  return 'Very Low';
});
```

- [ ] **Step 3j: Repoint `updatePriority()` to the timeline**

Find:
```js
// Method to update priority based on score
leadSchema.methods.updatePriority = function() {
  if (this.score >= 85) {
    this.priority = 'Critical';
  } else if (this.score >= 75) {
    this.priority = 'High';
  } else if (this.score >= 60) {
    this.priority = 'Medium';
  } else if (this.score >= 40) {
    this.priority = 'Low';
  } else {
    this.priority = 'Very Low';
  }
};
```
Replace with:
```js
// 2026-06 refactor: priority is derived from the occupancy timeline, not the
// score. Called by the pre-save hook so every .save() keeps priority in sync.
leadSchema.methods.updatePriority = function() {
  this.priority = derivePriorityFromTimeline(this.requirements?.timeline);
};
```

- [ ] **Step 3k: Tidy the `$nin` lists in the three statics** (remove now-nonexistent `'Unqualified'`)

In `getLeadsNeedingAttention`, `getLeadsByPriority`, and `getOverdueFollowUps`, find each occurrence of:
```js
    status: { $nin: ['Booked', 'Lost', 'Unqualified'] },
```
and replace with:
```js
    status: { $nin: ['Booked', 'Lost'] },
```
(There are three; `getLeadsByPriority` uses the same array without a trailing comma — replace `['Booked', 'Lost', 'Unqualified']` with `['Booked', 'Lost']` in all three.)

- [ ] **Step 4: Run the model test to verify it passes**

Run: `npm run test:unit -- leadModel.developerReady`
Expected: PASS (all assertions).

- [ ] **Step 5: Commit**

```bash
git add models/leadModel.js tests/unit/leadModel.developerReady.test.js
git commit -m "feat(leads): new enums, status history, sourceDetail, timeline-driven priority"
```

---

## Task 5: Keep the scoring service in-enum (drop Critical)

**Files:**
- Modify: `services/leadScoringService.js`

The model pre-save re-derives priority on every `.save()`, but `updateLeadScore` assigns `lead.priority = scoreResult.priority` (from `getLeadPriority`) before saving. Make `getLeadPriority` return only the 4 valid levels so no out-of-enum value is ever assigned (defends any future `findByIdAndUpdate` path).

- [ ] **Step 1: Edit `getLeadPriority`**

Find:
```js
const getLeadPriority = (score) => {
  if (score >= 85) return 'Critical';
  if (score >= 75) return 'High';
  if (score >= 60) return 'Medium';
  if (score >= 40) return 'Low';
  return 'Very Low';
};
```
Replace with:
```js
// 2026-06 refactor: 4 levels only (no Critical). NOTE: the authoritative
// priority is timeline-derived in the model pre-save hook; this score-based
// band is a fallback kept in-enum so we never assign an invalid value.
const getLeadPriority = (score) => {
  if (score >= 75) return 'High';
  if (score >= 60) return 'Medium';
  if (score >= 40) return 'Low';
  return 'Very Low';
};
```

- [ ] **Step 2: Syntax check**

Run: `node --check services/leadScoringService.js`
Expected: no output (exit 0).

- [ ] **Step 3: Commit**

```bash
git add services/leadScoringService.js
git commit -m "fix(leads): scoring priority band drops Critical (4 levels)"
```

---

## Task 6: `createLead` — force New status, seed history, mandatory assignment, budgetSource default

**Files:**
- Modify: `controllers/leadController.js` (`createLead`, lines ~85–156)

- [ ] **Step 1: Add the imports** at the top of `controllers/leadController.js`

Find:
```js
import { partnerAccessScope } from '../utils/partnerAccessHelper.js';
```
Replace with:
```js
import { partnerAccessScope } from '../utils/partnerAccessHelper.js';
import { assertTransition } from '../utils/leadStatusMachine.js';
import { derivePriorityFromTimeline } from '../utils/leadPriority.js';
```

- [ ] **Step 2: Enforce mandatory assignment** in `createLead`

Find:
```js
  // Basic validation
  if (!project || !firstName || !phone) {
    res.status(400);
    throw new Error('Project, first name, and phone are required fields.');
  }
```
Replace with:
```js
  // Basic validation
  if (!project || !firstName || !phone) {
    res.status(400);
    throw new Error('Project, first name, and phone are required fields.');
  }

  // 2026-06 refactor (#20): every lead must be assigned to a sales agent/manager.
  if (!assignedTo) {
    res.status(400);
    throw new Error('A sales manager/agent must be assigned to every lead.');
  }
```

- [ ] **Step 3: Force `New` status, seed `statusHistory`, fix budgetSource default** in the `new Lead({...})` call

Find:
```js
  // Create the lead with enhanced fields
  const lead = new Lead({
    ...req.body,
    organization: req.user.organization, // Set organization from logged-in user
    // Initialize scoring fields
    score: 0,
    scoreGrade: 'D',
    priority: 'Very Low',
    lastScoreUpdate: new Date(),
    engagementMetrics: {
      totalInteractions: 0,
      responseRate: 0
    },
    // Initialize budget validation if budget provided
    ...(budget && {
      budget: {
        ...budget,
        isValidated: false,
        budgetSource: 'self_reported'
      }
    })
  });
```
Replace with:
```js
  // Create the lead with enhanced fields
  const lead = new Lead({
    ...req.body,
    organization: req.user.organization, // Set organization from logged-in user
    // 2026-06 refactor (#12): direct creation is always status 'New' — there is
    // no client-chosen "initial status". (CP-pushed 'pending' leads are created
    // by prospectService, not this endpoint.)
    status: 'New',
    statusHistory: [{ status: 'New', changedAt: new Date(), changedBy: req.user._id }],
    // Initialize scoring fields. Priority is derived from the occupancy timeline.
    score: 0,
    scoreGrade: 'D',
    priority: derivePriorityFromTimeline(requirements?.timeline),
    lastScoreUpdate: new Date(),
    engagementMetrics: {
      totalInteractions: 0,
      responseRate: 0
    },
    // Initialize budget validation if budget provided. Respect a client-supplied
    // budgetSource (self_funded | bank_loan); default to self_funded.
    ...(budget && {
      budget: {
        ...budget,
        isValidated: budget.isValidated ?? false,
        budgetSource: budget.budgetSource || 'self_funded'
      }
    })
  });
```

- [ ] **Step 4: Syntax check**

Run: `node --check controllers/leadController.js`
Expected: no output (exit 0).

- [ ] **Step 5: Commit**

```bash
git add controllers/leadController.js
git commit -m "feat(leads): createLead forces New status, seeds history, requires assignment"
```

---

## Task 7: `updateLead` — transition guard, history, timeline-priority

**Files:**
- Modify: `controllers/leadController.js` (`updateLead`, lines ~395–514)

`updateLead` uses `findByIdAndUpdate` (bypasses the pre-save hook), so transitions, history, and timeline-priority must be enforced here.

- [ ] **Step 1: Guard the transition + derive priority before the update**

Find:
```js
  // The enrichment sub-document is AI-owned: it is managed only by createLead
  // and the /enrich endpoint. Drop any client-supplied enrichment payload so its
  // status/summary/signals cannot be forged through a plain lead update.
  delete req.body.enrichment;

  // Track what fields are being updated
  const updatedFields = Object.keys(req.body);
  const scoreAffectingFields = ['budget', 'requirements', 'status', 'qualificationStatus'];
  const shouldRecalculateScore = updatedFields.some(field => scoreAffectingFields.includes(field));

  // SP4 — remember the prior status so we can detect a developer-driven
  // status change on a CP-attributed lead (fires cp_lead_status_changed).
  const previousStatus = lead.status;
```
Replace with:
```js
  // The enrichment sub-document is AI-owned: it is managed only by createLead
  // and the /enrich endpoint. Drop any client-supplied enrichment payload so its
  // status/summary/signals cannot be forged through a plain lead update.
  delete req.body.enrichment;

  // SP4 — remember the prior status so we can detect a developer-driven
  // status change on a CP-attributed lead (fires cp_lead_status_changed).
  const previousStatus = lead.status;

  // 2026-06 refactor: validate any status change against the state machine
  // BEFORE persisting, so an illegal move (e.g. New → Booked) is rejected whole.
  const statusChanging = req.body.status && req.body.status !== previousStatus;
  if (statusChanging) {
    try {
      assertTransition(previousStatus, req.body.status);
    } catch (e) {
      res.status(400);
      throw new Error(e.message);
    }
    req.body.statusChangedAt = new Date();
  }

  // 2026-06 refactor: priority is timeline-derived. Never trust a client-sent
  // priority; recompute it whenever the timeline is part of the update.
  delete req.body.priority;
  if (req.body.requirements && Object.prototype.hasOwnProperty.call(req.body.requirements, 'timeline')) {
    req.body.priority = derivePriorityFromTimeline(req.body.requirements.timeline);
  }

  // Track what fields are being updated
  const updatedFields = Object.keys(req.body);
  const scoreAffectingFields = ['budget', 'requirements', 'status', 'qualificationStatus'];
  const shouldRecalculateScore = updatedFields.some(field => scoreAffectingFields.includes(field));
```

- [ ] **Step 2: Append `statusHistory` (and bump `revivedCount`) right after the `findByIdAndUpdate`**

Find:
```js
  // Update the lead
  const updatedLead = await Lead.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
    runValidators: true,
  }).populate('project', 'name location').populate('assignedTo', 'firstName lastName');

  // If score-affecting fields were updated, trigger recalculation
  if (shouldRecalculateScore) {
    addLeadScoreUpdateJob(updatedLead._id, { delay: 1000 });
  }
```
Replace with:
```js
  // Update the lead
  const updatedLead = await Lead.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
    runValidators: true,
  }).populate('project', 'name location').populate('assignedTo', 'firstName lastName');

  // 2026-06 refactor: record the status change in history (findByIdAndUpdate
  // bypasses the pre-save hook, so we append explicitly). Increment revivedCount
  // when entering 'Revived'.
  if (statusChanging) {
    const histEntry = { status: updatedLead.status, changedAt: req.body.statusChangedAt, changedBy: req.user._id };
    const update = { $push: { statusHistory: histEntry } };
    if (updatedLead.status === 'Revived') update.$inc = { revivedCount: 1 };
    await Lead.updateOne({ _id: updatedLead._id }, update);
    updatedLead.statusHistory.push(histEntry);
    if (updatedLead.status === 'Revived') updatedLead.revivedCount = (updatedLead.revivedCount || 0) + 1;
  }

  // If score-affecting fields were updated, trigger recalculation
  if (shouldRecalculateScore) {
    addLeadScoreUpdateJob(updatedLead._id, { delay: 1000 });
  }
```

- [ ] **Step 3: Syntax check**

Run: `node --check controllers/leadController.js`
Expected: no output (exit 0).

- [ ] **Step 4: Commit**

```bash
git add controllers/leadController.js
git commit -m "feat(leads): updateLead enforces status machine + history + timeline priority"
```

---

## Task 8: Quick status-change endpoint (`changeLeadStatus`)

**Files:**
- Modify: `controllers/leadController.js` (add function + export)

- [ ] **Step 1: Add the `changeLeadStatus` handler** immediately after `assignLead` (it ends near line 743, just before `const bulkUpdateLeads`)

Insert before `const bulkUpdateLeads = asyncHandler(async (req, res) => {`:
```js
/**
 * @desc    Quick status change (detail-page three-dots) — enforces the state machine
 * @route   PATCH /api/leads/:id/status
 * @access  Private (LEADS.UPDATE)
 */
const changeLeadStatus = asyncHandler(async (req, res) => {
  const { status, note } = req.body;
  if (!status) {
    res.status(400);
    throw new Error('A target status is required.');
  }

  const lead = await Lead.findOne({ _id: req.params.id, organization: req.user.organization });
  if (!lead) {
    res.status(404);
    throw new Error('Lead not found');
  }

  verifyProjectAccess(req, res, lead.project);

  if (
    req.user.role === 'Sales Executive' &&
    lead.assignedTo &&
    lead.assignedTo.toString() !== req.user._id.toString()
  ) {
    res.status(403);
    throw new Error('You are not authorized to update this lead.');
  }

  const previousStatus = lead.status;
  try {
    assertTransition(previousStatus, status);
  } catch (e) {
    res.status(400);
    throw new Error(e.message);
  }

  lead.status = status;
  lead.statusHistory.push({ status, changedAt: new Date(), changedBy: req.user._id, note: note || '' });
  if (status === 'Revived') lead.revivedCount = (lead.revivedCount || 0) + 1;
  await lead.save(); // pre-save stamps statusChangedAt and keeps priority in sync

  // Keep the CP-side source Prospect in lockstep (best-effort, non-fatal).
  await syncProspectStatusFromLead(lead, status, req.user);

  res.json({ success: true, data: lead, message: `Status updated to ${status}.` });
});

```

- [ ] **Step 2: Add `changeLeadStatus` to the export block**

Find (in the `export { ... }` block near line 1188):
```js
  assignLead,
```
Replace with:
```js
  assignLead,
  changeLeadStatus,
```

- [ ] **Step 3: Syntax check**

Run: `node --check controllers/leadController.js`
Expected: no output (exit 0).

- [ ] **Step 4: Commit**

```bash
git add controllers/leadController.js
git commit -m "feat(leads): PATCH /:id/status quick status-change handler"
```

---

## Task 9: Wire routes (assign + status) and fix inline enum references

**Files:**
- Modify: `routes/leadRoutes.js`

- [ ] **Step 1: Import the two handlers**

Find:
```js
import {
  createLead,
  getLeads,
  getLeadById,
  enrichLead,
  updateLead,
  addInteractionToLead,
  getLeadInteractions,
  deleteLead,
  getLeadRegistrations,
  decideLeadRegistration,
  decideLeadProposal,
} from '../controllers/leadController.js';
```
Replace with:
```js
import {
  createLead,
  getLeads,
  getLeadById,
  enrichLead,
  updateLead,
  addInteractionToLead,
  getLeadInteractions,
  deleteLead,
  getLeadRegistrations,
  decideLeadRegistration,
  decideLeadProposal,
  assignLead,
  changeLeadStatus,
} from '../controllers/leadController.js';
```

- [ ] **Step 2: Register the routes** (place after the `/:id/proposal` route, before `router.route('/:id')`)

Find:
```js
router.patch(
  '/:id/proposal',
  hasPermission(PERMISSIONS.LEADS.UPDATE),
  decideLeadProposal
);
```
Replace with:
```js
router.patch(
  '/:id/proposal',
  hasPermission(PERMISSIONS.LEADS.UPDATE),
  decideLeadProposal
);

// 2026-06 refactor: assign/reassign (the controller existed but was never
// wired) + quick status change from the detail-page three-dots.
router.put('/:id/assign', hasPermission(PERMISSIONS.LEADS.UPDATE), assignLead);
router.patch('/:id/status', hasPermission(PERMISSIONS.LEADS.UPDATE), changeLeadStatus);
```

- [ ] **Step 3: Fix the inline `'Critical'` reference in `/simple-stats`**

Find:
```js
    const highPriorityLeads = await Lead.countDocuments({
      ...query,
      priority: { $in: ['High', 'Critical'] }
    });
```
Replace with:
```js
    const highPriorityLeads = await Lead.countDocuments({
      ...query,
      priority: { $in: ['High'] }
    });
```

- [ ] **Step 4: Fix the inline enums in `/by-priority/:priority`**

Find:
```js
    const validPriorities = ['Critical', 'High', 'Medium', 'Low', 'Very Low'];
    if (!validPriorities.includes(priority)) {
      return res.status(400).json({ success: false, message: 'Invalid priority level' });
    }

    const query = {
      organization: req.user.organization,
      priority,
      status: { $nin: ['Booked', 'Lost', 'Unqualified'] }
    };
```
Replace with:
```js
    const validPriorities = ['High', 'Medium', 'Low', 'Very Low'];
    if (!validPriorities.includes(priority)) {
      return res.status(400).json({ success: false, message: 'Invalid priority level' });
    }

    const query = {
      organization: req.user.organization,
      priority,
      status: { $nin: ['Booked', 'Lost'] }
    };
```

- [ ] **Step 5: Fix the `$nin` in `/simple-overdue-followups`**

Find:
```js
    const query = {
      organization: req.user.organization,
      'followUpSchedule.nextFollowUpDate': { $lt: now },
      status: { $nin: ['Booked', 'Lost', 'Unqualified'] }
    };
```
Replace with:
```js
    const query = {
      organization: req.user.organization,
      'followUpSchedule.nextFollowUpDate': { $lt: now },
      status: { $nin: ['Booked', 'Lost'] }
    };
```

- [ ] **Step 6: Syntax check**

Run: `node --check routes/leadRoutes.js`
Expected: no output (exit 0).

- [ ] **Step 7: Commit**

```bash
git add routes/leadRoutes.js
git commit -m "feat(leads): wire assign + quick-status routes; drop Critical/Unqualified inline refs"
```

---

## Task 10: One-time data migration

**Files:**
- Create: `data/migrateLeadsDeveloperReady.js`

- [ ] **Step 1: Write the migration runner**

```js
// File: data/migrateLeadsDeveloperReady.js
// One-time (2026-06): migrate existing Lead documents onto the developer-ready
// enums. Idempotent — re-running is safe. Uses the raw driver (Lead.collection)
// to bypass schema validators and the pre-save hook, because legacy values are
// invalid under the new schema and we don't want the hook stamping "now".
//
// Run (dry-run first):  node data/migrateLeadsDeveloperReady.js --dry
// Then for real:        node data/migrateLeadsDeveloperReady.js
//
// Mapping (see data/leadEnumMigrationMaps.js + utils/leadPriority.js):
//   source        legacy → {Channel Partner, Management, Direct, Referral, Marketing, Cold Calling}
//   budgetSource  legacy → {self_funded, bank_loan}
//   status        Contacted→New, Site Visit Scheduled→Qualified, Unqualified→Lost
//   followUpType  whatsapp→text, site_visit→meeting
//   priority      recomputed from requirements.timeline (drops Critical)
//   floor.specific removed; statusHistory seeded if empty.

import dotenv from 'dotenv';
import mongoose from 'mongoose';
import connectDB from '../config/db.js';
import Lead from '../models/leadModel.js';
import {
  mapSource, mapBudgetSource, mapStatus, mapFollowUpType,
} from './leadEnumMigrationMaps.js';
import { derivePriorityFromTimeline } from '../utils/leadPriority.js';

dotenv.config();
const DRY = process.argv.includes('--dry');

const run = async () => {
  try {
    await connectDB();
    console.log(`🔄 Migrating leads to developer-ready model${DRY ? ' (DRY RUN)' : ''}…`);

    const cursor = Lead.collection.find({});
    let ops = [];
    let scanned = 0;
    let changed = 0;

    for await (const lead of cursor) {
      scanned++;
      const set = {};
      const unset = {};

      const newSource = mapSource(lead.source);
      if (newSource !== lead.source) set.source = newSource;

      const oldBs = lead.budget?.budgetSource;
      if (oldBs) {
        const nb = mapBudgetSource(oldBs);
        if (nb !== oldBs) set['budget.budgetSource'] = nb;
      }

      const newStatus = mapStatus(lead.status);
      if (newStatus !== lead.status) set.status = newStatus;

      const oldFt = lead.followUpSchedule?.followUpType;
      if (oldFt) {
        const nf = mapFollowUpType(oldFt);
        if (nf !== oldFt) set['followUpSchedule.followUpType'] = nf;
      }

      const newPriority = derivePriorityFromTimeline(lead.requirements?.timeline);
      if (newPriority !== lead.priority) set.priority = newPriority;

      if (lead.requirements?.floor?.specific !== undefined) {
        unset['requirements.floor.specific'] = '';
      }

      if (!Array.isArray(lead.statusHistory) || lead.statusHistory.length === 0) {
        set.statusHistory = [{
          status: newStatus,
          changedAt: lead.statusChangedAt || lead.createdAt || new Date(),
          changedBy: null,
        }];
      }

      const update = {};
      if (Object.keys(set).length) update.$set = set;
      if (Object.keys(unset).length) update.$unset = unset;
      if (!Object.keys(update).length) continue;

      changed++;
      ops.push({ updateOne: { filter: { _id: lead._id }, update } });
      if (ops.length >= 500 && !DRY) {
        await Lead.collection.bulkWrite(ops);
        ops = [];
      }
    }

    if (ops.length && !DRY) await Lead.collection.bulkWrite(ops);

    console.log(`✅ Scanned ${scanned}; ${DRY ? 'would change' : 'changed'} ${changed}.`);
    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  }
};

run();
```

- [ ] **Step 2: Syntax check**

Run: `node --check data/migrateLeadsDeveloperReady.js`
Expected: no output (exit 0).

- [ ] **Step 3: Dry-run against the dev database**

Run: `node data/migrateLeadsDeveloperReady.js --dry`
Expected: connects, prints `Scanned N; would change M.`, exits 0. (No writes.)

- [ ] **Step 4: Commit** (do NOT run the real migration until Phase 1 code is deployed)

```bash
git add data/migrateLeadsDeveloperReady.js
git commit -m "feat(leads): idempotent migration to developer-ready enums"
```

---

## Task 11: Full unit suite + integration smoke + wrap-up

- [ ] **Step 1: Run the whole unit suite**

Run: `npm run test:unit`
Expected: all suites pass, including the 4 new files. No regressions in existing `tests/unit/*`.

- [ ] **Step 2: Boot smoke (model + routes load cleanly under ESM)**

Run: `node -e "import('./models/leadModel.js').then(()=>import('./routes/leadRoutes.js')).then(()=>{console.log('OK');process.exit(0)}).catch(e=>{console.error(e);process.exit(1)})"`
Expected: prints `OK`.

- [ ] **Step 3: Manual API smoke (against a running dev server with seeded data)** — verify, in order:
  1. `POST /api/leads` without `assignedTo` → 400 "must be assigned".
  2. `POST /api/leads` with `assignedTo`, `requirements.timeline:'immediate'` → 201; response `status:'New'`, `priority:'High'`, `statusHistory[0].status:'New'`.
  3. `PATCH /api/leads/:id/status {status:'Booked'}` on a New lead → 400 "Invalid lead status transition".
  4. `PATCH /api/leads/:id/status {status:'Qualified'}` → 200; `statusHistory` has 2 entries.
  5. Walk Qualified→Site Visit Completed→Negotiating→Booked→Lost→Revived; confirm Revived sets `revivedCount:1` and only allows Site Visit Completed/Negotiating next.
  6. `PUT /api/leads/:id/assign {assignedTo:<userId>}` → 200.

- [ ] **Step 4: Run the migration for real** (after the above passes)

Run: `node data/migrateLeadsDeveloperReady.js`
Then re-run: `node data/migrateLeadsDeveloperReady.js --dry`
Expected: the second dry-run reports `would change 0` (idempotent).

- [ ] **Step 5: Final commit / phase tag**

```bash
git add -A
git commit -m "chore(leads): Phase 1 foundation complete — model, status machine, migration"
```

---

## Self-Review (completed during planning)

- **Spec coverage (Phase 1 slice):** new source enum ✓ (#2), budget source 2-value ✓ (#8), floor category-only ✓ (#7), follow-up enum superset is deferred to the wizard phase but the migration already remaps legacy values ✓ (#16), remove initial-status / always-New ✓ (#12), mandatory assignment ✓ (#20), new status set + Revived + state machine + revival tracking ✓ (#21), timeline-driven priority + drop Critical ✓ (#9), kill Hot/Warm/Cold on the model ✓ (#9/#22), wire assign + quick-status routes ✓ (#13/#23), migration + idempotency ✓ (demo-safety). Sub-decisions (Management `sourceDetail`, conservative remap) implemented as specced.
- **Placeholder scan:** none — every step has concrete code/commands.
- **Type/name consistency:** `derivePriorityFromTimeline`, `canTransition`/`assertTransition`/`allowedNextStatuses`, `mapSource`/`mapBudgetSource`/`mapStatus`/`mapFollowUpType`/`NEW_SOURCES`, `changeLeadStatus` used identically across tasks and the model/controller/routes/migration. `Booked` is the internal value everywhere (UI "Booking" label is a later FE phase).

## Next phase plans (separate docs, authored just-in-time so code stays accurate)
2. Scoring rework (timeline 40% weight, rekeyed sourceQuality, drop Critical from analytics/copilot). 3. Amenity catalog + demand report. 4. Create/Edit wizard → 3 tabs. 5. Detail page redesign. 6. List + Funnel rename + statusConfig. 7. Convert-to-booking fix. 8. Hybrid search. 9. Demo reseed + E2E.
