# SP4 Implementation Plan — Cross-Org Lead Lifecycle & Standalone CP Workspace

**Spec:** `docs/superpowers/specs/2026-05-21-channel-partner-platform-sp4-design.md`
**Date:** 2026-05-23
**Status:** Draft — awaiting user approval before execution

---

## 0. Process & Conventions

### 0.1 Skill availability
`superpowers:writing-plans` and `superpowers:subagent-driven-development` are **not loaded** in this session (same as `superpowers:brainstorming` for SP3). The equivalent workflow is run manually:
- This document is the plan artefact.
- After approval, each task is implemented in a fresh, narrowly-scoped subagent invocation (or directly by the lead agent), followed by a per-task commit.
- Two-stage review per task: (a) spec compliance check against the SP4 spec section the task implements, (b) code-quality pass before commit.

### 0.2 File-path corrections vs. spec text
The spec mentions a few paths that differ from the actual repo. The plan uses the **actual** paths:

| Spec text | Actual path used in plan |
|---|---|
| `data/defaultCpRoles.js` | `data/defaultChannelPartnerRoles.js` |
| `app.js` (mounts routes) | `server.js` (the real entrypoint — verified `grep app.use('/api server.js`) |
| `tests/regression/suites/sp3-*.js` (referenced as pattern) | `tests/regression/suites/27-cp-platform-sp3.test.js` (single SP3 file; `NN-name.test.js` naming) |

### 0.3 Test pattern
- Jest-based, file naming `NN-shortname.test.js`. SP3 used `27-...`. SP4 suites are **`28-sp4-…`** through **`36-sp4-…`** (9 suites, spec §8.1).
- Each suite imports from `tests/regression/_lib/api.js` — `import { api, setAuthToken, expectOk } from '../_lib/api.js';`. `api(method, path, body?, opts?)` returns `{ status, data, ok }`.
- Auth: `API_TEST_TOKEN` env var (when present) authenticates the request; unset → unauth tests still run, auth tests skip gracefully. SP4 suites that need a token will check `hasAuthToken()` and skip mutating assertions when absent — same pattern as the existing suites.
- **`npm run test:regression`** is the runner. It already exists.

### 0.4 Commit policy
- One commit per task. Conventional message: **`feat(cp-platform): SP4 — <short>`** or **`test(cp-platform): SP4 — <suite>`**.
- Each commit message ends with `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.
- **No push without explicit per-feature user authorization.** Tasks may accumulate as local commits across many phases.

### 0.5 Notification helper extension (added in Phase C, used Phase J)
`services/notificationService.js` exports `createNotification(...)` and many specific helpers (`notifyTaskAssigned`, etc.) but **no generic `notifyUsersWithPermission`**. The spec assumes one exists. The plan adds it as Task **T11**, with the signature:

```js
export async function notifyUsersWithPermission({
  organizationId,        // ObjectId — the org whose users we want to notify
  permission,            // 'leads:update' | 'cp_prospects:manage' | ...
  excludeUserIds = [],   // optional, e.g. [actor]
  // ...createNotification payload fields (type, title, message, actionUrl, relatedEntity, priority, actor, metadata)
}) {
  // 1. Roles in this org with the permission OR isOwnerRole:true
  // 2. Active users whose roleRef is one of those roles (excluding excludeUserIds)
  // 3. createNotification per user, in parallel; return { sent: <count> }
}
```

This is the **same shape** I used inline in `services/partnershipService.js → notifyPartnership` for SP3 (`resolveRecipients` + `Notification.insertMany`). The new generic helper centralises it. SP3's `notifyPartnership` stays unchanged to avoid risk in already-shipped code; a low-priority cleanup task (deferred, not in SP4 scope) could later refactor it to use the shared helper.

### 0.6 Reality-anchored details
| Anchor | Reality | Plan handles |
|---|---|---|
| `Lead.status` enum | `['New','Contacted','Qualified','Site Visit Scheduled','Site Visit Completed','Negotiating','Booked','Lost','Unqualified']` — **no `'pending'`** | T01 adds `'pending'` |
| `Lead.channelPartnerAttribution.partners[]` | `{ channelPartner, agent, sharePct }` | T02 adds `agentUser` (per spec §3.3) |
| `Lead.channelPartnerAttribution.status` enum | `['tagged','pending','approved','rejected']` (already includes `'pending'`) | Push sets `channelPartnerAttribution.status = 'pending'` AND `Lead.status = 'pending'` (the two are independent — top-level lead status vs attribution sub-status). |
| Identifying CP Agents at runtime | `req.user.role` is the **legacy** string field; for a CP Agent it's `'Channel Partner Agent'` (cpPortalController's `CP_ROLE_LEGACY_MAP`). The CP-role identity lives in `req.user.roleRef.name` or `roleRef.slug` (populated by `protect`). | `partnerAccessScope` uses `req.user.roleRef?.name === 'CP Agent'` (with `roleRef?.slug === 'cp-agent'` as a fallback). |
| `req.organization` | **Not** loaded by `protect`; loaded only by `requireOrgType` for routes that use it. `getLeads` doesn't use `requireOrgType`. | `partnerAccessScope` self-loads org when `req.organization` is absent (single `Organization.findById(req.user.organization).select('type').lean()`). |
| CP-facing `getLeads` query | Today: `{ organization: req.user.organization, ... }`. For a CP user this returns nothing (leads live in dev orgs). | T36: **replace** the `organization` filter with `partnerAccessScope` for CP users; non-CP users keep the existing org-scoped path. |
| `createNotification` payload | `{organization, recipient, type, title, message, actionUrl, relatedEntity, priority, actor, metadata}` | All SP4 notification calls match this shape (via the new `notifyUsersWithPermission` wrapper). |

---

## 1. §11 Open Items — Resolved decisions (locked)

| # | Question | Decision | Reasoning |
|---|---|---|---|
| **1** | Proposal-withdrawal mechanism — dedicated DELETE endpoint vs `{withdraw: true}` body on the propose endpoint | **Dedicated `DELETE /api/cp/prospects/:id/proposed-status`** | REST-idiomatic (deleting the pending proposal resource), keeps the propose POST body clean to `{status, note}`, separates intent. Same authorisation: `cp_prospects:manage`; original proposer OR any CP Manager/Owner of the same CP org. |
| **2** | Lead `'pending'` status — enum value vs separate `isPending` flag | **Add `'pending'` to the `Lead.status` enum** | Enum currently has 9 values; no `isPending` flag anywhere in the repo; spec assumes this. Single source of truth for "show in registrations queue" vs "show in normal lead lists". Default `getLeads` filter (non-CP) excludes `'pending'`. |
| **3** | Duplicate-match payload shape — single vs list | **Single best match by recency** | Spec recommends this; reviewer UX is simpler (one banner with one CTA); easy to re-query later if richer matching becomes needed. Match rule: in the same project, same email OR same phone, `status !== 'pending'`, `createdAt` within the last **60 days**, sorted by `createdAt desc`, take the first. |
| **4** | Re-push of a rejected prospect — clear `pushedToLead` vs require a new Prospect | **New Prospect required** | Simpler authorisation (no Manager-only clearing flow), preserves the rejected lead's audit trail unchanged, matches the spec edge-case table guidance. The UI: rejected-Prospect detail page exposes a **"Clone to new Prospect"** button that creates a new Prospect with the same contact + project, and a fresh push path. (Frontend convenience, not a separate backend endpoint — the existing `POST /api/cp/prospects` is sufficient.) |

These four decisions are referenced from the specific task entries below.

---

## 2. Task overview (12 phases, 51 tasks)

| Phase | Tasks | Description |
|---|---|---|
| **A** Foundation | T01–T08 | Lead/Notification model additions; permissions; CP role grants; new models (ExternalDeveloper, Prospect); permission backfill |
| **B** Access helper (security-critical, isolated) | T09–T10 | `utils/partnerAccessHelper.js` + isolated tests |
| **C** Notification helper + Prospect CRUD | T11–T16 | `notifyUsersWithPermission`; prospect service/controller/routes/CRUD; suite #29 |
| **D** Prospect commission tracking | T17–T19 | booking/payments/agreement/write-off; suite #30 |
| **E** ExternalDeveloper + public invite lookup | T20–T23 | service/controller/routes; suite #31 |
| **F** Claim flow + registration extension | T24–T26 | `claimExternalDeveloper`; `registerUser` extension; suite #32 |
| **G** Push + Registrations queue | T27–T31 | pushProspectToDeveloper; dev-side `GET /leads/registrations`; suites #33, #34 |
| **H** Status proposal flow | T32–T35 | propose / withdraw / dev decide; suite #35 |
| **I** Wire `partnerAccessScope` into `getLeads` / `getLeadById` | T36–T37 | The single most security-critical wiring |
| **J** Notifications fan-out | T38–T39 | Wire all 8 events; suite #36 |
| **K** Frontend (matching backend slice order) | T40–T49 | API client; CP nav/pages; dev-side queue+detail; register-page wiring; build gate |
| **L** Acceptance | T50–T51 | Manual smoke of 5 §8.2 scenarios; final commit summary + push (with authorisation) |

---

## 3. Task details

> Convention used in every entry below:
> **Files** — full repo-relative paths.
> **Goal** — one-line outcome.
> **Contract / code** — signatures, request/response shapes, validation rules, error codes.
> **Acceptance** — observable result that must hold when the task is "done".
> **Verify** — what to run.
> **Commit** — suggested message.

### Phase A — Foundation

#### T01 — Lead status enum gains `'pending'`
**Files:** `models/leadModel.js`
**Goal:** Add `'pending'` to the `Lead.status` enum so pushed-but-unreviewed leads are first-class.
**Contract:** Change the enum from
```js
enum: ['New','Contacted','Qualified','Site Visit Scheduled','Site Visit Completed','Negotiating','Booked','Lost','Unqualified']
```
to prepend `'pending'`:
```js
enum: ['pending','New','Contacted','Qualified','Site Visit Scheduled','Site Visit Completed','Negotiating','Booked','Lost','Unqualified']
```
The `default: 'New'` stays — a `'pending'` lead is only ever created explicitly by `pushProspectToDeveloper` (T27).
**Acceptance:** `node --check models/leadModel.js` passes; `Lead.create({status:'pending', ...})` validates.
**Verify:** Syntax check + module-load test.
**Commit:** `feat(cp-platform): SP4 — Lead.status accepts 'pending' for unreviewed CP-pushed leads`

#### T02 — Lead schema additions (`sourceProspect`, `proposedStatusChange`, `agentUser` in partners[])
**Files:** `models/leadModel.js`
**Goal:** Add the three SP4 fields per spec §3.3.
**Contract:**
- Top-level fields (add near `assignedTo`):
  ```js
  sourceProspect: { type: mongoose.Schema.Types.ObjectId, ref: 'Prospect', default: null, index: { sparse: true } },
  proposedStatusChange: {
    status:     { type: String, enum: ['pending','New','Contacted','Qualified','Site Visit Scheduled','Site Visit Completed','Negotiating','Booked','Lost','Unqualified'] },
    proposedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    proposedAt: { type: Date },
    note:       { type: String, trim: true },
  },
  ```
  `proposedStatusChange` defaults to absent (the whole sub-doc null/undefined when no proposal). Explicit `null` clear after accept/reject.
- Inside `channelPartnerAttribution.partners[]`, add:
  ```js
  agentUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  ```
  Coexists with the existing legacy `agent` (ChannelPartnerAgent ref) for backward compatibility.
- Index: `{ proposedStatusChange.proposedAt: 1 }` (sparse) — for "pending proposals" queries; small.

**Acceptance:** Syntax check passes; new fields can be set & populated via Mongoose.
**Verify:** `node --check` + module-load test importing leadController (which imports leadModel transitively).
**Commit:** `feat(cp-platform): SP4 — Lead additions (sourceProspect, proposedStatusChange, partners.agentUser)`

#### T03 — Notification enums (8 new types + 2 new related-entity types)
**Files:** `models/notificationModel.js`
**Goal:** Extend `NOTIFICATION_TYPES` with the 8 SP4 events and `RELATED_ENTITY_TYPES` with the 2 SP4 entities. Per spec §3.4.
**Contract:**
- `NOTIFICATION_TYPES` — append (alongside SP3's `partnership_request`/`partnership_update`):
  `lead_registration_received`, `lead_registration_accepted`, `lead_registration_rejected`, `cp_lead_status_changed`, `lead_status_proposed`, `lead_status_proposal_accepted`, `lead_status_proposal_rejected`, `external_developer_claimed`.
- `RELATED_ENTITY_TYPES` — append: `'Prospect'`, `'ExternalDeveloper'`.

**Acceptance:** Notification.create({type: 'lead_registration_received', ...}) validates. The existing notification system + bell continue to render unknown types harmlessly (they already do via title/message).
**Verify:** `node --check models/notificationModel.js`.
**Commit:** `feat(cp-platform): SP4 — Notification enums for cross-org lead events`

#### T04 — Permissions catalog: add `cp_prospects:*` and `cp_external_developers:*`
**Files:** `config/permissions.js`
**Goal:** Add the two new groups under `CP_PERMISSIONS`. `ALL_CP_PERMISSIONS` auto-derives them.
**Contract:** Insert into `CP_PERMISSIONS`:
```js
PROSPECTS: {
  VIEW:   'cp_prospects:view',
  MANAGE: 'cp_prospects:manage',
},
EXTERNAL_DEVELOPERS: {
  MANAGE: 'cp_external_developers:manage',
},
```
**Acceptance:** `ALL_CP_PERMISSIONS` includes the three new strings (visible via a quick `node -e "console.log((await import('./config/permissions.js')).ALL_CP_PERMISSIONS)"`).
**Commit:** `feat(cp-platform): SP4 — cp_prospects:* + cp_external_developers:* permissions`

#### T05 — Seed the new perms in default CP roles
**Files:** `data/defaultChannelPartnerRoles.js`
**Goal:** Per spec §3.5 grant the new perms on **new** CP orgs (existing orgs handled by T08 backfill).
**Contract:**
- **CP Owner** — already gets `ALL_CP_PERMISSIONS` (no change needed; T04 already extends the set).
- **CP Manager** — append three perms to its `permissions` array:
  ```js
  CP_PERMISSIONS.PROSPECTS.VIEW,
  CP_PERMISSIONS.PROSPECTS.MANAGE,
  CP_PERMISSIONS.EXTERNAL_DEVELOPERS.MANAGE,
  ```
- **CP Agent** — append two perms (NO external_developers):
  ```js
  CP_PERMISSIONS.PROSPECTS.VIEW,
  CP_PERMISSIONS.PROSPECTS.MANAGE,
  ```

**Acceptance:** Newly-seeded CP orgs (via `registerUser` with `type: 'channel_partner'`) get the new perms on their seeded Manager / Agent roles.
**Verify:** Read-back the file; T15's regression suite verifies CP Agent's `cp_prospects:manage` empirically.
**Commit:** `feat(cp-platform): SP4 — seed CP role grants for prospects + external developers`

#### T06 — `ExternalDeveloper` model
**Files:** `models/externalDeveloperModel.js` (NEW)
**Goal:** Per spec §3.2 — track off-platform developers a CP works with.
**Contract:** Mongoose schema with:
- `organization` (ref Organization, required, index) — must be a CP org. Pre-save: load org, assert `type === 'channel_partner'` (allow bypass when document already exists, to keep updates cheap).
- `name` (String, required, trim), `description` (String, trim).
- `contact: { person, email (trim lowercase), phone }`.
- `address` (String), `city` (String, trim, index).
- `projects: [{ name (required), location, type, notes }]` — embedded array, no `_id` on subdocs.
- `invite: { token (String, sparse, unique), email, invitedAt (Date), invitedBy (ref User), expiresAt (Date) }` — sub-doc; `token` is set/cleared, sparse-unique index.
- `claimedByOrg` (ref Organization, default null), `claimedAt` (Date, default null).
- `timestamps: true`.

**Indexes:** `{organization:1}`, `{'invite.token':1}` (sparse, unique), `{claimedByOrg:1}` (sparse).

**Pre-save validation:** confirm caller's org is `channel_partner` on first create; if `invite.token` is set and `invite.expiresAt` is not, throw. Otherwise allow through.

**Acceptance:** `node --check` passes; module-load via routes (T22) succeeds.
**Commit:** `feat(cp-platform): SP4 — ExternalDeveloper model for off-platform developer tracking`

#### T07 — `Prospect` model
**Files:** `models/prospectModel.js` (NEW)
**Goal:** Per spec §3.1 — the CP-side prospect entity; works for both on-platform and off-platform developers.
**Contract:** Mongoose schema with the full §3.1 shape, plus:
- **Pre-save validation hook** (`schema.pre('save', ...)`):
  1. If `developerContext.type === 'external'`: require `developerContext.externalDeveloper`.
  2. If `developerContext.type === 'platform'`: require `developerContext.partnership` AND `project.platform`. Load the partnership; assert `status === 'active'` AND `channelPartnerOrg.equals(this.organization)`.
  3. If `commission.status === 'written_off'`: require `commission.writeOffReason` (non-empty).
- **NO** auto-calc in the schema. Auto-calc lives in `prospectService` (T12, T17).
- **`activities`** is push-only at the schema level (no API to delete).
- **`commission.payments`** is push-only at the API level (T18 enforces).

**Indexes:** `{organization:1, status:1}`, `{organization:1, assignedAgent:1}`, `{pushedToLead:1}` (sparse), `{'developerContext.externalDeveloper':1}` (sparse), `{'developerContext.partnership':1}` (sparse), `{organization:1, 'followUp.nextDate':1}` (sparse — for the "follow-up due" list later, optional).

**Note on Mongoose `type` ambiguity** (same gotcha I hit in SP3's `partnershipModel.commissionTerms`): define `commissionAgreement` as a **sub-schema** to avoid Mongoose interpreting `commissionAgreement.type` as a type-path:
```js
const commissionAgreementSchema = new mongoose.Schema(
  { type: { type: String, enum: ['percentage','flat'] }, value: Number, currency: { type: String, default: 'INR' }, notes: String },
  { _id: false }
);
```
Then use `commissionAgreement: { type: commissionAgreementSchema, default: null }`. Same for `commission.payments[]` items (inline is fine — no `type` ambiguity).

**Acceptance:** `node --check` passes; module-load via routes (T14) succeeds.
**Commit:** `feat(cp-platform): SP4 — Prospect model (CP-side lead-equivalent with off/on-platform context)`

#### T08 — Backfill script `backfillSp4CpPermissions`
**Files:** `data/backfillSp4CpPermissions.js` (NEW)
**Goal:** Grant the SP4 perms to **existing** CP orgs' seeded Manager / Agent Role docs (which predate the perms). Idempotent. Modelled on the existing `data/backfillCpPartnershipsPermission.js` I wrote for SP3.
**Contract:**
```js
import dotenv from 'dotenv'; import mongoose from 'mongoose';
import connectDB from '../config/db.js'; import Role from '../models/roleModel.js';
dotenv.config();
const run = async () => {
  try {
    await connectDB();
    const managers = await Role.updateMany(
      { name: 'CP Manager' },
      { $addToSet: { permissions: { $each: [
        'cp_prospects:view', 'cp_prospects:manage', 'cp_external_developers:manage'
      ] } } }
    );
    const agents = await Role.updateMany(
      { name: 'CP Agent' },
      { $addToSet: { permissions: { $each: ['cp_prospects:view','cp_prospects:manage'] } } }
    );
    console.log(`SP4 backfill — ${managers.modifiedCount} CP Manager role(s), ${agents.modifiedCount} CP Agent role(s) updated.`);
  } finally { await mongoose.disconnect(); }
};
run().catch((err) => { console.error('Backfill failed:', err); process.exit(1); });
```
**Acceptance:** Script runs against the prod-or-equivalent DB without error; idempotent on re-run (`$addToSet`); reports counts. CP Owner role already has `ALL_CP_PERMISSIONS` (no action).
**Verify:** Dry-run locally against the DB (only — never to staging/prod yet). The script will execute against prod **only at the end of Phase L**, with the user's explicit per-execution OK, mirroring the SP3 cleanup-script run.
**Commit:** `feat(cp-platform): SP4 — backfill cp_prospects:* + cp_external_developers:manage on existing CP roles`

---

### Phase B — `partnerAccessHelper` (security-critical, isolated)

#### T09 — `utils/partnerAccessHelper.js`
**Files:** `utils/partnerAccessHelper.js` (NEW)
**Goal:** Per spec §4.1 — return a Mongo filter that scopes Lead queries to leads a given CP user is allowed to see. Self-contained (loads org if `req.organization` isn't set). Returns `null` for non-CP callers (the caller skips the AND).
**Contract:**
```js
// File: utils/partnerAccessHelper.js
import Organization from '../models/organizationModel.js';
import Partnership from '../models/partnershipModel.js';
import ChannelPartner from '../models/channelPartnerModel.js';

/**
 * Build a Mongo filter limiting Lead queries to records this CP user may see.
 * For non-CP users: returns null (caller does not AND).
 * For CP users with no active partnerships / no shadow record: returns
 *   { _id: { $in: [] } } (matches nothing — explicit empty scope).
 */
export async function partnerAccessScope(req) {
  const user = req.user;
  if (!user || !user.organization) return null;

  // Load org type (use req.organization if a middleware already loaded it).
  const org = req.organization
    ? req.organization
    : await Organization.findById(user.organization).select('type').lean();
  if (!org || org.type !== 'channel_partner') return null;

  // 1. Active partnerships → developer orgs.
  const partnerships = await Partnership.find({
    channelPartnerOrg: org._id || user.organization,
    status: 'active',
  }).select('developerOrg').lean();
  if (partnerships.length === 0) return { _id: { $in: [] } };

  const devOrgIds = partnerships.map((p) => p.developerOrg);

  // 2. ChannelPartner shadow records in those dev orgs that link back to this CP org.
  const cpRecords = await ChannelPartner.find({
    organization: { $in: devOrgIds },
    channelPartnerOrg: org._id || user.organization,
  }).select('_id').lean();
  if (cpRecords.length === 0) return { _id: { $in: [] } };

  const cpRecordIds = cpRecords.map((c) => c._id);

  // 3. Base scope — leads attributed to those shadow records.
  const filter = {
    'channelPartnerAttribution.partners.channelPartner': { $in: cpRecordIds },
  };

  // 4. CP Agent narrowing — only their own attribution.
  const roleName = user.roleRef?.name;
  const roleSlug = user.roleRef?.slug;
  if (roleName === 'CP Agent' || roleSlug === 'cp-agent') {
    filter['channelPartnerAttribution.partners.agentUser'] = user._id;
  }

  return filter;
}
```

**Behavioural notes:**
- **Returns `{ _id: { $in: [] } }`** (never matches) when the CP has 0 active partnerships or 0 shadow records — explicit empty scope is safer than a missing filter.
- **Returns `null`** only for non-CP callers — meaning "skip the AND, this user is not CP-scoped".
- **Reads only.** Never mutates state. No notifications. No side effects.
- **Owner-bypass is implicit:** CP Owners aren't narrowed (the role-name check is only for CP Agents). CP Manager/Owner see all attribution for the CP org.

**Acceptance:** Module loads (transitively used by T10's test); function is the **single source of truth** for "what cross-org leads can this CP user see/edit?".
**Commit:** `feat(cp-platform): SP4 — partnerAccessScope helper (CP-side Lead-query scoping)`

#### T10 — Isolated tests for `partnerAccessScope`
**Files:** `tests/regression/suites/28-sp4-partner-access-scope.test.js` (NEW)
**Goal:** Direct, isolated tests of the helper function. Full integration through `getLeads`/`getLeadById` comes after T36–T37 — but Phase I will extend this same file with the integration cases.
**Contract:**
- **Unit-style (calling the helper directly):**
  - Non-CP user (org.type='builder') → returns `null`.
  - CP user with no Partnership → `{ _id: { $in: [] } }`.
  - CP user with active partnership but no `ChannelPartner` shadow record yet → `{ _id: { $in: [] } }`.
  - CP user with active partnership + shadow record → filter includes `channelPartnerAttribution.partners.channelPartner: { $in: [cpRecord._id] }`.
  - CP user identified as CP Agent (`roleRef.name='CP Agent'`) → filter also includes `channelPartnerAttribution.partners.agentUser: user._id`.
  - CP user with multiple active partnerships → `$in` includes all shadow record ids (union).
  - **Terminated** partnership → excluded from `$in`.
- **Route-gate (no auth):** the SP4 routes added in later tasks reject unauthenticated requests (smoke-only — this just confirms the routes are mounted; deeper assertions live in their dedicated suites).

The helper-call tests use a **direct import** (`import { partnerAccessScope } from '../../../utils/partnerAccessHelper.js'`) and synthesise `req`-shaped objects with stubbed `user`/`organization`/`roleRef`. They run against the live DB via the test harness, so they require fixtures: the test suite reads fixture ids from env vars (or skips when not provided) — same opt-in pattern the existing token-gated tests use.

**Acceptance:** The 6 helper-call assertions pass when fixtures are provided; skip cleanly otherwise. Route-gate smoke passes always.
**Commit:** `test(cp-platform): SP4 — partner-access-scope isolated tests`

---

### Phase C — Notification helper + Prospect CRUD (no push / proposal / commission yet)

#### T11 — `notifyUsersWithPermission` in `notificationService.js`
**Files:** `services/notificationService.js`
**Goal:** Add the generic helper that all SP4 events use. Per §0.5 above.
**Contract:**
```js
import Role from '../models/roleModel.js';
// (add)

export async function notifyUsersWithPermission({
  organizationId,        // ObjectId
  permission,            // string, e.g. 'leads:update', 'cp_prospects:manage'
  excludeUserIds = [],   // ObjectId[] — typically [actor]
  // createNotification payload fields below:
  type, title, message,
  actionUrl, relatedEntity, priority = 'medium', actor, metadata,
}) {
  // 1. Roles in this org with the permission OR isOwnerRole.
  const roles = await Role.find({
    organization: organizationId,
    $or: [{ isOwnerRole: true }, { permissions: permission }],
  }).select('_id').lean();
  if (roles.length === 0) return { sent: 0 };

  // 2. Active users whose roleRef is one of those roles, minus excludeUserIds.
  const excludeStrs = excludeUserIds.filter(Boolean).map(String);
  const users = await User.find({
    organization: organizationId,
    isActive: true,
    roleRef: { $in: roles.map((r) => r._id) },
    ...(excludeStrs.length ? { _id: { $nin: excludeStrs } } : {}),
  }).select('_id').lean();

  if (users.length === 0) return { sent: 0 };

  // 3. Fire createNotification for each (in parallel; per-user pref check
  //    happens inside createNotification).
  const results = await Promise.all(
    users.map((u) =>
      createNotification({
        organization: organizationId, recipient: u._id, type, title, message,
        actionUrl, relatedEntity, priority, actor, metadata,
      })
    )
  );
  return { sent: results.filter(Boolean).length };
}
```
**Acceptance:** Existing `createNotification` is unchanged. New helper exports cleanly; consumed by Phase J tasks.
**Commit:** `feat(cp-platform): SP4 — notifyUsersWithPermission helper in notificationService`

#### T12 — `services/prospectService.js` (CRUD + activity slice only)
**Files:** `services/prospectService.js` (NEW)
**Goal:** CRUD + activity slice. Push / proposal / commission slices land in later phases.
**Contract:** Exported functions:
```js
createProspect(data, user)         // §3.1 validation; agent must be a User in caller's CP org
updateProspect(id, data, user)     // org-scoped; CP Agent → own only; cannot set pushedToLead/At/By
deleteProspect(id, user)           // org-scoped; CP Agent → own only; 409 if pushedToLead set
getProspect(id, user)              // org-scoped; CP Agent → own only (404 otherwise)
listProspects(query, user)         // org-scoped + filters (status, assignedAgent, developerContext.type, priority, search); CP Agent auto-narrows to assignedAgent=user._id
addActivity(id, activityData, user) // appends { type, note, at:now, by:user._id } to activities
```
Each function takes `user` (the authenticated `req.user`) and resolves scoping itself. Returns plain JS objects (Mongoose lean / `.toObject()` as appropriate) suitable for the controller to `res.json` directly.

**CP Agent identity check** uses the same pattern as the helper: `user.roleRef?.name === 'CP Agent' || user.roleRef?.slug === 'cp-agent'`.

**Acceptance:** Functions exported; controller (T13) consumes them.
**Commit:** `feat(cp-platform): SP4 — prospectService CRUD + activities`

#### T13 — `controllers/prospectController.js` (CRUD + activities)
**Files:** `controllers/prospectController.js` (NEW)
**Goal:** Thin HTTP handlers calling the service. asyncHandler style, matching `controllers/cpPortalController.js`.
**Contract:** Exports `listProspects`, `createProspect`, `getProspect`, `updateProspect`, `deleteProspect`, `addProspectActivity` — each `res.json({ success: true, data })`. Error patterns mirror the existing CP portal handlers (`res.status(...); throw new Error(...)`).
**Acceptance:** Routes (T14) wire correctly.
**Commit:** Folded into T14's commit.

#### T14 — `routes/prospectRoutes.js` + `server.js` mount
**Files:** `routes/prospectRoutes.js` (NEW), `server.js` (modify)
**Goal:** Mount `/api/cp/prospects` with `protect` + `requireOrgType('channel_partner')` at the router level, per-route `hasPermission(...)`.
**Contract:**
```js
import express from 'express';
import { protect, hasPermission, requireOrgType } from '../middleware/authMiddleware.js';
import { CP_PERMISSIONS } from '../config/permissions.js';
import * as ctl from '../controllers/prospectController.js';

const router = express.Router();
router.use(protect);
router.use(requireOrgType('channel_partner'));

router.get   ('/',                  hasPermission(CP_PERMISSIONS.PROSPECTS.VIEW),   ctl.listProspects);
router.post  ('/',                  hasPermission(CP_PERMISSIONS.PROSPECTS.MANAGE), ctl.createProspect);
router.get   ('/:id',               hasPermission(CP_PERMISSIONS.PROSPECTS.VIEW),   ctl.getProspect);
router.put   ('/:id',               hasPermission(CP_PERMISSIONS.PROSPECTS.MANAGE), ctl.updateProspect);
router.delete('/:id',               hasPermission(CP_PERMISSIONS.PROSPECTS.MANAGE), ctl.deleteProspect);
router.post  ('/:id/activities',    hasPermission(CP_PERMISSIONS.PROSPECTS.MANAGE), ctl.addProspectActivity);

export default router;
```
`server.js` adds the import + `app.use('/api/cp/prospects', prospectRoutes);` near the existing `/api/cp` mount (line ~166).
**Acceptance:** Unauthenticated `GET /api/cp/prospects` returns 401; non-CP-org caller returns 403 ("This area is not available for your organization type").
**Verify:** `node --check`; module-load test (`node -e "import('./routes/prospectRoutes.js').then(() => console.log('OK'))"`).
**Commit:** `feat(cp-platform): SP4 — POST/GET/PUT/DELETE /api/cp/prospects + activities`

#### T15 — Regression suite `29-sp4-prospect-crud.test.js`
**Files:** `tests/regression/suites/29-sp4-prospect-crud.test.js` (NEW)
**Goal:** Per spec §8.1 #1. CRUD + agent-scoping (CP Agent cannot see/edit other agents' prospects — 404).
**Contract:** Token-gated assertions (skip cleanly when `API_TEST_TOKEN` absent):
- `GET /api/cp/prospects` 401 unauth; 403 for developer-org token.
- Create / read / update / delete happy-path as CP Manager.
- CP Agent fixture: create → list → see only own; reading another agent's prospect → 404; updating another agent's prospect → 404.
- Add activity → activity appears in subsequent `GET /:id`.
- Validation: `developerContext.type === 'platform'` without `partnership` → 400; partnership in wrong org → 400; partnership not active → 400.

**Acceptance:** Suite passes with fixtures; skips cleanly without.
**Commit:** `test(cp-platform): SP4 — prospect CRUD + agent-scoping suite`

#### T16 — Backend syntax + module-load verification (cumulative checkpoint)
**Files:** none (verification step)
**Goal:** After T01–T15 are committed, run a full backend syntax + module-load sweep on all touched + new files. Mirror what I did after each phase of SP3.
**Verify:**
```bash
for f in models/leadModel.js models/notificationModel.js config/permissions.js \
         data/defaultChannelPartnerRoles.js data/backfillSp4CpPermissions.js \
         models/externalDeveloperModel.js models/prospectModel.js \
         utils/partnerAccessHelper.js services/notificationService.js \
         services/prospectService.js controllers/prospectController.js \
         routes/prospectRoutes.js server.js \
         tests/regression/suites/28-sp4-partner-access-scope.test.js \
         tests/regression/suites/29-sp4-prospect-crud.test.js; do
  node --check "$f" && echo "  OK  $f" || echo "  FAIL $f"
done
node -e "Promise.all([import('./routes/prospectRoutes.js')]).then(() => console.log('routes load OK')).catch(e => { console.error(e.message); process.exit(1) })"
```
**Acceptance:** All OK; routes import succeeds (transitively validates the new models + helper).
**Commit:** No commit — verification only.

---

### Phase D — Prospect commission tracking

#### T17 — `prospectService` extension: booking, commission payments, agreement, write-off
**Files:** `services/prospectService.js`
**Goal:** Per spec §3.1 (auto-calc rules) + §4.1 service rows.
**Contract:** Adds functions:
```js
recordBooking(id, bookingData, user)      // sets booking; recomputes commission.expectedAmount
addCommissionPayment(id, paymentData, user) // appends to commission.payments; recomputes commission.status
updateCommission(id, data, user)          // updates commissionAgreement (recomputes expected) OR status (only 'written_off' transition; requires writeOffReason; requires CP Manager/Owner)
```

**Auto-calc rules** (centralised in a private `recomputeCommission(prospect)` helper called by the three above):
- If `commissionAgreement.type === 'percentage'` AND `booking.salePrice` set → `commission.expectedAmount = booking.salePrice * (commissionAgreement.value / 100)`.
- If `commissionAgreement.type === 'flat'` → `commission.expectedAmount = commissionAgreement.value`.
- `commission.status`:
  - `0 paid` → `'pending'`
  - `partial (< expectedAmount)` → `'partially_paid'`
  - `>= expectedAmount` → `'paid'`
  - `'written_off'` is **never** auto-set — only via explicit `updateCommission({status: 'written_off', writeOffReason})`.
- Never overwrite an existing `'written_off'` status via auto-calc.

**Write-off authorisation:** `updateCommission` checks role; only `roleRef.name ∈ {'CP Owner','CP Manager'}` may set `status: 'written_off'` (CP Agents → 403).
**Acceptance:** All three functions exported and consumed by T18 routes.
**Commit:** `feat(cp-platform): SP4 — prospectService commission tracking (agreement, booking, payments, write-off)`

#### T18 — Commission routes
**Files:** `controllers/prospectController.js` (extend), `routes/prospectRoutes.js` (extend)
**Goal:** Wire the three commission endpoints.
**Contract:**
- `POST /:id/booking` — `cp_prospects:manage` — body matches `Prospect.booking` shape.
- `POST /:id/commission/payments` — `cp_prospects:manage` — body: `{ amount, receivedAt, method, referenceNumber, notes }`; server sets `recordedBy: user._id`, `recordedAt: now`.
- `PUT /:id/commission` — `cp_prospects:manage` — body: `{ commissionAgreement?, status?, writeOffReason? }`. Write-off transitions enforce Manager/Owner role.

**Acceptance:** Endpoints respond per shape; auto-calc reflected in subsequent `GET /:id`.
**Commit:** `feat(cp-platform): SP4 — prospect commission endpoints (booking / payments / agreement / write-off)`

#### T19 — Regression suite `30-sp4-commission-manual.test.js`
**Files:** `tests/regression/suites/30-sp4-commission-manual.test.js` (NEW)
**Goal:** Per spec §8.1 #8.
**Contract:** Token-gated assertions:
- Agreement CRUD: set percentage → expectedAmount updates after booking is set; set flat → expectedAmount = value regardless of booking.
- Payment ledger append-only (no DELETE endpoint; verify it's not exposed).
- Status auto-transitions: pending → partially_paid (single small payment) → paid (cumulative ≥ expected).
- Write-off requires Manager/Owner (CP Agent → 403); requires `writeOffReason` (missing → 400); allowed even with payments recorded; payments preserved post-write-off.

**Commit:** `test(cp-platform): SP4 — manual commission tracking suite`

---

### Phase E — `ExternalDeveloper` service + CRUD + public invite lookup

#### T20 — `services/externalDeveloperService.js` (claim deferred)
**Files:** `services/externalDeveloperService.js` (NEW)
**Goal:** Per spec §4.1.
**Contract:** Functions (claim added in T24):
```js
createExternalDeveloper(data, user)   // CP Manager/Owner only (Agents already blocked at route)
updateExternalDeveloper(id, data, user) // blocked when claimedByOrg set (409)
deleteExternalDeveloper(id, user)     // blocked when linked to any Prospect (count) OR claimed (409)
inviteExternalDeveloper(id, email, user) // crypto.randomBytes(32).toString('hex'); 90d expiry
getInviteByToken(token)               // { externalDeveloper, valid, reason }; valid=false if expired OR claimed; loads invitedByOrgName via Organization.findById(...).select('name')
```
**Commit:** `feat(cp-platform): SP4 — externalDeveloperService (CRUD + invite)`

#### T21 — Controller + routes (`/api/cp/external-developers`)
**Files:** `controllers/externalDeveloperController.js` (NEW), `routes/externalDeveloperRoutes.js` (NEW), `server.js` (modify)
**Goal:** Per spec §4.2. Router-level: `protect` + `requireOrgType('channel_partner')` + `hasPermission(CP_EXTERNAL_DEVELOPERS.MANAGE)`.
**Contract:** GET list, POST create, GET :id, PUT :id, DELETE :id, POST :id/invite (body `{email}` → 201 with `{ inviteLink, externalDeveloperId, token, expiresAt }`).
The `inviteLink` is constructed as: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/register?inviteToken=${token}` (the SP4 spec §5.5 says `/register?inviteToken=...`; the frontend `RegisterPage` reads the token).
**`server.js`:** add import + `app.use('/api/cp/external-developers', externalDeveloperRoutes);` next to the CP routes.
**Commit:** `feat(cp-platform): SP4 — CRUD + invite for /api/cp/external-developers`

#### T22 — Public invite lookup `routes/externalDeveloperInviteRoutes.js`
**Files:** `routes/externalDeveloperInviteRoutes.js` (NEW), `server.js` (modify)
**Goal:** Public (no auth) endpoint for the registration page pre-fill.
**Contract:**
```js
import express from 'express';
import * as ctl from '../controllers/externalDeveloperController.js';
const router = express.Router();
router.get('/:token', ctl.publicInviteLookup);  // no protect
export default router;
```
Handler (added to externalDeveloperController):
- `getInviteByToken(token)` → on `valid:false` (expired/claimed) → `410 Gone` with `{message:'...'}`.
- On `valid:true` → `200` with `{ name, contact, city, projects, invitedByOrgName, valid: true }` (matches spec §5.8 pre-fill expectations).

`server.js`: `app.use('/api/external-developer-invites', externalDeveloperInviteRoutes);` (mount BEFORE any catch-all, like the existing public-ish routes).
**Acceptance:** `curl /api/external-developer-invites/<bad-token>` → 410; valid token → 200 with the listed fields.
**Commit:** Folded into T21's commit (or kept separate — implementer choice; one route file is small).

#### T23 — Regression suite `31-sp4-external-developer.test.js`
**Files:** `tests/regression/suites/31-sp4-external-developer.test.js` (NEW)
**Goal:** Per spec §8.1 #6.
**Contract:** CRUD; invite generates unique 64-char hex token + 90d expiry; lookup endpoint returns developer info; expired token → 410; claimed token → 410; delete blocked when linked to prospects or claimed (409).
**Commit:** `test(cp-platform): SP4 — external developer suite`

---

### Phase F — `claimExternalDeveloper` + registration extension

#### T24 — `claimExternalDeveloper` (transactional)
**Files:** `services/externalDeveloperService.js` (extend)
**Goal:** Per spec §4.1, last row. Transactional or sequenced-with-rollback so a partial failure leaves no leaked state.
**Contract:**
```js
claimExternalDeveloper(token, newDeveloperOrgId, actorUser)
```
Steps (run inside a Mongoose session/transaction when the Mongo deployment supports it — Atlas does; fallback for non-replica-set local: sequenced with explicit cleanup on error):
1. Find `ExternalDeveloper` by `invite.token`. Assert not claimed, not expired. (409 otherwise.)
2. Load the inviting CP org via `externalDeveloper.organization`.
3. Set `claimedByOrg = newDeveloperOrgId`, `claimedAt = now`. (Save inside the transaction.)
4. Upsert a `Partnership` for `(developerOrg=newDeveloperOrgId, channelPartnerOrg=externalDeveloper.organization)`:
   - status `'active'`, `initiatedBy: 'channel_partner'`,
   - `requestedAt: externalDeveloper.invite.invitedAt`, `decidedAt: now`, `decidedBy: actorUser._id`,
   - history entry `{ status: 'active', action: 'accepted', actor: actorUser._id, actorOrg: newDeveloperOrgId, at: now, note: 'Off-platform CP invited the developer to platform; claimed via registration link' }`.
   If a Partnership for this pair already exists (rejected/terminated from a prior SP3 cycle), reopen it (status='active', append history) — uses the same pattern as SP3's `createPartnership` re-open path.
5. Run SP3's reconciliation (`partnershipService.reconcileChannelPartnerRecord(partnership, actorUser._id)`) — this ensures a dev-side `ChannelPartner` shadow record with `channelPartnerOrg` set. Idempotent.
6. Update all `Prospect` documents in the inviting CP org where `developerContext.externalDeveloper === externalDeveloper._id`:
   - `developerContext.type = 'platform'`
   - `developerContext.partnership = partnership._id`
   - `developerContext.externalDeveloper = undefined` (clear via `$unset`)
   - Push a system activity: `{ type: 'system', note: 'Developer joined the platform', at: now, by: null }`.
   Bulk update via `Prospect.updateMany` + a follow-up `bulkWrite` for the activity push (or a single aggregation pipeline `$set`/`$push` for Mongo ≥ 4.2 — implementer choice). Run inside the transaction.
7. Fire `external_developer_claimed` notification to CP Manager/Owner (`notifyUsersWithPermission` with `permission: 'cp_org:manage'` against the CP org — that resolves to Manager/Owner; or use `cp_partnerships:manage` — either is fine, both map to the same audience by current role grants; the plan uses `cp_partnerships:manage` for consistency with SP3 notifications about partnership lifecycle).

**Failure modes:**
- Token invalid / expired / already-claimed → 409 throws **before** any mutation.
- Mongoose validation error mid-transaction → entire txn aborts; no partial state.
- On non-replica-set Mongo (no txn support): wrap in a try-catch; on failure, attempt explicit rollback (`Partnership.deleteOne` if just created; `externalDeveloper.claimedByOrg = null; await save()` revert). The plan **prefers the transaction path** — Atlas (the prod DB) is a replica set.

**Acceptance:** Successful claim leaves: ExternalDeveloper claimed; Partnership active with both refs; dev-side ChannelPartner record with `channelPartnerOrg` set; all linked Prospects re-tagged with a system activity. Failure leaves nothing changed.
**Commit:** `feat(cp-platform): SP4 — transactional claimExternalDeveloper (Partnership + reconciliation + Prospect retag)`

#### T25 — `registerUser` extension for `externalDeveloperInviteToken`
**Files:** `controllers/authController.js`
**Goal:** Per spec §4.3. **Non-destabilising** — adds purely after the existing org+user creation, wrapped in try/catch; failure attaches `claimWarning` to the response, registration still succeeds.
**Contract:** After the existing successful registration block (right before `res.status(201).json({...})`):
```js
let claimWarning = null;
if (req.body.externalDeveloperInviteToken && organization.type === 'builder') {
  try {
    await claimExternalDeveloper(
      req.body.externalDeveloperInviteToken,
      organization._id,
      user
    );
  } catch (err) {
    claimWarning = err.message || 'Could not claim the developer invite.';
    // Log for ops visibility — claim failure is non-fatal.
    console.error('[registerUser] claimExternalDeveloper failed:', err);
  }
}
res.status(201).json({
  // ... existing response shape ...
  ...(claimWarning ? { claimWarning } : {}),
});
```
The import sits at the top of `authController.js`: `import { claimExternalDeveloper } from '../services/externalDeveloperService.js';`.

**`registerSchema` (Joi)** — needs `externalDeveloperInviteToken` added as `Joi.string().hex().length(64).optional()`. SP3's experience taught me that `validate(schema)` runs `stripUnknown:true`, so **any field not in the Joi schema is silently dropped before the controller sees it** (the SP1 bug I fixed in commit `a2fb417`). Without this entry, the token never reaches the controller. **This is a required schema change.**

**Acceptance:** Developer registration with a valid invite token returns 201 with the user payload + creates the partnership. Invalid/expired token → 201 with `claimWarning` in the body, registration still succeeded.
**Commit:** `feat(cp-platform): SP4 — registerUser claims externalDeveloperInviteToken (non-fatal on failure)`

#### T26 — Regression suite `32-sp4-claim-flow.test.js`
**Files:** `tests/regression/suites/32-sp4-claim-flow.test.js` (NEW)
**Goal:** Per spec §8.1 #7.
**Contract:** Token-gated end-to-end:
- Setup: CP creates ExternalDeveloper + linked Prospects + invites.
- Developer registers with `externalDeveloperInviteToken` → 201; Partnership exists active; ExternalDeveloper.claimedByOrg set; dev-side ChannelPartner exists with `channelPartnerOrg`; Prospects re-tagged (developerContext.type='platform', partnership set, externalDeveloper cleared); system activity present.
- Invalid token → 201 with `claimWarning`; no Partnership / no claim.
- Re-using an already-claimed token in a second registration → fails (rejected by claim with 409, surfaced as `claimWarning`; the new dev org still registers).
- `external_developer_claimed` notification visible to CP Manager.

**Commit:** `test(cp-platform): SP4 — claim flow regression suite`

---

### Phase G — Push to developer + Registrations queue

#### T27 — `prospectService.pushProspectToDeveloper`
**Files:** `services/prospectService.js` (extend)
**Goal:** Per spec §4.1.
**Contract:**
```js
pushProspectToDeveloper(prospectId, user)
```
Steps:
1. Load Prospect (org-scoped, agent-scoped for CP Agent). 404 otherwise.
2. Assert `developerContext.type === 'platform'`, `pushedToLead == null`. (409 otherwise.)
3. Load the Partnership; assert `status === 'active'`. (409 otherwise.)
4. Reconcile shadow record: load the dev-side `ChannelPartner` with `organization=partnership.developerOrg, channelPartnerOrg=prospect.organization`. If missing, run `partnershipService.reconcileChannelPartnerRecord(partnership, user._id)` — defensive; should always exist via SP3.
5. Create a Lead in the developer's org:
   ```js
   Lead.create({
     organization: partnership.developerOrg,
     project: prospect.project.platform,
     firstName: prospect.firstName, lastName: prospect.lastName,
     email: prospect.email, phone: prospect.phone,
     source: 'channel_partner',
     status: 'pending',
     priority: prospect.priority,
     budget: prospect.budget,
     requirements: prospect.requirements,
     notes: prospect.notes,
     sourceProspect: prospect._id,
     channelPartnerAttribution: {
       viaChannelPartner: true,
       partners: [{ channelPartner: cpRecord._id, agentUser: prospect.assignedAgent, sharePct: 100 }],
       status: 'pending',
       taggedBy: user._id,
       taggedAt: new Date(),
     },
   });
   ```
6. Update prospect: `pushedToLead = lead._id, pushedAt = now, pushedBy = user._id`; push a system activity `{type:'system', note:'Pushed to developer for review', at:now, by:user._id}`.
7. **Notification:** `lead_registration_received` → `notifyUsersWithPermission({organizationId: partnership.developerOrg, permission: 'leads:update', type: 'lead_registration_received', title: '...', message: '...', actionUrl: '/leads/registrations', relatedEntity:{entityType:'Lead', entityId: lead._id, displayLabel: '<contact name>'}, actor: user._id})`.

Returns the created lead (so the controller can include it in the response).

**Acceptance:** Push creates a `pending` Lead with `sourceProspect` set, attribution populated, and the prospect's `pushedToLead` set. Second push on already-pushed prospect → 409.
**Commit:** `feat(cp-platform): SP4 — pushProspectToDeveloper (creates pending Lead + sets attribution)`

#### T28 — Push route
**Files:** `controllers/prospectController.js` (extend), `routes/prospectRoutes.js` (extend)
**Goal:** Wire `POST /api/cp/prospects/:id/push` → `cp_prospects:manage`.
**Commit:** `feat(cp-platform): SP4 — POST /api/cp/prospects/:id/push`

#### T29 — Developer-side registrations queue endpoints
**Files:** `controllers/leadController.js` (extend), `routes/leadRoutes.js` (extend)
**Goal:** Per spec §4.2.
**Contract:**
- `GET /api/leads/registrations` — `leads:read`. Returns leads where:
  - `organization = caller.org` AND `status = 'pending'` AND `sourceProspect != null`.
  - For each lead: populate `sourceProspect.notes`, the CP org name (via `channelPartnerAttribution.partners[0].channelPartner → ChannelPartner → channelPartnerOrg → Organization.name`), the `agentUser` name (`User.firstName/lastName`).
  - **Duplicate-match** (per §1 Decision 3): for each lead, run a query for the **single best** matching non-pending Lead in the same project: `Lead.findOne({ organization, project, status: { $ne: 'pending' }, createdAt: { $gte: 60dAgo }, $or: [{email: lead.email}, {phone: lead.phone}], _id: { $ne: lead._id } }).sort({ createdAt: -1 }).select('_id firstName lastName createdAt').lean()`. Attach as `duplicateMatch: { _id, name, lastContactedDaysAgo } | null`.
  - Org-scoped + project-access-scoped via existing `projectAccessFilter(req)`.

- `PATCH /api/leads/:id/registration` — `leads:update`. Body `{action: 'accept'|'reject', note?}`. Loads lead by id+org (404 otherwise). Asserts `status === 'pending'` and `sourceProspect != null` (409 otherwise).
  - **accept:** set `status = 'New'`, set `channelPartnerAttribution.status = 'approved'`. Fire `lead_registration_accepted` → CP `agentUser` + CP Manager/Owner of the originating CP org. Append a status-history entry (the existing Lead model has status history under interactions or a similar field — implementer to inspect `leadModel.js` for the convention; if no formal status-history field exists, leave the auto-`updatedAt` as the timeline marker, matching how other Lead status changes work today).
  - **reject:** set `status = 'Lost'`, set `channelPartnerAttribution.status = 'rejected'`. Append an Interaction document (one already exists in `models/interactionModel.js` — implementer to confirm) `{type: 'note', note: 'Registration rejected: <note>', lead, user, createdBy}` as the audit trail. Fire `lead_registration_rejected`.

- Notification recipient resolution for "the CP agent": `lead.channelPartnerAttribution.partners[0].agentUser` (we just push one partner per lead in T27). Use `createNotification` directly (single recipient) for the CP agent + `notifyUsersWithPermission` for the CP Manager/Owner audience (`permission: 'cp_prospects:manage'` against the CP org — that's CP Owner + CP Manager + CP Agent; pass `excludeUserIds: [agentUser]` to avoid double-notifying the agent; or use `cp_org:manage` for a tighter Manager/Owner-only audience — plan uses `cp_org:manage` for less spam to other agents).

**Routes (`routes/leadRoutes.js`):**
```js
router.get  ('/registrations',          hasPermission('leads:read'),   getLeadRegistrations);
router.patch('/:id/registration',       hasPermission('leads:update'), decideLeadRegistration);
// (T34 will add the proposal route alongside)
```

**Acceptance:** Queue returns only pending+sourceProspect leads; accept/reject transitions correctly; notifications fire.
**Commit:** `feat(cp-platform): SP4 — GET /api/leads/registrations + PATCH /api/leads/:id/registration (accept/reject)`

#### T30 — Regression suite `33-sp4-prospect-push.test.js`
**Files:** `tests/regression/suites/33-sp4-prospect-push.test.js` (NEW)
**Goal:** Per spec §8.1 #2.
**Contract:** Push creates `pending` Lead with `sourceProspect` + correct attribution (`channelPartner` ref, `agentUser` ref); non-active partnership blocks push (409); double-push on same prospect blocked (409).
**Commit:** `test(cp-platform): SP4 — push flow suite`

#### T31 — Regression suite `34-sp4-lead-registration-queue.test.js`
**Files:** `tests/regression/suites/34-sp4-lead-registration-queue.test.js` (NEW)
**Goal:** Per spec §8.1 #3.
**Contract:** Queue returns only pending CP-submitted leads, org-scoped; accept transitions to `'New'` + fires notification; reject sets `'Lost'` + Interaction created + fires notification; duplicate-match flags same project + (email OR phone) within 60d.
**Commit:** `test(cp-platform): SP4 — lead registration queue suite`

---

### Phase H — Status proposal flow

#### T32 — `proposeStatusChange` + `withdrawProposedStatusChange`
**Files:** `services/prospectService.js` (extend)
**Goal:** Per spec §4.1 row + §1 Decision 1 (DELETE-based withdrawal).
**Contract:**
```js
proposeStatusChange(prospectId, statusValue, note, user)
// 409 if !pushedToLead, if Lead.proposedStatusChange already non-null, or if proposed status === current Lead.status.
// Validates statusValue is in the Lead.status enum (excluding 'pending').
// Sets Lead.proposedStatusChange = {status, proposedBy: user._id, proposedAt: now, note}.
// Pushes a 'status_change' activity to the Prospect: {type:'status_change', note: 'Proposed status: <status>. <note>', at:now, by:user._id}.
// Fires lead_status_proposed → developer-side: lead's assignedTo (single) + dev Manager/Owner via notifyUsersWithPermission(leads:update) excluding assignedTo.

withdrawProposedStatusChange(prospectId, user)
// 404 if no pushed lead; 409 if no pending proposal.
// Auth: proposer OR CP Manager/Owner of the prospect's org. (CP Agent who is NOT the proposer → 403.)
// Sets Lead.proposedStatusChange = null. Pushes a 'system' activity 'Proposal withdrawn'.
// No notification — developer hasn't acted; silent withdrawal.
```
**Commit:** `feat(cp-platform): SP4 — proposeStatusChange + withdraw on Prospect → Lead`

#### T33 — Proposal routes (CP side)
**Files:** `controllers/prospectController.js` (extend), `routes/prospectRoutes.js` (extend)
**Goal:** Per spec §4.2 + §1 Decision 1.
**Contract:**
- `POST /api/cp/prospects/:id/propose-status` — `cp_prospects:manage`. Body `{status, note?}`.
- `DELETE /api/cp/prospects/:id/proposed-status` — `cp_prospects:manage`. No body. Returns `{success:true}`.

**Commit:** `feat(cp-platform): SP4 — POST :id/propose-status + DELETE :id/proposed-status`

#### T34 — Developer-side proposal decision
**Files:** `controllers/leadController.js` (extend), `routes/leadRoutes.js` (extend)
**Goal:** Per spec §4.2 last row.
**Contract:** `PATCH /api/leads/:id/proposal` — `leads:update`. Body `{action: 'accept'|'reject', note?}`. Loads lead; asserts `proposedStatusChange != null` (409). Org-scoped.
- **accept:** apply `lead.status = proposedStatusChange.status`; record an Interaction `{type:'note', note: 'Status updated via CP proposal: <oldStatus> → <newStatus>. <note>'}` as the audit trail (same approach as T29 reject's audit). Clear `proposedStatusChange = null`. Also fire `cp_lead_status_changed` (the spec lists this for **any** dev-driven status change on a CP-attributed lead; acceptable to fire only here and in the standard `updateLead` path — Phase J Task T38 wires it into `updateLead` too). Fire `lead_status_proposal_accepted` → CP agent + CP Manager/Owner.
- **reject:** clear `proposedStatusChange = null`; append Interaction `{type:'note', note: 'Status proposal rejected: <note>'}`. Fire `lead_status_proposal_rejected` → CP agent + CP Manager/Owner.

**Acceptance:** Both transitions work; `proposedStatusChange` clears; notifications fire to CP side.
**Commit:** `feat(cp-platform): SP4 — PATCH /api/leads/:id/proposal (accept/reject)`

#### T35 — Regression suite `35-sp4-status-proposal.test.js`
**Files:** `tests/regression/suites/35-sp4-status-proposal.test.js` (NEW)
**Goal:** Per spec §8.1 #4.
**Contract:** Propose creates `proposedStatusChange`; second propose → 409; withdraw clears it; dev accept applies status + clears proposal; dev reject clears proposal; all four notifications fire correctly.
**Commit:** `test(cp-platform): SP4 — status proposal suite`

---

### Phase I — Wire `partnerAccessScope` into `getLeads` / `getLeadById`

#### T36 — `getLeads` modification (CRITICAL — security-sensitive)
**Files:** `controllers/leadController.js`
**Goal:** Per spec §4.2. For CP callers, **replace** the org-scoped query with the `partnerAccessScope` filter (leads live in dev orgs, not the CP's org). For non-CP callers, keep the existing logic.
**Contract:** Reshape the start of `getLeads`:
```js
import { partnerAccessScope } from '../utils/partnerAccessHelper.js';
import Organization from '../models/organizationModel.js';

const getLeads = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, status, source, assignedTo, project, minScore, maxScore, priority, qualificationStatus, sortBy = 'score', sortOrder = 'desc', search, channelPartner } = req.query;

  // Determine caller org type once.
  const callerOrg = await Organization.findById(req.user.organization).select('type').lean();
  const isCp = callerOrg?.type === 'channel_partner';

  let query;
  if (isCp) {
    const scope = await partnerAccessScope(req);
    if (!scope) return res.json({ success: true, data: [], pagination: { total: 0, page: Number(page), limit: Number(limit) } });
    query = { ...scope };
    // CP user can see their own pending leads in their list.
  } else {
    query = { organization: req.user.organization, ...projectAccessFilter(req) };
    // Hide 'pending' from default non-CP lead lists; explicit status filter overrides.
    if (!status) query.status = { $ne: 'pending' };
  }

  // Existing per-filter merging (status, source, assignedTo, project, ...):
  if (status) query.status = status;
  // ... (existing logic continues, applied uniformly to both branches)
```

**Important:** the existing `if (req.user.role === 'Sales Executive') { query.assignedTo = req.user._id; }` branch must run **only for non-CP callers** (a CP Agent's narrowing is already inside `partnerAccessScope`). Wrap that line in `if (!isCp) { ... }`.

**Acceptance:**
- Non-CP caller behaviour is **unchanged** except 'pending' is excluded by default — verified by re-running existing leads tests (suite #11) plus a check that `?status=pending` still works.
- CP caller sees only leads attributed to their CP org via active partnerships.
- CP Agent caller sees only leads where `agentUser === self`.
**Commit:** `feat(cp-platform): SP4 — getLeads scopes CP users via partnerAccessScope; hides 'pending' from default non-CP lists`

#### T37 — `getLeadById` modification
**Files:** `controllers/leadController.js`
**Goal:** Per spec §4.2.
**Contract:** For CP callers, look up via `Lead.findOne({ _id: req.params.id, ...partnerAccessScope })` (no org filter). For non-CP callers keep `Lead.findOne({ _id, organization: req.user.organization })`. Non-match → 404 in both cases. Existing Sales-Executive narrowing stays in the non-CP branch.

**Acceptance:** CP Manager/Owner: can read any lead within their scope. CP Agent: only own. Outside scope → 404 (no enumeration leak).
**Commit:** `feat(cp-platform): SP4 — getLeadById scopes CP users via partnerAccessScope`

> After T36–T37, **extend** `tests/regression/suites/28-sp4-partner-access-scope.test.js` with integration cases (no new file): CP token can call `/api/leads` and gets a scoped list; CP Agent gets the narrowed slice; non-CP token is unaffected. Update via `git add` to the existing suite and commit with `test(cp-platform): SP4 — partner-access-scope integration via /api/leads`.

---

### Phase J — Notifications fan-out

#### T38 — Wire all 8 events
**Files:** `services/prospectService.js`, `controllers/leadController.js`
**Goal:** Per spec §4.4. Every event uses `notifyUsersWithPermission` (or `createNotification` for single-recipient targeted events).
**Contract:** A single source-of-truth table (in code comments at the top of each module) listing each fire-site. The actual calls are:

| Site | Call |
|---|---|
| `prospectService.pushProspectToDeveloper` succeeds | `notifyUsersWithPermission({organizationId: developerOrg, permission: 'leads:update', type: 'lead_registration_received', title, message, actionUrl: '/leads/registrations', relatedEntity, actor})` |
| `decideLeadRegistration` accept | `createNotification` to `agentUser` (single) + `notifyUsersWithPermission({organizationId: cpOrg, permission: 'cp_org:manage', type: 'lead_registration_accepted', excludeUserIds:[agentUser]})` |
| `decideLeadRegistration` reject | same shape with `type: 'lead_registration_rejected'` |
| Dev changes status of a CP-attributed lead (existing `updateLead`) | extend `updateLead` to detect `channelPartnerAttribution.viaChannelPartner` + status change → fire `cp_lead_status_changed` to `agentUser` + CP Manager/Owner |
| `proposeStatusChange` | `notifyUsersWithPermission({organizationId: developerOrg, permission: 'leads:update', type: 'lead_status_proposed', actor})` + `createNotification` to `lead.assignedTo` (single, if set, with `excludeUserIds:[actor]` on the broadcast to avoid double-notify) |
| `decideLeadProposal` accept | `createNotification` to `agentUser` (`lead_status_proposal_accepted`) + CP Manager/Owner broadcast |
| `decideLeadProposal` reject | same with `lead_status_proposal_rejected` |
| `claimExternalDeveloper` succeeds | `notifyUsersWithPermission({organizationId: invitingCpOrg, permission: 'cp_partnerships:manage', type: 'external_developer_claimed', ...})` |

The plan picks **`cp_org:manage`** as the CP Manager/Owner audience for lead-registration/proposal-decision events (lighter than `cp_prospects:manage` which would also notify all CP Agents). For the "claim" event, **`cp_partnerships:manage`** (same audience SP3 used for partnership lifecycle events) — narrow and consistent with SP3.

**Acceptance:** Every event creates a notification visible via the bell / `GET /api/notifications` to every listed recipient. Self-notification suppressed by `createNotification`'s built-in actor==recipient check.
**Commit:** `feat(cp-platform): SP4 — wire all 8 SP4 notification events`

#### T39 — Regression suite `36-sp4-notifications.test.js`
**Files:** `tests/regression/suites/36-sp4-notifications.test.js` (NEW)
**Goal:** Per spec §8.1 #9.
**Contract:** For each event in the table above, trigger it (using fixtures) and assert the expected notification(s) exist for the expected recipients (via authenticated `GET /api/notifications`).
**Commit:** `test(cp-platform): SP4 — notifications fan-out suite`

---

### Phase K — Frontend (matching backend slice order)

> All frontend tasks run in `/Users/nirpekshnandan/My Products/propvantage-ai-frontend` (use absolute paths when editing from the backend cwd). **Build gate** at the end of every chunk: `CI=true npm run build` (zero errors, zero warnings — CI treats warnings as errors).

#### T40 — API client additions
**Files:** `src/services/api.js`
**Goal:** Per spec §5.1. Add the 4 client objects.
**Contract:** Append (after the existing `partnershipAPI` block) — exactly the spec §5.1 shape: `cpProspectsAPI`, `cpExternalDevelopersAPI`, `externalDeveloperInviteAPI`, `leadRegistrationsAPI`. Paths use the `/cp/...` and `/leads/...` prefixes already proven by SP3 (the `api` axios instance baseURL ends in `/api`).
**Verify:** `CI=true npm run build` clean.
**Commit:** `feat(cp-platform): SP4 — api.js clients (cpProspects, cpExternalDevelopers, externalDeveloperInvite, leadRegistrations)`

#### T41 — CP portal nav additions
**Files:** `src/components/layout/ChannelPartnerLayout.js`
**Goal:** Per spec §5.2. Add two nav items.
**Contract:**
- "Prospects" — `path: '/partner/prospects'`, icon `PersonSearch`, requires `cp_prospects:view`.
- "Off-Platform Developers" — `path: '/partner/external-developers'`, icon (e.g. `Domain` or `Business`), requires `cp_external_developers:manage`. Placed under the existing Marketplace group if the layout supports grouping (the SP3 `NAV` array is flat — adding both at the top level is acceptable and matches the existing style).

Owner-bypass handled by the existing `useAuth` `checkPerm`/`isOwner` pattern (same as SP3's nav gating).
**Verify:** Build clean; nav renders.
**Commit:** `feat(cp-platform): SP4 — CP portal nav (Prospects + Off-Platform Developers)`

#### T42 — `ProspectsListPage.jsx`
**Files:** `src/pages/partner/ProspectsListPage.jsx` (NEW), `src/App.js` (add route)
**Goal:** Per spec §5.3.
**Contract:**
- Route `/partner/prospects` → `ChannelPartnerRoute` + `ChannelPartnerLayout` + `<ProspectsListPage />`. Lazy-loaded with Suspense (match the SP3 routing pattern at `App.js:485..510`).
- Page composition per spec §5.3: header + "New Prospect" button → dialog (with the on/off-platform radio, partnership picker for on-platform, ExternalDeveloper picker + inline-create for off-platform), filter bar, MUI `DataGrid` (or Table — match the style of SP3's `DeveloperPartnershipsPage` which used `Table`/`Tabs` for consistency).

**Implementation strategy:** As with SP3's frontend, delegate the bulk of the new-page work to a focused general-purpose agent at execution time. The agent gets: the SP4 spec §5.3 verbatim, the API contract (T40), the conventions from `ProspectDetailPage`/`CpMarketplacePage` (style reference), and the build gate. Same playbook as the SP3 frontend agent.

**Verify:** `CI=true npm run build` clean; page renders; create dialog gates partnership / project pickers correctly (calls SP3's `/api/cp/partnerships?status=active` and SP2's `/api/portfolio/view/:orgId`).
**Commit:** `feat(cp-platform): SP4 — ProspectsListPage + new-prospect dialog`

#### T43 — `ProspectDetailPage.jsx` (4 tabs)
**Files:** `src/pages/partner/ProspectDetailPage.jsx` (NEW), `src/App.js` (add route)
**Goal:** Per spec §5.4 (Overview / Activities / Status & Push / Commission tabs).
**Contract:**
- Route `/partner/prospects/:id` (after `/partner/prospects` for unambiguous matching).
- Tabs panel: Overview, Activities, Status & Push, Commission — exactly per §5.4.
- The withdrawal UX (Decision 1): on the Status & Push tab, when a proposal is pending, a **Withdraw** button calls `DELETE /api/cp/prospects/:id/proposed-status` (a new line in `partnershipAPI`? — actually it's on `cpProspectsAPI`; T40 should include this; revise T40 to add `withdrawProposedStatus: (id) => api.delete(`/cp/prospects/${id}/proposed-status`)`).
- Commission tab implements all four cards: Agreement (editable), Booking (editable), Summary (computed), Payments ledger (table + record dialog), Write-off (Manager/Owner-only; disabled when status='paid'). All calls hit the T18 endpoints.

**Self-correction note for T40:** before executing T43, ensure `cpProspectsAPI` exposes `withdrawProposedStatus`. Add it during T40 (the plan lists it now — implementer adds the line below `proposeStatus`).

**Commit:** `feat(cp-platform): SP4 — ProspectDetailPage (4 tabs)`

#### T44 — `ExternalDevelopersListPage.jsx`
**Files:** `src/pages/partner/ExternalDevelopersListPage.jsx` (NEW), `src/App.js` (add route)
**Goal:** Per spec §5.5.
**Contract:** Route `/partner/external-developers`. Grid of cards; side-drawer for detail/edit; invite section that:
- When no invite or expired → "Invite to Platform" dialog (email) → on submit, displays the returned `inviteLink` in a copyable field (same UX as SP3's `inviteNewCp` dialog — reuse the same copy-to-clipboard pattern from `DeveloperPartnershipsPage`).
- When invite active → status + Regenerate.
- When claimed → "Claimed by …" + link to the matching active Partnership (route `/partner/partnerships`).

**Commit:** `feat(cp-platform): SP4 — ExternalDevelopersListPage + invite flow`

#### T45 — Developer `RegisterPage` invite-token wiring
**Files:** `src/pages/auth/RegisterPage.jsx` (or wherever the **developer** registration component lives — SP3 work touched `ChannelPartnerRegisterPage.js`; the developer side is a separate component to locate at execution time)
**Goal:** Per spec §5.8.
**Contract:** On mount, read `inviteToken` from `useSearchParams`. If present, call `externalDeveloperInviteAPI.lookup(token)`:
- `200` → pre-fill orgName, contact phone/email, city; lock `type='builder'`; show banner *"You've been invited by {invitedByOrgName} to join the platform. Completing this registration will activate a partnership with them."*
- `410` → show non-blocking warning "Invalid or expired invite link." (let registration proceed normally without a token).

On submit, include `externalDeveloperInviteToken: inviteToken` in the request body when set. After `201`, if `claimWarning` in response → show a non-blocking toast.

**SP3 reuse:** the existing `ChannelPartnerRegisterPage.js` already implements a very similar pattern for SP3's `inviteToken`/`cpId` (developer-invites-CP direction). The developer-register page mirrors that pattern; an implementing agent should treat the SP3 page as the style template.

**Commit:** `feat(cp-platform): SP4 — developer RegisterPage handles externalDeveloperInviteToken`

#### T46 — `LeadRegistrationsPage.jsx` + nav badge
**Files:** `src/pages/leads/LeadRegistrationsPage.jsx` (NEW), `src/App.js` (route), `src/components/layout/DashboardLayout.js` (Leads nav child + count badge)
**Goal:** Per spec §5.6.
**Contract:**
- Route `/leads/registrations` (developer side; `ProtectedRoute requiredPermission="leads:read"` + `DashboardLayout`).
- Table per §5.6 columns; row-click side-drawer with full detail + Accept/Reject; bulk select + bulk actions.
- Nav: add "Pending Registrations" child under the Leads nav group with a count badge (poll `cpProspectsAPI`? — actually it's `leadRegistrationsAPI.list()`'s length; the existing notification bell already shows the unread count, so the badge here is supplementary — implementer may keep it simple as a static label if polling adds complexity. Spec leaves the implementer choice.)

**Commit:** `feat(cp-platform): SP4 — LeadRegistrationsPage + Leads nav badge`

#### T47 — `LeadDetailPage` additions
**Files:** `src/pages/leads/LeadDetailPage.jsx` (modify)
**Goal:** Per spec §5.7.
**Contract:**
- "Channel Partner" right-column card when `channelPartnerAttribution.partners[0].channelPartner` is set: shows CP firm name + agent (User name+email) + submitted-at + original Prospect note.
- Proposed-status banner across the top when `proposedStatusChange != null`. Two buttons (Accept Proposal / Reject Proposal) → `leadRegistrationsAPI.decideProp(leadId, {action, note?})`. Both gated `leads:update`.
- Status timeline rendering of accept/reject events (uses the Interaction history already rendered today — the new Interactions created in T29/T34 will appear automatically).

**Commit:** `feat(cp-platform): SP4 — LeadDetailPage CP section + proposed-status banner`

#### T48 — Router checks for all SP4 routes
**Files:** `src/App.js`
**Goal:** Confirm the four new routes are mounted with the right wrappers (added piecewise in T42, T43, T44, T46). This task is a verification step — no new code if T42–T46 are complete. If the route order needs adjustment (e.g. `/partner/prospects/:id` after `/partner/prospects`), fix here.
**Acceptance:** All four routes resolve in the browser without 404; layouts wrap correctly.
**Commit:** No commit unless route reordering needed.

#### T49 — Frontend build gate
**Files:** none
**Goal:** Final frontend gate — `CI=true npm run build` clean (zero errors, zero warnings) after all of T40–T48 are committed.
**Acceptance:** Build summary shows "Compiled successfully." Any warning is a blocker per CI mode; iterate until clean.

---

### Phase L — Acceptance

#### T50 — Manual smoke through five §8.2 scenarios
**Goal:** Walk through each scenario in a fresh browser session (chrome MCP if available; manual otherwise), using the test accounts already on `prop-vantage.com`.
**Scenarios:**
1. **Standalone CP, off-platform developer** — create ExternalDeveloper, create Prospect, log activities, record booking + manual commission + payment. Ends with the Commission tab showing `paid`.
2. **Both on platform, collaborative** — CP creates Prospect against an active partnership → pushes → developer accepts in registrations queue → CP proposes status change → developer accepts proposal → status updates on both sides.
3. **CP-initiated late onboarding** — Standalone CP invites their ExternalDeveloper → developer registers via the invite link → ExternalDeveloper claimed; Partnership active; Prospects re-tagged; CP retains manual commission ledger.
4. **Dev-initiated late onboarding (SP3 flow)** — confirm no regression; SP3's existing developer-invites-CP flow + the new `partnerAccessScope` shows pre-existing dev-side CP attribution to the newly-joined CP.
5. **Retroactive re-tagging** — after a claim, existing pushed leads (if any) become visible to the CP via `partnerAccessScope`.

For each scenario, document: account used, steps taken, observed outcome, screenshot if anomalous. Report back to the user with a pass/fail summary.

#### T51 — Final commit summary + authorised push & deploy
**Goal:** Surface the full per-task commit history + the migration script status, then ask the user:
- Approve pushing both repos to `main` (triggers EC2 deploy on backend; Vercel on frontend)?
- Approve running `data/backfillSp4CpPermissions.js` against the prod DB (one-shot, idempotent)?

Both run only with explicit user OK (matching the SP3 flow established earlier this session).

**Commit:** None; this is the close-out step.

---

## 4. Self-review against the checklist

| Check | Outcome |
|---|---|
| Every spec section/requirement covered by a task | **Yes.** Cross-referenced below. |
| No placeholders ("TBD", "similar to Task N") | **Yes.** Every task has explicit files/contract/acceptance. The frontend page-body delegation (T42/T43/T44) is a deliberate execution strategy carried over from SP3 — not a placeholder; the contract is fully specified in the spec §5.3–§5.7 and the API contract here. |
| Type / signature consistency across tasks | **Yes.** `partnerAccessScope` returns `null` / `{ _id: {$in: []} }` / filter consistently. `notifyUsersWithPermission` returns `{sent}` consistently. All controllers `res.json({success:true, data})` consistently with the existing repo style. |
| `notifyUsersWithPermission` integration | **Added in T11**; used in T28 (push), T29 (registration decide), T34 (proposal decide), T24/T38 (claim), T38 (status-change), and T39 (test). |
| Lead 'pending' enum value | **Added in T01**; used in T27 (push creates pending), T29 (queue filters by pending), T36 (default excludes pending for non-CP). |
| `partnerAccessScope` integration | **Built in T09**, **tested isolated in T10**, **wired in T36/T37**, **integration-tested by extension to T10**. |
| Transactional claim flow | **T24** specifies session-based transaction (Atlas supports it) with fallback. |
| Backfill for existing CP orgs | **T08** script + run in **T51** with user OK. |
| Notifications enum extension | **T03** adds 8 types + 2 entity types; **T38** wires all 8 fires; **T39** asserts. |
| Frontend build gate | **T49** explicit; **T42/T43/T44/T46** each include build-clean in acceptance. |
| Per-task commits | Explicit `Commit:` line on every task. |
| No push without OK | Stated in §0.4 and reinforced in **T51**. |

### Spec section → task cross-reference

| Spec § | Tasks |
|---|---|
| §3.1 Prospect | T07, T12 (CRUD), T17 (commission), T27 (push), T32 (proposal) |
| §3.2 ExternalDeveloper | T06, T20, T24 (claim) |
| §3.3 Lead additions | T01, T02 |
| §3.4 Notification enums | T03 |
| §3.5 Permissions + role grants + backfill | T04, T05, T08 |
| §4.1 Services | T11 (notify), T12/T17 (prospect), T20/T24 (extdev), T27 (push), T32 (propose) |
| §4.2 Controllers & routes | T13/T14, T18, T21/T22, T28, T29, T33, T34, T36, T37 |
| §4.3 Registration extension | T25 |
| §4.4 Notifications fan-out | T38 |
| §4.5 App wiring | folded into T14, T21, T22 (all touch `server.js`) |
| §5.1 API client | T40 |
| §5.2 CP nav | T41 |
| §5.3 Prospects list | T42 |
| §5.4 Prospect detail | T43 |
| §5.5 External Developers | T44 |
| §5.6 Lead Registrations | T46 |
| §5.7 Lead Detail additions | T47 |
| §5.8 Register page wiring | T45 |
| §6 Out-of-scope | n/a (no tasks; documented in plan §6 below) |
| §7 Edge cases | covered by each task's contract + the regression suites |
| §8.1 Regression suites #1–9 | T15, T19, T23, T26, T30, T31, T35, T39, plus T10 (#5 partner-access-scope extended in T36/T37) |
| §8.2 Manual smoke | T50 |
| §9 File summary | matches plan deliverables (create/modify lists) |
| §10 Implementation order | matches phase order A→L |
| §11 Open items | resolved in §1 of this plan |

## 5. Scope not in this plan

The spec §6 "Scope Boundaries — Not in SP4" — restated for clarity, no tasks:
- Cross-org analytics dashboards → SP5.
- CP subscription & billing → SP6.
- Email/SMS notifications.
- Lead reassignment workflow between CP agents (CP Manager edits `assignedAgent` directly).
- Bulk import; attachments on prospects; automatic commission engine on CP side; unified commission reconciliation.

## 6. Known follow-ups (post-SP4, low priority)

- Refactor SP3's `partnershipService.notifyPartnership` internals to call the new shared `notifyUsersWithPermission` helper. Not in SP4 — would touch already-shipped code.
- Add a per-CP-org "follow-up due today" digest using the new `Prospect.followUp.nextDate` index. Spec doesn't require it.

---

**End of plan.** Awaiting user approval before executing Task T01.
