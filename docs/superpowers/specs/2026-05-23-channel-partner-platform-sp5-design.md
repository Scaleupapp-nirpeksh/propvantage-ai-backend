# Channel Partner Platform — SP5: Analytics, Commission Visibility & AI Insights

**Date:** 2026-05-23
**Status:** Approved for planning
**Repos:** `propvantage-ai-backend` (Node/Express/MongoDB/Mongoose), `propvantage-ai-frontend` (React 18 + MUI v5 + React Router v6)

---

## 1. Context

PropVantage AI is a two-sided platform (developers ⇄ channel partners). This is
**SP5** of the six-sub-project roadmap defined in
`2026-05-21-channel-partner-platform-sp1-design.md` (§2–§3). SP1 (CP orgs +
onboarding), SP2 (developer portfolio), SP3 (marketplace + partnership
lifecycle), and SP4 (cross-org lead lifecycle + standalone CP workspace) are
shipped. SP5 is the analytics & insight layer — it turns the data SP1–SP4
generate into actionable intelligence for both sides of the platform.

**SP5 — Analytics, Commission Visibility & AI Insights.** SP5 ships:

1. **Eight deterministic analytics areas** — five for the CP side
   (pipeline, commission, agents, developers, reconciliation), three for the
   dev side (CP scorecard, commission paid-out, lead quality signals). All
   read-only, all Mongo aggregations, all standalone-useful without AI.
2. **AI insights for the CP side** — every CP dashboard card carries an
   AI-generated narrative + recommendations; a dedicated `/partner/insights`
   page serves weekly/monthly digests; a CP-side Copilot answers free-form
   business questions. All three surfaces are grounded in a strict facts
   pack and a numeric/entity validator that rejects hallucinated claims.
3. **Existing dev-side Copilot extension** — three new tools register with
   `aiCopilotService.js` so dev staff can ask analytics questions about CPs
   without a new UI surface.
4. **Cost/quota plumbing** — per-CP-org rate limits, a per-period meter that
   distinguishes scheduled vs. on-demand generations (the SP6 monetization
   hook), and graceful degradation when AI fails or is rate-limited.
5. **Cross-org reconciliation** — the headline feature: a unified view that
   reconciles the CP's manual commission ledger (Prospect.commission, from
   SP4) against the developer's official `CommissionRecord` engine.

SP5 ends at: a CP can run their business by looking at the dashboards and
trusting the AI commentary; a developer can see which CPs are performing;
the platform has a working AI cost model with the meter in place for SP6 to
monetize.

This spec is **self-contained**: an engineer implementing this from a fresh
context can build SP5 with only this document + the existing codebase.

## 2. Decisions Locked (during brainstorming)

| Decision | Choice |
|---|---|
| Analytics scope | All 8 areas (5 CP-side + 3 dev-side) in SP5 |
| Anti-hallucination architecture | Hybrid: pre-computed facts pack + LLM narration + post-LLM validator |
| AI delivery surfaces | All three: embedded dashboard cards + dedicated Insights page + CP Copilot |
| Insight categories | All four: descriptive, diagnostic, predictive, prescriptive — with guard rails (forecasts deterministic, recommendations from candidate set) |
| AI scope | CP-only new surfaces; existing dev Copilot gains 3 new tools (no new dev UI) |
| LLM provider | OpenAI `gpt-4o` (matches existing `aiCopilotService`) |
| Cadence — cards | 24h cache + on-demand "Generate Now" |
| Cadence — digests | Sunday 22:00 IST cron + on-demand |
| Cadence — copilot | Live, per-message |
| Rate limiting | Per-org daily quota (default 200 generations/day) + hourly burst cap |
| Monetization meter | On-demand generations counted separately for SP6 billing |
| Empty/placeholder states | Beautiful "Available at \[date/time\]" UI on every scheduled surface |
| Graceful degradation | LLM failure → retry → deterministic template fallback; never blocks dashboard |
| Cross-tenant safety | Org scoping is non-overridable (middleware-injected); audit-logged |

## 3. Architecture

### 3.1 The four-layer stack

```
Layer 4 — UI surfaces
  • Dashboard insight cards (CP portal)
  • Weekly/monthly Insights page
  • CP-side AI Copilot (chat drawer)
  • Dev-side Copilot (existing — gains new analytics tools)

Layer 3 — Narrator + Validator (LLM)
  • System prompt constrains LLM to facts pack only
  • Generates prose / ranks candidates / explains
  • Validator: every cited number/name/citation must appear in facts pack
    OR insight is rejected and regenerated (max 2 retries → template fallback)

Layer 2 — Insight Engine (deterministic)
  • factsPackBuilder — assembles bounded JSON per surface
  • recommendationCandidates — rule library; pre-computes prescriptive options
  • Forecasts computed in code (linear projection / EWMA — no LLM math)
  • Every fact carries a citation (record ID + URL)

Layer 1 — Analytics Services (8 areas, deterministic)
  • CP-side via partnerAccessScope when reading cross-org data
  • All Mongo aggregations; no LLM in this layer
  • Standalone-useful without AI above it
```

**Architectural guarantees:**
- L1 standalone: dashboards work even if L3/L4 are disabled.
- L2 is the grounding boundary — anything not in a facts pack cannot be cited.
- L3 only narrates + ranks; never computes.
- Validator rejects ungrounded claims at the boundary.

## 4. Data Model

### 4.1 New model — `AIInsight` (cache)

Create `models/aiInsightModel.js`.

```js
{
  cpOrgId:        { type: ObjectId, ref: 'Organization', required: true, index: true },
  surface:        { type: String, required: true, index: true },     // 'pipeline_health' etc
  period:         { from: Date, to: Date, range: String },
  factsPackHash:  { type: String, required: true },                  // sha256 of facts pack
  narrative:      String,
  headlinedCandidates: [String],                                     // candidate IDs
  citations:      [{ label: String, url: String }],
  confidence:     { type: String, enum: ['high','medium','low','fallback'] },
  source:         { type: String, enum: ['scheduled','on_demand'], required: true },
  generatedAt:    { type: Date, default: Date.now },
  expiresAt:      { type: Date, required: true, index: true },        // TTL
  validationResult: {
    valid:              Boolean,
    retries:            Number,
    fellBackToTemplate: Boolean,
    failureReason:      String,
  },
  tokenUsage: {
    prompt:     Number,
    completion: Number,
    total:      Number,
    costUsd:    Number,
  },
}
```

**Indexes:**
- `{ cpOrgId: 1, surface: 1, expiresAt: -1 }` — cache lookups.
- `{ expiresAt: 1 }` — Mongo TTL index for auto-cleanup.

### 4.2 New model — `AIUsageMeter`

Create `models/aiUsageMeterModel.js`.

```js
{
  cpOrgId:               { type: ObjectId, ref: 'Organization', required: true, index: true },
  periodKey:             { type: String, required: true },           // 'YYYY-MM-DD' (daily)
  monthKey:              { type: String, required: true },           // 'YYYY-MM' (billing rollup)
  scheduledGenerations:  { type: Number, default: 0 },
  onDemandGenerations:   { type: Number, default: 0 },               // SP6 billable
  copilotMessages:       { type: Number, default: 0 },
  totalTokensUsed:       { type: Number, default: 0 },
  totalCostUsd:          { type: Number, default: 0 },
  rateLimitHits:         { type: Number, default: 0 },
  lastUpdatedAt:         Date,
}
```

**Indexes:**
- `{ cpOrgId: 1, periodKey: 1 }` unique.
- `{ cpOrgId: 1, monthKey: 1 }`.

### 4.3 `Organization` additions

Modify `models/organizationModel.js` — add optional sub-doc:

```js
aiQuota: {
  dailyQuota:  { type: Number, default: null },   // null = use config default
  hourlyQuota: { type: Number, default: null },
  plan:        { type: String, default: 'default' },  // SP6 monetization hook
}
```

### 4.4 `Prospect` additions (small)

Modify `models/prospectModel.js` — add an optional field for reconciliation tracking:

```js
reconciliationReviewedAt: { type: Date, default: null },
reconciliationReviewedBy: { type: ObjectId, ref: 'User', default: null },
```

### 4.5 Permissions

Modify `config/permissions.js` — add to the CP permission group:

```js
CP_ANALYTICS: {
  VIEW:      'cp_analytics:view',         // CP Owner/Manager/Agent (Agent auto-scoped)
  VIEW_TEAM: 'cp_analytics:view_team',    // CP Owner/Manager only
},
```

Modify `data/defaultChannelPartnerRoles.js`:
- **CP Owner** — both (via `ALL_CP_PERMISSIONS` — verify).
- **CP Manager** — both.
- **CP Agent** — `view` only.

**Backfill** — `data/backfillSp5CpAnalyticsPermissions.js` (idempotent `$addToSet` pattern, follow `data/backfillSp4CpPermissions.js`).

Dev side: **no new permissions.** Areas 6–8 reuse existing `analytics:read`.

## 5. Backend — Analytics Services (Layer 1)

### 5.1 Common patterns

- Query params: `range` (`7d | 30d | 90d | 6m | 12m | ytd | all`, default `30d`), optional `project`, optional `partnership` / `channelPartner`.
- Response shape: `{ summary: {...}, series: [...], breakdowns: {...}, generatedAt, range }`.
- Server-side cache: 5 minutes (analytics tolerate slight staleness).
- CP-side endpoints AND `partnerAccessScope(req)` whenever they read cross-org data.
- CP Agent auto-scoped to own data on any agent-breakdown query.

### 5.2 CP-side service — `services/analytics/cpAnalyticsService.js`

Implements areas 1–4. Functions:

| Function | Returns |
|---|---|
| `getPipelineHealth(orgId, params, user)` | `{ summary: {totalProspects, activeProspects, followUpsDueToday, followUpsDueThisWeek, agingOver30d, activityVolume7d, activityVolume30d}, breakdowns: {byStatus, funnel, aging}, series: {activityHeat[]} }` |
| `getCommissionOverview(orgId, params, user)` | `{ summary: {expected, received, outstanding, writtenOff, realisationRate}, breakdowns: {byStatus, byDeveloper, byAgent}, series: {byMonth[]} }` |
| `getAgentPerformance(orgId, params, user)` | `{ agents: [{userId, name, prospectsActive, prospectsBooked, conversionRate, avgTimeToBookingDays, activityVolume30d, commissionGenerated, compositeScore}] }`. Requires `cp_analytics:view_team`. |
| `getDeveloperPerformance(orgId, params, user)` | `{ developers: [{id, name, context: 'external'\|'platform', prospects, conversionRate, deltaVsOverall, avgTimeToBookingDays, commissionRealised, leadAcceptanceRate}] }` |

All four functions apply CP Agent auto-scoping when `user.role === 'CP Agent'`.

### 5.3 CP-side service — `services/analytics/commissionReconciliationService.js`

Implements area 5 — the headline cross-org feature. Functions:

| Function | Returns |
|---|---|
| `getReconciliationOverview(orgId, params, user)` | `{ summary: {matched, cpOnly, devOnly, mismatched, totalDiscrepancy}, rows: [...] }` |
| `getReconciliationDetail(orgId, prospectId, user)` | `{ prospect, cpLedger, devRecord, status, discrepancy, explanation, citations }` |
| `markReviewed(orgId, prospectId, user)` | Sets `reconciliationReviewedAt/By` on the Prospect. Returns updated record. |

**Reconciliation logic:**
1. For each `Prospect` in the CP org with `pushedToLead` set:
   - Read CP ledger from `Prospect.commission`.
   - Read dev record from `CommissionRecord` (joined to the Lead, filtered by `partnerAccessScope`).
2. Compute status:
   - `matched`: both exist; `abs(cpExpected - devExpected) / devExpected ≤ 0.01` AND `abs(cpReceived - devPaid) / devPaid ≤ 0.01`.
   - `cp_only`: CP has ledger but no CommissionRecord exists for the Lead AND the Lead status indicates one *should* exist (default trigger statuses: `Booked` and later — configurable in `config/insightSurfaces.js`).
   - `dev_only`: CommissionRecord exists but Prospect has no `commissionAgreement` or `expectedAmount === 0`.
   - `mismatched`: both exist but amounts diverge > ±1%.
3. Tolerance configurable via `INSIGHT_VALIDATOR_NUMERIC_TOLERANCE` env var (default `0.01`).

### 5.4 Dev-side service — `services/analytics/devAnalyticsService.js`

Implements areas 6–8. Functions:

| Function | Returns |
|---|---|
| `getChannelPartnerScorecard(orgId, params, user)` | `{ partners: [{partnershipId, channelPartnerOrg, leadsSubmitted, accepted, rejected, acceptRate, conversionRate, avgTimeToDecisionHours, commissionPaidYtd, partnerQualityScore}] }` |
| `getCommissionPayouts(orgId, params, user)` | `{ summary: {paidThisPeriod, outstanding, cpsPaid, avgPayoutPerCp}, breakdowns: {byCp, byProject}, series: {byMonth[]} }` |
| `getLeadQuality(orgId, params, user)` | `{ partners: [{channelPartnerOrg, totalSubmitted, accepted, rejected, acceptRate, topRejectionReasons[], duplicateFlagRate, proposalsSubmitted, proposalsAccepted, leadQualityScore}] }` |

Read-only; org-scoped to the dev org.

### 5.5 Controllers & routes

**Create `controllers/cpAnalyticsController.js`** + **`routes/cpAnalyticsRoutes.js`** mounted at `/api/cp/analytics`. All routes: `protect` + `requireOrgType('channel_partner')` + `cp_analytics:view` (agent-breakdown route requires `cp_analytics:view_team`).

| Method | Path | Permission |
|---|---|---|
| GET | `/api/cp/analytics/pipeline` | `cp_analytics:view` |
| GET | `/api/cp/analytics/commission` | `cp_analytics:view` |
| GET | `/api/cp/analytics/agents` | `cp_analytics:view_team` |
| GET | `/api/cp/analytics/developers` | `cp_analytics:view` |
| GET | `/api/cp/analytics/reconciliation` | `cp_analytics:view` |
| GET | `/api/cp/analytics/reconciliation/:prospectId` | `cp_analytics:view` |
| POST | `/api/cp/analytics/reconciliation/:prospectId/reviewed` | `cp_analytics:view` |

**Extend `routes/analyticsRoutes.js`** (or create `controllers/devAnalyticsController.js` if the codebase has a separate analytics controller pattern):

| Method | Path | Permission |
|---|---|---|
| GET | `/api/analytics/channel-partners` | `analytics:read` |
| GET | `/api/analytics/commission-payouts` | `analytics:read` |
| GET | `/api/analytics/lead-quality` | `analytics:read` |

## 6. Backend — AI Insights Infrastructure (Layers 2 & 3)

### 6.1 Surface configuration — `config/insightSurfaces.js`

```js
export const insightSurfaces = {
  pipeline_health: {
    factsPackBuilder: 'buildPipelineHealthPack',
    candidateRules:   ['agingProspects','overdueFollowUps','stagnantStages'],
    promptTemplate:   'pipelineHealthTemplate',
    validator:        'standardNumericValidator',
    cacheTtl:         24 * 60 * 60 * 1000,
    scheduledFor:     null,
    minConfidence:    'medium',
  },
  commission_overview: {
    factsPackBuilder: 'buildCommissionOverviewPack',
    candidateRules:   ['forecastedShortfall','reconciliationMismatches','weekOverWeekChanges'],
    promptTemplate:   'commissionOverviewTemplate',
    validator:        'standardNumericValidator',
    cacheTtl:         24 * 60 * 60 * 1000,
    scheduledFor:     null,
    minConfidence:    'medium',
  },
  agent_performance: {
    factsPackBuilder: 'buildAgentPerformancePack',
    candidateRules:   ['topAgents','weakAgents'],
    promptTemplate:   'agentPerformanceTemplate',
    validator:        'standardNumericValidator',
    cacheTtl:         24 * 60 * 60 * 1000,
    minConfidence:    'medium',
  },
  developer_performance: {
    factsPackBuilder: 'buildDeveloperPerformancePack',
    candidateRules:   ['topDevelopers','weakDevelopers'],
    promptTemplate:   'developerPerformanceTemplate',
    validator:        'standardNumericValidator',
    cacheTtl:         24 * 60 * 60 * 1000,
    minConfidence:    'medium',
  },
  commission_reconciliation: {
    factsPackBuilder: 'buildReconciliationPack',
    candidateRules:   ['reconciliationMismatches'],
    promptTemplate:   'reconciliationTemplate',
    validator:        'standardNumericValidator',
    cacheTtl:         24 * 60 * 60 * 1000,
    minConfidence:    'medium',
  },
  weekly_digest: {
    factsPackBuilder: 'buildWeeklyDigestPack',
    candidateRules:   ['topDevelopers','topAgents','agingProspects','reconciliationMismatches','weekOverWeekChanges'],
    promptTemplate:   'weeklyDigestTemplate',
    validator:        'standardNumericValidator',
    cacheTtl:         7 * 24 * 60 * 60 * 1000,
    scheduledFor:     'INSIGHT_DIGEST_CRON_WEEKLY',
    minConfidence:    'low',
  },
  monthly_digest: {
    factsPackBuilder: 'buildMonthlyDigestPack',
    candidateRules:   ['topDevelopers','topAgents','weakDevelopers','weakAgents','forecastedShortfall','reconciliationMismatches'],
    promptTemplate:   'monthlyDigestTemplate',
    validator:        'standardNumericValidator',
    cacheTtl:         30 * 24 * 60 * 60 * 1000,
    scheduledFor:     'INSIGHT_DIGEST_CRON_MONTHLY',
    minConfidence:    'low',
  },
};
```

### 6.2 Facts pack builder — `services/ai/factsPackBuilder.js`

One builder function per surface. Each produces a strictly-bounded JSON object:

```js
{
  surface:     'pipeline_health',
  generatedAt: '2026-05-23T10:30:00Z',
  period:      { range, from, to },
  scope:       { cpOrgId, cpOrgName, userScope: 'org' | 'agent', agentId? },
  hasInsufficientData: false,
  metrics: { /* every value cited by AI must live here */ },
  notableRecords: { /* lists capped at 5 items per category */ },
  candidates:  { recommendations: [...] },  // populated from recommendationCandidates
}
```

**Hard rules enforced by the builder:**
- Total facts pack ≤ `INSIGHT_FACTS_PACK_MAX_TOKENS` (default 4000). Truncate `notableRecords` first, never `metrics`.
- Every number under `metrics` comes from an analytics service — builder never derives new numbers.
- Every named entity carries a `citation` (record URL).
- `hasInsufficientData: true` when N < threshold (defined per builder); in that case the surface skips the LLM call entirely.

### 6.3 Recommendation candidates — `services/ai/recommendationCandidates.js`

Rule library. Each rule is a pure function `(metrics, params) → Candidate[]`.

```js
{
  id:                  'focus_developer_skyline',
  type:                'developer_focus',
  evidence:            { developerName, cpConversionWithThisDev, cpOverallConversion, deltaPct, activeProspectsAgingInNegotiating },
  defaultAction:       'Schedule site visits this week for the 3 negotiating prospects',
  evidenceCitations:   [...urls],
  confidence:          'high',     // based on sample size + statistical strength
  priorityScore:       87,         // for ranking
}
```

**Initial rule catalog:**

| Rule key | Trigger condition | Type |
|---|---|---|
| `agingProspects` | Prospect > 30d in non-terminal status | aging |
| `overdueFollowUps` | `followUp.nextDate` past + status not terminal | followup |
| `stagnantStages` | Funnel stage where conversion < 0.5 × overall | diagnostic |
| `topDevelopers` | Developer with CP conversion ≥ 1.3 × overall (n ≥ 10) | developer_focus |
| `weakDevelopers` | Developer with CP conversion ≤ 0.5 × overall (n ≥ 10) | developer_warning |
| `topAgents` | Agent with conversion ≥ 1.3 × team avg (n ≥ 10) | agent_recognition |
| `weakAgents` | Agent with conversion ≤ 0.5 × team avg + activity vol < median | agent_coaching |
| `reconciliationMismatches` | Mismatch > ±1% on commission reconciliation | reconciliation |
| `weekOverWeekChanges` | Any headline metric changed > 25% WoW | trend |
| `forecastedShortfall` | Linear projection of next-30d bookings < trailing 30d × 0.7, requires ≥ 8 weeks data | forecast |

Each rule returns top-N candidates by `priorityScore`. The surface config decides which rules to invoke and how many top candidates to pass to the LLM (e.g., 5 for a card, 12 for a digest).

### 6.4 Narrator — `services/ai/insightNarrator.js`

Wraps OpenAI gpt-4o with function-calling disabled (we want structured-JSON output, not tool use here).

```js
async function narrate(surface, factsPack) {
  const config = insightSurfaces[surface];
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user',   content: buildUserPrompt(config.promptTemplate, factsPack) },
  ];
  const response = await openai.chat.completions.create({
    model:           process.env.COPILOT_MODEL || 'gpt-4o',
    messages,
    response_format: { type: 'json_object' },
    temperature:     0.3,
    max_tokens:      Number(process.env.INSIGHT_NARRATIVE_MAX_TOKENS) || 800,
  });
  return JSON.parse(response.choices[0].message.content);
  // shape: { narrative, headlinedCandidates: [...candidateIds], confidence, citations: [...urls] }
}
```

**`SYSTEM_PROMPT` (verbatim concept):**

> "You are a real-estate channel partner business analyst. You will be given a
> strictly-bounded JSON facts pack. You MUST follow these rules:
> 1. Every number you mention must appear in the facts pack. Do not compute new
>    numbers — not even averages or percentages.
> 2. Every person/developer/project name you mention must appear in the facts
>    pack.
> 3. To make a recommendation, you must select from
>    `candidates.recommendations[]`. You may not invent recommendations.
> 4. If you cannot make a confident claim from the facts pack, say so
>    explicitly — do not fill in plausible-sounding detail.
> 5. Output strict JSON with shape `{ narrative: string, headlinedCandidates:
>    string[], confidence: 'high'|'medium'|'low', citations: string[] }`.
>    The `citations` array must list every `citation` URL referenced.
> 6. Keep the narrative under 120 words for dashboard cards, under 400 words
>    for digests. Plain prose, no headings."

Prompt templates live in `services/ai/promptTemplates.js` — one per surface.

### 6.5 Validator — `services/ai/insightValidator.js`

`standardNumericValidator(response, factsPack) → { valid, reason? }`:

1. Extract every number-like token from `narrative` (regex covering digits, decimals, %, ₹, units).
2. For each number, search the facts pack recursively. Match within ±`INSIGHT_VALIDATOR_NUMERIC_TOLERANCE` (default 0.01). Fail if any number is not found.
3. Extract proper nouns (capitalized multi-word sequences); for each, search the facts pack for an exact match in any `name`, `developerName`, `agentName`, or `prospectName` field. Fail if any entity is not found.
4. Every `headlinedCandidates[]` ID must exist in `factsPack.candidates.recommendations[].id`.
5. Every `citations[]` URL must match a `citation` field somewhere in the facts pack.

On failure → narrator retries up to `INSIGHT_VALIDATOR_MAX_RETRIES` (default 2) with a feedback prompt ("Your response cited number X / entity Y which is not in the facts pack — regenerate"). If still failing, fall back to `deterministicTemplate(surface, factsPack)` — a hardcoded sentence-builder using `factsPack.metrics` directly. The fallback insight has `confidence: 'fallback'`.

Every validation outcome is logged (`AIInsight.validationResult`).

### 6.6 The insight pipeline — `services/ai/insightPipeline.js`

The orchestrator. One entry point:

```js
async function getOrGenerateInsight(surface, cpOrgId, user, opts = {}) {
  const cached = await findFreshCache(surface, cpOrgId);
  if (cached && !opts.forceRegenerate) return cached;

  // Lock to prevent concurrent regeneration for the same (org, surface).
  const lock = await acquireLock(surface, cpOrgId);
  try {
    const cached2 = await findFreshCache(surface, cpOrgId);   // re-check post-lock
    if (cached2 && !opts.forceRegenerate) return cached2;

    const factsPack = await factsPackBuilder.build(surface, cpOrgId, user, opts.range);
    if (factsPack.hasInsufficientData) {
      return cacheAndReturn({ surface, cpOrgId, narrative: null, confidence: 'fallback',
                              source: opts.forceRegenerate ? 'on_demand' : 'scheduled',
                              insufficientData: true, factsPack });
    }
    factsPack.candidates = recommendationCandidates.collect(surface, factsPack);

    let narration, validation, retries = 0;
    while (retries <= MAX_RETRIES) {
      narration  = await insightNarrator.narrate(surface, factsPack);
      validation = insightValidator.validate(narration, factsPack);
      if (validation.valid) break;
      retries++;
    }

    if (!validation.valid) {
      narration = deterministicTemplate(surface, factsPack);
    }

    return cacheAndReturn({ surface, cpOrgId, narration, factsPack,
                            validationResult: { ...validation, retries,
                                                fellBackToTemplate: !validation.valid },
                            source: opts.forceRegenerate ? 'on_demand' : 'scheduled' });
  } finally {
    await releaseLock(lock);
  }
}
```

`acquireLock`/`releaseLock` use a short-lived Mongo sentinel doc (collection `AIInsightLock`, TTL 60s, unique on `{cpOrgId, surface}`) — implementer may swap to in-memory `Map` if simpler.

### 6.7 Endpoints — insight + usage

**Create `controllers/cpInsightController.js`** + `routes/cpInsightRoutes.js` mounted at `/api/cp/insights`. All routes: `protect` + `requireOrgType('channel_partner')` + `cp_analytics:view` + `aiRateLimit` middleware.

| Method | Path | Handler |
|---|---|---|
| GET | `/api/cp/insights/:surface` | `getOrGenerateInsight` (uses cache if available) |
| POST | `/api/cp/insights/:surface/generate` | `getOrGenerateInsight` with `forceRegenerate=true` |

**Create `controllers/cpAiUsageController.js`** + `routes/cpAiUsageRoutes.js`:

| Method | Path | Handler |
|---|---|---|
| GET | `/api/cp/ai/usage` | Returns current period meter + quota. |

### 6.8 Rate-limit middleware — `middlewares/aiRateLimit.js`

Pseudocode:

```js
export async function aiRateLimit(req, res, next) {
  const orgId = req.organization._id;
  const periodKey = currentDailyPeriodKey();
  let meter = await AIUsageMeter.findOneAndUpdate(
    { cpOrgId: orgId, periodKey },
    { $setOnInsert: { monthKey: currentMonthKey() } },
    { upsert: true, new: true }
  );
  const quota = await getOrgQuota(req.organization);
  const dailyUsed = meter.scheduledGenerations + meter.onDemandGenerations + meter.copilotMessages;

  if (dailyUsed >= quota.dailyQuota) {
    await AIUsageMeter.updateOne({_id: meter._id}, { $inc: { rateLimitHits: 1 } });
    return res.status(429).json({
      error: 'ai_quota_exceeded',
      message: `Daily AI quota reached (${quota.dailyQuota}). Resets at midnight IST.`,
      resetsAt: nextMidnightIst(),
      meter: { dailyUsed, dailyQuota: quota.dailyQuota },
    });
  }
  next();
}
```

`getOrgQuota(org)` reads `org.aiQuota.dailyQuota` if set, else falls back to `INSIGHT_DEFAULT_DAILY_QUOTA`.

### 6.9 Usage-meter increments

`services/ai/aiUsageMeterService.js` exposes `incrementMeter(cpOrgId, kind, tokenUsage)` where `kind ∈ { 'scheduled', 'on_demand', 'copilot' }`. Called from the insight pipeline and copilot service immediately after a successful LLM call.

### 6.10 CP Copilot — `services/cpCopilotService.js`

Mirrors `aiCopilotService.js` architecture but:
- Different system prompt (CP business analyst persona — same anti-hallucination rules as the narrator).
- Different tool catalog: `services/cpCopilotFunctions.js`.
- Same OpenAI gpt-4o + function-calling pattern.
- Same in-memory conversation store (30-min TTL, 10-message rolling window).

**Tool catalog:**

| Tool | Description | Returns |
|---|---|---|
| `getPipelineHealth` | Pipeline metrics for a range | Area 1 shape + citations |
| `getCommissionOverview` | Commission metrics for a range | Area 2 shape + citations |
| `getAgentPerformance` | Per-agent breakdown (Manager/Owner only) | Area 3 shape + citations |
| `getDeveloperPerformance` | Per-developer breakdown | Area 4 shape + citations |
| `getReconciliationStatus` | Reconciliation summary or specific prospect | Area 5 shape + citations |
| `findProspects` | Search prospects by name/phone/email/status/agent | Top 10 + citations |
| `getProspectDetail` | One prospect's full record | Detail + citation |

**Critical safety:** tool functions read `req.user.organization._id` from middleware — scoping is non-overridable. Tools do NOT accept an `organizationId` argument. Cross-org reads (e.g., `findProspects` showing dev-side Lead context) go through `partnerAccessScope`.

**Endpoint** — `controllers/cpCopilotController.js` + `routes/cpCopilotRoutes.js`:

| Method | Path | Permission |
|---|---|---|
| POST | `/api/cp/copilot/message` | `cp_analytics:view` + `aiRateLimit` |

Body: `{ conversationId, message }`. Returns: `{ conversationId, response, citations, toolCallsExecuted }`. Increments `aiUsageMeter.copilotMessages`.

### 6.11 Dev-side Copilot extension

Extend `services/copilotFunctions.js` with three new tools, registered with the existing dev Copilot:

```js
{
  name:        'getChannelPartnerScorecard',
  description: 'Get performance scorecard for active channel partners over a date range.',
  parameters:  { range: 'string (7d|30d|...)', channelPartnerId: 'string optional' },
  execute:     (args, user) => devAnalyticsService.getChannelPartnerScorecard(user.organization._id, args, user),
}
{
  name:        'getCommissionPaidOut',
  description: 'Get commission payout summary by channel partner, project, or month.',
  parameters:  { range: 'string', groupBy: '"cp"|"project"|"month"' },
  execute:     (args, user) => devAnalyticsService.getCommissionPayouts(user.organization._id, args, user),
}
{
  name:        'getLeadQualityByPartner',
  description: 'Get lead quality signals per channel partner.',
  parameters:  { range: 'string', channelPartnerId: 'string optional' },
  execute:     (args, user) => devAnalyticsService.getLeadQuality(user.organization._id, args, user),
}
```

No new controller, no new dev-side UI. The existing dev Copilot picks up the tools automatically.

### 6.12 Scheduled digest job — `jobs/generateScheduledInsights.js`

- Cron: `INSIGHT_DIGEST_CRON_WEEKLY` (default `"0 22 * * 0"` Sunday 22:00 IST) for weekly, `INSIGHT_DIGEST_CRON_MONTHLY` (default `"0 22 1 * *"`) for monthly.
- Implementation: reuses the codebase's existing scheduled-job pattern (confirm by inspecting `cronJobs/` or similar at impl time).
- Iterates active CP orgs (`Organization.type === 'channel_partner'` AND `(active partnership count > 0 OR active prospect count > 0)` — skip dormant orgs).
- For each, calls `insightPipeline.getOrGenerateInsight('weekly_digest' | 'monthly_digest', orgId, systemUser, { forceRegenerate: true })`.
- Per-org try/catch — one org failing doesn't poison the batch.
- Logs summary: `{ totalOrgs, succeeded, failedOrgs[], totalCostUsd, totalLatencyMs }`.

### 6.13 Environment variables (add to `.env.example`)

```bash
COPILOT_MODEL=gpt-4o
INSIGHT_DEFAULT_DAILY_QUOTA=200
INSIGHT_DEFAULT_HOURLY_QUOTA=50
INSIGHT_FACTS_PACK_MAX_TOKENS=4000
INSIGHT_NARRATIVE_MAX_TOKENS=800
INSIGHT_CACHE_TTL_HOURS=24
INSIGHT_DIGEST_CRON_WEEKLY="0 22 * * 0"
INSIGHT_DIGEST_CRON_MONTHLY="0 22 1 * *"
INSIGHT_VALIDATOR_MAX_RETRIES=2
INSIGHT_VALIDATOR_NUMERIC_TOLERANCE=0.01
INSIGHT_DEFAULT_TIMEZONE="Asia/Kolkata"
```

### 6.14 App wiring

Modify the app entrypoint:

```js
app.use('/api/cp/analytics', require('./routes/cpAnalyticsRoutes'));
app.use('/api/cp/insights',  require('./routes/cpInsightRoutes'));
app.use('/api/cp/ai',        require('./routes/cpAiUsageRoutes'));
app.use('/api/cp/copilot',   require('./routes/cpCopilotRoutes'));
// Dev-side: extend existing analyticsRoutes or mount additions.
// Register the scheduled job (cron).
```

## 7. Frontend

### 7.1 API client additions — `src/services/api.js`

```js
export const cpAnalyticsAPI = {
  getPipeline:               (params) => api.get('/cp/analytics/pipeline', { params }),
  getCommission:             (params) => api.get('/cp/analytics/commission', { params }),
  getAgents:                 (params) => api.get('/cp/analytics/agents', { params }),
  getDevelopers:             (params) => api.get('/cp/analytics/developers', { params }),
  getReconciliation:         (params) => api.get('/cp/analytics/reconciliation', { params }),
  getReconciliationDetail:   (id)     => api.get(`/cp/analytics/reconciliation/${id}`),
  markReconciliationReviewed:(id)     => api.post(`/cp/analytics/reconciliation/${id}/reviewed`),
};

export const cpInsightsAPI = {
  get:        (surface, params) => api.get(`/cp/insights/${surface}`, { params }),
  generate:   (surface, body)   => api.post(`/cp/insights/${surface}/generate`, body),
  usage:      ()                => api.get('/cp/ai/usage'),
};

export const cpCopilotAPI = {
  message: (data) => api.post('/cp/copilot/message', data),
};

export const devAnalyticsAPI = {
  getChannelPartnerScorecard: (params) => api.get('/analytics/channel-partners', { params }),
  getCommissionPayouts:       (params) => api.get('/analytics/commission-payouts', { params }),
  getLeadQuality:             (params) => api.get('/analytics/lead-quality', { params }),
};
```

### 7.2 Shared AI components — `src/components/ai/`

- `AIInsightCard.jsx` — props `{ surface, range?, compact? }`. Handles all states from §4.1: fresh, generating, low-confidence fallback, error, scheduled-placeholder, quota-exceeded.
- `AINarrative.jsx` — renders prose; inline pill citations expand the panel.
- `AICitationsPanel.jsx` — expandable list of cited URLs.
- `AIConfidenceBadge.jsx` — color-coded chip (high=green, medium=neutral, low=amber, fallback=grey).
- `AIGenerateNowButton.jsx` — encapsulates on-demand call + loading + quota gating.
- `AIScheduledPlaceholder.jsx` — §4.3 beautiful placeholder. Props `{ surface, nextRunAt, copy }`.
- `AIQuotaIndicator.jsx` — small "47 generations left today" text.
- `CpCopilotDrawer.jsx` + FAB trigger.

All under `src/components/ai/`. Chart library: match what the codebase already uses.

### 7.3 CP Dashboard — `src/pages/cp-portal/CpPortalDashboardPage.js`

Modify the existing page. Layout: 5-card responsive grid. Cards:

1. **Pipeline Health** — funnel chart + KPIs + `<AIInsightCard surface="pipeline_health" />`.
2. **Commission Overview** — stacked bar + KPI strip + `<AIInsightCard surface="commission_overview" />`. "View details" → `/partner/commission`.
3. **Agent Performance** *(Manager/Owner only)* — ranked table + `<AIInsightCard surface="agent_performance" />`. "View details" → CP Team page Performance tab.
4. **Developer Performance** — ranked table + delta-vs-overall + `<AIInsightCard surface="developer_performance" />`. "View details" → `/partner/developers/performance`.
5. **Commission Reconciliation** — four KPI tiles + donut + `<AIInsightCard surface="commission_reconciliation" />`. "View details" → `/partner/commission/reconciliation`.

### 7.4 New CP-side pages

| Path | File | Notes |
|---|---|---|
| `/partner/insights` | `src/pages/cp-portal/CpInsightsPage.js` | Tabs: This Week / This Month / Custom. Uses `<AIInsightCard surface="weekly_digest"\|"monthly_digest" />` rendered in digest mode (non-compact). Custom-range triggers on-demand. Pre-cron: `<AIScheduledPlaceholder />`. |
| `/partner/commission` | `src/pages/cp-portal/CommissionDashboardPage.js` | Deep-dive: KPIs, time-series, by-developer/by-agent tables, by-status breakdown, filtered prospects list, AI card. |
| `/partner/commission/reconciliation` | `src/pages/cp-portal/ReconciliationDashboardPage.js` | Headline cross-org view: 4 filter-tab KPI tiles, sortable table, drill-through drawer, mark-reviewed action, AI card. |
| `/partner/developers/performance` | `src/pages/cp-portal/DeveloperPerformanceDetailPage.js` | Two-pane: developer list + detail; AI card parameterised per developer. |

### 7.5 Dev-side new pages

| Path | File | Notes |
|---|---|---|
| `/analytics/channel-partners` | `src/pages/analytics/ChannelPartnerScorecardPage.js` | Ranked partners table + per-CP detail drawer; range selector. Deterministic only. |
| `/analytics/commission-payouts` | `src/pages/analytics/CommissionPayoutsPage.js` | KPIs, monthly chart, by-CP table, by-project breakdown, drill-through to records. |
| `/analytics/lead-quality` | `src/pages/analytics/LeadQualityPage.js` | Per-CP quality metrics + top rejection reasons + composite score. |

### 7.6 Navigation

**CP portal shell** (`src/components/layout/ChannelPartnerLayout.js`):
- Add nav items: **Insights** → `/partner/insights`; **Commission** → `/partner/commission` (sub-item *Reconciliation*); **Developer Performance** → `/partner/developers/performance` (under Marketplace group).
- Mount the floating CP Copilot FAB on every CP portal page.

**Dev app shell** (`src/components/layout/DashboardLayout.js`):
- Under the existing Analytics nav, add: **Channel Partners**, **Commission Payouts**, **Lead Quality**.

### 7.7 Existing CP Team page

The existing SP1 CP Team page gains a new "Performance" tab that consumes `cpAnalyticsAPI.getAgents`. Reuses the agent-performance breakdown from area 3.

## 8. Scope Boundaries — Not in SP5

- **CP subscription & billing** → SP6 (the meter exists for it).
- **PDF/email export of digests.**
- **Push/email notifications for AI insights** — in-app pull only.
- **AI for dev-side new surfaces** — dev-side AI is only via the existing Copilot's expanded tool catalog.
- **ML-based forecasting** — forecasts are linear projection / EWMA in code.
- **Cross-CP benchmarking** ("you're in the top 20%") — defer.
- **Voice copilot, multi-language insights, mobile-specific AI UX** — defer.
- **Custom user-defined recommendation rules** — rule library is code-defined.
- **Real-time insight refresh** — caching is intentional.

## 9. Edge Cases

| Case | Behaviour |
|---|---|
| New CP org, zero prospects | All analytics return zeroed summaries. AI cards detect `hasInsufficientData` and render a friendly empty state without calling the LLM. |
| CP with very small N (< 10 prospects, < 5 bookings) | Candidates with sample-size thresholds are filtered out. Confidence forced to `low` or `fallback`. |
| CP Agent narrowing | Facts pack assembled from agent-scoped data only. AI narrative can only reference the agent's own records. Cross-org audit log captures the scoping filter. |
| Concurrent on-demand requests | Mongo sentinel lock — first request locks `(cpOrgId, surface)`; concurrent requests await + receive the same result. |
| Facts pack changed during generation | Cached entry stores the facts-pack hash. On next read, if data drift exceeds the threshold, cache invalidates early. |
| LLM returns malformed JSON | Validation failure → retry → fallback template. |
| LLM cites a near-but-not-exact number (22.4% vs 22%) | Validator allows ±1% rounding (configurable). |
| LLM invents a developer/agent name | Validator catches via entity check → retry → fallback. Logged. |
| Mongo aggregation timeout on a large CP org | Endpoint 503 with retry guidance. Dashboard partial-renders; AI card hidden until analytics recover. |
| Cron failure for one org | Per-org try/catch; failed orgs in summary; manual `POST /generate` retry available. |
| Time zone — "Updated 4h ago" + cron | Server stores UTC; frontend formats in user's TZ (`INSIGHT_DEFAULT_TIMEZONE` default `Asia/Kolkata`). Cron expressions interpreted in IST. |
| Multi-currency commission | Prospect/CommissionRecord currency preserved; analytics aggregate per-currency; narrator must always state currency code. |
| Forecasted shortfall without baseline | `forecastedShortfall` rule requires ≥ 8 weeks data; otherwise emits zero candidates. |
| Zero candidates from rules | Narrative is purely descriptive; no prescriptive section. |
| Reconciliation when CommissionRecord doesn't exist yet | Status = `cp_only` only when Lead status indicates one *should* exist (default trigger: `Booked` and later — configurable). |
| OpenAI 429/5xx | Last cached insight served with "Refresh failed — using last available" banner. Retry button surfaces. |
| Rate limit reached mid-day | AI buttons disabled in UI; deterministic dashboards still work; toast shows reset time. |
| Citation link to deleted record | 404 with friendly message; AI cache invalidates on next read. |
| Org-quota override (future paid plan) | `Organization.aiQuota.dailyQuota` overrides config default. |

## 10. Testing

### 10.1 Backend regression suites (`tests/regression/suites/sp5-*.js`)

Follow the SP3/SP4 suite pattern (live-API assertions; mock the OpenAI client at the SDK boundary; no real LLM calls).

1. `sp5-cp-analytics.js` — Areas 1–4 endpoints; range params; org-scoping; CP Agent narrowing; permission gating.
2. `sp5-reconciliation.js` — Area 5; four reconciliation statuses across fixtures; `partnerAccessScope` enforcement; tolerance behaviour.
3. `sp5-dev-analytics.js` — Areas 6–8; existing `analytics:read` gating; shapes.
4. `sp5-facts-pack.js` — Builder bounded output; token-cap enforcement; citation completeness; insufficient-data flag.
5. `sp5-recommendation-candidates.js` — Every rule's trigger conditions; sample-size thresholds; priority scoring; deterministic ordering.
6. `sp5-narrator-validator-loop.js` — With a **mocked LLM**: happy path, numeric tolerance, entity check, invented-citation rejection, retry feedback, fallback to deterministic template, max-retry exhaustion.
7. `sp5-insight-cache.js` — Hit/miss; `source: 'scheduled'` vs `'on_demand'`; TTL; concurrent-request lock; expired-but-served fallback.
8. `sp5-rate-limit-meter.js` — Daily/hourly limits; 429 shape; meter increments; midnight-IST rollover; per-org quota override.
9. `sp5-cross-tenant-safety.js` — The audit: CP user cannot retrieve another CP's facts pack via any endpoint; tools cannot accept `organizationId` arg; cross-org access log is written.
10. `sp5-scheduled-digest-job.js` — Job iterates eligible orgs; skips empty orgs; per-org error isolation; summary report shape.
11. `sp5-cp-copilot.js` — Message endpoint; conversation persistence; tool execution; rate-limit integration; citation propagation.
12. `sp5-dev-copilot-tools.js` — Three new tools registered; existing Copilot can invoke them; answers cite real partnership records.

### 10.2 Frontend smoke scenarios

`CI=true npm run build` must compile clean. Manual scenarios:

1. New CP org with no data — empty states; no LLM calls (verify in logs).
2. Full-data CP — all 5 cards render with narratives + citations; click each citation → drill-through works.
3. Generate Now on each surface; meter decrements; on-demand counter distinct from scheduled.
4. Exhaust quota → 429 toast + buttons disabled until reset.
5. Insights page pre-cron (Saturday) → beautiful placeholder with correct next-run time.
6. Insights page post-cron → digest renders.
7. Custom-range digest → on-demand generation; caching by repeat.
8. CP Copilot — "which developer should I push more leads to?" — tool fires, citations link to real records.
9. Dev Copilot — "which channel partner is best this quarter?" — new `getChannelPartnerScorecard` tool fires.
10. Reconciliation drill-through — click `mismatched` row → side-by-side ledger → "Mark as reviewed" persists.
11. Sparse-data CP → confidence falls to `Auto-summary`; no invented numbers.
12. Cross-CP isolation — log into CP A, verify no CP B entity appears anywhere in narratives or copilot responses.

## 11. File Summary

### Backend — create
- `models/aiInsightModel.js`
- `models/aiUsageMeterModel.js`
- `services/analytics/cpAnalyticsService.js`
- `services/analytics/commissionReconciliationService.js`
- `services/analytics/devAnalyticsService.js`
- `services/ai/factsPackBuilder.js`
- `services/ai/recommendationCandidates.js`
- `services/ai/insightNarrator.js`
- `services/ai/insightValidator.js`
- `services/ai/insightPipeline.js`
- `services/ai/promptTemplates.js`
- `services/ai/aiUsageMeterService.js`
- `services/cpCopilotService.js`
- `services/cpCopilotFunctions.js`
- `controllers/cpAnalyticsController.js`
- `controllers/cpInsightController.js`
- `controllers/cpAiUsageController.js`
- `controllers/cpCopilotController.js`
- `controllers/devAnalyticsController.js` *(or extend existing analytics controller)*
- `routes/cpAnalyticsRoutes.js`
- `routes/cpInsightRoutes.js`
- `routes/cpAiUsageRoutes.js`
- `routes/cpCopilotRoutes.js`
- `middlewares/aiRateLimit.js`
- `config/aiQuotas.js`
- `config/insightSurfaces.js`
- `jobs/generateScheduledInsights.js`
- `data/backfillSp5CpAnalyticsPermissions.js`
- 12 regression suites under `tests/regression/suites/sp5-*.js`

### Backend — modify
- `models/organizationModel.js` — `aiQuota` sub-doc.
- `models/prospectModel.js` — `reconciliationReviewedAt/By`.
- `config/permissions.js` — `CP_ANALYTICS` group.
- `data/defaultChannelPartnerRoles.js` — assign new perms.
- `services/copilotFunctions.js` (dev-side) — register three new tools.
- `routes/analyticsRoutes.js` — mount three new dev-side endpoints (or via the new controller).
- `.env.example` — new env vars.
- App entrypoint — mount new routes + register cron.

### Frontend — create
- `src/components/ai/AIInsightCard.jsx`
- `src/components/ai/AINarrative.jsx`
- `src/components/ai/AICitationsPanel.jsx`
- `src/components/ai/AIConfidenceBadge.jsx`
- `src/components/ai/AIGenerateNowButton.jsx`
- `src/components/ai/AIScheduledPlaceholder.jsx`
- `src/components/ai/AIQuotaIndicator.jsx`
- `src/components/ai/CpCopilotDrawer.jsx`
- `src/pages/cp-portal/CpInsightsPage.js`
- `src/pages/cp-portal/CommissionDashboardPage.js`
- `src/pages/cp-portal/ReconciliationDashboardPage.js`
- `src/pages/cp-portal/DeveloperPerformanceDetailPage.js`
- `src/pages/analytics/ChannelPartnerScorecardPage.js`
- `src/pages/analytics/CommissionPayoutsPage.js`
- `src/pages/analytics/LeadQualityPage.js`

### Frontend — modify
- `src/services/api.js` — four new API clients.
- `src/pages/cp-portal/CpPortalDashboardPage.js` — 5-card layout.
- `src/components/layout/ChannelPartnerLayout.js` — nav additions + Copilot FAB.
- `src/components/layout/DashboardLayout.js` — three dev-side analytics nav items.
- Existing CP Team page — Performance tab.
- Router — six new CP-side routes + three new dev-side routes.

## 12. Implementation Order (recommended)

1. **Data foundation** — `AIInsight`, `AIUsageMeter`, `Organization.aiQuota`, `Prospect.reconciliationReviewed*`, new permissions, backfill script.
2. **Analytics services** — areas 1–8 + endpoint contracts. Ship deterministic dashboards first.
3. **Facts pack builder + recommendation candidates** — pure functions, comprehensive unit tests, no LLM.
4. **Validator** — grounding check with extensive failure-mode tests, mocked LLM.
5. **Narrator + insight pipeline** — wire OpenAI; validator loop; cache; lock; deterministic template fallback.
6. **Rate-limit middleware + meter service.**
7. **Insight endpoints** — `GET/POST /api/cp/insights/:surface` + `/api/cp/ai/usage`.
8. **Scheduled digest job** — cron registration; per-org isolation; logging.
9. **CP Copilot service + endpoint + tool catalog.**
10. **Dev Copilot tool extensions.**
11. **Frontend — shared AI components.**
12. **Frontend — CP dashboard 5-card layout.**
13. **Frontend — Commission, Reconciliation, Developer Performance pages.**
14. **Frontend — Insights page.**
15. **Frontend — CP Copilot drawer + FAB.**
16. **Frontend — dev-side analytics 3 pages.**
17. **Regression suites + manual smoke.**

Sequencing rationale: stop after step 2 and the platform ships useful new analytics standalone; stop after step 7 and AI cards work; stop after step 9 and chat works. Each step is independently shippable.

## 13. Open Items for Implementation

Minor decisions the implementer resolves at task time without re-brainstorming. Document the choice in the PR description:

- **Chart library** — confirm whether the codebase uses `recharts` or `@mui/x-charts` and match. Do not introduce a second chart library.
- **Cron framework** — confirm the existing scheduled-job pattern in the codebase (`node-cron`, `agenda`, a custom runner, etc.) and reuse.
- **Concurrent-generation lock** — Mongo sentinel doc vs. in-memory `Map`. Either is fine; pick whichever is more idiomatic in this codebase.
- **Citation URL format** — match the frontend route conventions (`/partner/prospects/:id`, `/leads/:id`, etc.).
- **Time-zone source of truth** — `INSIGHT_DEFAULT_TIMEZONE` env var default is `Asia/Kolkata`. If `Organization.timezone` field exists, prefer that.
- **Dev-side controller pattern** — extend existing `analyticsController.js` if one exists, else create `devAnalyticsController.js`. Match existing code style.
- **Deterministic fallback template granularity** — one per surface; templates live alongside prompt templates in `services/ai/promptTemplates.js` for co-location.

---

**End of SP5 spec.** Next step: planning via `superpowers:writing-plans`, then
execution via `superpowers:subagent-driven-development`.
