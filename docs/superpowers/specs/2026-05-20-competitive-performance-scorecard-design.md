# Competitive Performance Scorecard — Design Spec

**Date:** 2026-05-20
**Status:** Approved (design phase)
**Repos affected:** `propvantage-ai-backend`, `propvantage-ai-frontend`

## Problem

A real estate promoter wants one screen that answers: *"How is my project
performing against the market and my competitors?"* Today the Competitive
Analysis section has competitor records, market-overview aggregates, and AI
research — but nothing that puts a promoter's own project at the centre and
benchmarks it. The promoter has to assemble the picture manually across
pricing, sales, inventory, and competitor pages.

## Goals

- A project-centric **Competitive Performance Scorecard**: pick a project,
  see how it stacks up against the market and named competitors.
- Five benchmark pillars — Pricing, Velocity, Inventory, Positioning, Demand —
  plus a competitor leaderboard, in a polished, card-driven layout.
- A web-researched **market demand** signal, carrying an explicit confidence
  score and cited sources, mapped against competing and own supply.
- An AI "where you stand + recommendations" verdict.
- Charts render instantly from verified data; AI content streams in after.

## Non-goals

- **Competitor sales velocity / absorption.** Competitors do not publish sold
  counts. The scorecard never invents them — competitor data is limited to
  verifiable facts (status, scale, possession timeline).
- A new shared tab shell for the Competitive Analysis section — it uses flat
  routes; this feature adds one more page in the same style.
- Editing or writing back any benchmark data — the scorecard is read-only.

## Approach

Carried forward from the design discussion (Approach A):

- **One synchronous endpoint** computes the five real-data pillars plus the
  leaderboard via DB aggregation. It is all fast indexed queries — no reason
  to make it async.
- **The AI content** (verdict, recommendations, and the market-demand web
  research) reuses the existing async-polling pattern (`activeJobs` Map +
  `CompetitiveAnalysis` cache) already used by `getAnalysis`, via a new
  analysis `type`. The frontend renders charts immediately and polls for the
  AI block separately.

Rejected: a single async job assembling everything (couples the instant
charts to a ~30s AI wait); real-data-only with no AI (drops the verdict and
the confidence-scored demand read the promoter asked for).

## Design

### 1. Where it lives

A new frontend page at:

- `/competitive-analysis/scorecard` — project picker, no project chosen yet.
- `/competitive-analysis/scorecard/:projectId` — the scorecard for a project.

Registered as a flat route in `App.js` alongside the other competitive-analysis
pages, wrapped in `ProtectedRoute` (`compAnalysisView()`) + `DashboardLayout`.
Linked from `CADashboardPage`.

### 2. Scorecard endpoint (synchronous, verified data)

`GET /api/competitive-analysis/scorecard/:projectId`
Auth: `protect` + `PERMISSIONS.COMPETITIVE_ANALYSIS.VIEW`. Org-scoped — the
project must belong to `req.user.organization`.

It resolves the project's locality (`project.location.city` + `.area`) and
computes five pillars plus a leaderboard. Response shape:

```jsonc
{
  "project": { "id", "name", "city", "area", "status", "totalUnits", "targetRevenue" },

  "pricing": {
    "yourAvgPsf": Number,                 // avg of Unit.currentPrice / Unit.areaSqft
    "market": { "min","p25","median","p75","max","avg" },  // competitor ₹/sqft distribution
    "yourPercentile": Number,             // where yourAvgPsf falls in the market distribution
    "premiumDiscountPct": Number,         // (yourAvgPsf - market.avg) / market.avg * 100
    "byUnitType": [
      { "unitType", "yourPsf", "marketPsf": { "min","avg","max" }, "deltaPct" }
    ],
    "competitorCount": Number
  },

  "velocity": {
    "totalUnits": Number,
    "soldUnits": Number,                  // Unit.status in ['sold','booked']
    "availableUnits": Number,
    "percentSold": Number,
    "monthsActive": Number,               // months since earliest non-cancelled Sale.bookingDate
    "unitsPerMonth": Number,              // soldUnits / monthsActive
    "revenueAchieved": Number,            // sum Sale.salePrice, status != 'Cancelled'
    "targetRevenue": Number,
    "revenuePercent": Number,
    "projectedSelloutDate": String|null   // now + (availableUnits / unitsPerMonth) months
  },

  "inventory": {
    "yourUnsoldByType": [{ "unitType", "count" }],
    "competingSupplyByType": [{ "unitType", "totalCount", "availableCount" }],
    "monthsOfInventory": Number|null      // availableUnits / unitsPerMonth
  },

  "positioning": {
    "your": { "status", "totalUnits" },
    "competitors": [
      { "name", "projectStatus", "possession": String|null, "totalUnits" }
    ]
  },

  "demand": {
    "yourLeads": {
      "total": Number,
      "last30d": Number,
      "trend": [{ "month": "YYYY-MM", "count" }],   // last 6 months
      "qualityMix": [{ "grade", "count" }]          // by Lead.scoreGrade
    }
    // market demand is delivered by the async AI block, not here
  },

  "leaderboard": [
    { "competitorId", "name", "developer", "avgPsf",
      "deltaPsfPct", "projectStatus", "threatRank" }
  ],

  "meta": { "hasCompetitorData": Boolean, "locality": "Area, City", "generatedAt" }
}
```

**Pillar computations — all from confirmed-present fields:**

- **Pricing** — your ₹/sqft is the mean of `Unit.currentPrice / Unit.areaSqft`
  over the project's units (per unit type for `byUnitType`). The market
  distribution is built from `CompetitorProject.pricing.pricePerSqft.avg` for
  every active competitor in the locality; `yourPercentile` is the project's
  rank within that set.
- **Velocity** — `soldUnits` from `Unit.status`; `revenueAchieved` and
  `monthsActive` from `Sale` records (excluding `status: 'Cancelled'`);
  `targetRevenue` from `Project.targetRevenue`.
- **Inventory** — your unsold units grouped by `Unit.type`; competing supply
  aggregated from `CompetitorProject.unitMix[]` (`totalCount` / `availableCount`)
  across the locality.
- **Positioning** — `Project.status` / `totalUnits` vs each competitor's
  `projectStatus`, `possessionTimeline`, `totalUnits`. Verifiable facts only.
- **Demand (own side)** — `Lead` records scoped to the project: total,
  trailing-30-day count, 6-month inflow trend, quality mix by `scoreGrade`.
- **Leaderboard** — active competitors in the locality, ranked by pricing
  proximity to the project (closest ₹/sqft = highest threat).

### 3. AI analysis block (async, polling)

Reuses `getAnalysis` (`GET /api/competitive-analysis/analysis/:projectId`)
with a new `type=performance_scorecard`. This inherits the existing
`activeJobs` Map, the 202-processing / 200-completed polling contract, and the
`CompetitiveAnalysis` DB cache with no new plumbing.

The job runs two steps (mirroring `aiResearchService.js`):

1. **Web search** (`gpt-4o-search-preview`) — research the micro-market's
   demand and absorption: consultancy absorption reports (Anarock, Knight
   Frank, JLL), RERA registration trends, and credible news for the project's
   city + area.
2. **Synthesis** (`claude-sonnet-4-6`) — produce structured JSON.

Result shape (cached in `CompetitiveAnalysis`, returned on poll completion):

```jsonc
{
  "verdict": "string — one-line where-you-stand summary",
  "recommendations": ["string", "string", "string"],
  "marketDemand": {
    "signal": "strong | moderate | soft | unclear",
    "confidence": 0-100,
    "confidenceLabel": "Low | Medium | High",
    "summary": "2-3 sentences on micro-market absorption/demand",
    "sources": [{ "url": "string", "title": "string" }]
  }
}
```

### 4. Confidence model

The `marketDemand.confidence` is a 0–100 score the synthesis model assigns,
under explicit instructions to score **conservatively**:

- **High (70–100)** — backed by named consultancy absorption data or RERA
  registration figures specific to the city/micro-market.
- **Medium (40–69)** — credible but indirect: city-level commentary, dated
  reports, or adjacent-locality data.
- **Low (0–39)** — only general market commentary, or little found.

`confidenceLabel` is derived from the score by the same thresholds. The UI
always shows the label, the score, and the source list next to the market
demand read — the demand signal is never presented as fact without it.

### 5. Frontend

New page `src/pages/competitive-analysis/CompetitivePerformancePage.js`:

- A project picker (Autocomplete over the org's projects).
- On select → `GET .../scorecard/:projectId`; render the five pillar cards +
  leaderboard immediately from the response.
- In parallel → poll `GET .../analysis/:projectId?type=performance_scorecard`;
  while processing, the verdict banner and the market-demand half of the
  Demand card show a "Analysing…" state; on completion they populate.
- **Demand card** maps market demand vs supply: the AI market-demand signal
  (with its confidence chip + sources) alongside competing supply, your
  unsold inventory, and your lead inflow — a supply/demand balance read.
- **Leaderboard** rows link to the existing `CompetitorDetailPage`
  (`/competitive-analysis/competitors/:id`).
- Card visual language matches the infographic reference: chips, percentile
  bars, small donuts/bars (the section already uses a charting library).

A new `competitiveAnalysisAPI.getScorecard(projectId)` method is added to the
frontend API client.

### 6. Graceful degradation

- **No competitors in the locality** (`meta.hasCompetitorData === false`) —
  Pricing/Inventory/Positioning/Leaderboard show your own-side data and a
  prompt to add competitors or run AI research. Velocity and own-side Demand
  are unaffected.
- **No sales yet** — Velocity shows inventory counts; `unitsPerMonth`,
  `projectedSelloutDate`, and `monthsOfInventory` are `null` and the card
  renders "No sales recorded yet" rather than dividing by zero.
- **AI block fails or times out** — the verdict banner and market-demand panel
  show an error with a retry; all verified charts remain fully usable.

### 7. Error handling

- The scorecard endpoint validates the project exists and is org-scoped (404
  otherwise) and runs `verifyProjectAccess`.
- The AI job is wrapped so a failure is reported through the existing
  `activeJobs` failed-status path; it never crashes the process.
- Division-by-zero guards on every rate/percentage (zero units, zero sales,
  zero competitors).

## Data sources

| Pillar | Models used | Confirmed |
|---|---|---|
| Pricing | `Unit` (currentPrice, areaSqft, type), `CompetitorProject.pricing` | yes |
| Velocity | `Unit.status`, `Sale` (salePrice, bookingDate, status), `Project.targetRevenue` | yes |
| Inventory | `Unit` (type, status), `CompetitorProject.unitMix` | yes |
| Positioning | `Project` (status, totalUnits), `CompetitorProject` (projectStatus, possessionTimeline, totalUnits) | yes |
| Demand (own) | `Lead` (project, scoreGrade, createdAt) | yes |
| Demand (market) | AI web research (`gpt-4o-search-preview` + `claude-sonnet-4-6`) | new |
| Leaderboard | `CompetitorProject` | yes |

## Testing

- Backend smoke test `tests/testCompetitiveScorecard.js` (mirroring
  `tests/testCompetitiveAnalysis.js`): authenticate, pick a project, call the
  scorecard endpoint, assert the five pillars and leaderboard are present and
  numerically sane; call the AI analysis endpoint and poll to completion,
  asserting `verdict` and `marketDemand.confidence` are present.
- Manual UI pass: load the scorecard for a project with competitors and one
  without; confirm graceful degradation, the AI block streaming in, the
  confidence chip + sources on market demand, and leaderboard drill-in.

## Out of scope / future

- Competitor sales velocity (not public — verifiable facts only).
- Historical scorecard trends / snapshots over time.
- Exporting the scorecard as a PDF/share link.
- Writing the AI market-demand read back onto any persistent market model.
