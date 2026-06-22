# People & Performance Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Each task is dispatched to a fresh subagent that does TDD (failing test → impl → green → commit) and returns.

**Goal:** A people-management layer where the Owner tracks Heads and Heads track their teams — per-user performance signals, targets, red-flags, mandatory weekly reflections with voice + AI sentiment/morale, and Member/Head/Owner dashboards.

**Architecture:** Read existing `Lead/Interaction/Sale/Task/SupportTicket/User`; add `PerformanceSnapshot/PerformanceTarget/WeeklyReflection/MoraleSummary`. A nightly + weekly `node-cron` job materializes snapshots, red-flags, and morale roll-ups; dashboards merge stored snapshots with a live current-day compute. Claude does sentiment/morale; OpenAI does voice transcription.

**Tech Stack:** Node/Express ESM, Mongoose, Jest (`node --experimental-vm-modules node_modules/jest/bin/jest.js --config jest.unit.config.mjs`), node-cron, @anthropic-ai/sdk (`claude-sonnet-4-6`), openai (transcription), React 18 + MUI 5, Axios.

**Full design:** `docs/superpowers/specs/2026-06-22-people-performance-design.md` — every task references it; read the relevant section before implementing.

## Global Constraints

- Backend repo: `/Users/nirpekshnandan/My Products/propvantage-ai-backend`. Frontend repo: `/Users/nirpekshnandan/My Products/propvantage-ai-frontend`.
- ESM only (`import`/`export`). Tests in `tests/unit/`, mock all models/AI/DB — no live Mongo or network.
- Every backend task: unit tests pass via the Jest command above; commit at the end. Co-author trailer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Frontend: `CI=true npm run build` must stay green (warnings are errors). Reuse NaN-safe currency formatting (see `src/components/copilot/cards/MetricsCardRenderer.js`).
- All `/api/people` reads/writes are org-scoped AND subtree-guarded (a user only sees down their own subtree; Owner sees all).
- Money values returned by APIs are RAW numbers; the frontend formats them.
- Do NOT start a task until its predecessors are merged (dependencies are real).

---

### Task 1: Hierarchy resolver + Role.department

**Files:**
- Create: `services/people/hierarchyService.js`
- Modify: `models/roleModel.js` (add optional `department` String)
- Test: `tests/unit/hierarchyService.test.js`

**Interfaces — Produces:**
- `DEPARTMENT_BY_ROLE: Record<string,string>` and `HEAD_ROLE_BY_DEPARTMENT: Record<string,string>`
- `resolveDepartment(user) -> string` (from `user.role`, else `user.roleRef?.department`, else `'unassigned'`)
- `getHeadRoleForUser(user) -> string|null`
- `async getTeam(headUser) -> User[]` (org members in the head's department, excluding the head)
- `async getManagerChain(user) -> User[]` (direct Head … Owner)
- `async getSubtree(user) -> { scope:'org'|'department'|'self', userIds: ObjectId[] }` (Owner/Business Head → org; Head → dept; member → [self])
- `isOwnerLevel(user) -> boolean` (org owner or 'Business Head')

**Spec:** §5. Mapping in §5 table (Sales Head ← Sales Manager/Executive + all Channel-Partner roles; Finance Head ← Finance Manager; etc.; Owner/Business Head sees all).

Reference for detailed steps (written just-in-time at dispatch): role enum in `models/userModel.js` (lines ~96-113), `isOwner`/organization-owner detection, `roleRef` populate.

**Acceptance:** unit tests cover — sales exec → Sales Head; CP agent → Sales Head; finance manager → Finance Head; unmapped custom role → unassigned → Owner subtree; Owner getSubtree scope 'org'; Head getSubtree scope 'department' with correct userIds; member getSubtree = self only.

---

### Task 2: Performance signals service + PerformanceSnapshot + nightly snapshot job

**Files:**
- Create: `models/performanceSnapshotModel.js`, `services/people/performanceSignalsService.js`, `jobs/computePerformanceSnapshots.js`
- Modify: the cron registration point (follow `services/backgroundJobService.js` / existing `jobs/` registration)
- Test: `tests/unit/performanceSignalsService.test.js`, `tests/unit/performanceSnapshotModel.test.js`

**Interfaces:**
- Consumes: `hierarchyService.getTeam`, `getSubtree` (Task 1)
- Produces: `async computeMetrics(user, periodStart, periodEnd) -> MetricsObject` (shape per spec §6 `PerformanceSnapshot.metrics`); `async buildSnapshot(orgId, user, period, periodStart) -> SnapshotDoc`; `async teamMedians(orgId, headUser, period, periodStart) -> Record<metric,number>`

**Spec:** §4 (hybrid), §6 (`PerformanceSnapshot`), §7 (metric→source table). Sources: Lead(assignedTo/statusHistory), Sale(salesPerson/bookingDate/status≠Cancelled), Task(assignedTo/completedAt/sla), SupportTicket(assignee/closedAt), Interaction(user/createdAt).

**Acceptance:** each metric computed from mocked aggregates; unique index `{organization,user,period,periodStart}`; nightly job iterates org→active users, writes day snapshot, rolls week/month, is idempotent (upsert).

---

### Task 3: Targets + attainment

**Files:**
- Create: `models/performanceTargetModel.js`, `services/people/targetService.js`, `config/performanceTargetTemplates.js`
- Test: `tests/unit/targetService.test.js`

**Interfaces:**
- Consumes: `hierarchyService.getSubtree`, `performanceSignalsService.computeMetrics`
- Produces: `async getOrSeedTarget(orgId, userId, periodStart) -> TargetDoc`; `async setTarget(actor, userId, periodStart, targets) -> TargetDoc` (subtree-guarded — actor must be above target user); `computeAttainment(metrics, target) -> Record<metric,{actual,target,pct}>`

**Spec:** §6 (`PerformanceTarget`), §9. Role templates in the config map.

**Acceptance:** seeds from role template on first read; setTarget rejects when actor not above target user; attainment math (incl. divide-by-zero → null pct).

---

### Task 4: Red-flag engine + alerts

**Files:**
- Create: `services/people/redFlagService.js`
- Modify: `models/notificationModel.js` (add types `perf_redflag_digest`, `perf_redflag_self`), wire detection into `jobs/computePerformanceSnapshots.js`
- Test: `tests/unit/redFlagService.test.js`

**Interfaces:**
- Consumes: hierarchyService, Notification creation (`services/notificationService.js`)
- Produces: `async detectFlags(orgId, user, asOf) -> { staleLeads, noMovementLeads, overdueFollowUps, overdueTasks, agingPipeline, lowActivity }` (each `{count, items}`); `async sendDigests(orgId, asOf)` (per-Head digest + per-member self-nudge)

**Spec:** §8. Thresholds (configurable, defaults 7/14/2d, 30d, <5/7d).

**Acceptance:** each threshold boundary tested (exactly-7-days etc.); digest groups by Head; self-nudge only when member has ≥1 flag; thresholds read from config.

---

### Task 5: Weekly reflections + voice transcription + mandatory soft-gate

**Files:**
- Create: `models/weeklyReflectionModel.js`, `services/people/reflectionService.js`, `controllers/reflectionController.js`
- Modify: `models/notificationModel.js` (add `reflection_due`, `reflection_overdue`)
- Test: `tests/unit/reflectionService.test.js`, `tests/unit/reflectionController.test.js`

**Interfaces:**
- Consumes: `openAIService` (transcription), `hierarchyService.getManagerChain`
- Produces: `async upsertDraft(user, isoWeek, answers)`; `async submit(user, isoWeek)` (enforces each required answer ≥500 chars; locks if past `weekEnd`); `async currentStatus(user) -> {isoWeek, status, overdue}`; `async transcribe(audioBuffer, mime) -> string`; `async ack(manager, reflectionId, note)`; `isoWeekOf(date) -> 'YYYY-Www'`

**Spec:** §6 (`WeeklyReflection`), §10. Mandatory = soft-gate (status surfaced; reminders); editable until weekEnd then locked.

**Acceptance:** submit rejects when any required answer <500 chars; locked after weekEnd; currentStatus flags overdue; transcribe calls OpenAI (mocked) and returns text; ack stores `managerAck` only if manager is in the author's manager chain.

---

### Task 6: AI sentiment + MoraleSummary + weekly job

**Files:**
- Create: `models/moraleSummaryModel.js`, `services/people/moraleService.js`, `jobs/generateMoraleSummaries.js`
- Modify: `models/notificationModel.js` (add `morale_summary_ready`), reflection submit (Task 5) to enqueue per-reflection sentiment
- Test: `tests/unit/moraleService.test.js`

**Interfaces:**
- Consumes: `@anthropic-ai/sdk` client (follow `services/aiCopilotService.js`/`openAIService.js` patterns), hierarchyService
- Produces: `async analyzeReflection(reflectionDoc) -> {score,label,themes,riskSignals}` (best-effort; null on failure, never throws to caller); `async buildTeamMorale(orgId, headUser, isoWeek) -> MoraleSummaryDoc`; `async buildOrgMorale(orgId, isoWeek)`

**Spec:** §6 (`MoraleSummary`), §11. Strict-JSON Claude prompts; failure leaves sentiment null and never blocks submit.

**Acceptance:** analyzeReflection parses strict JSON + returns null on malformed/throwing client; buildTeamMorale aggregates a week's submitted reflections; weekly job emits `reflection_overdue` for non-submitters + `morale_summary_ready`.

---

### Task 7: Dashboards API + access control

**Files:**
- Create: `controllers/peopleController.js`, `routes/peopleRoutes.js`, `services/people/dashboardService.js`
- Modify: `server.js` (`app.use('/api/people', peopleRoutes)`), add `lastActiveAt` bump middleware (throttled) in `middleware/authMiddleware.js`, `models/userModel.js` (`lastActiveAt`)
- Test: `tests/unit/peopleController.test.js`, `tests/unit/dashboardService.test.js`

**Interfaces:**
- Consumes: all of Tasks 1–6
- Produces endpoints (spec §13): `GET /me`, `GET /member/:userId`, `GET /team`, `GET /org`, `GET /flags`, `GET/PUT /targets/:userId`, reflections routes (`/reflections/current|?isoWeek|:isoWeek|:isoWeek/submit|:id/ack|/transcribe`), `GET /morale/team|/org`. Each merges stored snapshots + live current-day compute.

**Spec:** §12 (dashboards/access), §13 (APIs). Every endpoint subtree-guarded via `getSubtree`.

**Acceptance:** member cannot read another member; Head reads only their team; Owner reads all; `/me` merges live current-day; 403 on cross-subtree access.

---

### Task 8: Frontend — dashboards, reflection editor + voice, morale panels, nav

**Files (frontend repo):**
- Create: `src/pages/people/MyPerformancePage.js`, `TeamPerformancePage.js`, `OrgPerformancePage.js`; `src/components/people/{Scorecard,MetricTile,RedFlagInbox,TargetEditorDialog,MoralePanel,ReflectionEditor,VoiceRecorder,ReflectionHistory,ManagerAck,ReflectionPrompt}.js`
- Modify: `src/services/api.js` (`peopleAPI`), `src/App.js` (routes), `src/components/layout/DashboardLayout.js` (People nav, role-gated; ReflectionPrompt banner)
- Test: render tests for `Scorecard`, `MetricTile` (NaN-safe), `ReflectionEditor` (≥500 gating), `VoiceRecorder` (transcribe→editable, mocked)

**Interfaces:** Consumes `/api/people/*` (Task 7). `peopleAPI = { me, member, team, org, flags, getTargets, setTargets, reflectionCurrent, getReflection, saveReflection, submitReflection, ackReflection, transcribe, moraleTeam, moraleOrg }`.

**Spec:** §12, §14. Time-range switch; scorecard tiles (value · trend · vs median · %target); reflection editor (5 prompts, char-counter, voice); morale panels; soft-gate banner.

**Acceptance:** `CI=true npm run build` green; MetricTile renders ₹ values without NaN; ReflectionEditor blocks submit under 500 chars; nav items role-gated (member sees My; Head sees My+Team; Owner sees all).

---

## Self-Review

- **Spec coverage:** §5→T1, §6/§7→T2, §9→T3, §8→T4, §10→T5, §11→T6, §12/§13→T7, §14→T8, §16 testing folded into each task, §15 jobs in T2/T6, §17 build order = task order. Covered.
- **Interface consistency:** `getSubtree`, `computeMetrics`, `computeAttainment`, `detectFlags`, `submit`/`currentStatus`, `analyzeReflection`, `peopleAPI` names are referenced consistently across producer/consumer blocks.
- **Per-task detail:** each task's exact TDD steps (failing test code → impl) are authored just-in-time in the subagent brief at dispatch, grounded in the live codebase, per the cross-repo, large-scope adaptation noted at the top.
