# Channel Partner Platform — SP1: CP Organizations & Onboarding

**Date:** 2026-05-21
**Status:** Approved for planning
**Repos:** `propvantage-ai-backend` (Node/Express/MongoDB), `propvantage-ai-frontend` (React 18 + MUI v5)

---

## 1. Context & Vision

PropVantage AI today is a **single-sided** product: real-estate developers are the
customers, and channel partners (CPs) exist only as registry records *inside* a
developer's account.

The vision is to make PropVantage a **two-sided platform**. Channel partners become a
second customer type — their own organizations, their own teams, their own portal, their
own subscription — and a **marketplace** connects the two sides. A CP runs all the
developers they work with from one place; a developer reaches a directory of partners.

This is a large initiative. It has been decomposed into **six sub-projects** (Section 2).
This spec covers **SP1** only, and additionally carries a shared **Target Architecture**
(Section 3) — the end-state design that constrains all six sub-projects so the early ones
do not box in the later ones.

## 2. Sub-Project Decomposition (Roadmap)

| # | Sub-project | Delivers | Depends on |
|---|---|---|---|
| **SP1** | **CP orgs & onboarding** *(this spec)* | Registration fork; CP `Organization` + owner; CP team invites with CP roles; CP portal shell + dashboard skeleton. Defines the two-sided data model. | — |
| SP2 | Developer public portfolio | Developer-side: curate which projects/details are public; a shareable, searchable portfolio. | — |
| SP3 | Marketplace & partnership lifecycle | CP searches developers; apply ↔ approve/reject; developer-initiated invites; notifications; partnership status views. | SP1 + SP2 |
| SP4 | Cross-org lead lifecycle | Partnered CP creates & tracks leads for a developer end-to-end; cross-org attribution. | SP3 |
| SP5 | CP analytics & commission visibility | Per-developer + holistic CP analytics. Re-points the existing CP analytics engine to the CP's own view. | SP4 |
| SP6 | CP subscription & billing | Monthly fee for CP orgs, mirroring developer billing. | SP1 |

Build order: SP1 → SP2 (may run alongside) → SP3 → SP4 → SP5; SP6 once monetization is
desired. Each sub-project gets its own detailed spec at its turn, every one constrained
by Section 3.

## 3. Target Architecture (End-State Across SP1–SP6)

Designed holistically up front; SP1 implements only its slice (Section 4).

### 3.1 Organizations
- `Organization.type` gains `'channel_partner'` alongside the existing `'builder'`.
- A `User` belongs to exactly one `Organization` (unchanged).
- A CP org reuses Organization's existing name/contact/address fields (`name` = the CP
  firm name) and adds `category` (4-category taxonomy) and `reraRegistrationNumber`.

### 3.2 Partnership — the central new model (built in SP3)
A `Partnership` document links one developer org and one CP org:
- `developerOrg` (ref Organization, type builder), `channelPartnerOrg` (ref Organization,
  type channel_partner).
- `status`: `pending | active | rejected | suspended | terminated`.
- `initiatedBy`: `channel_partner` (CP applied) | `developer` (developer invited).
- Decision audit: `requestedAt`, `decidedAt`, `decidedBy`, `history[]`.
- The developer projects the partnership covers.
- Unique per (developerOrg, channelPartnerOrg) pair.

### 3.3 The existing `ChannelPartner` registry becomes the developer-side shadow
The CP module shipped earlier (registry, attribution, commission, analytics) is **not**
discarded. The `ChannelPartner` record gains an optional `channelPartnerOrg` ref. When a
Partnership becomes `active`, the system ensures a linked `ChannelPartner` record exists
in the developer's org. Consequence: every existing engine — attribution, commission, the
analytics — keeps working unchanged as the developer-side machinery; the CP portal is a
new surface over the *same* data, joined via `channelPartnerOrg`. Legacy `ChannelPartner`
records with no org link continue to work as manually-managed records.

### 3.4 Cross-org leads (SP4)
A CP-created lead lives in the **developer's** organization (their pipeline), carrying the
existing `channelPartnerAttribution` sub-document. A CP "sees their leads" by joining
through `ChannelPartner.channelPartnerOrg` — the same join the CP analytics already
performs.

### 3.5 Scoping — the security-critical new dimension
Today every query is `organization`-scoped. A CP user gets two kinds of access:
- **(a) Own-org scoping** — normal `organization` scoping for the CP org's own data
  (team, profile, dashboard).
- **(b) Partnership-mediated access** — to developer-org data (leads/sales/commission),
  ONLY via an `active` Partnership and ONLY records attributed to their CP. CP users
  never receive raw `organization`-scoped access to a developer org.

Within a CP org: CP Owner and CP Manager see all of the CP org's data; CP Agent sees only
leads where they are the attributed agent (`channelPartnerAttribution.partners.agent`).
This "partner access scope" helper is *defined* here and *implemented* in SP4.

### 3.6 Permissions
- Developer orgs: the existing permission catalog, unchanged.
- CP orgs: a separate `cp_*` namespace, kept distinct so the two products' permission
  models do not tangle. Full end-state set: `cp_team:*`, `cp_org:*`, `cp_dashboard:view`,
  `cp_partnerships:*` (SP3), `cp_leads:*` (SP4), `cp_analytics:view` (SP5),
  `cp_billing:*` (SP6).

### 3.7 Frontend
One React app. At login, `organization.type` selects the app-shell: `builder` → the
existing `DashboardLayout`; `channel_partner` → a new `ChannelPartnerLayout`. Login,
auth, the invitation accept flow, `ProtectedRoute`, and routing infrastructure are shared.

## 4. SP1 Scope — What SP1 Builds

SP1 implements the foundation and a working CP onboarding experience. It builds **no
outward-facing features** (there are no developers to connect to until SP3).

In: registration fork, CP `Organization` + owner creation, CP role/permission seeds, CP
org profile, CP team management (via the existing invitation system), the CP portal shell
with a dashboard skeleton.

## 5. Data Model (SP1 Changes)

### 5.1 `Organization`
- Add `'channel_partner'` to the `type` enum.
- Add `category` — enum `individual_agent | broker_firm | corporate | digital_aggregator`.
  Required when `type === 'channel_partner'`; unused for builders.
- Add `reraRegistrationNumber` — String, normalized (trimmed, uppercased). Required when
  `type === 'channel_partner'` (see Section 9).
- **Partial unique index** on `reraRegistrationNumber` with
  `partialFilterExpression: { type: 'channel_partner' }` — so RERA numbers are unique
  among CP orgs and never collide with developer orgs.

### 5.2 CP role seed — `defaultChannelPartnerRoles`
A new seed module, parallel to the existing developer `defaultRoles`, producing three
`Role` documents in a CP org at creation:
- **CP Owner** — `isOwnerRole: true`, lowest `level`. All `cp_*` permissions.
- **CP Manager** — manages team, org profile, dashboard.
- **CP Agent** — dashboard + `cp_org:view`.

The `Role` model itself is unchanged (it is already per-org with `level` + `permissions[]`).

### 5.3 `cp_*` permissions — SP1 subset
Add to the permission catalog (CP namespace): `cp_team:view`, `cp_team:manage`,
`cp_org:view`, `cp_org:manage`, `cp_dashboard:view`. Assignment:
- CP Owner: all five.
- CP Manager: `cp_team:view`, `cp_team:manage`, `cp_org:view`, `cp_org:manage`, `cp_dashboard:view`.
- CP Agent: `cp_org:view`, `cp_dashboard:view`.

(SP1 grants Owner and Manager the same set; they diverge in later sub-projects — e.g.
billing is Owner-only in SP6.)

## 6. Registration Fork

### 6.1 Flow
- A pre-registration **choice screen**: "I'm a Developer" / "I'm a Channel Partner".
- The developer path is unchanged.
- The CP path shows a CP registration form: firm name, `category` (dropdown),
  `reraRegistrationNumber`, owner first/last name, owner email, password, primary
  contact (phone), and location/city.

### 6.2 Backend
The existing `registerUser` is generalised to accept an org `type`:
- `type: 'builder'` (or omitted) → current behaviour, unchanged.
- `type: 'channel_partner'` → validate RERA (Section 9) and email (Section 11); create the
  `Organization` with `type`, `category`, `reraRegistrationNumber`; seed the three CP
  roles via `defaultChannelPartnerRoles`; create the owner `User` and assign the **CP
  Owner** role; issue the JWT — mirroring the developer registration path.

## 7. CP Org Backend Endpoints

All require `protect`; all are restricted to users whose org `type` is `channel_partner`
and gated by the relevant `cp_*` permission.

- **Org profile** — `GET` (view) and `PUT` (update: firm name, category, primary
  contact, address/city). `reraRegistrationNumber` is **read-only** post-registration
  (Section 9). Gated by `cp_org:view` / `cp_org:manage`.
- **Team** — list members; invite a member (reuses the existing invitation system —
  generates a share link, with a CP role); change a member's role; deactivate a member.
  Gated by `cp_team:view` / `cp_team:manage`. Invitation role-hierarchy enforcement
  (inviter's `level` must outrank the invited role) applies via the CP role levels.

## 8. Frontend

### 8.1 Registration
- A pre-registration choice screen (Developer / Channel Partner).
- A CP registration form collecting the Section 6.1 fields; on submit it calls the
  generalised registration endpoint with `type: 'channel_partner'`.

### 8.2 CP portal shell
- New `ChannelPartnerLayout`. After login, the app reads `organization.type`:
  `channel_partner` → `ChannelPartnerLayout`; otherwise the existing developer layout.
  `AuthContext` must expose `organization.type`.
- SP1 CP navigation: **Dashboard · My Team · Organization Profile** (plus account/
  settings). Later nav items (marketplace, leads, analytics) arrive in their sub-projects.

### 8.3 Screens
- **Dashboard** — an onboarding-checklist landing: "complete your profile", "invite your
  team", and a greyed-out "find developers to partner with — coming soon". It is genuine
  onboarding guidance and fills in as later sub-projects land.
- **My Team** — list members (name, role, status); invite via share-link with a CP role;
  change a member's role; deactivate a member.
- **Organization Profile** — view/edit the CP org's details; `reraRegistrationNumber`
  shown read-only.

### 8.4 Reused unchanged
Login page, JWT auth, the invitation generate/verify/accept flow and its accept page,
`ProtectedRoute`, multi-tenancy `organization` scoping.

## 9. RERA Handling

- `reraRegistrationNumber` is **mandatory** for all CP registrations, across all four
  categories (individual agents register with RERA too). Registration rejects a
  missing/blank value.
- Normalized — trimmed and uppercased — before storage and before any comparison.
- **Uniqueness** — enforced by the partial unique index (Section 5.1). The registration
  endpoint additionally checks first and rejects a duplicate with a clear message:
  *"A channel partner account already exists for this RERA registration number."* The
  index is the hard backstop against a concurrent-registration race.
- RERA format is **not** strictly validated by regex (formats vary by state and a wrong
  regex would reject valid numbers); only non-empty after normalization is required.
- The field is **read-only after registration** — it is a legal-identity field. A
  correction is a separate admin action, out of SP1 scope.

## 10. Scope Boundaries — Not in SP1

The Partnership model, marketplace/search, developer public portfolio, cross-org lead
creation, CP analytics, and CP billing are later sub-projects. Also out of SP1: the rich
CP marketing profile (areas served, description, track record) → SP3; email delivery for
invitations (stays manual link-sharing, as today).

## 11. Edge Cases

| Case | Behaviour |
|---|---|
| Duplicate RERA number at registration | Rejected with a clear message; partial unique index is the backstop. |
| Missing/blank RERA at CP registration | Rejected — RERA is mandatory. |
| Email already registered anywhere on the platform | Registration rejected — login resolves by email, so a cross-org duplicate would be ambiguous. |
| Code paths assuming `type === 'builder'` | Audited (auth middleware, layout/routing, anything branching on org type) so a CP org never falls into a developer-only path. |
| CP user hitting a developer route/endpoint | Blocked; the CP shell exposes no developer navigation, and CP-org endpoints reject non-CP orgs. |
| A CP org with only its owner, no team | Fully valid. |
| CP Manager inviting a CP Owner | Rejected — invitation role-hierarchy enforcement via role `level`. |

## 12. Testing

- **Backend** — regression-style endpoint tests (the repo's existing pattern, e.g.
  `tests/regression/suites/`): CP registration creates the org with correct `type`,
  `category`, `reraRegistrationNumber`, the three seeded CP roles, and the owner;
  duplicate-RERA, missing-RERA, and duplicate-email registrations are all rejected;
  developer registration is unaffected (regression).
- **Frontend** — `CI=true npm run build` compiles clean; manual verification: register a
  CP org → land on the CP shell → invite a Manager and an Agent → accept both invites →
  each lands in the CP shell with the correct role; a developer login still gets the
  developer shell.

## 13. Decisions Locked (During Brainstorming)

| Decision | Choice |
|---|---|
| CP is its own org | Yes — `Organization.type = 'channel_partner'` |
| CP sub-type | The 4-category taxonomy (individual_agent / broker_firm / corporate / digital_aggregator), profile-only |
| CP team roles | CP Owner / CP Manager / CP Agent |
| Portal delivery | One codebase, org-type-switched app-shell (Approach A) |
| RERA | Mandatory at registration, normalized, unique among CP orgs, read-only afterward |
| Up-front prep | Holistic Target Architecture now (Section 3) + detailed specs per sub-project |
