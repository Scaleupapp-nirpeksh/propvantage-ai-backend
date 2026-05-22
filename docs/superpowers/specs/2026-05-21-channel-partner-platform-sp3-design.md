# Channel Partner Platform — SP3: Marketplace & Partnership Lifecycle

**Date:** 2026-05-21
**Status:** Approved for planning
**Repos:** `propvantage-ai-backend` (Node/Express/MongoDB), `propvantage-ai-frontend` (React 18 + MUI v5)

---

## 1. Context

PropVantage AI is a **two-sided platform**: real-estate **developers** (`Organization.type
= 'builder'`) and **channel partner (CP)** organizations (`type = 'channel_partner'`). The
six-sub-project roadmap and the shared **Target Architecture** are defined in the SP1 spec
(`2026-05-21-channel-partner-platform-sp1-design.md`, §2–§3 — which still governs).

- **SP1** shipped CP organizations, the CP portal (`/partner/*`, `/api/cp/*`), CP roles
  and the `cp_*` permission namespace.
- **SP2** shipped the developer public portfolio — `Project.portfolio`,
  `Organization.portfolioProfile`, `portfolioService.getDeveloperPortfolio`, and
  `GET /api/portfolio/view/:organizationId`.

**SP3 — Marketplace & Partnership Lifecycle.** SP3 is the connective layer: it lets a CP
and a developer form a working relationship on the platform. A CP discovers developers and
their SP2 portfolios, applies to partner; the developer's leadership approves or rejects;
a developer can also invite a CP from a directory. SP3 ends when a partnership is
`active` — making an active partnership *do* something (cross-org leads) is **SP4**.

SP3 depends on SP1 + SP2 and is governed by the SP1 Target Architecture §3 — in
particular the `Partnership` model shape (§3.2), the `ChannelPartner`-as-developer-shadow
rule (§3.3), and the security-critical scoping rule (§3.5).

## 2. Decisions Locked (during brainstorming)

| # | Decision | Choice |
|---|---|---|
| 1 | Partnership scope | Covers **all** the developer's published projects by default; the developer may **optionally restrict** to a subset (`Partnership.projects[]`). |
| 2 | Developer-side approval gating | **Reuse** the existing `channel_partners:*` permissions — no new developer permission, no backfill. |
| 3 | Lifecycle | **Full** state machine — approve/reject, accept/decline, terminate (both sides), suspend/resume (developer), and re-apply. |
| 4 | Marketplace search | Org-name text search + filters: **city, project type, price band, project status**. |
| 5 | Application content | Optional free-text **message + document attachments** (existing S3 file system). |
| 6 | CP marketing profile | New `Organization.channelPartnerProfile` — `logoUrl, about, areasServed[], trackRecord`. |
| 7 | Spam / rate control | Cap of **10 `pending` applications** per CP (configurable); developer-initiated invites are exempt. |
| 8 | Notifications | Reuse the in-app `/api/notifications` system; fire on **every** request and decision. |
| 9 | Commission terms | **Captured on the `Partnership` at approval/invite**; on activation they seed the existing `CommissionRule` / `ChannelPartner` engine, which still executes (§6.5). |
| 10 | Legacy dev-org "Channel Partner *" roles | **Removed** — dropped from `defaultRoles.js`; a migration deletes them from existing developer orgs (no real users are assigned — confirmed). |
| 11 | CP-side permissions | New `cp_partnerships:view` / `cp_partnerships:manage`: CP Owner & CP Manager get both; CP Agent gets `view`. |

## 3. Architectural Constraints (fixed — from SP1 §3)

- The `Partnership` model shape is the agreed end-state (§5.1 below realises it).
- The `ChannelPartner` registry remains the developer-side shadow of a partnership, linked
  via `channelPartnerOrg`. The existing attribution / commission / analytics machinery
  must keep working unchanged (§6.5).
- **Scoping is security-critical.** A CP user gets (a) normal `organization`-scoping for
  their own CP org and (b) partnership-mediated access to a developer's data — only via an
  `active` Partnership. A CP user never gets raw `organization`-scoped access to a
  developer org. SP3 only **establishes** the Partnership records; the "partner access
  scope" that *reads* them is SP4.
- One React app, org-type-switched shell. One shared database — partnerships link the two
  org types.

## 4. Data Model

### 4.1 `Partnership` — new model (`models/partnershipModel.js`)

The central new model (SP1 Target Architecture §3.2).

```js
{
  developerOrg:      { type: ObjectId, ref: 'Organization', required, index },  // type 'builder'
  channelPartnerOrg: { type: ObjectId, ref: 'Organization', required, index },  // type 'channel_partner'

  status:      { type: String, enum: ['pending','active','rejected','suspended','terminated'], default: 'pending', index },
  initiatedBy: { type: String, enum: ['channel_partner','developer'], required },

  // Empty array = the partnership covers ALL the developer's published projects.
  // Non-empty = the developer has restricted it to this subset (Decision 1).
  projects: [{ type: ObjectId, ref: 'Project' }],

  // The apply / invite payload (Decision 5).
  application: {
    message:     { type: String, default: '' },
    attachments: [{ url: String, name: String, uploadedAt: Date }],
  },

  // Agreed commission terms, set by the developer at approval (CP-initiated) or at
  // invite (developer-initiated) — Decision 9. Null until then.
  commissionTerms: {
    type:  { type: String, enum: ['percentage','flat'] },
    value: Number,
    notes: { type: String, default: '' },
  },

  // Decision audit.
  requestedAt: Date,
  decidedAt:   Date,
  decidedBy:   { type: ObjectId, ref: 'User' },
  history: [{
    status:   String,                       // status moved TO
    action:   String,                       // applied|invited|approved|rejected|accepted|declined|suspended|resumed|terminated|reapplied|reinvited
    actor:    { type: ObjectId, ref: 'User' },
    actorOrg: { type: ObjectId, ref: 'Organization' },
    at:       Date,
    note:     String,
  }],
}
```

- **Unique compound index** `{ developerOrg: 1, channelPartnerOrg: 1 }` — exactly one
  Partnership document per (developer, CP) pair, ever. Re-application reuses the document
  (§6.3).
- `timestamps: true`.

### 4.2 `Organization` — `channelPartnerProfile` sub-document

Add to `models/organizationModel.js` (used by `type: 'channel_partner'` orgs — the
"rich CP marketing profile" SP1 §10 deferred to SP3, Decision 6):

```js
channelPartnerProfile: {
  logoUrl:     { type: String, default: null },
  about:       { type: String, default: '' },
  areasServed: { type: [String], default: [] },   // cities / localities
  trackRecord: { type: String, default: '' },     // free text — formats vary, not structured
}
```

### 4.3 `ChannelPartner` — `channelPartnerOrg` ref

Add to `models/channelPartnerModel.js` (Target Architecture §3.3):

```js
channelPartnerOrg: { type: ObjectId, ref: 'Organization', default: null }  // sparse index
```

Links a developer-side registry record to a CP org. Set during reconciliation (§6.5).
Legacy `ChannelPartner` records with no org link continue to work as manually-managed
records.

## 5. Permissions

### 5.1 CP namespace — `cp_partnerships:*` (Decision 11)

Add to `config/permissions.js` (`CP_PERMISSIONS` + `ALL_CP_PERMISSIONS`):
`cp_partnerships:view`, `cp_partnerships:manage`.

`data/defaultChannelPartnerRoles.js` assignment:
- **CP Owner** — both (via `ALL_CP_PERMISSIONS`).
- **CP Manager** — `cp_partnerships:view`, `cp_partnerships:manage`.
- **CP Agent** — `cp_partnerships:view` only.

Existing CP orgs' seeded role documents predate these permissions, so SP3 includes a
one-time backfill `data/backfillCpPartnershipsPermission.js` (modelled on SP2's
`data/backfillPortfolioPermission.js`) that adds them to existing CP Owner / CP Manager /
CP Agent role documents. The CP Owner also has them via owner-bypass.

### 5.2 Developer side — reuse `channel_partners:*` (Decision 2)

No new developer permission, no backfill. Mapping:
- `channel_partners:view` — view partnership requests, the partnerships list, and the CP
  directory.
- `channel_partners:create` — invite a CP (creates a Partnership).
- `channel_partners:update` — decide an existing Partnership (approve / reject / suspend /
  resume / terminate).

The Organization Owner has all via owner-bypass.

## 6. Backend

All routes behind `protect`. CP-org routes additionally use
`requireOrgType('channel_partner')`; developer-org routes reject CP orgs.

### 6.1 Marketplace — CP discovery

`GET /api/cp/marketplace` — `requireOrgType('channel_partner')` + `cp_partnerships:view`.
Query params: `q` (org-name text), `city`, `projectType`, `priceMin`, `priceMax`,
`projectStatus`, plus pagination. A developer org is included if it has **≥1 published
project** (`portfolio.isPublished`) and at least one published project matches every
supplied filter (city ← `location.city`, type ← `Project.type`, price band ←
`Project.priceRange`, status ← `Project.status`).

Returns developer-org cards:
```
{ organizationId, name, logoUrl, city, about,
  publishedProjectCount, projectTypes: [...],
  partnershipStatus: 'none'|'pending'|'active'|'rejected'|'suspended'|'terminated' }
```
`partnershipStatus` reflects any existing Partnership between the calling CP and that
developer, so the UI can show "Applied" / "Partnered". Opening a developer reuses SP2's
`GET /api/portfolio/view/:organizationId`.

### 6.2 CP directory — developer discovery

`GET /api/directory/channel-partners` — developer org + `channel_partners:view`. Query:
`q` (firm-name text), `category`, `area`, pagination. Returns CP-org cards from
`name`, `category`, `channelPartnerProfile` (`logoUrl`, `about`, `areasServed`,
`trackRecord`), and `partnershipStatus` relative to the calling developer.

### 6.3 Partnership lifecycle

**`POST /api/partnerships`** — create a `pending` Partnership.
Body: `{ counterpartyOrgId, message?, attachments?, projects?, commissionTerms? }`.
- Caller is a CP → `initiatedBy: 'channel_partner'`; counterparty must be a `builder`
  with ≥1 published project; `cp_partnerships:manage`; enforces the **pending cap** —
  rejected if the CP already has 10 partnerships in `pending` (configurable via env, e.g.
  `CP_MAX_PENDING_APPLICATIONS`). `commissionTerms`/`projects` ignored (developer's call).
- Caller is a developer → `initiatedBy: 'developer'` (an invite); counterparty must be a
  `channel_partner`; `channel_partners:create`; the developer may supply `commissionTerms`
  and `projects` here. Not subject to the pending cap.
- **Unique-pair handling.** If a Partnership already exists for the pair:
  - `rejected` or `terminated` → reopen the **same document** to `pending`, reset
    `application`, append `history` (`reapplied` / `reinvited`). Re-application (Decision 3).
  - `pending`, `active`, or `suspended` → 409, clear message ("a partnership request
    already exists" / "you are already partnered with this organization").
- Writes a `Notification` to the counterparty org.

**`PATCH /api/partnerships/:id`** — a lifecycle transition.
Body: `{ action, note?, commissionTerms?, projects? }`. The caller must be a party to the
partnership. Authorization & transition matrix:

| `action` | Caller side | From status | Requires | → status |
|---|---|---|---|---|
| `approve` | developer | `pending` & `initiatedBy: channel_partner` | `channel_partners:update` + **`commissionTerms`** (optional `projects`) | `active` |
| `reject` | developer | `pending` & `initiatedBy: channel_partner` | `channel_partners:update` | `rejected` |
| `accept` | CP | `pending` & `initiatedBy: developer` | `cp_partnerships:manage` | `active` |
| `decline` | CP | `pending` & `initiatedBy: developer` | `cp_partnerships:manage` | `rejected` |
| `suspend` | developer | `active` | `channel_partners:update` | `suspended` |
| `resume` | developer | `suspended` | `channel_partners:update` | `active` |
| `terminate` | developer **or** CP | `active` or `suspended` | dev: `channel_partners:update` / CP: `cp_partnerships:manage` | `terminated` |

Every transition sets `decidedAt`/`decidedBy` (where a decision), appends `history[]`,
and writes a `Notification` to the other side. A transition to `active` runs the
ChannelPartner reconciliation (§6.5). Any action not permitted from the current
status / by the caller's side → 409 / 403 with a clear message.

**`GET /api/cp/partnerships`** — CP side; this CP org's partnerships, `?status=` filterable;
`cp_partnerships:view`. **`GET /api/partnerships`** — developer side; this developer org's
partnerships (incoming `pending`, `active`, sent invites, …), filterable;
`channel_partners:view`. **`GET /api/partnerships/:id`** — single partnership; caller must
be a party.

### 6.4 Notifications (Decision 8)

Reuse the existing `Notification` model and `/api/notifications` — in-app only (the
platform has no email integration). On partnership creation and on every transition, write
a notification to the counterparty org's users who hold the relevant gating permission;
the Organization / CP Owner always qualifies via owner-bypass, so a notification always
has a recipient.

### 6.5 `ChannelPartner` reconciliation (Target Architecture §3.3)

When a Partnership enters `active`, `services/partnershipService.js` ensures the
developer-side shadow exists:
1. Find a `ChannelPartner` in `developerOrg` with `channelPartnerOrg ===
   partnership.channelPartnerOrg`. If none, create one — name / contact copied from the CP
   `Organization`, `channelPartnerOrg` set, active. The `channelPartnerOrg` link is the
   idempotency key: re-activation (terminate → re-apply → approve) never duplicates it.
2. **Commission seeding (Decision 9 / item A confirmed).** `partnership.commissionTerms`
   is the *agreed contract*; reconciliation seeds the existing execution engine from it —
   create/update the corresponding `CommissionRule` (or the `ChannelPartner` record's
   commission config) so attribution & commission keep calculating unchanged. The
   `Partnership` is the agreement; `CommissionRule` / `ChannelPartner` still execute.
3. On `suspended` / `terminated`, the linked `ChannelPartner` record is marked **inactive**
   (new attribution stops) but **not deleted** — historical attribution and commission are
   preserved. `resume` reactivates it.

Do **not** discard or rewrite the `ChannelPartner` module — it is the engine SP4's
cross-org leads will hang off.

## 7. Frontend

### 7.1 API client
Add to `src/services/api.js`: `marketplaceAPI` (search developers), `partnershipAPI`
(create, transition, list, get), `cpDirectoryAPI` (search CPs).

### 7.2 CP portal (`ChannelPartnerLayout`, `/partner/*`)
- **Nav** gains **Marketplace** and **Partnerships** (alongside Dashboard · My Team ·
  Organization Profile).
- **Marketplace page** — search bar + filters (city, project type, price band, project
  status); developer-org cards; opening one renders the developer's SP2 portfolio with an
  **Apply** action; the apply dialog collects a message + document uploads (existing S3
  upload flow).
- **Partnerships page** — the CP's partnerships tabbed by status (Pending / Active /
  Rejected / Suspended / Terminated); per-row actions: accept/decline a developer invite,
  terminate an active/suspended one, re-apply on a rejected/terminated one.
- **Organization Profile page** (SP1) — gains the marketing-profile fields: logo `about`,
  `areasServed`, `trackRecord`.
- The dashboard onboarding checklist's greyed-out "find developers to partner with" card
  becomes a **live link to Marketplace**.

### 7.3 Developer app (`DashboardLayout`)
Extend the existing **Channel Partners** area with tabs:
- **Partnership Requests** — incoming `pending` applications; approve (a form for
  `commissionTerms` + optional project restriction) / reject.
- **Active Partners** — active/suspended partnerships; suspend/resume/terminate.
- **Invites Sent** — developer-initiated invites and their status.
- **Find Partners** — browse the CP directory (filter by category / area) and invite (a
  dialog with message, `commissionTerms`, optional `projects`).

The existing developer-side CP registry view is unchanged.

### 7.4 Reused unchanged
Login / JWT auth, the org-type-switched app-shell, `ProtectedRoute`, the S3 file-upload
flow, SP2's `GET /api/portfolio/view/:organizationId` rendering, the `/api/notifications`
UI.

## 8. Legacy Role Cleanup (Decision 10)

The pre-platform CP module seeded three roles into **every developer org**: `Channel
Partner Manager`, `Channel Partner Admin`, `Channel Partner Agent` (distinct from the new
CP-org roles CP Owner/Manager/Agent). They are obsolete on the two-sided platform.

- Remove them from `data/defaultRoles.js` — new developer orgs no longer get them.
- `data/cleanupLegacyChannelPartnerRoles.js` (modelled on existing `data/backfill*`
  scripts) deletes the three legacy roles from every existing developer org. No real users
  are assigned to them (confirmed); the script still **reports** any role it finds with
  assigned users as a defensive check before deleting.

## 9. Scope Boundaries — Not in SP3

- **Cross-org lead creation & tracking** — a partnered CP creating/working leads for a
  developer → **SP4**.
- **The "partner access scope" enforcement** — a CP user actually *reading* a developer's
  leads/sales data → **SP4**. SP3 only establishes the `Partnership` records that scope
  will read.
- CP analytics & commission visibility → **SP5**; CP subscription & billing → **SP6**.
- Email notifications — none; in-app only.
- A truly-public, unauthenticated marketplace — out of scope; marketplace is platform-only,
  as SP2's portfolio visibility decided.

## 10. Edge Cases

| Case | Behaviour |
|---|---|
| Re-apply / re-invite after `rejected` or `terminated` | The same Partnership document is reopened to `pending`; `history[]` preserves all prior cycles. |
| Apply while at the 10-`pending` cap | Rejected with a clear message; developer-initiated invites are exempt from the cap. |
| Apply / invite when a `pending`/`active`/`suspended` Partnership already exists for the pair | 409 — a request already exists / already partnered. |
| Developer with no published portfolio | Absent from the marketplace; an apply targeting one is rejected (400). |
| Developer restricts `projects[]`, then later unpublishes/deletes one | `projects[]` stores refs; staleness is tolerated and resolved by the consumer (SP4). |
| A transition invalid for the current status or caller side | 409 / 403 with a clear message; the status never changes. |
| `approve` (or developer `invite`) without `commissionTerms` | Rejected (400) — terms are mandatory to reach `active`. |
| Counterparty org has no user holding the gating permission | The notification still has a recipient — the Org/CP Owner qualifies via owner-bypass. |
| Partnership `terminated`/`suspended` | The linked `ChannelPartner` shadow record is marked inactive, **not** deleted — historical attribution/commission is preserved. |
| Re-activation after terminate → re-apply → approve | Reconciliation is idempotent on the `channelPartnerOrg` link — no duplicate `ChannelPartner` record. |
| A CP user hitting a developer partnership route (or vice-versa) | Blocked — routes are org-type gated. |

## 11. Testing

- **Backend** — a regression suite `tests/regression/suites/27-cp-platform-sp3.test.js`
  (the repo's existing pattern): partnership create (CP apply + developer invite); the
  unique-pair / re-apply reuse; the pending cap; the full transition authorization matrix
  (a CP cannot approve its own application; a developer cannot accept on the CP's behalf;
  invalid-from-status transitions are rejected); marketplace & directory responses; the
  `ChannelPartner` reconciliation + commission seeding on activation; notification
  creation; unauthenticated and permission-gate rejections.
- **Frontend** — `CI=true npm run build` compiles clean; manual: a CP applies (with a
  message + attachment) → the developer approves with `commissionTerms` → the CP sees
  `Active` → terminate → re-apply; a developer invites a CP from the directory → the CP
  accepts; confirm notifications land on both sides.

## 12. File Summary

**Backend — create**
- `models/partnershipModel.js`
- `controllers/partnershipController.js`, `routes/partnershipRoutes.js`
- `controllers/marketplaceController.js`, `routes/marketplaceRoutes.js` (marketplace + CP directory)
- `services/partnershipService.js` (lifecycle transitions + `ChannelPartner` reconciliation)
- `data/backfillCpPartnershipsPermission.js`
- `data/cleanupLegacyChannelPartnerRoles.js`
- `tests/regression/suites/27-cp-platform-sp3.test.js`

**Backend — modify**
- `models/organizationModel.js` — `channelPartnerProfile` sub-document
- `models/channelPartnerModel.js` — `channelPartnerOrg` ref
- `config/permissions.js` — `cp_partnerships:*`
- `data/defaultChannelPartnerRoles.js` — assign `cp_partnerships:*`
- `data/defaultRoles.js` — remove the three legacy "Channel Partner *" roles
- `controllers/cpPortalController.js` / `routes/cpPortalRoutes.js` — CP marketing-profile
  fields on the org-profile endpoints
- `server.js` — mount `/api/partnerships`, `/api/marketplace`, `/api/directory`
- notification trigger points

**Frontend — create**
- the CP **Marketplace** page
- the CP **Partnerships** page
- the developer **Find Partners** + **Partnership Requests** views

**Frontend — modify**
- `src/services/api.js` — `marketplaceAPI`, `partnershipAPI`, `cpDirectoryAPI`
- the CP **Organization Profile** page — marketing-profile fields
- the developer **Channel Partners** area — the new tabs
- the CP portal nav — Marketplace + Partnerships
- the CP dashboard onboarding checklist — live Marketplace link

## 13. Decisions Locked (recap)

See §2. The eleven brainstorm decisions, plus the two confirmed design points: (A) the
`Partnership` is the agreed commission *contract* and seeds the existing `CommissionRule` /
`ChannelPartner` engine on activation — the engine still executes; (B) the legacy
"Channel Partner *" developer-org roles are deleted outright (no real users assigned).
