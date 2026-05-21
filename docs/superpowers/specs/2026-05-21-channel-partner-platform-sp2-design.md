# Channel Partner Platform — SP2: Developer Public Portfolio

**Date:** 2026-05-21
**Status:** Approved for planning
**Repos:** `propvantage-ai-backend` (Node/Express/MongoDB), `propvantage-ai-frontend` (React 18 + MUI v5)

---

## 1. Context

PropVantage AI is becoming a two-sided platform (developers ⇄ channel partners). This is
**SP2** of the six-sub-project roadmap defined in the SP1 spec
(`2026-05-21-channel-partner-platform-sp1-design.md`, §2–§3 — the roadmap and the shared
Target Architecture, which still governs).

**SP2 — Developer Public Portfolio.** A developer curates which of their projects (and
which details) are visible to channel partners, and assembles a public-facing
**portfolio**: their org profile plus a showcase of published projects. SP2 produces the
developer-side curation and a **preview**; the channel-partner-facing marketplace search
that consumes these portfolios is **SP3**.

**SP2 deliverable:** a developer can publish projects to a portfolio, control what each
shows, fill in a public org profile, and preview the portfolio exactly as a channel
partner will see it.

## 2. Decisions Locked (during brainstorming)

| Decision | Choice |
|---|---|
| Curation granularity | A publish toggle per project + a few section toggles (not per-field) |
| Section toggles | `showPriceRange`, `showConfigurations` |
| Inventory depth | Configuration-level summary (per type: available count, size range, price range) — not per-unit |
| Visibility | Platform-only — visible to logged-in platform users; no anonymous public page (deferred) |
| Architecture | Approach A — computed view; no separate collection |
| Images | One cover image per project + an org logo; multi-image gallery deferred |

## 3. Data Model

### 3.1 `Project` — `portfolio` sub-document
Add to `models/projectModel.js`:
```js
portfolio: {
  isPublished:        { type: Boolean, default: false },
  showPriceRange:     { type: Boolean, default: true },
  showConfigurations: { type: Boolean, default: true },
  coverImageUrl:      { type: String,  default: null },
}
```

### 3.2 `Organization` — `portfolioProfile` sub-document
Add to `models/organizationModel.js` (used by `type: 'builder'` orgs):
```js
portfolioProfile: {
  logoUrl: { type: String, default: null },
  about:   { type: String, default: '' },
}
```
The public contact reuses the existing `contactInfo` (`phone`, `website`, `address`) — no
duplication.

### 3.3 Permission
Add `portfolio:manage` to `config/permissions.js` (in the developer `PERMISSIONS`
catalog — a new group `PORTFOLIO: { MANAGE: 'portfolio:manage' }`). Add it to the default
developer roles that own this — **Business Head, Project Director, Marketing Head** — in
`data/defaultRoles.js`. The Organization Owner gets it via the existing owner-bypass.

Existing developer orgs' seeded role documents predate this permission, so SP2 includes a
one-time backfill (§7).

## 4. Backend — the Computed Portfolio

### 4.1 `services/portfolioService.js` (new)
`getDeveloperPortfolio(organizationId)` assembles and returns:
```
{
  profile:  { name, logoUrl, about, city, contact: { phone, website, address } },
  projects: [ curatedProject, … ]
}
```
- `profile` ← the `Organization` document (`name`, `portfolioProfile.logoUrl`,
  `portfolioProfile.about`, `city`, `contactInfo`).
- `projects` ← that org's `Project` documents where `portfolio.isPublished === true`,
  each passed through a **strict allow-list projection** (`curatedProject`):
  - **Always:** `id, name, type, status, location { city, area }, description,
    amenities, reraNumber` (from `approvals.rera.number`), `expectedCompletionDate,
    totalUnits, coverImageUrl`.
  - **If `portfolio.showPriceRange`:** `priceRange { min, max }`.
  - **If `portfolio.showConfigurations`:** `configurationSummary` — a `Unit` aggregation:
    match the project's units with `status: 'available'`, group by `type` →
    `[{ type, availableCount, sizeRange { min, max }, priceRange { min, max } }]`
    (`sizeRange` from `areaSqft`, `priceRange` from `currentPrice`).
- The projection is **allow-list**: internal fields (`targetRevenue`, `budgetTracking`,
  `pricingRules`, `additionalCharges`, `paymentConfiguration`, competitive data, internal
  approvals beyond the RERA number) are never emitted.

### 4.2 `controllers/portfolioController.js` + `routes/portfolioRoutes.js` (new)
Mounted at `/api/portfolio`; all routes behind `protect`.

| Method | Path | Gate | Behaviour |
|---|---|---|---|
| GET | `/api/portfolio/profile` | `protect` | The caller's own org public profile (`portfolioProfile` + `contactInfo`). |
| PUT | `/api/portfolio/profile` | `hasPermission(portfolio:manage)` | Update `portfolioProfile` (`logoUrl`, `about`) and `contactInfo`. |
| PUT | `/api/portfolio/projects/:id` | `hasPermission(portfolio:manage)` | Set a project's `portfolio` settings (`isPublished`, `showPriceRange`, `showConfigurations`, `coverImageUrl`). Org-scoped — the project must belong to the caller's organization, else 404. |
| GET | `/api/portfolio/view/:organizationId` | `protect` | The computed portfolio for any developer org (via `getDeveloperPortfolio`). Any logged-in platform user may view (the "platform-only" visibility decision). 404 if the org is missing or not a builder org. |

The `/view/:organizationId` path segment is deliberately distinct so it cannot collide
with the literal `/profile` and `/projects/:id` routes.

## 5. Frontend (Developer Side)

### 5.1 API client
Add `portfolioAPI` to `src/services/api.js`: `getProfile()`, `updateProfile(data)`,
`updateProjectPortfolio(projectId, data)`, `getPortfolio(organizationId)`.

### 5.2 Project-level curation
A **"Portfolio" card** on the existing Project Detail page: the publish toggle, the two
section toggles, and a cover-image upload. The cover image uploads through the existing
S3 file system; the returned URL is saved via `PUT /api/portfolio/projects/:id`. The card
includes a link to the Preview page.

### 5.3 Public Profile page (new)
A developer-facing editor for the org's `portfolioProfile`: logo upload (existing file
system) + an "about" text area, plus the public contact (`contactInfo`) fields. Saves via
`PUT /api/portfolio/profile`.

### 5.4 Portfolio Preview page (new)
Calls `GET /api/portfolio/view/{ownOrgId}` and renders the computed portfolio exactly as a
channel partner will see it: an org header (logo, name, about, contact) above a grid of
published-project cards — each showing cover image, name, type, status, location,
amenities, RERA number, and, when enabled, price range + configuration summary. An empty
state when nothing is published ("Publish a project to build your portfolio").

### 5.5 Navigation
A **"Portfolio"** nav group in the developer app shell with two items — *Public Profile*
and *Preview* — gated by `portfolio:manage` (the Organization Owner sees it via
owner-bypass).

Reused unchanged: the developer `DashboardLayout`, auth, the file-upload flow, the Project
Detail page shell.

## 6. Scope Boundaries — Not in SP2

The CP-facing marketplace search & discovery and the partnership apply/approve flow are
**SP3**. The truly-public, unauthenticated, shareable portfolio link is deferred (per the
visibility decision). A multi-image project gallery is deferred — SP2 has one cover image
per project. Detailed per-unit inventory exposure is post-partnership (**SP4**) — SP2
shows the configuration-level summary only.

## 7. Edge Cases

| Case | Behaviour |
|---|---|
| Project never published | Absent from the portfolio. |
| Published, `showConfigurations: false` | No `configurationSummary` in the output. |
| Published, `showPriceRange: false` | No `priceRange` in the output. |
| Published project with zero available units | `configurationSummary` is `[]`; the preview shows "no current availability" gracefully. |
| Org profile empty (no logo / no about) | Portfolio still renders (name + projects); the header degrades gracefully. |
| Future new internal field on `Project` | Stays hidden — the projection is allow-list, not deny-list. |
| `GET /view/:organizationId` for a missing or non-builder org | 404. |
| `portfolio:manage` on existing developer orgs | Only newly-registered orgs get it on seeded non-owner roles. SP2 includes a one-time backfill script `data/backfillPortfolioPermission.js` (modelled on existing `data/backfill*` scripts) that adds `portfolio:manage` to existing Business Head / Project Director / Marketing Head role documents. Until run, existing orgs rely on the Owner. |

## 8. Testing

- **Backend** — a regression suite (`tests/regression/suites/` pattern): the
  `/api/portfolio/*` routes reject unauthenticated requests; `PUT
  /api/portfolio/projects/:id` is permission-gated; the `/view/:organizationId` read
  returns **only** allow-listed fields — assert internal fields (`targetRevenue`,
  `budgetTracking`, `pricingRules`) are absent; an unpublished project does not appear.
- **Frontend** — `CI=true npm run build` compiles clean; manual: publish a project, set
  the toggles, upload a cover image + org logo, open the Preview and confirm the curated
  view; confirm an unpublished project is absent and that toggling off "price range"
  hides it.

## 9. File Summary

**Backend — create**
- `services/portfolioService.js`
- `controllers/portfolioController.js`
- `routes/portfolioRoutes.js`
- `data/backfillPortfolioPermission.js`
- Regression suite under `tests/regression/suites/`

**Backend — modify**
- `models/projectModel.js` — `portfolio` sub-document
- `models/organizationModel.js` — `portfolioProfile` sub-document
- `config/permissions.js` — `PORTFOLIO.MANAGE` permission
- `data/defaultRoles.js` — `portfolio:manage` on Business Head / Project Director / Marketing Head
- the app entrypoint — mount `/api/portfolio`

**Frontend — create**
- the Public Profile page
- the Portfolio Preview page

**Frontend — modify**
- `src/services/api.js` — `portfolioAPI`
- the Project Detail page — the "Portfolio" curation card
- the developer app shell — the "Portfolio" nav group
