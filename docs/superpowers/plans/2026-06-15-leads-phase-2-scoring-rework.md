# Leads Refactor — Phase 2: Scoring Rework — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make occupancy timeline the dominant scoring factor, rekey the source-quality scores to the 6 new lead sources, point the persisted lead priority at the timeline (so score recalculation never reintroduces a score-based or `Critical` priority), purge the removed `Critical`/`Unqualified` values from the AI copilot's lead functions, and fix a pre-existing route-shadowing bug.

**Architecture:** The scoring service (`services/leadScoringService.js`) keeps its structure; we change the `DEFAULT_SCORING_CONFIG` weights + source rules, the `calculateSourceScore` branching, and `updateLeadScore`'s priority assignment. The two pure factor functions (`calculateSourceScore`, `calculateTimelineScore`) are added to the export list so they can be unit-tested DB-free. The AI copilot (`services/copilotFunctions.js`) and the lead routes (`routes/leadRoutes.js`) get targeted cleanups.

**Tech Stack:** Node ESM, Express, Mongoose, Jest (`npm run test:unit`).

**Depends on Phase 1** (already merged into this branch): `utils/leadPriority.js` exports `derivePriorityFromTimeline`; the Lead model `priority` enum is `['High','Medium','Low','Very Low']`; `getLeadPriority` already drops `Critical`.

**Out of scope (later phases):** frontend score/temperature display, demo reseed, `qualificationStatus` thresholds (left as-is — it tracks the qualification workflow, not the priority band).

---

## File Structure

**Create:**
- `tests/unit/leadScoring.config.test.js` — DB-free tests for the config weights + source rules + the two pure factor functions + `getLeadPriority`.

**Modify:**
- `services/leadScoringService.js` — reweight `DEFAULT_SCORING_CONFIG`, rekey `sourceQuality.rules`, rewrite `calculateSourceScore` branching, export the two pure factor fns, point `updateLeadScore` priority at the timeline.
- `services/copilotFunctions.js` — drop `Critical` from lead-priority tool-schema enums + query filters + description text; drop `Unqualified` from lead-status `$nin`.
- `routes/leadRoutes.js` — move the one-segment literal GET/PUT routes above `router.route('/:id')` so they stop being shadowed.

---

## Task 1: Reweight scoring, rekey source quality, export pure factor fns

**Files:**
- Modify: `services/leadScoringService.js`
- Test: `tests/unit/leadScoring.config.test.js`

- [ ] **Step 1: Write the failing test**

```js
// tests/unit/leadScoring.config.test.js
import {
  DEFAULT_SCORING_CONFIG, getLeadPriority, calculateSourceScore, calculateTimelineScore,
} from '../../services/leadScoringService.js';

describe('lead scoring config + pure factor functions', () => {
  it('weights sum to 1.0 with occupancy timeline the single largest factor', () => {
    const c = DEFAULT_SCORING_CONFIG;
    const sum = c.budgetAlignment.weight + c.engagementLevel.weight + c.timelineUrgency.weight
      + c.sourceQuality.weight + c.recencyFactor.weight;
    expect(Math.round(sum * 100) / 100).toBe(1);
    expect(c.timelineUrgency.weight).toBe(0.40);
    [c.budgetAlignment.weight, c.engagementLevel.weight, c.sourceQuality.weight, c.recencyFactor.weight]
      .forEach((w) => expect(c.timelineUrgency.weight).toBeGreaterThan(w));
  });

  it('source-quality rules are keyed to the 6 new sources', () => {
    const r = DEFAULT_SCORING_CONFIG.sourceQuality.rules;
    expect(Object.keys(r).sort()).toEqual(
      ['channelPartner', 'coldCalling', 'direct', 'management', 'marketing', 'other', 'referral']);
    expect(r.referral).toBeGreaterThan(r.coldCalling);
  });

  it('calculateSourceScore maps each new source to its quality tier', () => {
    const cfg = DEFAULT_SCORING_CONFIG.sourceQuality;
    expect(calculateSourceScore({ source: 'Referral' }, cfg).rawScore).toBe(100);
    expect(calculateSourceScore({ source: 'Channel Partner' }, cfg).rawScore).toBe(85);
    expect(calculateSourceScore({ source: 'Management' }, cfg).rawScore).toBe(80);
    expect(calculateSourceScore({ source: 'Direct' }, cfg).rawScore).toBe(70);
    expect(calculateSourceScore({ source: 'Marketing' }, cfg).rawScore).toBe(55);
    expect(calculateSourceScore({ source: 'Cold Calling' }, cfg).rawScore).toBe(30);
    expect(calculateSourceScore({ source: 'Anything Else' }, cfg).rawScore).toBe(40); // other
  });

  it('calculateTimelineScore rewards immediacy and is the dominant signal', () => {
    const cfg = DEFAULT_SCORING_CONFIG.timelineUrgency;
    expect(calculateTimelineScore({ requirements: { timeline: 'immediate' } }, cfg).rawScore).toBe(100);
    expect(calculateTimelineScore({ requirements: { timeline: '1-3_months' } }, cfg).rawScore).toBe(85);
    expect(calculateTimelineScore({ requirements: { timeline: '12+_months' } }, cfg).rawScore).toBe(25);
  });

  it('getLeadPriority returns the 4 levels (no Critical)', () => {
    expect(getLeadPriority(99)).toBe('High');
    expect(getLeadPriority(65)).toBe('Medium');
    expect(getLeadPriority(45)).toBe('Low');
    expect(getLeadPriority(10)).toBe('Very Low');
    expect(['High', 'Medium', 'Low', 'Very Low']).toContain(getLeadPriority(88));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- leadScoring.config`
Expected: FAIL — `calculateSourceScore` / `calculateTimelineScore` are not exported (import is undefined), and source rules still have `walkIn`/`website`/etc.

- [ ] **Step 3a: Reweight `DEFAULT_SCORING_CONFIG`**

In `services/leadScoringService.js`, make these four weight edits (each is unique in context):

Find `  budgetAlignment: {\n    weight: 0.30,` → replace the weight line with `    weight: 0.25,`
Find `  engagementLevel: {\n    weight: 0.25,` → replace the weight line with `    weight: 0.20,`
Find `  timelineUrgency: {\n    weight: 0.20,` → replace the weight line with `    weight: 0.40,`
Find `  recencyFactor: {\n    weight: 0.10,` → replace the weight line with `    weight: 0.05,`

Concretely, apply each by matching the factor block. For budget:
```js
  budgetAlignment: {
    weight: 0.30,
```
→
```js
  budgetAlignment: {
    weight: 0.25,
```
For engagement:
```js
  engagementLevel: {
    weight: 0.25,
```
→
```js
  engagementLevel: {
    weight: 0.20,
```
For timeline:
```js
  timelineUrgency: {
    weight: 0.20,
```
→
```js
  timelineUrgency: {
    weight: 0.40,
```
For recency:
```js
  recencyFactor: {
    weight: 0.10,
```
→
```js
  recencyFactor: {
    weight: 0.05,
```

- [ ] **Step 3b: Rekey the `sourceQuality` block**

Find:
```js
  sourceQuality: {
    weight: 0.15,
    rules: {
      referral: 100,
      walkIn: 90,
      website: 75,
      propertyPortal: 70,
      socialMedia: 60,
      advertisement: 50,
      coldCall: 30,
      other: 40
    }
  },
```
Replace with:
```js
  sourceQuality: {
    weight: 0.10,
    // 2026-06 refactor: keyed to the 6 new lead sources.
    rules: {
      referral: 100,
      channelPartner: 85,
      management: 80,
      direct: 70,
      marketing: 55,
      coldCalling: 30,
      other: 40
    }
  },
```

- [ ] **Step 3c: Rewrite `calculateSourceScore` branching**

Find:
```js
    const sourceLower = source.toLowerCase().replace(/[-\s]/g, '');
    
    let sourceScore;
    if (sourceLower.includes('referral')) {
      sourceScore = config.rules.referral;
    } else if (sourceLower.includes('walkin')) {
      sourceScore = config.rules.walkIn;
    } else if (sourceLower.includes('website')) {
      sourceScore = config.rules.website;
    } else if (sourceLower.includes('portal') || sourceLower.includes('property')) {
      sourceScore = config.rules.propertyPortal;
    } else if (sourceLower.includes('social')) {
      sourceScore = config.rules.socialMedia;
    } else if (sourceLower.includes('advertisement') || sourceLower.includes('ad')) {
      sourceScore = config.rules.advertisement;
    } else if (sourceLower.includes('cold') || sourceLower.includes('call')) {
      sourceScore = config.rules.coldCall;
    } else {
      sourceScore = config.rules.other;
    }
```
Replace with:
```js
    const sourceLower = source.toLowerCase();

    // 2026-06 refactor: map the 6 new lead sources to their quality tier.
    let sourceScore;
    if (sourceLower.includes('referral')) {
      sourceScore = config.rules.referral;
    } else if (sourceLower.includes('channel')) {
      sourceScore = config.rules.channelPartner;
    } else if (sourceLower.includes('management')) {
      sourceScore = config.rules.management;
    } else if (sourceLower.includes('marketing')) {
      sourceScore = config.rules.marketing;
    } else if (sourceLower.includes('cold')) {
      sourceScore = config.rules.coldCalling;
    } else if (sourceLower.includes('direct')) {
      sourceScore = config.rules.direct;
    } else {
      sourceScore = config.rules.other;
    }
```

- [ ] **Step 3d: Export the two pure factor functions**

Find:
```js
// Export functions
export {
  calculateLeadScore,
  updateLeadScore,
  bulkUpdateLeadScores,
  DEFAULT_SCORING_CONFIG,
  getScoreGrade,
  getLeadPriority
};
```
Replace with:
```js
// Export functions
export {
  calculateLeadScore,
  updateLeadScore,
  bulkUpdateLeadScores,
  DEFAULT_SCORING_CONFIG,
  getScoreGrade,
  getLeadPriority,
  calculateSourceScore,
  calculateTimelineScore
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- leadScoring.config`
Expected: PASS (5 tests).

- [ ] **Step 5: Run the full suite (no regressions)**

Run: `npm run test:unit`
Expected: all suites pass (163 + new).

- [ ] **Step 6: Commit**

```bash
git add services/leadScoringService.js tests/unit/leadScoring.config.test.js
git commit -m "feat(leads): timeline-dominant scoring weights + new source-quality tiers

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Persist timeline-derived priority on score recalculation

**Files:**
- Modify: `services/leadScoringService.js` (`updateLeadScore`)

`updateLeadScore` currently sets `lead.priority = scoreResult.priority` (score-based). The model pre-save would override it with the timeline value, but the in-memory + returned value should already match. Point both at the timeline.

- [ ] **Step 1: Add the import** at the top of `services/leadScoringService.js`

Find:
```js
import mongoose from 'mongoose';
```
Replace with:
```js
import mongoose from 'mongoose';
import { derivePriorityFromTimeline } from '../utils/leadPriority.js';
```

- [ ] **Step 2: Use the timeline priority in `updateLeadScore`**

Find:
```js
    // Add new fields if they exist in the model
    if (lead.schema.paths.priority) lead.priority = scoreResult.priority;
    if (lead.schema.paths.confidence) lead.confidence = scoreResult.confidence;
```
Replace with:
```js
    // 2026-06 refactor: priority is timeline-derived, not score-derived. (The
    // model pre-save hook also enforces this; we set it here so the in-memory
    // doc + the returned payload are consistent without a re-fetch.)
    if (lead.schema.paths.priority) lead.priority = derivePriorityFromTimeline(lead.requirements?.timeline);
    if (lead.schema.paths.confidence) lead.confidence = scoreResult.confidence;
```

- [ ] **Step 3: Use the timeline priority in the returned payload**

Find:
```js
      newScore: scoreResult.totalScore,
      grade: scoreResult.grade,
      priority: scoreResult.priority,
      confidence: scoreResult.confidence,
```
Replace with:
```js
      newScore: scoreResult.totalScore,
      grade: scoreResult.grade,
      priority: derivePriorityFromTimeline(lead.requirements?.timeline),
      confidence: scoreResult.confidence,
```

- [ ] **Step 4: Syntax check + full suite**

Run: `node --check services/leadScoringService.js && npm run test:unit`
Expected: parse OK; all unit tests pass.

- [ ] **Step 5: Commit**

```bash
git add services/leadScoringService.js
git commit -m "fix(leads): score recalculation persists timeline-derived priority

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Purge Critical/Unqualified from the AI copilot lead functions

**Files:**
- Modify: `services/copilotFunctions.js`

These are functional: the tool-schema `enum`s tell the LLM which priority values exist, and the filters query by priority/status. Read each location and apply the edit.

- [ ] **Step 1: Tool-schema priority enums → 4 levels**

There are three tool-parameter schemas that declare a lead `priority` enum including `'Critical'`. Update each:

Find (first occurrence, ~line 270):
```js
          priority: { type: 'string', enum: ['Critical', 'High', 'Medium', 'Low', 'Very Low'] },
```
Replace with:
```js
          priority: { type: 'string', enum: ['High', 'Medium', 'Low', 'Very Low'] },
```

Find (the two occurrences, ~lines 506 and 549 — apply to BOTH):
```js
          priority: { type: 'string', enum: ['Critical', 'High', 'Medium', 'Low'] },
```
Replace each with:
```js
          priority: { type: 'string', enum: ['High', 'Medium', 'Low', 'Very Low'] },
```

- [ ] **Step 2: Description text**

Find (~line 295):
```js
      description: 'Get leads needing immediate attention — high/critical priority leads and overdue follow-ups.',
```
Replace with:
```js
      description: 'Get leads needing immediate attention — high priority leads and overdue follow-ups.',
```

- [ ] **Step 3: Priority query filters → drop the dead `Critical`**

Find (~line 1085):
```js
    const highPriorityLeads = await Lead.find({ ...filter, priority: { $in: ['Critical', 'High'] } })
```
Replace with:
```js
    const highPriorityLeads = await Lead.find({ ...filter, priority: { $in: ['High'] } })
```

Find (~line 1698):
```js
    const hotLeads = await Lead.countDocuments({ ...leadBaseFilter, priority: { $in: ['Critical', 'High'] }, status: { $nin: ['Booked', 'Lost', 'Unqualified'] } });
```
Replace with:
```js
    const hotLeads = await Lead.countDocuments({ ...leadBaseFilter, priority: { $in: ['High'] }, status: { $nin: ['Booked', 'Lost'] } });
```

- [ ] **Step 4: Verify no other functional lead-`Critical`/`Unqualified` remains**

Run: `grep -nE "Critical|Unqualified" services/copilotFunctions.js`
Expected remaining hits are ONLY the analytics `critical:`/`criticalCount` aggregation (~lines 1917/1936), which now simply counts 0 and is non-breaking — LEAVE it (changing the response shape could break a consumer). If you see any other `priority: ... 'Critical'` filter or `status: ... 'Unqualified'` for LEADS, fix it the same way. Do NOT touch task/approval priority.

- [ ] **Step 5: Syntax check + boot smoke**

Run: `node --check services/copilotFunctions.js`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add services/copilotFunctions.js
git commit -m "fix(leads): copilot lead functions drop Critical/Unqualified

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Fix pre-existing route shadowing in leadRoutes.js

**Files:**
- Modify: `routes/leadRoutes.js`

The one-segment literal routes `/high-priority`, `/needs-attention`, `/score-analytics`, `/scoring-config` (GET+PUT), `/simple-stats`, `/simple-overdue-followups`, `/scoring-health` are registered AFTER `router.route('/:id')`, so Express matches them as `/:id` and they're shadowed/broken. Move them above `/:id`. (Two-segment routes like `/:id/score` and `/by-priority/:priority` are unaffected and stay; `/bulk-recalculate-scores` is POST and unaffected, but move it with its neighbors for clarity.)

- [ ] **Step 1: Cut the scoring/aggregate route blocks**

Delete the following blocks from their current location (the "LEAD SCORING" + "SIMPLE PLACEHOLDER ROUTES" sections, everything from `router.get('/:id/score', ...)` through the `/scoring-health` handler), so they can be re-inserted. Specifically, the routes to relocate are: `/:id/score`, `/:id/recalculate-score`, `/:id/score-history` (these are two-segment and safe either way — keep them grouped, re-insert them too), `/high-priority`, `/needs-attention`, `/score-analytics`, `/bulk-recalculate-scores`, `/scoring-config`, `/simple-stats`, `/by-priority/:priority`, `/simple-overdue-followups`, `/scoring-health`.

To keep this mechanical and low-risk: **move the single line `router.route('/:id')` block and the `/:id/interactions` + `/:id/enrich` blocks to AFTER all the scoring/aggregate routes** instead of moving many blocks up. Concretely:

Find this block:
```js
router.route('/:id')
  .get(hasPermission(PERMISSIONS.LEADS.VIEW), getLeadById)
  .put(hasPermission(PERMISSIONS.LEADS.UPDATE), updateLead)
  .delete(hasPermission(PERMISSIONS.LEADS.DELETE), deleteLead);

router.route('/:id/interactions')
  .post(hasPermission(PERMISSIONS.LEADS.UPDATE), addInteractionToLead)
  .get(hasPermission(PERMISSIONS.LEADS.VIEW), getLeadInteractions);

router.post('/:id/enrich', hasPermission(PERMISSIONS.LEADS.UPDATE), enrichLead);
```
Cut it (remove from here).

- [ ] **Step 2: Re-insert it just before `export default router;`**

Find:
```js
// Health check
router.get('/scoring-health', (req, res) => {
  res.json({
    success: true,
    availableFunctions: {
      getLeadScore: true, recalculateLeadScore: true,
      getHighPriorityLeads: true, getLeadsNeedingAttention: true,
      getScoreAnalytics: true, bulkRecalculateScores: true,
      getLeadScoreHistory: true, getScoringConfig: true,
      updateScoringConfig: true,
    },
    message: 'Lead scoring system available.'
  });
});

export default router;
```
Replace with:
```js
// Health check
router.get('/scoring-health', (req, res) => {
  res.json({
    success: true,
    availableFunctions: {
      getLeadScore: true, recalculateLeadScore: true,
      getHighPriorityLeads: true, getLeadsNeedingAttention: true,
      getScoreAnalytics: true, bulkRecalculateScores: true,
      getLeadScoreHistory: true, getScoringConfig: true,
      updateScoringConfig: true,
    },
    message: 'Lead scoring system available.'
  });
});

// 2026-06 refactor: the catch-all `/:id` routes are registered LAST so the
// literal paths above (high-priority, needs-attention, score-analytics,
// scoring-config, simple-stats, simple-overdue-followups, scoring-health) are
// not shadowed by `/:id`. (Pre-existing bug fixed in Phase 2.)
router.route('/:id')
  .get(hasPermission(PERMISSIONS.LEADS.VIEW), getLeadById)
  .put(hasPermission(PERMISSIONS.LEADS.UPDATE), updateLead)
  .delete(hasPermission(PERMISSIONS.LEADS.DELETE), deleteLead);

router.route('/:id/interactions')
  .post(hasPermission(PERMISSIONS.LEADS.UPDATE), addInteractionToLead)
  .get(hasPermission(PERMISSIONS.LEADS.VIEW), getLeadInteractions);

router.post('/:id/enrich', hasPermission(PERMISSIONS.LEADS.UPDATE), enrichLead);

export default router;
```

NOTE: The `/:id/registration`, `/:id/proposal`, `/:id/assign`, `/:id/status` PATCH/PUT routes registered earlier (before this point) stay where they are — they are two-segment and already correctly placed; moving the bare `/:id` block to the end does not affect them. After this change, verify that `/:id/score`, `/:id/recalculate-score`, `/:id/score-history` still appear BEFORE the bare `/:id` block (they're in the SCORING section, which is above the health check) — they do, so they remain correctly ordered.

- [ ] **Step 3: Syntax check + boot smoke + route presence sanity**

Run:
```bash
node --check routes/leadRoutes.js
OPENAI_API_KEY=smoke-test node -e "import('./routes/leadRoutes.js').then(r=>{const stack=r.default.stack.filter(l=>l.route).map(l=>Object.keys(l.route.methods)[0].toUpperCase()+' '+l.route.path); const idIdx=stack.findIndex(s=>s==='GET /:id'); const hp=stack.findIndex(s=>s==='GET /high-priority'); console.log('high-priority before /:id =', hp>=0 && hp<idIdx); process.exit(hp>=0&&hp<idIdx?0:1)})"
```
Expected: `high-priority before /:id = true` (exit 0).

- [ ] **Step 4: Commit**

```bash
git add routes/leadRoutes.js
git commit -m "fix(leads): register /:id catch-all last so literal lead routes aren't shadowed

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Phase 2 verification

- [ ] **Step 1: Full unit suite** — `npm run test:unit` → all pass (incl. new `leadScoring.config`).
- [ ] **Step 2: Boot smoke** — `OPENAI_API_KEY=smoke-test node -e "import('./services/leadScoringService.js').then(()=>import('./services/copilotFunctions.js')).then(()=>import('./routes/leadRoutes.js')).then(()=>{console.log('OK');process.exit(0)}).catch(e=>{console.error(e);process.exit(1)})"` → `OK`.
- [ ] **Step 3: Optional live recalc smoke (running server, seeded lead):** `PUT /api/leads/:id/recalculate-score` returns 200; response `priority` matches the lead's timeline (immediate/1-3mo → High, etc.), never `Critical`.

## Self-Review (completed during planning)
- **Coverage:** timeline dominant weight ✓ (Task 1), source-quality rekey ✓ (Task 1), persisted priority = timeline ✓ (Task 2), copilot drops Critical/Unqualified ✓ (Task 3), route shadowing fixed ✓ (Task 4). qualificationStatus intentionally untouched (separate concept).
- **Placeholders:** none — concrete code/commands throughout.
- **Consistency:** `derivePriorityFromTimeline` (Phase 1), `calculateSourceScore`/`calculateTimelineScore` exported names, source-rule keys (`channelPartner`/`coldCalling`/etc.) match between config, branching, and tests.
