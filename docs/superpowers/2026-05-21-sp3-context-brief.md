# SP3 Context Brief — Marketplace & Partnership Lifecycle

> **Purpose of this document.** This is a handoff brief so a fresh conversation can pick
> up **SP3** of the Channel Partner platform. It is **not a spec** — SP3 still needs its
> own full cycle: `superpowers:brainstorming` → write spec → `superpowers:writing-plans`
> → `superpowers:subagent-driven-development`. This brief tells you the territory: what
> SP3 must cover, what is already fixed by earlier decisions, and what is still open for
> SP3's brainstorm to decide with the user.

---

## 1. The big picture

PropVantage AI is becoming a **two-sided platform**. Originally single-sided (real-estate
**developers** are the customers; channel partners were just records inside a developer's
account). The platform now also has **channel partner (CP) organizations** as a second
customer type, and a **marketplace** connects the two sides.

The whole initiative was decomposed into **six sub-projects**:

| # | Sub-project | Status |
|---|---|---|
| SP1 | CP organizations & onboarding | ✅ Shipped |
| SP2 | Developer public portfolio | ✅ Shipped |
| **SP3** | **Marketplace & partnership lifecycle** | **← this brief** |
| SP4 | Cross-org lead lifecycle | Not started |
| SP5 | CP analytics & commission visibility | Not started |
| SP6 | CP subscription & billing | Not started |

SP3 depends on SP1 + SP2 and is the **pivotal** one — it is where the two sides actually
connect. SP4 (a partnered CP creating leads for a developer) depends on SP3.

## 2. Read these first

- **`docs/superpowers/specs/2026-05-21-channel-partner-platform-sp1-design.md`** — the
  SP1 spec. **§2 is the 6-SP roadmap; §3 is the shared "Target Architecture" that governs
  all six sub-projects, including SP3.** SP3 MUST honor §3. Read §3 carefully.
- **`docs/superpowers/specs/2026-05-21-channel-partner-platform-sp2-design.md`** — the
  SP2 spec (developer public portfolio — the content the marketplace surfaces).
- The SP1/SP2 implementation plans (`docs/superpowers/plans/2026-05-21-channel-partner-platform-sp1.md`, `...-sp2.md`) show what was actually built.

## 3. What is already built (the foundation SP3 builds on)

**From SP1 — CP organizations exist:**
- `Organization.type` is `'builder'` (developer) or `'channel_partner'` (CP).
- A CP org has `category` (`individual_agent | broker_firm | corporate | digital_aggregator`)
  and a unique `reraRegistrationNumber`.
- CP orgs have their own seeded roles — **CP Owner / CP Manager / CP Agent** — and a
  separate `cp_*` permission namespace.
- A CP portal exists (org-type-switched app shell, `/partner/*` routes): CP dashboard,
  team management, org profile. Backend endpoints under `/api/cp/*`.
- CP registration is a fork of `registerUser`; the CP portal is gated by a
  `requireOrgType('channel_partner')` middleware.

**From SP2 — developer portfolios exist:**
- `Project.portfolio` sub-document `{ isPublished, showPriceRange, showConfigurations,
  coverImageUrl }` — a developer curates which projects are public.
- `Organization.portfolioProfile` `{ logoUrl, about }` — the developer's public profile.
- `services/portfolioService.js` → `getDeveloperPortfolio(organizationId)` computes a
  curated portfolio (org profile + published projects + a live per-configuration unit
  summary) behind a strict allow-list projection.
- `GET /api/portfolio/view/:organizationId` returns a developer's computed portfolio to
  any logged-in platform user. **This is the content SP3's marketplace search surfaces.**
- A `portfolio:manage` permission gates curation.

## 4. SP3's mission

Build the **marketplace and the partnership lifecycle** — the connective layer that lets
a channel partner and a developer form a working relationship on the platform.

The user's own description of this experience (verbatim intent):
- A CP can **search for developers** and see their public project details (what SP2's
  portfolio exposes).
- A CP can **apply to become a channel partner with a particular developer**; that
  request goes to that developer organization's leadership to **approve or reject**.
- If approved, it becomes visible on the CP's portal — there is a section showing
  everything **pending / rejected / accepted**.
- **Two-way:** a developer can also **add/invite a channel partner** from the directory
  of CPs already on the platform; the CP gets a **notification** and can then start
  seeing the developer's details.
- Once a CP is onboarded/accepted for a developer, they can start creating leads for that
  developer (— that lead-creation step is **SP4**, not SP3).

## 5. What SP3 must cover (scope)

1. **The `Partnership` model — the central new model.** Its shape is *already specified*
   in the SP1 Target Architecture §3.2:
   - `developerOrg` (ref Organization, type builder), `channelPartnerOrg` (ref
     Organization, type channel_partner).
   - `status`: `pending | active | rejected | suspended | terminated`.
   - `initiatedBy`: `channel_partner` (CP applied) | `developer` (developer invited).
   - Decision audit: `requestedAt`, `decidedAt`, `decidedBy`, `history[]`.
   - The developer projects the partnership covers.
   - Unique per `(developerOrg, channelPartnerOrg)` pair.

2. **Marketplace / discovery (CP side).** A CP browses/searches developers and their
   public portfolios (reusing SP2's `portfolioService` / `/api/portfolio/view`). A CP
   opens a developer's portfolio and can initiate an application from there.

3. **The application flow (CP → developer).** A CP applies to partner with a developer →
   a `Partnership` is created in `pending` state, `initiatedBy: 'channel_partner'`.

4. **Developer-side approval.** The pending request is surfaced to the developer org's
   **leadership**; they approve (→ `active`) or reject (→ `rejected`).

5. **Developer-initiated invites (developer → CP).** A developer browses the directory of
   CP orgs on the platform and invites one → a `Partnership` in `pending`,
   `initiatedBy: 'developer'`. The CP sees it and accepts/declines.

6. **Notifications.** Both sides are notified of new requests and of decisions. (An
   in-app notification system already exists — `/api/notifications`, a `Notification`
   model — SP3 should reuse it, not build a new one.)

7. **Status views on both portals.** The CP portal gets a "Partnerships" / "Developers"
   section (pending / active / rejected). The developer app gets a "Channel Partners" /
   "Partnership Requests" view (incoming applications, active partners, invites sent).

8. **`ChannelPartner`-record reconciliation (SP1 Target Architecture §3.3 — important).**
   The existing developer-side `ChannelPartner` registry model is the engine behind
   attribution, commission, and the analytics already shipped. SP3 must add an optional
   `channelPartnerOrg` ref to the `ChannelPartner` model, and **when a Partnership becomes
   `active`, ensure a linked `ChannelPartner` record exists in the developer's org**. This
   is what keeps every existing engine working — and is what SP4's cross-org leads will
   hang off. Do NOT discard or rewrite the `ChannelPartner` module.

## 6. Architectural constraints (fixed — do not re-decide these)

From the SP1 Target Architecture (SP1 spec §3) — SP3 must honor all of it:
- The `Partnership` model shape (§5.1 above) is the agreed end-state design.
- The `ChannelPartner` registry stays as the developer-side shadow of a partnership,
  linked via `channelPartnerOrg`. The existing attribution/commission/analytics machinery
  must keep working unchanged.
- **Scoping is security-critical.** A CP user gets (a) normal `organization`-scoping for
  their own CP org, and (b) **partnership-mediated** access to a developer's data — only
  via an `active` Partnership. A CP user must never get raw access to a developer org.
  SP3 establishes the partnership records that SP4's "partner access scope" will read.
- Permissions: developer orgs use the existing catalog; CP orgs use the `cp_*` namespace.
  SP3 will add partnership permissions — `cp_partnerships:*` on the CP side, and something
  appropriate on the developer side.
- One React app; org-type-switched shell (developer `DashboardLayout` vs the CP portal
  shell). Backend is one shared database (partnerships link the two org types).

## 7. Open questions — for SP3's brainstorm to decide with the user

These are NOT decided. The brainstorm must resolve them:
- **Marketplace search dimensions** — filter developers by city / project type / price
  band / something else? How rich is search in SP3 vs. later?
- **Who approves on the developer side** — exactly which developer roles can approve a
  partnership request (Org Owner, Business Head, Sales Head, …)? A new permission?
- **Partnership scope** — does a partnership cover *all* of a developer's projects, or a
  selected subset? The `Partnership` model has "projects it covers" — is that set at
  approval, editable later, or simply "all published"?
- **Application content** — does a CP attach a message/pitch when applying? Any documents?
- **Lifecycle transitions** — can either side `suspend` or `terminate` an `active`
  partnership? Can a `rejected` CP re-apply? Cooldowns?
- **Notifications** — confirm reuse of the existing `/api/notifications` system; in-app
  only (the platform has no email integration).
- **Spam / rate control** — should there be a limit on how many developers a CP can apply
  to, or pending-application caps?
- **Commission terms** — are commission terms agreed at partnership time, or left to the
  existing `CommissionRule` mechanism? (Likely out of SP3 — flag and probably defer — but
  confirm with the user.)
- **The legacy seeded "Channel Partner *" roles** inside developer orgs (from the
  pre-platform era) — do they need cleanup? (Probably out of scope; note it.)

## 8. What SP3 does NOT cover

- **Cross-org lead creation & tracking** — a partnered CP creating/working leads for a
  developer → **SP4**.
- **CP analytics & commission visibility** → **SP5**.
- **CP subscription & billing** → **SP6**.
- SP3 ends at: a partnership exists and is `active`. SP4 is what makes an active
  partnership *do* something.

## 9. Process

Treat SP3 like SP1 and SP2:
1. `superpowers:brainstorming` — resolve the §7 open questions one at a time, propose
   approaches, present the design in sections, get approval.
2. Write the spec to `docs/superpowers/specs/2026-05-21-channel-partner-platform-sp3-design.md`.
3. `superpowers:writing-plans` — a task-by-task implementation plan.
4. `superpowers:subagent-driven-development` — execute it.

Both repos (`propvantage-ai-backend`, `propvantage-ai-frontend`) are on `main`; the user
has been authorizing direct commits to `main` and explicit pushes per feature this
session. Backend deploys via GitHub Actions → EC2; frontend via Vercel.
