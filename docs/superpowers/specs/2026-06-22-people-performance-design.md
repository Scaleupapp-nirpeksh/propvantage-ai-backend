# People & Performance Management — Design Spec

**Date:** 2026-06-22
**Repos:** `propvantage-ai-backend` (data, engine, jobs, APIs, AI) + `propvantage-ai-frontend` (dashboards, reflection editor)
**Status:** Approved in brainstorm; pending spec review → implementation plan.

## 1. Goal

A two-sided people-management layer on PropVantage:

1. **Manager-facing performance tracking** — the Owner tracks Heads; each Head tracks their team. Surfaces each person's real output (leads, sales, tasks, tickets, interactions), attainment vs targets, trends, and **behavioral red-flags** (stale leads, no follow-up, no movement) so it feeds real promotion / improvement / termination conversations.
2. **Member-facing weekly reflection + self-dashboard** — every member files a **mandatory** weekly reflection (≥500 chars per answer, with voice→transcription→confirm) and sees their own performance over any time range. Reflections + AI **sentiment/morale** analysis roll up to the Head and Owner.

## 2. Locked decisions (from brainstorm)

- **Hierarchy:** derived from **role tiers** (no explicit `reportsTo`). Members roll up to their department Head; Heads roll up to the Owner.
- **Delivery:** the full system as **one release** (built as clean, independently-testable modules — see §13).
- **Targets:** per-user **targets/quotas** included (seeded from role templates, monthly).
- **Red-flags:** **alert the manager (daily digest) + show on dashboards**, with a gentle self-nudge to the member first.
- **Reflections:** **mandatory** weekly; **soft gate** (persistent prompt + overdue flag + tracked submission rate, not a hard lockout). Editable until end of ISO week, then locked. Manager can **acknowledge + leave a private note**.
- **Signals computation:** **hybrid** — nightly job materializes snapshots; current day computed live.
- **AI sentiment:** Claude analyzes each reflection; per-person sentiment is visible to the **direct manager chain + Owner**; a weekly **morale roll-up** is generated for Heads (team) and Owner (org).
- **Channel-Partner roles** roll up under the **Sales Head**.
- **Red-flag thresholds (defaults, configurable):** lead no-interaction 7d; no status-movement 14d; follow-up overdue 2d; aging pipeline 30d; low activity < 5 interactions / 7d.

## 3. Scope

**In:** hierarchy resolver; performance signals + nightly snapshot job; per-user targets + attainment; red-flag engine + alerts; weekly reflections + voice transcription + mandatory enforcement; AI sentiment + weekly morale roll-ups; Member/Head/Owner dashboards + access control.

**Out (later):** explicit org-chart editor / `reportsTo` overrides; commission payout tracking for internal agents; peer/360 feedback; OKRs beyond simple quotas; mobile-native.

## 4. Architecture

```
Existing collections (read-only sources)        New collections
  Lead, Interaction, Sale, Task,                  PerformanceSnapshot
  SupportTicket, User, Notification               PerformanceTarget
            │                                      WeeklyReflection (+ sentiment)
            ▼                                      MoraleSummary
  hierarchyResolver ──► performanceSignalsService ──► dashboards API
            │                    │
            │                    ├─ nightly job (node-cron) ─► snapshots + red-flags + morale roll-ups
            ▼                    ▼
  reflectionService ◄─ openAIService (transcribe) ─ anthropic (sentiment/morale)
```

- **Hybrid signals:** the nightly job writes `PerformanceSnapshot` rows (day grain, rolled to week/month) and detects red-flags + builds morale roll-ups. Dashboard reads merge stored snapshots (history/trends) with a **live compute for the in-progress day**. Identical metric functions are used by both paths (one source of truth in `performanceSignalsService`).
- **Schedulers** use the existing `node-cron` pattern (cf. `services/backgroundJobService.js`, `jobs/`). AI uses existing `openai` (transcription) and `@anthropic-ai/sdk` (sentiment) clients — no new deps.

## 5. Hierarchy resolver (`services/people/hierarchyService.js`)

Pure functions over `User` (role + `roleRef` + `isOwner`/organization owner):

- `DEPARTMENT_BY_ROLE` map:
  - **Sales:** Sales Head ← Sales Manager, Sales Executive, Channel Partner Manager, Channel Partner Admin, Channel Partner Agent
  - **Finance:** Finance Head ← Finance Manager
  - **Legal:** Legal Head ← (legal team)
  - **CRM/Support:** CRM Head ← (CRM/support team)
  - **Marketing:** Marketing Head ← (marketing team)
  - **Projects:** Project Director ← (project/construction team)
  - **Top:** Owner / Business Head ← all Heads
- `getTeam(headUser)` → members whose department maps to that Head (org-scoped).
- `getManagerChain(user)` → [direct Head, …, Owner].
- `getSubtree(user)` → everyone visible to this user (Owner = whole org; Head = their department; member = self).
- `resolveDepartment(user)` → from `role`, else `roleRef.department` tag, else `'unassigned'` (rolls up to Owner so nobody is invisible).
- Custom `roleRef` roles roll up via a new optional **`department`** tag on the Role model; unmapped → Owner.

## 6. Data models (new)

### `PerformanceSnapshot` (`models/performanceSnapshotModel.js`)
`{ organization, user, period: 'day'|'week'|'month', periodStart, periodEnd, metrics: { leadsWorked, leadsConverted, conversionRate, salesCount, salesValue, tasksCompleted, tasksOverdue, taskSlaRate, ticketsResolved, ticketAvgResolutionHrs, interactionsLogged, ... }, redFlags: { staleLeads, noMovementLeads, overdueFollowUps, overdueTasks, agingPipeline, lowActivity }, computedAt }`. Indexes: `{organization, user, period, periodStart}` unique.

### `PerformanceTarget` (`models/performanceTargetModel.js`)
`{ organization, user, period: 'month', periodStart, targets: { salesCount, salesValue, leadsWorked, conversions, taskSlaRate }, setBy, source: 'template'|'manual', updatedAt }`. Role-template defaults live in a config map; `setBy` is the Head/Owner.

### `WeeklyReflection` (`models/weeklyReflectionModel.js`)
`{ organization, user, isoWeek: 'YYYY-Www', weekStart, weekEnd, answers: { wins, areasToImprove, dislikes, achievements, plansNextWeek, other? }, status: 'draft'|'submitted', submittedAt, voiceMeta: [{field, durationSec, transcribedAt}], sentiment: { score: -1..1, label: 'positive'|'neutral'|'negative', themes: [..], riskSignals: [..], analyzedAt, model }, managerAck: { by, at, note } }`. Each required answer ≥500 chars enforced at submit. Unique `{organization, user, isoWeek}`.

### `MoraleSummary` (`models/moraleSummaryModel.js`)
`{ organization, scope: 'team'|'org', head?: User, isoWeek, moraleScore: 0..100, trendVsLastWeek, narrative, topPositiveThemes: [..], topNegativeThemes: [..], peopleToCheckIn: [{user, reason}], risks: [..], reflectionsAnalyzed, generatedAt }`. Built weekly by the job.

### Edits to existing models
- `User`: add `lastActiveAt` (Date) — bumped by a lightweight middleware on authenticated requests (throttled to ~1/hour write).
- `Role`: add optional `department` (String) tag for custom-role rollup.
- `Notification`: add types `perf_redflag_digest`, `perf_redflag_self`, `reflection_due`, `reflection_overdue`, `morale_summary_ready`.

## 7. Performance signals (`services/people/performanceSignalsService.js`)

One module that, given `(user, periodStart, periodEnd)`, returns the metrics object — used by both the nightly job and live reads.

| Metric | Source |
|---|---|
| leadsWorked / conversions / conversionRate | `Lead` (assignedTo, statusHistory, status ∈ Booked) |
| salesCount / salesValue | `Sale` (salesPerson, bookingDate, status ≠ Cancelled) |
| tasksCompleted / tasksOverdue / taskSlaRate | `Task` (assignedTo, completedAt, sla) |
| ticketsResolved / avgResolutionHrs | `SupportTicket` (assignee, status, closedAt) |
| interactionsLogged | `Interaction` (user, createdAt) |
| trends | current snapshot vs previous period snapshot |
| vs team median | computed across `getTeam` snapshots in the job |

## 8. Red-flag engine (`services/people/redFlagService.js`)

Run nightly per active member. Each flag = `{type, count, items: [entityIds]}`:
- `staleLeads` — open leads with `engagementMetrics.lastInteractionDate` > 7d ago.
- `noMovementLeads` — open leads with `statusChangedAt` > 14d ago.
- `overdueFollowUps` — `followUpSchedule.nextFollowUpDate` passed > 2d.
- `overdueTasks` — tasks past `dueDate`, not completed.
- `agingPipeline` — leads open > 30d, not converted.
- `lowActivity` — interactionsLogged(last 7d) < threshold.

**Delivery:** member gets a `perf_redflag_self` nudge for their own flags; each Head gets one `perf_redflag_digest` summarizing flagged team members. Flags also persist on the snapshot for the dashboard "needs attention" inbox. Thresholds in an org-level config (defaults above).

## 9. Targets & attainment (`services/people/targetService.js`)

- Role-template defaults (config map) seed a member's monthly `PerformanceTarget` on first need.
- Heads set/adjust targets for their team; Owner for Heads. CRUD guarded by `getSubtree`.
- Attainment = actual (from signals) / target, surfaced as %/pace on every scorecard.

## 10. Reflections + voice (`services/people/reflectionService.js`, `controllers/reflectionController.js`)

- **Prompts (each ≥500 chars):** wins, areasToImprove, dislikes, achievements, plansNextWeek (+ optional other).
- **Voice pipeline:** browser records per field → `POST /api/people/reflections/transcribe` (multipart audio) → `openAIService` transcription → returns text → user edits → confirm → `PUT /api/people/reflections/:isoWeek` (draft) → `POST .../submit`.
- **Mandatory (soft gate):** a member's current-week reflection status is exposed via `GET /api/people/reflections/current`; the frontend shows a persistent prompt + banner when missing. `reflection_due` (Fri) and `reflection_overdue` (Mon) notifications. Submission-rate metric tracked per person/team.
- **Lifecycle:** draftable all week; **locked after `weekEnd`**. On submit → enqueue AI sentiment analysis.
- **Manager loop:** `POST .../:id/ack` records `managerAck {by, at, note}` (private to manager chain).

## 11. AI sentiment & morale (`services/people/moraleService.js`)

- **Per reflection (on submit, Claude `@anthropic-ai/sdk`):** returns `{score, label, themes[], riskSignals[]}` (burnout, frustration, blocked-on-others, flight-risk, recognition, workload). Stored on the reflection. Strict JSON output, best-effort (failure leaves sentiment null, never blocks submit).
- **Weekly roll-up (weekly job):** for each Head's team and for the org, Claude summarizes that week's submitted reflections → `MoraleSummary` (moraleScore, trend, narrative, top themes, people-to-check-in, risks). No anonymization (per the visibility decision, managers already see their team's reflections); a tiny team simply yields a thinner signal, noted in the narrative.
- **Surfacing:** "Team Morale" panel (Head dashboard), "Organization Morale" panel (Owner). `morale_summary_ready` notification when generated.

## 12. Dashboards & access control

All reads guarded by `getSubtree(currentUser)` — you only see down your own subtree; Owner sees all.

- **Member — "My Performance"** (`/people/me`): time-range switch (this/last week, last 2 weeks, this month, custom); scorecard (value · trend · vs team median · % target); my red-flags (deep-linked); reflection editor + history; activity/funnel charts.
- **Head — "Team Performance"** (`/people/team`): team roster of scorecards (metrics, attainment %, flag count, last active, reflection-in?); sort/rank/compare; drill into a member's (read-only) Member view + reflections + ack; team rollup + trends; **needs-attention inbox**; **Team Morale** panel; target editor for the team.
- **Owner — "Organization Performance"** (`/people/org`): Heads roster (department rollup + Head's own scorecard); drill Owner→Head→member→entity; all reflections; **Organization Morale** panel; org-wide outliers; target editor for Heads.

## 13. APIs (new, under `/api/people`)

- `GET /me` · `GET /member/:userId` — scorecard for a user + range (`?from&to` or `?range=`), subtree-guarded.
- `GET /team` (Head) · `GET /org` (Owner) — roster rollups.
- `GET /flags` — red-flags for self or a subtree user.
- `GET /targets/:userId` · `PUT /targets/:userId` — read/set targets (subtree-guarded).
- `GET /reflections/current` · `GET /reflections?isoWeek=` · `PUT /reflections/:isoWeek` · `POST /reflections/:isoWeek/submit` · `POST /reflections/:id/ack` · `POST /reflections/transcribe`.
- `GET /morale/team` · `GET /morale/org`.

Routes mounted `app.use('/api/people', protect, peopleRoutes)`.

## 14. Frontend (`propvantage-ai-frontend`)

- Pages: `MyPerformancePage`, `TeamPerformancePage`, `OrgPerformancePage` (role-gated nav under a new "People" section).
- Components: `Scorecard`, `MetricTile` (reuse the copilot/workspace formatting helpers — guard against NaN), `RedFlagInbox`, `TargetEditorDialog`, `MoralePanel`, `ReflectionEditor` (5 prompts, char-counter ≥500, `VoiceRecorder` → transcribe → editable), `ReflectionHistory`, `ManagerAck`.
- `api.js`: `peopleAPI` (member/team/org/flags/targets/reflections/morale/transcribe).
- Reflection soft-gate: a small `ReflectionPrompt` banner in the dashboard layout when the current week is unsubmitted.

## 15. Scheduled jobs

- **Nightly** (`jobs/computePerformanceSnapshots.js`, node-cron): per org → per active member compute day snapshot, roll week/month, detect red-flags, send self-nudges; per Head send the digest.
- **Weekly** (Mon AM): generate `MoraleSummary` (team + org) from the prior week's submitted reflections; emit `morale_summary_ready`; emit `reflection_overdue` for non-submitters; (Fri) emit `reflection_due`.

## 16. Testing

- Unit (Jest, `--experimental-vm-modules`): hierarchyService (rollups, custom-role fallback), performanceSignalsService (each metric off mocked collections), redFlagService (each threshold boundary), targetService (attainment math, subtree guard), reflectionService (500-char enforcement, lock-after-week, mandatory status), moraleService (JSON parse + best-effort failure), access-control guards on every endpoint.
- Frontend: render tests for Scorecard/MetricTile (NaN-safe), ReflectionEditor (char-min gating), VoiceRecorder (transcribe → editable flow mocked).

## 17. Build order (modules)

1. `hierarchyService` (+ Role.department) — foundation, fully unit-tested.
2. `performanceSignalsService` + `PerformanceSnapshot` + nightly snapshot job.
3. `targetService` + `PerformanceTarget` + attainment.
4. `redFlagService` + alerts/digest.
5. `reflectionService` + `WeeklyReflection` + voice transcription + mandatory soft-gate.
6. `moraleService` + `MoraleSummary` + weekly job (sentiment + roll-ups).
7. Dashboards API + access control.
8. Frontend: 3 dashboards + reflection editor/voice + morale panels + nav.

## 18. Risks / notes

- **Honesty bias:** mandatory + manager-visible sentiment may bias reflections positive (accepted per visibility decision).
- **AI cost/latency:** sentiment is per-submit (cheap, async); morale roll-ups are weekly (bounded). Both best-effort, never block the user.
- **Role-tier rigidity:** can't model sub-teams/odd reporting lines; `reportsTo` overrides are a clean later add if needed.
- **Snapshot backfill:** trends need history; on first deploy, backfill N weeks of snapshots from existing data via a one-off script.
- **Voice privacy:** audio is transcribed then discarded (not stored); only text + minimal `voiceMeta` persist.
