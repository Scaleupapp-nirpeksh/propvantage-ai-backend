# Channel Partner Platform — SP5 Implementation Plan

**Source spec:** [`docs/superpowers/specs/2026-05-23-channel-partner-platform-sp5-design.md`](../specs/2026-05-23-channel-partner-platform-sp5-design.md)
**Foundations:** SP1 (CP orgs) · SP2 (portfolio) · SP3 (partnerships) · SP4 (cross-org lead lifecycle + `partnerAccessScope`)
**Repos:** `propvantage-ai-backend` (Node/Express/MongoDB) + `propvantage-ai-frontend` (React 18 + MUI v5)
**Date:** 2026-05-23

---

## §0 Pre-flight — resolutions to spec §13 Open Items

These choices are locked here so no task downstream re-decides them. Each rationale is one line.

| # | Item | Decision | Why |
|---|---|---|---|
| 1 | Chart library | **`recharts`** (`^2.8.0` in `package.json`) | Used by `PaymentReportsPage`, `TaskAnalyticsPage`, `CommissionReportsPage`, `SalesReportsPage`, `ChartCardRenderer`. Single library kept. |
| 2 | Cron framework | **`node-cron`** (`^4.2.0`) with `cron.schedule('expr', fn)` at module load | Same pattern as `backgroundJobService.js`, `taskAutoGenerationService.js`. `jobs/generateScheduledInsights.js` is `import`-ed from `server.js`. |
| 3 | Concurrent-generation lock | **Mongo sentinel collection `AIInsightLock`** with TTL=60s + unique index on `{cpOrgId, surface}` | Survives PM2 cluster mode + future horizontal scaling. ~30 lines net. In-process Map ruled out because cron + on-demand can collide across workers. |
| 4 | Citation URL format | Relative paths matching frontend routes: **`/partner/prospects/<id>`**, **`/leads/<id>`**, **`/partner/external-developers`** (id deep-linked when drawer supports it), **`/partner/commission/reconciliation`** for the reconciliation row, **`/partner/marketplace`** for developers. Citations are rendered as `Link to={url}` by `<AICitationsPanel>`. | Matches existing CP and dev router patterns. |
| 5 | Time-zone source | **`INSIGHT_DEFAULT_TIMEZONE`** env var only (default `Asia/Kolkata`). `Organization.timezone` does NOT exist yet. | Adding org-level TZ is out of SP5 scope — flagged as a future enhancement when SP6 monetization or multi-region needs land. |
| 6 | Dev-side controller pattern | **New `controllers/devAnalyticsController.js`** + **new `routes/devAnalyticsRoutes.js`** mounted at `/api/analytics/cp-scorecard|commission-payouts|lead-quality`. Reuses existing `PERMISSIONS.ANALYTICS.ADVANCED` (`'analytics:advanced'`) — there is no `'analytics:read'` permission in the codebase; closest semantic match. | Keeps SP5 dev-side analytics colocated; existing `analyticsController.js` stays untouched. |
| 7 | Deterministic fallback template granularity | **One per surface, co-located in `services/ai/promptTemplates.js`** — exports both `<surface>PromptTemplate(factsPack)` and `<surface>FallbackTemplate(factsPack)`. | Keeps prompt + fallback in lockstep; single file makes diff-review of a surface trivial. |

---

## §1 What ships in SP5 (one-line summary per phase)

Per spec §12 — 17 phases, each independently shippable.

| Phase | Theme | Independent value |
|---|---|---|
| 1 | Data foundation | Models + perms + migration; no user-visible change |
| 2 | Analytics services (Areas 1–8) | Deterministic dashboards work via direct API calls |
| 3 | Facts pack builder + recommendation rules | Pure functions; no LLM yet |
| 4 | **Validator** (LLM-mocked tests first — anti-hallucination boundary) | Trust boundary proven before any prod LLM call |
| 5 | Narrator + insight pipeline | Insights pipeline returns real text |
| 6 | Rate limit + meter | SP6 monetization hook live |
| 7 | Insight endpoints | `GET/POST /api/cp/insights/:surface` + `/api/cp/ai/usage` |
| 8 | Scheduled digest job | Weekly + monthly insights generated automatically |
| 9 | CP Copilot service + endpoint | Chat works from API |
| 10 | Dev Copilot extension (3 new tools) | Dev staff can ask analytics questions |
| 11 | Shared AI frontend components | Reusable AICard, Narrative, Citations, Confidence, etc. |
| 12 | CP Dashboard 5-card layout | Single visible upgrade |
| 13 | Commission/Reconciliation/Developer Performance pages | Three deep-dive CP pages |
| 14 | Insights page (`/partner/insights`) | Digest hub |
| 15 | CP Copilot drawer + FAB | Chat available on every CP page |
| 16 | Dev-side analytics 3 pages | Dev gets new analytics surfaces |
| 17 | 12 regression suites + manual smoke | Full safety net |

---

## §2 Constraints carried from the user's brief

- **Validator built and tested FIRST with mocked LLM.** Anti-hallucination is the central architectural concern.
- **`partnerAccessScope` is reused everywhere CP-side analytics touch cross-org data.** Imported from [`utils/partnerAccessHelper.js`](../../../utils/partnerAccessHelper.js). Never reinvent.
- **Cross-tenant safety by construction.** CP Copilot tool catalog must NOT accept an `organizationId` parameter. Scoping = `req.user.organization._id` from middleware. The `sp5-cross-tenant-safety.js` regression suite is written immediately after the CP Copilot lands (not at phase 17), and asserts the absence of the parameter.
- **Mock the LLM in regression.** Use `jest.unstable_mockModule` pattern from `tests/regression/suites/28-sp4-partner-access-scope.test.js` (mocks at the ESM module boundary). No real LLM calls in regression. The existing `14-ai-copilot.test.js` LIVE-flag pattern stays for live smoke only.
- **On-demand meter (`AIUsageMeter.onDemandGenerations`) is the SP6 monetization hook.** Keep cleanly separated from `scheduledGenerations`.
- **Backend deploys via push to main → GH Actions → EC2.** Per-feature ASK before push. Each task lands its own commit; pushes batched at phase boundaries with explicit user authorization.
- **Frontend tests:** no Jest/Vitest harness. `CI=true npm run build` must compile clean. Manual smoke through 12 scenarios from spec §10.2.
- **Backend tests:** existing Jest regression suites under `tests/regression/suites/`. SP5 adds 12 suites (spec §10.1). Match SP4 numbering style: `37-sp5-<area>.test.js`.

---

## §3 File inventory — every file SP5 creates or modifies

> Lifted from spec §11. This is the canonical list for all 17 phases. Anything not in this list is out of scope.

### Backend — CREATE (29 files)

| Path | Purpose | Created in phase |
|---|---|---|
| `models/aiInsightModel.js` | Cache + audit doc for every insight | 1 |
| `models/aiUsageMeterModel.js` | Per-org per-day meter (scheduled vs on-demand) | 1 |
| `models/aiInsightLockModel.js` | Mongo sentinel for concurrent-generation locking (TTL=60s) | 5 |
| `data/backfillSp5CpAnalyticsPermissions.js` | Idempotent `$addToSet` of new perms onto existing CP roles | 1 |
| `services/analytics/cpAnalyticsService.js` | Areas 1–4 (pipeline, commission, agents, developers) | 2 |
| `services/analytics/commissionReconciliationService.js` | Area 5 (the headline cross-org feature) | 2 |
| `services/analytics/devAnalyticsService.js` | Areas 6–8 (dev-side CP scorecard / payouts / lead quality) | 2 |
| `services/ai/factsPackBuilder.js` | Bounded JSON per surface — every fact carries a citation | 3 |
| `services/ai/recommendationCandidates.js` | Rule library — 10 rules, each pure function | 3 |
| `services/ai/insightValidator.js` | Numeric + entity + citation grounding check | 4 |
| `services/ai/insightNarrator.js` | OpenAI gpt-4o wrapper, JSON-mode output | 5 |
| `services/ai/insightPipeline.js` | Orchestrator (cache → lock → facts → narrate → validate → cache) | 5 |
| `services/ai/promptTemplates.js` | Per-surface prompt + fallback template | 5 |
| `services/ai/aiUsageMeterService.js` | `incrementMeter(cpOrgId, kind, tokenUsage)` | 6 |
| `services/cpCopilotService.js` | CP-side Copilot orchestrator (mirrors `aiCopilotService.js`) | 9 |
| `services/cpCopilotFunctions.js` | 7-tool catalog — no `organizationId` parameter on any tool | 9 |
| `controllers/cpAnalyticsController.js` | Thin asyncHandlers for cpAnalyticsService + reconciliation | 2 |
| `controllers/cpInsightController.js` | `GET/POST /api/cp/insights/:surface` | 7 |
| `controllers/cpAiUsageController.js` | `GET /api/cp/ai/usage` | 7 |
| `controllers/cpCopilotController.js` | `POST /api/cp/copilot/message` | 9 |
| `controllers/devAnalyticsController.js` | Areas 6–8 endpoints (NEW; existing `analyticsController.js` untouched) | 2 |
| `routes/cpAnalyticsRoutes.js` | Mounted at `/api/cp/analytics` | 2 |
| `routes/cpInsightRoutes.js` | Mounted at `/api/cp/insights` | 7 |
| `routes/cpAiUsageRoutes.js` | Mounted at `/api/cp/ai` | 7 |
| `routes/cpCopilotRoutes.js` | Mounted at `/api/cp/copilot` | 9 |
| `routes/devAnalyticsRoutes.js` | Mounted at `/api/analytics` (alongside existing `analyticsRoutes.js`) | 2 |
| `middleware/aiRateLimit.js` | Daily/hourly quota gate; returns 429 with reset time | 6 |
| `config/aiQuotas.js` | `INSIGHT_DEFAULT_DAILY_QUOTA`, `INSIGHT_DEFAULT_HOURLY_QUOTA` lookups | 6 |
| `config/insightSurfaces.js` | Surface config map per spec §6.1 | 3 |
| `jobs/generateScheduledInsights.js` | node-cron registration for weekly + monthly digest | 8 |

### Backend — MODIFY

| Path | Change |
|---|---|
| `models/organizationModel.js` | Add `aiQuota` sub-doc per spec §4.3 |
| `models/prospectModel.js` | Add `reconciliationReviewedAt`, `reconciliationReviewedBy` per spec §4.4 |
| `config/permissions.js` | Add `CP_ANALYTICS` group (`VIEW`, `VIEW_TEAM`) per spec §4.5 |
| `data/defaultChannelPartnerRoles.js` | Assign new perms per spec §4.5 (Owner = both via `ALL_CP_PERMISSIONS`; Manager = both; Agent = `VIEW` only) |
| `services/copilotFunctions.js` (dev-side) | Append 3 new tool entries (spec §6.11) — no other change to file |
| `.env.example` | 11 new vars per spec §6.13 |
| `server.js` | Mount 5 new route prefixes + import `jobs/generateScheduledInsights.js` |

### Backend — Regression suites (12 files, phase 17)

Following SP4 numbering convention `NN-sp5-*.test.js`. The next free number after `36-sp4-notifications.test.js` is `37`. SP5 occupies 37–48.

| # | File | Phase asserting it |
|---|---|---|
| 37 | `37-sp5-cp-analytics.test.js` | 17 |
| 38 | `38-sp5-reconciliation.test.js` | 17 |
| 39 | `39-sp5-dev-analytics.test.js` | 17 |
| 40 | `40-sp5-facts-pack.test.js` | 17 |
| 41 | `41-sp5-recommendation-candidates.test.js` | 17 |
| 42 | `42-sp5-narrator-validator-loop.test.js` | 4 (validator-first) |
| 43 | `43-sp5-insight-cache.test.js` | 17 |
| 44 | `44-sp5-rate-limit-meter.test.js` | 17 |
| 45 | `45-sp5-cross-tenant-safety.test.js` | 9 (immediately after CP Copilot) |
| 46 | `46-sp5-scheduled-digest-job.test.js` | 17 |
| 47 | `47-sp5-cp-copilot.test.js` | 17 |
| 48 | `48-sp5-dev-copilot-tools.test.js` | 17 |

### Frontend — CREATE (16 files)

| Path | Purpose | Phase |
|---|---|---|
| `src/components/ai/AIInsightCard.jsx` | All states from spec §7.2 (fresh, generating, fallback, error, placeholder, quota) | 11 |
| `src/components/ai/AINarrative.jsx` | Prose + inline citation pills | 11 |
| `src/components/ai/AICitationsPanel.jsx` | Expandable cited-URL list | 11 |
| `src/components/ai/AIConfidenceBadge.jsx` | High/medium/low/fallback chip | 11 |
| `src/components/ai/AIGenerateNowButton.jsx` | On-demand call + loading + quota gating | 11 |
| `src/components/ai/AIScheduledPlaceholder.jsx` | "Available at <date/time>" beautiful empty state | 11 |
| `src/components/ai/AIQuotaIndicator.jsx` | "47 generations left today" pill | 11 |
| `src/components/ai/CpCopilotDrawer.jsx` | Drawer pattern mirroring `src/components/copilot/CopilotChat.js` | 15 |
| `src/pages/cp-portal/CpInsightsPage.js` | `/partner/insights` — weekly/monthly/custom tabs | 14 |
| `src/pages/cp-portal/CommissionDashboardPage.js` | `/partner/commission` deep-dive | 13 |
| `src/pages/cp-portal/ReconciliationDashboardPage.js` | `/partner/commission/reconciliation` headline | 13 |
| `src/pages/cp-portal/DeveloperPerformanceDetailPage.js` | `/partner/developers/performance` two-pane | 13 |
| `src/pages/analytics/ChannelPartnerScorecardPage.js` | `/analytics/channel-partners` (dev side) | 16 |
| `src/pages/analytics/CommissionPayoutsPage.js` | `/analytics/commission-payouts` (dev side) | 16 |
| `src/pages/analytics/LeadQualityPage.js` | `/analytics/lead-quality` (dev side) | 16 |

### Frontend — MODIFY

| Path | Change |
|---|---|
| `src/services/api.js` | Add `cpAnalyticsAPI`, `cpInsightsAPI`, `cpCopilotAPI`, `devAnalyticsAPI` |
| `src/pages/cp-portal/CpPortalDashboardPage.js` | Replace contents with 5-card layout per spec §7.3 |
| `src/components/layout/ChannelPartnerLayout.js` | Add nav items: Insights / Commission (+Reconciliation sub) / Developer Performance; mount `<CpCopilotDrawer />` FAB |
| `src/components/layout/DashboardLayout.js` | Add 3 analytics sub-nav items: Channel Partners / Commission Payouts / Lead Quality |
| `src/pages/cp-portal/CpPortalTeamPage.js` | Add a "Performance" tab calling `cpAnalyticsAPI.getAgents` |
| `src/App.js` | Add 6 CP routes + 3 dev routes (all `Suspense` + lazy) |

---

## §4 Phase-by-phase task breakdown

> Task ID format: `T<phase>.<step>`. Each task lands one commit using the SP4 message style:
> `feat(cp-platform): SP5 — <short description>` or `test(cp-platform): SP5 — <short description>`.
> Each commit ends with `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.

---

### Phase 1 — Data foundation (5 tasks · backend only · no user-visible change)

**Goal:** Models + permissions in place + migration script that's safe to re-run.

#### T1.1 — `models/aiInsightModel.js`

Create file. Schema = spec §4.1 verbatim. Indexes:
- `{ cpOrgId: 1, surface: 1, expiresAt: -1 }` for cache lookups.
- `{ expiresAt: 1 }` declared as `{ expireAfterSeconds: 0 }` → Mongo TTL.

Exports: `AIInsight` (default + named). Pre-save: validates `surface ∈ Object.keys(insightSurfaces)` (lazy-imported to avoid circular dep).

**Commit:** `feat(cp-platform): SP5 — AIInsight model (cache + audit)`

#### T1.2 — `models/aiUsageMeterModel.js`

Create file. Schema = spec §4.2 verbatim. Indexes:
- `{ cpOrgId: 1, periodKey: 1 }` unique (the upsert key).
- `{ cpOrgId: 1, monthKey: 1 }` for billing rollups (used by SP6).

Static helper: `AIUsageMeter.findOrCreateForToday(cpOrgId)` → returns the meter for today's `periodKey` (`YYYY-MM-DD` IST).

**Commit:** `feat(cp-platform): SP5 — AIUsageMeter model (daily + monthly rollup keys)`

#### T1.3 — Extend `models/organizationModel.js` + `models/prospectModel.js`

Two small edits, single commit:

(a) `organizationModel.js` — add to schema, between `channelPartnerProfile` and the closing `{ timestamps: true }`:
```js
// SP5 — per-org AI quota override (null = use INSIGHT_DEFAULT_DAILY_QUOTA / HOURLY).
// The 'plan' field is the SP6 monetization hook.
aiQuota: {
  dailyQuota:  { type: Number, default: null },
  hourlyQuota: { type: Number, default: null },
  plan:        { type: String, default: 'default' },
},
```

(b) `prospectModel.js` — add top-level fields next to existing reconciliation-adjacent fields (after `commission` sub-doc, before `activities`):
```js
// SP5 — explicit reconciliation review tracking for the dashboard.
reconciliationReviewedAt: { type: Date, default: null },
reconciliationReviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
```

**Commit:** `feat(cp-platform): SP5 — Organization.aiQuota + Prospect.reconciliationReviewed*`

#### T1.4 — Extend `config/permissions.js` + `data/defaultChannelPartnerRoles.js`

(a) `permissions.js` — append to `CP_PERMISSIONS` block (after `EXTERNAL_DEVELOPERS`):
```js
// SP5 — analytics, insights, copilot
ANALYTICS: {
  VIEW:      'cp_analytics:view',
  VIEW_TEAM: 'cp_analytics:view_team',
},
```
`ALL_CP_PERMISSIONS` auto-picks these up via `Object.values`.

(b) `defaultChannelPartnerRoles.js`:
- CP Owner — already gets both via `ALL_CP_PERMISSIONS`. Verify.
- CP Manager — append `CP_PERMISSIONS.ANALYTICS.VIEW`, `CP_PERMISSIONS.ANALYTICS.VIEW_TEAM`.
- CP Agent — append `CP_PERMISSIONS.ANALYTICS.VIEW` only (not `_TEAM`).

**Commit:** `feat(cp-platform): SP5 — cp_analytics:view + view_team permissions + role seed`

#### T1.5 — `data/backfillSp5CpAnalyticsPermissions.js`

Mirror `data/backfillSp4CpPermissions.js`. Idempotent `$addToSet`:
- For every Role doc with `slug ∈ ['cp-owner', 'cp-manager']` → add both `cp_analytics:view` AND `cp_analytics:view_team`.
- For every Role doc with `slug === 'cp-agent'` → add `cp_analytics:view` only.

Exports a `runBackfill()` function and an `if (import.meta.url === ...) await runBackfill();` CLI entry.

**Commit:** `feat(cp-platform): SP5 — backfill script for cp_analytics:* perms`

> **Phase 1 deliverable:** 5 commits. Locally tested via `node data/backfillSp5CpAnalyticsPermissions.js` against a scratch DB. **PAUSE for user authorization before pushing.**

---

### Phase 2 — Analytics services (Areas 1–8) (8 tasks · backend only)

**Goal:** Deterministic dashboards work via direct API calls. Standalone-useful without AI.

Pattern for every endpoint:
- `range` query param (`7d | 30d | 90d | 6m | 12m | ytd | all`, default `30d`).
- 5-minute server-side cache (`node-cache` is already in deps — confirm at impl time; if not, use a tiny `Map` with `expiresAt`).
- CP-side: AND `partnerAccessScope(req)` whenever reading cross-org data.
- CP Agent auto-scoping via `user.roleRef.slug === 'cp-agent'` per the existing helper.

#### T2.1 — `services/analytics/cpAnalyticsService.js` — Area 1 `getPipelineHealth(orgId, params, user)`

Aggregation over `Prospect` for the CP org:
- Totals: `totalProspects`, `activeProspects` (status NOT IN `['Booked','Lost','Unqualified']`).
- `followUpsDueToday`, `followUpsDueThisWeek` via `followUp.nextDate`.
- `agingOver30d` (active prospects, `updatedAt < now - 30d`).
- `activityVolume7d`, `activityVolume30d` via `$size: $filter` on `activities[].at`.
- `breakdowns.byStatus`: count per status.
- `breakdowns.funnel`: ordered status counts for the funnel chart.
- `breakdowns.aging`: bucketed by stage and `updatedAt` recency.
- `series.activityHeat[]`: daily activity counts for the last 30d.

CP Agent narrowing: `match.assignedAgent = user._id` injected when applicable.

**Commit:** `feat(cp-platform): SP5 — getPipelineHealth (Area 1)`

#### T2.2 — Same service — Area 2 `getCommissionOverview(orgId, params, user)`

Aggregation over `Prospect.commission`:
- Summary: `expected` = Σ `commission.expectedAmount`; `received` = Σ payments amount; `outstanding` = expected − received; `writtenOff` = Σ where status=`written_off`; `realisationRate` = received / expected (0 when expected=0).
- Per-currency rollup (don't conflate INR + USD).
- `breakdowns.byStatus` (4 buckets per `commission.status` enum).
- `breakdowns.byDeveloper`: joined via `developerContext.partnership` → `Partnership.developerOrg.name` (with `developerContext.externalDeveloper.name` for `external` context).
- `breakdowns.byAgent`: joined via `assignedAgent` → User name (Manager/Owner only; CP Agent sees only their own bucket).
- `series.byMonth[]`: last 12 months of received commission.

**Commit:** `feat(cp-platform): SP5 — getCommissionOverview (Area 2)`

#### T2.3 — Same service — Area 3 `getAgentPerformance(orgId, params, user)`

Requires `cp_analytics:view_team`. Per-agent metrics:
- `prospectsActive`, `prospectsBooked`.
- `conversionRate` = booked / total.
- `avgTimeToBookingDays` from `createdAt → booking.bookedAt`.
- `activityVolume30d`.
- `commissionGenerated` = Σ `commission.expectedAmount` (booked prospects).
- `compositeScore` (formula documented in code): `0.4 * conversionRate + 0.3 * normalised(activityVolume30d) + 0.3 * normalised(commissionGenerated)`.

**Commit:** `feat(cp-platform): SP5 — getAgentPerformance (Area 3)`

#### T2.4 — Same service — Area 4 `getDeveloperPerformance(orgId, params, user)`

Per-developer (both `external` and `platform` contexts):
- `prospects`, `conversionRate`, `deltaVsOverall` (developer rate − overall org rate, in pp).
- `avgTimeToBookingDays`.
- `commissionRealised` = Σ commission received.
- `leadAcceptanceRate` (for `platform` developers only) = accepted Leads / pushed Prospects. Joined via `pushedToLead → Lead.status`.

**Commit:** `feat(cp-platform): SP5 — getDeveloperPerformance (Area 4)`

#### T2.5 — `services/analytics/commissionReconciliationService.js` — Area 5

The headline cross-org feature. Three functions per spec §5.3:

- `getReconciliationOverview(orgId, params, user)` — for each Prospect with `pushedToLead`:
  - Read `Prospect.commission` (CP ledger).
  - Read `CommissionRecord` where `sale.lead === Prospect.pushedToLead` AND filtered by `partnerAccessScope(req)` to ensure cross-org visibility is legitimate.
  - Status logic per spec §5.3 step 2 (matched / cp_only / dev_only / mismatched) with tolerance `INSIGHT_VALIDATOR_NUMERIC_TOLERANCE` (default 0.01).
  - `cp_only` only triggers when `Lead.status ∈ ['Booked', ...]` (trigger statuses live in `config/insightSurfaces.js`).
- `getReconciliationDetail(orgId, prospectId, user)` — full side-by-side: `prospect`, `cpLedger`, `devRecord`, `status`, `discrepancy`, plain-language `explanation`, `citations[]` (URLs to both records).
- `markReviewed(orgId, prospectId, user)` — sets `reconciliationReviewedAt = now`, `reconciliationReviewedBy = user._id`. Idempotent.

**Commit:** `feat(cp-platform): SP5 — commission reconciliation service (Area 5)`

#### T2.6 — `services/analytics/devAnalyticsService.js` — Areas 6, 7, 8

Three functions per spec §5.4. Org-scoped to the dev org (no `partnerAccessScope`).

- `getChannelPartnerScorecard(orgId, params, user)` — joins `Partnership` (active) → `ChannelPartner` → `Lead` → `Sale` → `CommissionRecord`. Per-partner: leads submitted (counts Leads with `sourceProspect`), accepted, rejected, accept rate, conversion rate, avg time-to-decision (hours from `createdAt` to status leave `'pending'`), commission paid YTD, `partnerQualityScore` (composite: `0.5 * acceptRate + 0.3 * conversionRate + 0.2 * (1 / max(1, avgTimeToDecisionDays))`).
- `getCommissionPayouts(orgId, params, user)` — Σ over `CommissionRecord`: `paidThisPeriod`, `outstanding`, `cpsPaid`, `avgPayoutPerCp`. Breakdowns by CP and by project. `series.byMonth[]` last 12 months.
- `getLeadQuality(orgId, params, user)` — per-partner: counts of `lead_registration_accepted/rejected`, `topRejectionReasons[]` (from rejection note classification by keyword for v1 — kept simple; ML in SP6+), `duplicateFlagRate`, `proposalsSubmitted`, `proposalsAccepted`, composite `leadQualityScore`.

**Commit:** `feat(cp-platform): SP5 — devAnalyticsService (Areas 6, 7, 8)`

#### T2.7 — `controllers/cpAnalyticsController.js` + `routes/cpAnalyticsRoutes.js`

Per spec §5.5 table. All routes: `protect` + `requireOrgType('channel_partner')` + the listed permission.

```
GET  /api/cp/analytics/pipeline                           cp_analytics:view
GET  /api/cp/analytics/commission                         cp_analytics:view
GET  /api/cp/analytics/agents                             cp_analytics:view_team
GET  /api/cp/analytics/developers                         cp_analytics:view
GET  /api/cp/analytics/reconciliation                     cp_analytics:view
GET  /api/cp/analytics/reconciliation/:prospectId         cp_analytics:view
POST /api/cp/analytics/reconciliation/:prospectId/reviewed cp_analytics:view
```

Thin asyncHandlers calling the services from T2.1–T2.5. Wire `app.use('/api/cp/analytics', cpAnalyticsRoutes)` in `server.js`.

**Commit:** `feat(cp-platform): SP5 — /api/cp/analytics routes + controller`

#### T2.8 — `controllers/devAnalyticsController.js` + `routes/devAnalyticsRoutes.js`

Per resolved Open Item #6. All routes: `protect` + `hasPermission(PERMISSIONS.ANALYTICS.ADVANCED)`.

```
GET /api/analytics/cp-scorecard       analytics:advanced
GET /api/analytics/commission-payouts analytics:advanced
GET /api/analytics/lead-quality       analytics:advanced
```

Wire `app.use('/api/analytics', devAnalyticsRoutes)` AFTER existing `analyticsRoutes` mount in `server.js` (Express allows multiple routers on the same prefix; SP5's new paths don't collide with the existing four).

**Commit:** `feat(cp-platform): SP5 — /api/analytics dev-side endpoints (Areas 6–8)`

> **Phase 2 deliverable:** 8 commits. CP and dev users can hit all 8 endpoints with curl/Postman and get correct data. **PAUSE for user authorization to push Phases 1 + 2 as a batch.**

---

### Phase 3 — Facts pack builder + recommendation candidates (3 tasks · backend only)

**Goal:** Pure functions, fully testable without LLM.

#### T3.1 — `config/insightSurfaces.js`

Verbatim from spec §6.1 (the full `insightSurfaces` map with 7 surfaces). Plus:
```js
// SP5 — Lead statuses at which a CommissionRecord is *expected* to exist.
// Used by reconciliation to decide cp_only vs not-yet-due.
export const RECONCILIATION_TRIGGER_STATUSES = ['Booked', 'Possession', 'Closed'];
```

**Commit:** `feat(cp-platform): SP5 — insightSurfaces config + reconciliation trigger statuses`

#### T3.2 — `services/ai/factsPackBuilder.js`

One builder per surface (7 total). Each function: `build<Surface>Pack(cpOrgId, user, range) → factsPack`. Output shape per spec §6.2:

```js
{
  surface, generatedAt, period, scope,
  hasInsufficientData: bool,
  metrics: {…},          // from analytics services
  notableRecords: {…},   // capped at 5 per category
  candidates: { recommendations: [] }, // populated downstream in pipeline (T5.2)
}
```

Hard rules enforced in a shared `enforceLimits(pack)` helper:
- Total stringified pack ≤ `INSIGHT_FACTS_PACK_MAX_TOKENS` (default 4000 → ~16 KB JSON). Truncate `notableRecords` lists from the tail until under cap; throw if `metrics` alone exceeds (analytics service bug → fail loud).
- Every named entity object MUST have a `citation` URL field (use citation helpers per Open Item #4).
- `hasInsufficientData: true` when surface-specific minimum N not met (e.g., `pipeline_health` needs ≥ 3 prospects; `developer_performance` needs ≥ 1 partnership; `weekly_digest` needs ≥ 1 active prospect).

Exports a `build(surface, cpOrgId, user, range)` dispatcher that looks up the builder name from `insightSurfaces[surface].factsPackBuilder` and invokes it.

**Commit:** `feat(cp-platform): SP5 — factsPackBuilder (7 surfaces) + bounded output enforcement`

#### T3.3 — `services/ai/recommendationCandidates.js`

10 pure functions per spec §6.3 catalog. Signature: `(metrics, params) → Candidate[]`. Each `Candidate`:
```js
{ id, type, evidence: {...}, defaultAction, evidenceCitations: [...], confidence, priorityScore }
```

Sample-size thresholds per spec §6.3 (e.g., `topDevelopers` requires `n ≥ 10`). `confidence` derived from sample size (n ≥ 30 → high; ≥ 10 → medium; else low).

Exports `collect(surface, factsPack)` — looks up `insightSurfaces[surface].candidateRules`, invokes each rule on `factsPack.metrics`, concatenates results, sorts by `priorityScore` desc, returns top N (N = 5 for cards, 12 for digests — configured in `insightSurfaces[surface].topN` with default 5).

**Commit:** `feat(cp-platform): SP5 — recommendationCandidates rule library (10 rules)`

> **Phase 3 deliverable:** 3 commits. Builder + rules importable from any other service. **Continue to Phase 4 without pushing — anti-hallucination boundary not yet proven.**

---

### Phase 4 — Validator (LLM-mocked tests FIRST) (2 tasks · backend only)

**Goal:** The trust boundary. Built and tested with extensive failure cases BEFORE any real LLM wiring.

#### T4.1 — `services/ai/insightValidator.js`

Per spec §6.5. Single export:
```js
export function standardNumericValidator(response, factsPack)
  → { valid: bool, reason?: string, retryHint?: string }
```

Internal helpers:
- `extractNumbers(narrative)` — regex covering `\d[\d,]*(\.\d+)?%?` + ₹ + units. Returns parsed numeric tokens + their textual form.
- `findNumberInPack(num, pack, tolerance)` — recursive walk of `pack.metrics` + `pack.notableRecords`. Match within `±tolerance` (default 0.01 = 1%).
- `extractProperNouns(narrative)` — capitalized multi-word sequences (`/[A-Z][a-zA-Z]+(\s+[A-Z][a-zA-Z]+)*/g`), filtered against a stoplist (`Q1`, `January`, etc.).
- `findEntityInPack(name, pack)` — exact-match any `name|developerName|agentName|prospectName|firstName + lastName` field.
- Validate `response.headlinedCandidates[]` IDs exist in `pack.candidates.recommendations[].id`.
- Validate `response.citations[]` URLs each match a `citation` field somewhere in the pack.

On any failure: `{ valid: false, reason: '<which check>', retryHint: '<feedback string for the next narrator call>' }`.

**Commit:** `feat(cp-platform): SP5 — insightValidator (numeric + entity + citation grounding)`

#### T4.2 — `tests/regression/suites/42-sp5-narrator-validator-loop.test.js`

**WRITTEN BEFORE THE NARRATOR EXISTS.** Mocks the narrator AND the OpenAI SDK module. Uses `jest.unstable_mockModule` like `28-sp4-partner-access-scope.test.js`.

Test cases:
1. Happy path — LLM returns response with all numbers + entities + candidates + citations from a synthetic facts pack → validator passes.
2. Number with ±0.5% rounding (`22.4%` vs `22%`) → passes within tolerance.
3. Number with > ±1% error (`30%` vs `22%`) → fails.
4. Hallucinated developer name not in pack → fails on entity check.
5. Hallucinated candidate ID not in `pack.candidates.recommendations` → fails on candidate check.
6. Citation URL not in pack → fails on citation check.
7. Pure text (no numbers, no entities) but `headlinedCandidates: []` → passes (zero-claim narrative is OK).
8. Retry feedback: after a failed validation, builder is called again with `retryHint` appended to the user message; second attempt passes.
9. Max-retry exhaustion (2 retries default per `INSIGHT_VALIDATOR_MAX_RETRIES`) → returns `{ valid: false, fellBackToTemplate: true }` so caller knows to invoke `deterministicTemplate(surface, factsPack)`.

> **The validator must catch every failure mode in this suite before any code path can call the real LLM.**

**Commit:** `test(cp-platform): SP5 — narrator+validator failure-mode suite (mocked LLM)`

> **Phase 4 deliverable:** 2 commits. Validator proven correct before any prod LLM cost. **PAUSE before phase 5 — validator is the boundary.**

---

### Phase 5 — Narrator + insight pipeline (3 tasks · backend only)

**Goal:** End-to-end insight generation with cache + lock + retry + fallback.

#### T5.1 — `services/ai/promptTemplates.js`

Per resolved Open Item #7. Exports per surface:
- `pipelineHealthPromptTemplate(factsPack) → string` (the user-message content for the LLM).
- `pipelineHealthFallbackTemplate(factsPack) → string` (the deterministic prose used when validator exhausts retries).

7 surfaces × 2 templates = 14 functions. Each fallback is a hand-written sentence builder reading from `factsPack.metrics` directly (no LLM, no inference).

Also exports the verbatim `SYSTEM_PROMPT` from spec §6.4.

**Commit:** `feat(cp-platform): SP5 — prompt + fallback templates for 7 surfaces`

#### T5.2 — `services/ai/insightNarrator.js`

Per spec §6.4. Wraps OpenAI gpt-4o:
```js
export async function narrate(surface, factsPack, retryHint?) → { narrative, headlinedCandidates, confidence, citations }
```

- Uses `process.env.COPILOT_MODEL || 'gpt-4o'`.
- `response_format: { type: 'json_object' }`.
- `temperature: 0.3`, `max_tokens: INSIGHT_NARRATIVE_MAX_TOKENS || 800`.
- System prompt: imports `SYSTEM_PROMPT` from `promptTemplates.js`.
- User prompt: invokes the per-surface prompt template + appends `retryHint` if present.
- Returns parsed JSON.
- Throws on malformed JSON (caller catches; validator sees failure and retries).

**Commit:** `feat(cp-platform): SP5 — insightNarrator (OpenAI gpt-4o JSON-mode)`

#### T5.3 — `models/aiInsightLockModel.js` + `services/ai/insightPipeline.js`

(a) `aiInsightLockModel.js`: minimal schema `{ cpOrgId, surface, lockedAt }` with unique `{cpOrgId, surface}` and TTL `{lockedAt: 1, expireAfterSeconds: 60}`. Functions `acquireLock(cpOrgId, surface)` (insert; throws on duplicate-key → caller polls) and `releaseLock(lockDoc)` (delete).

(b) `insightPipeline.js` orchestrator per spec §6.6:
```js
export async function getOrGenerateInsight(surface, cpOrgId, user, opts = {}) → AIInsight
```
Flow:
1. Check cache: `AIInsight.findOne({ cpOrgId, surface, expiresAt: { $gt: now } }).sort({ generatedAt: -1 })`. If hit and not `opts.forceRegenerate` → return.
2. `acquireLock(cpOrgId, surface)` — on `E11000` duplicate-key, poll cache every 500ms up to 30s for the result of the concurrent caller; if still nothing, error 503.
3. Re-check cache (someone else may have generated while we were locked-waiting).
4. `factsPack = await factsPackBuilder.build(surface, cpOrgId, user, opts.range)`.
5. If `factsPack.hasInsufficientData` → write `AIInsight {confidence: 'fallback', narrative: null}` + return.
6. `factsPack.candidates = recommendationCandidates.collect(surface, factsPack)`.
7. Retry loop (≤ `INSIGHT_VALIDATOR_MAX_RETRIES`): narrate → validate → break if valid.
8. If still invalid: `narration = deterministicTemplate(surface, factsPack)`, `confidence: 'fallback'`.
9. Cache: `AIInsight.create({...})` with `expiresAt = now + insightSurfaces[surface].cacheTtl`.
10. Always `releaseLock`.

`source` field: `opts.forceRegenerate ? 'on_demand' : 'scheduled'`.

**Commit:** `feat(cp-platform): SP5 — insight pipeline (cache + lock + retry + fallback)`

> **Phase 5 deliverable:** 3 commits. Insight pipeline returns text for any surface. End-to-end smoke: call `getOrGenerateInsight('pipeline_health', orgId, user)` from a Node REPL and verify output structure. **PAUSE for user authorization to push Phases 3+4+5 as a batch.**

---

### Phase 6 — Rate limit + meter (2 tasks · backend only)

**Goal:** Per-org quotas enforced; SP6 monetization meter live.

#### T6.1 — `config/aiQuotas.js` + `services/ai/aiUsageMeterService.js`

(a) `aiQuotas.js`:
```js
export const DEFAULT_DAILY_QUOTA  = Number(process.env.INSIGHT_DEFAULT_DAILY_QUOTA)  || 200;
export const DEFAULT_HOURLY_QUOTA = Number(process.env.INSIGHT_DEFAULT_HOURLY_QUOTA) || 50;

export async function getOrgQuota(org) {
  return {
    dailyQuota:  org.aiQuota?.dailyQuota  ?? DEFAULT_DAILY_QUOTA,
    hourlyQuota: org.aiQuota?.hourlyQuota ?? DEFAULT_HOURLY_QUOTA,
    plan:        org.aiQuota?.plan        ?? 'default',
  };
}
```

(b) `aiUsageMeterService.js`:
```js
export async function incrementMeter(cpOrgId, kind /* 'scheduled' | 'on_demand' | 'copilot' */, tokenUsage)
```
Upserts today's meter, `$inc`-ments the right counter, `totalTokensUsed`, `totalCostUsd` (token-cost lookup table keyed on model from `COPILOT_MODEL`). `lastUpdatedAt = now`.

Helper exports: `currentDailyPeriodKey(now = new Date())` (IST date `YYYY-MM-DD`), `currentMonthKey(now)` (`YYYY-MM`), `nextMidnightIst(now)`.

**Commit:** `feat(cp-platform): SP5 — aiQuotas config + aiUsageMeterService`

#### T6.2 — `middleware/aiRateLimit.js`

Per spec §6.8. Reads `req.organization` (loaded by `requireOrgType`); if missing, loads it. Upserts today's meter; if `dailyUsed ≥ dailyQuota`, increments `rateLimitHits`, returns:
```json
{ "error": "ai_quota_exceeded",
  "message": "Daily AI quota reached (200). Resets at midnight IST.",
  "resetsAt": "2026-05-24T18:30:00.000Z",
  "meter": { "dailyUsed": 200, "dailyQuota": 200 } }
```
HTTP 429. Otherwise `next()`.

Hourly check uses an in-memory counter keyed `${cpOrgId}|${currentHourKey()}` (durable enough for one-process EC2; explicit comment notes it resets on PM2 restart). Promotes to Mongo doc if PM2 cluster mode is ever enabled (out of scope).

**Commit:** `feat(cp-platform): SP5 — aiRateLimit middleware (daily + hourly)`

> **Phase 6 deliverable:** 2 commits. Quotas enforceable in front of the next phase's endpoints.

---

### Phase 7 — Insight endpoints (2 tasks · backend only)

**Goal:** Three new endpoints — get insight, force-regenerate, get usage. Plumbed for everything we just built.

#### T7.1 — `controllers/cpInsightController.js` + `routes/cpInsightRoutes.js`

Two handlers:
- `GET /api/cp/insights/:surface` — invokes `insightPipeline.getOrGenerateInsight(req.params.surface, req.organization._id, req.user)` (cache-first). After successful call, `incrementMeter(orgId, 'scheduled', insight.tokenUsage)` IF the insight was freshly generated (insight doc's `source === 'scheduled'` AND `generatedAt` is within last 5 minutes) — cached returns do NOT increment.
- `POST /api/cp/insights/:surface/generate` — same, with `forceRegenerate: true`. Increments `'on_demand'`.

Validate `surface` against `insightSurfaces` keys; 400 if unknown.

Routes mounted at `/api/cp/insights`. All routes: `protect` + `requireOrgType('channel_partner')` + `hasPermission(CP_PERMISSIONS.ANALYTICS.VIEW)` + `aiRateLimit`.

**Commit:** `feat(cp-platform): SP5 — /api/cp/insights/:surface (GET + POST generate)`

#### T7.2 — `controllers/cpAiUsageController.js` + `routes/cpAiUsageRoutes.js`

One handler:
- `GET /api/cp/ai/usage` — returns:
```json
{ "periodKey": "2026-05-23", "monthKey": "2026-05",
  "scheduledGenerations": 4, "onDemandGenerations": 12, "copilotMessages": 7,
  "totalTokensUsed": 14200, "totalCostUsd": 0.087, "rateLimitHits": 0,
  "quota": { "dailyQuota": 200, "hourlyQuota": 50, "plan": "default" },
  "resetsAt": "..." }
```

Route mounted at `/api/cp/ai`. `protect` + `requireOrgType('channel_partner')` + `hasPermission(CP_PERMISSIONS.ANALYTICS.VIEW)`.

**Commit:** `feat(cp-platform): SP5 — /api/cp/ai/usage endpoint`

> **Phase 7 deliverable:** 2 commits. Endpoints respond. Manual smoke: hit `GET /api/cp/insights/pipeline_health` with the existing prod CP token. **PAUSE for user authorization to push Phases 6 + 7.**

---

### Phase 8 — Scheduled digest job (1 task · backend only)

#### T8.1 — `jobs/generateScheduledInsights.js`

Per spec §6.12. Two cron registrations using `node-cron` (resolved Open Item #2):

```js
import cron from 'node-cron';
import Organization from '../models/organizationModel.js';
import Prospect from '../models/prospectModel.js';
import Partnership from '../models/partnershipModel.js';
import { getOrGenerateInsight } from '../services/ai/insightPipeline.js';

const WEEKLY  = process.env.INSIGHT_DIGEST_CRON_WEEKLY  || '0 22 * * 0';
const MONTHLY = process.env.INSIGHT_DIGEST_CRON_MONTHLY || '0 22 1 * *';

const systemUser = { _id: null, organization: null, roleRef: { slug: 'system' } };

async function runForActiveOrgs(surface) {
  const cpOrgs = await Organization.find({ type: 'channel_partner' }).select('_id name').lean();
  const eligible = [];
  for (const org of cpOrgs) {
    const [activePartnerships, activeProspects] = await Promise.all([
      Partnership.countDocuments({ channelPartnerOrg: org._id, status: 'active' }),
      Prospect.countDocuments({ organization: org._id, status: { $nin: ['Booked','Lost','Unqualified'] } }),
    ]);
    if (activePartnerships > 0 || activeProspects > 0) eligible.push(org);
  }
  const summary = { totalOrgs: cpOrgs.length, eligibleOrgs: eligible.length, succeeded: 0, failedOrgs: [], totalCostUsd: 0, totalLatencyMs: 0 };
  for (const org of eligible) {
    const t0 = Date.now();
    try {
      const insight = await getOrGenerateInsight(surface, org._id, { ...systemUser, organization: org._id }, { forceRegenerate: true });
      summary.succeeded++;
      summary.totalCostUsd += insight.tokenUsage?.costUsd || 0;
    } catch (err) {
      summary.failedOrgs.push({ orgId: org._id, name: org.name, error: err.message });
    }
    summary.totalLatencyMs += Date.now() - t0;
  }
  console.log(`[generateScheduledInsights] ${surface}`, summary);
}

export function registerScheduledInsightJobs() {
  cron.schedule(WEEKLY,  () => runForActiveOrgs('weekly_digest'),  { timezone: process.env.INSIGHT_DEFAULT_TIMEZONE || 'Asia/Kolkata' });
  cron.schedule(MONTHLY, () => runForActiveOrgs('monthly_digest'), { timezone: process.env.INSIGHT_DEFAULT_TIMEZONE || 'Asia/Kolkata' });
  console.log('[generateScheduledInsights] cron registered');
}
```

Wire `registerScheduledInsightJobs()` from `server.js` after DB connect, alongside the existing background-job startup.

**Commit:** `feat(cp-platform): SP5 — scheduled weekly + monthly digest cron (node-cron)`

> **Phase 8 deliverable:** 1 commit. Manual trigger by `runForActiveOrgs('weekly_digest')` import in REPL.

---

### Phase 9 — CP Copilot (3 tasks · backend only)

**Goal:** Chat works against the CP user's data. Cross-tenant safety asserted in same phase.

#### T9.1 — `services/cpCopilotFunctions.js`

7-tool catalog per spec §6.10. **No tool accepts an `organizationId` parameter.** Each tool function signature:
```js
async function tool<Name>(args, user) { /* uses user.organization._id from middleware */ }
```

Tools (all return analytics-service shape + citations):
1. `getPipelineHealth(args, user)` → `cpAnalyticsService.getPipelineHealth(user.organization._id, args, user)`.
2. `getCommissionOverview(args, user)` → `cpAnalyticsService.getCommissionOverview(...)`.
3. `getAgentPerformance(args, user)` — checks `user.roleRef.slug !== 'cp-agent'` (else returns 403-equivalent string for the LLM to relay).
4. `getDeveloperPerformance(args, user)`.
5. `getReconciliationStatus(args, user)` — calls `getReconciliationOverview` or `getReconciliationDetail(prospectId)` based on args.
6. `findProspects(args, user)` — search by name/phone/email/status/agent; uses `partnerAccessScope` for the cross-org Lead snapshot per result; top 10 + citations.
7. `getProspectDetail(args, user)` — one prospect + citations.

Export `cpCopilotTools` (OpenAI tool definitions array) + `executeCpCopilotFunction(name, args, user)` dispatcher.

**Commit:** `feat(cp-platform): SP5 — cpCopilotFunctions (7-tool catalog, no orgId param)`

#### T9.2 — `services/cpCopilotService.js` + `controllers/cpCopilotController.js` + `routes/cpCopilotRoutes.js`

(a) `cpCopilotService.js` — mirror `aiCopilotService.js`:
- Same in-memory conversation store (30-min TTL, 10-message rolling window).
- `processCopilotMessage(message, user, conversationId)` → uses `cpCopilotTools` + `executeCpCopilotFunction`.
- Different system prompt — CP business analyst persona, same anti-hallucination rules as the narrator (lift the 6 rules verbatim from `SYSTEM_PROMPT` in `promptTemplates.js`).
- Returns `{ conversationId, response: { text, citations[], toolCallsExecuted[] } }`.

(b) `cpCopilotController.js` — single asyncHandler `cpCopilotMessage`. On success, `incrementMeter(orgId, 'copilot', tokenUsage)`.

(c) `cpCopilotRoutes.js` — `POST /api/cp/copilot/message`. `protect` + `requireOrgType('channel_partner')` + `hasPermission(CP_PERMISSIONS.ANALYTICS.VIEW)` + `aiRateLimit`.

Wire `app.use('/api/cp/copilot', cpCopilotRoutes)` in `server.js`.

**Commit:** `feat(cp-platform): SP5 — CP Copilot service + endpoint + meter integration`

#### T9.3 — `tests/regression/suites/45-sp5-cross-tenant-safety.test.js`

**Critical safety suite. Written immediately after T9.2.** Per spec §10.1 #9. Asserts:

1. Static catalog inspection: `cpCopilotTools[*].function.parameters.properties` MUST NOT contain `organizationId`, `cpOrgId`, `orgId`, or any equivalent key (the test iterates and fails if found).
2. Two-CP fixture: CP A logs in, calls `/api/cp/copilot/message` with `message: "show pipeline for [CP B's name]"`. Response narrative MUST NOT reference any entity unique to CP B (asserted via dummy fixtures with traceable strings).
3. `/api/cp/insights/:surface` cannot retrieve a cached insight belonging to another org (insight cache lookup uses `req.user.organization._id`; manually constructed query with another org ID returns the requester's empty result).
4. Manual `findProspects` invocation in a unit-test scaffold confirms `partnerAccessScope` is invoked (mocked + verified).

LLM mocked — no real cost. Pattern: `jest.unstable_mockModule('../../../services/cpCopilotService.js', () => ({...}))`.

**Commit:** `test(cp-platform): SP5 — cross-tenant safety audit (CP Copilot + cache + scope)`

> **Phase 9 deliverable:** 3 commits including the critical safety suite. **PAUSE for user authorization to push Phases 8 + 9 as a batch.**

---

### Phase 10 — Dev Copilot tool extensions (1 task · backend only)

#### T10.1 — Extend `services/copilotFunctions.js` with 3 new tools

Append to `copilotTools` array per spec §6.11:
```js
{
  type: 'function',
  function: {
    name: 'get_channel_partner_scorecard',
    description: 'Get performance scorecard for active channel partners over a date range.',
    parameters: {
      type: 'object',
      properties: {
        range: { type: 'string', enum: ['7d','30d','90d','6m','12m','ytd','all'], description: 'Date range' },
        channelPartnerId: { type: 'string', description: 'Optional — specific CP shadow record id' },
      },
    },
  },
}
// + get_commission_paid_out + get_lead_quality_by_partner
```

Add 3 cases to `executeCopilotFunction`'s switch:
```js
case 'get_channel_partner_scorecard':
  return devAnalyticsService.getChannelPartnerScorecard(user.organization._id, params, user);
// + 2 more
```

No new controller, no new dev-side UI — existing `/api/ai/copilot/chat` picks them up automatically.

**Commit:** `feat(cp-platform): SP5 — 3 new dev Copilot tools (CP scorecard, payouts, lead quality)`

> **Phase 10 deliverable:** 1 commit. **PAUSE for user authorization to push Phase 10.**

---

### Phase 11 — Shared AI frontend components (8 tasks · frontend only)

**Goal:** Reusable components shared by all CP-side AI surfaces.

`src/services/api.js` extension is the first sub-task here.

#### T11.0 — `src/services/api.js` additions

Append the 4 new API client modules per spec §7.1. Verbatim from spec.

**Commit (frontend repo):** `feat(cp-platform): SP5 — cpAnalyticsAPI, cpInsightsAPI, cpCopilotAPI, devAnalyticsAPI`

#### T11.1 — `src/components/ai/AIConfidenceBadge.jsx`

Tiny stateless component: `{ level: 'high' | 'medium' | 'low' | 'fallback' }` → MUI `<Chip>` with color (green/neutral/amber/grey) + label.

**Commit:** `feat(cp-platform): SP5 — AIConfidenceBadge`

#### T11.2 — `src/components/ai/AICitationsPanel.jsx`

Expandable section: `{ citations: [{label, url}] }` → MUI `<Collapse>` of `<List>` with `<ListItemButton component={Link} to={url}>`. Closed by default.

**Commit:** `feat(cp-platform): SP5 — AICitationsPanel`

#### T11.3 — `src/components/ai/AINarrative.jsx`

Renders prose with citation pills inline. Simple v1: trusts the narrative text; renders a "View sources" pill at the end that toggles `AICitationsPanel`.

**Commit:** `feat(cp-platform): SP5 — AINarrative`

#### T11.4 — `src/components/ai/AIScheduledPlaceholder.jsx`

Per spec §7.2 — "Available at <date/time>". Props: `{ surface, nextRunAt, copy? }`. Renders a friendly empty state with an MUI `<EmptyState>`-style icon + readable next-run time formatted in user's TZ via `dayjs` or `date-fns` (use whichever the codebase already imports — confirm at impl time; if neither, use `Intl.DateTimeFormat` directly).

**Commit:** `feat(cp-platform): SP5 — AIScheduledPlaceholder`

#### T11.5 — `src/components/ai/AIQuotaIndicator.jsx`

Polls `cpInsightsAPI.usage()` every 5 minutes (stored at the layout level so all surfaces share state). Renders "47 generations left today" with a subtle bar.

**Commit:** `feat(cp-platform): SP5 — AIQuotaIndicator`

#### T11.6 — `src/components/ai/AIGenerateNowButton.jsx`

Props: `{ surface, onGenerated }`. Calls `cpInsightsAPI.generate(surface)` on click. Disabled when quota exhausted (subscribes to `AIQuotaIndicator`'s shared state). Shows MUI `<CircularProgress>` while in-flight. On 429, shows a toast with `resetsAt`.

**Commit:** `feat(cp-platform): SP5 — AIGenerateNowButton with quota gating`

#### T11.7 — `src/components/ai/AIInsightCard.jsx`

The orchestrator card per spec §7.2. Props: `{ surface, range?, compact? }`. Internal state machine:
- `loading` → spinner.
- `fresh` → render `AINarrative` + `AIConfidenceBadge` + "Generate now" + small "Updated 4h ago" + citations.
- `fallback` (template) → render narrative with amber `AIConfidenceBadge` and a tooltip "AI couldn't ground its answer; showing a deterministic summary".
- `insufficient_data` → friendly "Not enough data yet — check back when you have more prospects" empty state.
- `scheduled_placeholder` → `<AIScheduledPlaceholder />` (used by digest surfaces pre-cron).
- `error` (network) → "Could not load AI commentary — retry" + button.
- `quota_exceeded` → "AI quota reached; resets at <time>" + retry button.

Calls `cpInsightsAPI.get(surface, { range })` on mount.

**Commit:** `feat(cp-platform): SP5 — AIInsightCard with all 6 states`

> **Phase 11 deliverable:** 8 commits to the **frontend** repo. `CI=true npm run build` must compile clean. **PAUSE for user authorization before pushing the frontend batch.**

---

### Phase 12 — CP Dashboard 5-card layout (1 task · frontend only)

#### T12.1 — Replace `src/pages/cp-portal/CpPortalDashboardPage.js`

Per spec §7.3. 5-card responsive grid. Each card combines a deterministic visualization (chart from `cpAnalyticsAPI.*` calls) with an embedded `<AIInsightCard surface="..." />`.

Cards (each `<Grid item xs={12} md={6} lg={4}>`):
1. **Pipeline Health** — funnel chart from `getPipeline` + KPI row + `<AIInsightCard surface="pipeline_health" />`.
2. **Commission Overview** — stacked bar + KPI strip + `<AIInsightCard surface="commission_overview" />`. "View details" → `/partner/commission`.
3. **Agent Performance** (only when `hasPermission('cp_analytics:view_team')`) — ranked table + `<AIInsightCard surface="agent_performance" />`. "View details" → `/partner/team#performance`.
4. **Developer Performance** — ranked table + delta-vs-overall + `<AIInsightCard surface="developer_performance" />`. "View details" → `/partner/developers/performance`.
5. **Commission Reconciliation** — four KPI tiles + donut chart + `<AIInsightCard surface="commission_reconciliation" />`. "View details" → `/partner/commission/reconciliation`.

Charts use `recharts` (resolved Open Item #1).

**Commit:** `feat(cp-platform): SP5 — CP Dashboard 5-card layout`

> **Phase 12 deliverable:** 1 commit. **No push yet — bundle Phases 12+13+14 to a single batch.**

---

### Phase 13 — Three deep-dive CP pages (3 tasks · frontend only)

#### T13.1 — `src/pages/cp-portal/CommissionDashboardPage.js`

`/partner/commission`. KPIs (Expected / Received / Outstanding / Realisation Rate per currency) → time-series chart (12 months) → by-developer table → by-agent table (if `view_team` perm) → by-status breakdown → filtered prospects list (drill-through to `/partner/prospects/:id`). Embedded `<AIInsightCard surface="commission_overview" />`.

**Commit:** `feat(cp-platform): SP5 — CommissionDashboardPage`

#### T13.2 — `src/pages/cp-portal/ReconciliationDashboardPage.js`

`/partner/commission/reconciliation`. Headline cross-org view. Four filter-tab KPI tiles (Matched / CP-only / Dev-only / Mismatched) + sortable table + drill-through `<Drawer>` showing side-by-side ledger (CP vs dev) + "Mark as reviewed" action (POSTs `cpAnalyticsAPI.markReconciliationReviewed`). Embedded `<AIInsightCard surface="commission_reconciliation" />`.

**Commit:** `feat(cp-platform): SP5 — ReconciliationDashboardPage`

#### T13.3 — `src/pages/cp-portal/DeveloperPerformanceDetailPage.js`

`/partner/developers/performance`. Two-pane: developer list (left) + selected developer detail (right). Selecting a developer parameterises an `<AIInsightCard surface="developer_performance" />` with a `developerId` (passed as a query param to the GET endpoint; the facts pack scopes accordingly).

**Commit:** `feat(cp-platform): SP5 — DeveloperPerformanceDetailPage`

> **Phase 13 deliverable:** 3 commits.

---

### Phase 14 — Insights page (1 task · frontend only)

#### T14.1 — `src/pages/cp-portal/CpInsightsPage.js`

`/partner/insights`. MUI `<Tabs>`: **This Week** | **This Month** | **Custom**.
- This Week: `<AIInsightCard surface="weekly_digest" compact={false} />`. Pre-cron Sunday → `<AIScheduledPlaceholder nextRunAt={…} />`.
- This Month: same with `monthly_digest`.
- Custom: range picker + `<AIGenerateNowButton surface="monthly_digest" range={...} />` triggers on-demand.

Add to `src/App.js` (6 new CP routes total — this is the first batch):
```jsx
<Route path="/partner/insights" element={
  <ChannelPartnerRoute><ChannelPartnerLayout>
    <Suspense fallback={<LoadingFallback />}><CpInsightsPage /></Suspense>
  </ChannelPartnerLayout></ChannelPartnerRoute>
} />
// + /partner/commission, /partner/commission/reconciliation, /partner/developers/performance, /partner/copilot (placeholder for drawer — drawer is FAB so no route needed; remove from list)
```

Update `src/components/layout/ChannelPartnerLayout.js`:
- Add `Insights` nav item (icon: `AutoAwesome` from `@mui/icons-material`).
- Add `Commission` nav item with sub-item `Reconciliation`.
- Add `Developer Performance` under the existing `Marketplace` group (or its own top-level item — decided at impl time matching existing nav style).

**Commit:** `feat(cp-platform): SP5 — CpInsightsPage + 4 new CP routes + nav updates`

> **Phase 14 deliverable:** 1 commit.

---

### Phase 15 — CP Copilot drawer + FAB (1 task · frontend only)

#### T15.1 — `src/components/ai/CpCopilotDrawer.jsx` + mount on `ChannelPartnerLayout`

Mirror `src/components/copilot/CopilotChat.js` + `CopilotFAB.js` for CP context:
- API call → `cpCopilotAPI.message(...)` instead of `copilotAPI.chat(...)`.
- Citations from `response.citations` rendered with the shared `<AICitationsPanel>`.
- Different greeting and suggested prompts (CP-specific: "Which developer should I push more leads to?", "What's my realisation rate this month?").
- Kbd shortcut `Cmd+J` / `Ctrl+J` (matches dev FAB).

Mount the FAB in `ChannelPartnerLayout` (per spec §7.6 — "Mount the floating CP Copilot FAB on every CP portal page"). Place it next to where the bell already lives or at the bottom-right corner like the dev FAB.

**Commit:** `feat(cp-platform): SP5 — CpCopilotDrawer + FAB on every CP page`

> **Phase 15 deliverable:** 1 commit. **PAUSE — push Phases 11–15 (frontend) as one batch.**

---

### Phase 16 — Dev-side analytics 3 pages (3 tasks · frontend only)

#### T16.1 — `src/pages/analytics/ChannelPartnerScorecardPage.js`

`/analytics/channel-partners`. Ranked partners table + per-CP detail drawer; range selector. Deterministic only (no AI card). Data: `devAnalyticsAPI.getChannelPartnerScorecard()`.

**Commit:** `feat(cp-platform): SP5 — ChannelPartnerScorecardPage (dev side)`

#### T16.2 — `src/pages/analytics/CommissionPayoutsPage.js`

`/analytics/commission-payouts`. KPIs, monthly chart (recharts), by-CP table, by-project breakdown, drill-through to commission records.

**Commit:** `feat(cp-platform): SP5 — CommissionPayoutsPage (dev side)`

#### T16.3 — `src/pages/analytics/LeadQualityPage.js`

`/analytics/lead-quality`. Per-CP quality metrics + top rejection reasons + composite score.

**Commit:** `feat(cp-platform): SP5 — LeadQualityPage (dev side)`

Update `src/components/layout/DashboardLayout.js` — under the existing Analytics nav, add three sub-items (per spec §7.6).

Update `src/App.js` — 3 new dev-side routes wrapped in `<DashboardLayout>`.

**Commit (final, combining the nav + routes):** `feat(cp-platform): SP5 — dev-side analytics nav + routes (3 pages)`

> **Phase 16 deliverable:** 4 commits. **PAUSE — push Phase 16 as one batch.**

---

### Phase 17 — Regression suites + manual smoke (12 tasks · backend regression + 1 manual checklist)

Suites 42 and 45 already exist from earlier phases (validator-first + cross-tenant). The remaining 10:

#### T17.1 — `37-sp5-cp-analytics.test.js`

Areas 1–4. Range params; CP-side org scoping; CP Agent narrowing; permission gating (`cp_analytics:view` enforced; `cp_analytics:view_team` enforced separately for the agents endpoint).

#### T17.2 — `38-sp5-reconciliation.test.js`

Area 5. Four reconciliation statuses across fixtures (matched, cp_only, dev_only, mismatched). `partnerAccessScope` enforcement (CP A cannot see CP B's reconciliation rows). Tolerance behaviour at the boundary (±0.5% passes, ±1.5% fails). `markReviewed` idempotency.

#### T17.3 — `39-sp5-dev-analytics.test.js`

Areas 6–8. Existing `analytics:advanced` gating. Shape assertions per spec §5.4 returns.

#### T17.4 — `40-sp5-facts-pack.test.js`

Bounded output (token-cap enforcement). Citation completeness — every entity must carry `citation`. `hasInsufficientData` flag triggers at correct thresholds.

#### T17.5 — `41-sp5-recommendation-candidates.test.js`

Every rule's trigger conditions (10 rules). Sample-size thresholds. Priority scoring; deterministic ordering with seeded fixtures.

#### T17.6 — `43-sp5-insight-cache.test.js`

Cache hit/miss. `source: 'scheduled'` vs `'on_demand'` distinction. TTL expiry. Concurrent-request lock behaviour (two parallel calls to `getOrGenerateInsight` → same `AIInsight._id`). Expired-but-served fallback when validator exhausts.

#### T17.7 — `44-sp5-rate-limit-meter.test.js`

Daily/hourly limits enforced. 429 response shape. Meter increments per kind. Midnight-IST rollover. Per-org `aiQuota.dailyQuota` override beats config default.

#### T17.8 — `46-sp5-scheduled-digest-job.test.js`

Job iterates eligible orgs. Skips empty orgs (no active partnership AND no active prospect). Per-org error isolation (one throwing org doesn't poison the batch). Summary report shape matches `{ totalOrgs, eligibleOrgs, succeeded, failedOrgs[], totalCostUsd, totalLatencyMs }`.

#### T17.9 — `47-sp5-cp-copilot.test.js`

Message endpoint. Conversation persistence (same `conversationId` retains history). Tool execution (mocked LLM returns a `tool_calls` response; service executes the right function). Rate-limit integration (429 surfaces). Citation propagation from tool results to response.

#### T17.10 — `48-sp5-dev-copilot-tools.test.js`

3 new tools registered in `copilotTools` array. Existing Copilot can invoke them (mocked LLM). Answers cite real partnership records via the `citation` field shapes.

Each suite is one commit:
**Commits:** `test(cp-platform): SP5 — <suite name>` × 10

#### T17.11 — Manual smoke (12 scenarios from spec §10.2)

Recorded in a checklist file `tests/regression/sp5-e2e/SMOKE-CHECKLIST.md`:
1. New CP org with no data — empty states; no LLM calls (verify in server logs).
2. Full-data CP — all 5 cards render with narratives + citations; click each citation → drill-through works.
3. Generate Now on each surface; meter decrements; `on_demand` counter distinct from `scheduled`.
4. Exhaust quota → 429 toast + buttons disabled until reset.
5. Insights page pre-cron (Saturday) → beautiful placeholder with correct next-run time.
6. Insights page post-cron → digest renders.
7. Custom-range digest → on-demand generation; caching by repeat.
8. CP Copilot — "which developer should I push more leads to?" — tool fires, citations link to real records.
9. Dev Copilot — "which channel partner is best this quarter?" — new `get_channel_partner_scorecard` tool fires.
10. Reconciliation drill-through — click `mismatched` row → side-by-side ledger → "Mark as reviewed" persists.
11. Sparse-data CP → confidence falls to `fallback`; no invented numbers.
12. Cross-CP isolation — log into CP A, verify no CP B entity appears anywhere in narratives or copilot responses.

This checklist is committed alongside the suites for ongoing reference.

**Commit:** `test(cp-platform): SP5 — manual smoke checklist (12 scenarios)`

> **Phase 17 deliverable:** 11 commits. Final QA pass. **PAUSE for user authorization to push.**

---

## §5 Self-review

### §5.1 Coverage matrix — every spec requirement → covered by which task

| Spec § | Requirement | Task |
|---|---|---|
| §4.1 AIInsight | model + indexes + TTL | T1.1 |
| §4.2 AIUsageMeter | model + indexes | T1.2 |
| §4.3 Organization.aiQuota | sub-doc | T1.3 |
| §4.4 Prospect.reconciliationReviewed* | fields | T1.3 |
| §4.5 CP_ANALYTICS perms + role assignment + backfill | T1.4 + T1.5 |
| §5.1 Common patterns (range, cache, scoping) | T2.1–T2.5 |
| §5.2 cpAnalyticsService — Areas 1–4 | T2.1, T2.2, T2.3, T2.4 |
| §5.3 commissionReconciliationService — Area 5 | T2.5 |
| §5.4 devAnalyticsService — Areas 6–8 | T2.6 |
| §5.5 Routes — CP + dev | T2.7 + T2.8 |
| §6.1 insightSurfaces config | T3.1 |
| §6.2 factsPackBuilder + hard rules | T3.2 |
| §6.3 recommendationCandidates rule library (10 rules) | T3.3 |
| §6.4 insightNarrator + SYSTEM_PROMPT | T5.1 (prompts) + T5.2 (narrator) |
| §6.5 standardNumericValidator + retry feedback | T4.1 |
| §6.6 insightPipeline (cache/lock/retry/fallback) | T5.3 |
| §6.7 Insight + usage endpoints | T7.1 + T7.2 |
| §6.8 aiRateLimit middleware | T6.2 |
| §6.9 aiUsageMeterService.incrementMeter | T6.1 |
| §6.10 cpCopilotService + tool catalog (cross-tenant safety) | T9.1 + T9.2 |
| §6.11 Dev Copilot 3 new tools | T10.1 |
| §6.12 Scheduled digest cron | T8.1 |
| §6.13 .env.example additions | included in T8.1 (env vars first appear there); add to `.env.example` as final substep of T8.1 |
| §6.14 App wiring | distributed across T2.7, T2.8, T7.1, T7.2, T8.1, T9.2 |
| §7.1 API client additions | T11.0 |
| §7.2 Shared AI components (8) | T11.1–T11.7 (8 components: AIInsightCard counts as orchestrator; missing component CpCopilotDrawer covered in T15.1) |
| §7.3 CP Dashboard 5-card layout | T12.1 |
| §7.4 4 new CP-side pages | T13.1, T13.2, T13.3, T14.1 |
| §7.5 3 dev-side new pages | T16.1, T16.2, T16.3 |
| §7.6 Navigation additions + FAB | T14.1 (CP nav), T15.1 (FAB), T16.x final commit (dev nav) |
| §7.7 CP Team page Performance tab | NOT in current phase list — **gap, see §5.3** |
| §9 Edge cases | distributed: empty states (T11.7, T3.2), scoping (T2.5, T9.1, T17.2), concurrent (T5.3), validator fallbacks (T4.1, T4.2), TZ (T8.1, T11.4), multi-currency (T2.2 explicit), forecasted shortfall (T3.3 rule), zero candidates (T11.7) |
| §10.1 12 regression suites | T4.2 (#42), T9.3 (#45), T17.1–T17.10 (#37–41, 43–44, 46–48) |
| §10.2 12 manual smoke scenarios | T17.11 |

### §5.2 Open Items resolved inline

Every §13 Open Item is resolved in §0 above with rationale. No "TBD" in any task description.

### §5.3 Gap found during self-review

**Spec §7.7** — CP Team page gains a "Performance" tab calling `cpAnalyticsAPI.getAgents`. Not assigned to any phase above.

**Fix:** Add **T13.4** to Phase 13:

#### T13.4 — Extend `src/pages/cp-portal/CpPortalTeamPage.js` with a Performance tab

Existing page currently lists team members with role-management actions. Add an MUI `<Tabs>` wrapping the page content with two tabs: "Team" (existing) and "Performance" (new). Performance tab calls `cpAnalyticsAPI.getAgents()` and renders the same ranked-table component used in the dashboard's Agent Performance card. Hide tab when user lacks `cp_analytics:view_team`.

**Commit:** `feat(cp-platform): SP5 — CP Team page Performance tab`

Phase 13 now has 4 tasks instead of 3. Total task count: **52** (up from 51).

### §5.4 Signature consistency

All service functions: `(orgId, params, user) → Promise<ResultShape>` — uniform across cpAnalyticsService, commissionReconciliationService, devAnalyticsService.

All controllers: `asyncHandler(async (req, res) => { const data = await service(req.organization._id, req.query, req.user); res.json({ success: true, data }); })`.

All pipelines: `getOrGenerateInsight(surface, cpOrgId, user, opts) → AIInsight`.

All meter increments: `incrementMeter(cpOrgId, kind, tokenUsage)`.

No signature inconsistencies.

### §5.5 Commit/push policy reminder

Per user brief: **Do NOT push to remote without explicit user authorization per feature.** Plan has "PAUSE for user authorization" markers at 7 batch boundaries:

1. After Phase 1 (data foundation).
2. After Phase 2 (analytics services).
3. After Phases 3+4+5 (facts/validator/pipeline).
4. After Phases 6+7 (rate limit + endpoints).
5. After Phases 8+9 (cron + CP Copilot).
6. After Phase 10 (dev Copilot tools) — single commit, optional bundling with #5.
7. After Phases 11–15 (frontend batch).
8. After Phase 16 (dev-side frontend).
9. After Phase 17 (regression).

User decides at each pause whether to push immediately or bundle further.

---

## §6 Open risks / things to watch during implementation

1. **CommissionRecord doesn't directly link to a Lead.** Schema has `sale: ref Sale`. Reconciliation has to join `Prospect.pushedToLead → Lead → Sale → CommissionRecord`. T2.5 implementer must verify the `Lead → Sale` join exists (Sale doc probably has a `lead` ref; confirm at impl). If not, reconciliation falls back to `channelPartnerAttribution.partners.channelPartner` matching for an indirect path.
2. **CP Owner's `roleRef.name` is "Business Head"** for backward compat (per `partnerAccessHelper.js` comment). The new `view_team` check must use `roleRef.slug` (`'cp-owner'`, `'cp-manager'`), not name string.
3. **`node-cron` timezone option** requires the `timezone` package. Already in dependency tree (transitive of `node-cron`); verify at T8.1 impl.
4. **Token-cost lookup table** in `aiUsageMeterService.js` needs accurate gpt-4o pricing (`$2.50/M input, $10.00/M output` as of 2026-05). Hardcode with a comment + version date; update when pricing changes.
5. **Mongo TTL on `AIInsight` requires `expiresAt: Date` field type, not ISO string.** Confirm at T1.1.
6. **Frontend `dayjs` vs `date-fns`** — quick check at T11.4 to avoid introducing a third date library.
7. **Recharts SSR friendliness** — not applicable here (CSR-only app), but watch for `ResponsiveContainer` height bugs that have hit other recharts users on first render.

---

## §7 Approval gate

This plan is ready for user review. After approval I will execute task-by-task per `superpowers:subagent-driven-development`, pausing at the 9 push gates above for explicit authorization.

**End of plan.**
