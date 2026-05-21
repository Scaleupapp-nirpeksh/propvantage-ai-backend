# Channel Partner Analytics — Design Spec

**Date:** 2026-05-21
**Status:** Approved for planning
**Repos:** `propvantage-ai-backend` (Node/Express/MongoDB), `propvantage-ai-frontend` (React 18 + MUI v5)

---

## 1. Problem

The Analytics section of PropVantage AI surfaces zero Channel Partner (CP) data. Its
controllers (`analyticsController.js`) aggregate only `Sale` / `Lead` / `Unit` and never
reference `channelPartnerAttribution` or commission. CP analytics exist only inside the
separate operational CP dashboard (`/channel-partners/dashboard`). As a result a company
leader looking at Analytics cannot see how much revenue, how many leads, or how much
commission flowed through channel partners.

This spec adds CP visibility into the existing Analytics pages, broken out by individual
partner firm **and** by a new partner category.

## 2. Goal

Within the existing Analytics pages, show:
- Direct-vs-CP split of sales revenue and leads.
- A breakdown by partner **category** and by individual partner **firm**.
- Commission given, payment status, and top performers (gated — financial data).
- A promoter-grade KPI: effective commission rate (commission ÷ CP-sourced revenue).

Additionally, make all of the above answerable through the AI copilot chat, so a user
can ask Channel Partner questions in natural language (see Section 10).

## 3. Decisions (locked during brainstorming)

| Decision | Choice |
|---|---|
| Grouping | Both — per-firm detail **and** category roll-up |
| Category taxonomy | 4 fixed values: Broker Firm, Individual Agent, Corporate, Digital Aggregator |
| Placement | Split across existing pages — Sales Analytics, Lead Analytics, Analytics Overview |
| Visibility | Lead/revenue counts open to all Analytics users; commission & payment data gated by `CHANNEL_PARTNERS.VIEW` |
| Backend approach | Approach A — dedicated CP-analytics endpoints + a shared aggregation service |
| AI copilot | Two new copilot tools that reuse the same aggregation service (Section 10) |

## 4. Non-goals

- No changes to the existing operational CP dashboard (`/channel-partners/dashboard`).
- No CP analytics trend-over-time chart (snapshots for the selected period only).
- No org-configurable category taxonomy — the 4 categories are a fixed enum.
- No new top-level Analytics nav page — CP content is embedded in existing pages.

---

## 5. Data Model Change

### 5.1 `ChannelPartner.category`

Add to `models/channelPartnerModel.js`:

```js
category: {
  type: String,
  enum: ['broker_firm', 'individual_agent', 'corporate', 'digital_aggregator'],
  default: 'broker_firm',
  index: true,
},
```

Add a compound index: `channelPartnerSchema.index({ organization: 1, category: 1 });`

`default` ensures new documents and any code-path `.save()` always have a value.
`required` is intentionally **not** set — the default covers it and avoids breaking
existing update flows that omit the field.

### 5.2 Backfill

`data/backfillChannelPartnerCategory.js` — a one-time, org-agnostic script that runs
`ChannelPartner.updateMany({ category: { $exists: false } }, { $set: { category: 'broker_firm' } })`.
Aggregation pipelines additionally `$ifNull`-default the field, so analytics is correct
even if the backfill has not been run.

### 5.3 Demo seeder

Update `data/mumbaiLuxuryCPSeeder.js` so its seeded partners span all four categories
(so the category roll-up demonstrates meaningfully on the demo org).

---

## 6. Backend

### 6.1 Aggregation service — `services/channelPartnerAnalyticsService.js` (new)

Two exported functions. Each accepts `{ organization, projectIds, startDate, endDate }`
and returns a plain object. `projectIds` is the resolved list from the project-access
filter (and the optional `project` query param). All pipelines start with an
`organization` match.

**`getVolumeBreakdown({ organization, projectIds, startDate, endDate })`**

```
{
  sales: {
    direct:         { count, revenue },
    channelPartner: { count, revenue },
    total:          { count, revenue },
    cpSharePct                          // CP revenue ÷ total revenue, 0 if total 0
  },
  leads: {
    direct:         { count },
    channelPartner: { count },
    total:          { count },
    cpSharePct                          // CP leads ÷ total leads
  },
  conversion: {
    direct:         pct,                // direct sales ÷ direct leads
    channelPartner: pct                 // CP sales ÷ CP leads
  },
  avgDealSize: {
    direct:         number,
    channelPartner: number
  },
  byCategory: [                          // exactly 4 rows, zero-filled
    { category, leads, sales, revenue }
  ],
  byFirm: [
    { channelPartnerId, firmName, category, leads, sales, revenue, conversionPct }
  ]
}
```

**`getCommissionBreakdown({ organization, projectIds, startDate, endDate })`**

```
{
  summary: { grossAccrued, tds, netAccrued, paid, pending },
  paymentStatus: [                       // one row per CommissionRecord.status
    { status, count, netAmount }         // accrued | partially_paid | paid | cancelled
  ],
  effectiveCommissionRate: pct,          // netAccrued ÷ CP-sourced revenue (0 if no CP revenue)
  byFirm: [
    { channelPartnerId, firmName, category, netCommission, paid, pending }
  ],
  topPerformers: [                       // top 10 firms by booked revenue
    { channelPartnerId, firmName, category, bookedRevenue, netCommission }
  ]
}
```

### 6.2 Aggregation rules

- **Date field:** sales filtered by `bookingDate` (fallback `createdAt` if a sale lacks
  `bookingDate`); leads by `createdAt`; commission records by `createdAt`. The plan must
  confirm the exact sale date field name against `salesController.js`.
- **CP-sourced definition:** a sale or lead is "CP-sourced" when
  `channelPartnerAttribution.viaChannelPartner === true`.
- **Direct-vs-CP top line:** a CP-sourced sale contributes its **whole** revenue to
  `sales.channelPartner` (counted once, even with multiple partners on the split).
- **Per-firm / per-category revenue:** apportioned by each partner's
  `channelPartnerAttribution.partners[].sharePct`, so the sum of `byFirm` revenue and the
  sum of `byCategory` revenue each reconcile to `sales.channelPartner.revenue`. A lead is
  attributed (unapportioned, count of 1) to every partner on its attribution.
- **Exclusions:** sales with status `Cancelled` are excluded from revenue/count;
  `CommissionRecord` documents with status `cancelled` are excluded from `summary`,
  `byFirm`, and `topPerformers` (but still appear as a row in `paymentStatus`).
- **Category default:** `$ifNull(['$category', 'broker_firm'])` in every grouping stage.
- **Multi-tenancy:** every pipeline matches `organization` and respects the
  project-access filter; the `category` filter and CP joins are additional conditions,
  never replacements.

### 6.3 Controller — `controllers/channelPartnerAnalyticsController.js` (new)

- `getChannelPartnerVolumeAnalytics(req, res)` — reads `period` and `project` query
  params, resolves the date range via the existing analytics `period`→date-range helper
  (the plan must locate and reuse it from `analyticsController.js`), resolves
  `projectIds` via the existing project-access filter, calls `getVolumeBreakdown`,
  returns `200` with the payload.
- `getChannelPartnerCommissionAnalytics(req, res)` — same param handling, calls
  `getCommissionBreakdown`.
- Both wrap errors consistently with the rest of `analyticsController.js`.

### 6.4 Routes — added to `routes/analyticsRoutes.js`

| Method | Path | Protection |
|---|---|---|
| GET | `/api/analytics/channel-partners/volume` | `protect` only — same middleware as the existing analytics routes in this file |
| GET | `/api/analytics/channel-partners/commission` | `protect` + `checkPermission(PERMISSIONS.CHANNEL_PARTNERS.VIEW)` |

Query params for both: `period` (same vocabulary as the existing analytics endpoints,
e.g. `year`), `project` (an ObjectId, or omitted / `all`).

### 6.5 CP create/update controller

`channelPartnerController.js` create and update handlers start accepting and persisting
the `category` field (validated against the enum by the schema).

---

## 7. Frontend

### 7.1 CP form — `src/pages/channel-partners/ChannelPartnerFormPage.js`

Add `category: 'broker_firm'` to the form's initial state. Add a `TextField select`
labelled "Category" immediately after the existing Status field, with four `MenuItem`s
(Broker Firm / Individual Agent / Corporate / Digital Aggregator). Include `category` in
the submit payload. Mirrors the existing Status-field markup.

### 7.2 API client — `src/services/api.js`

Add to `analyticsAPI`:
- `getChannelPartnerVolume(params)` → `GET /analytics/channel-partners/volume`
- `getChannelPartnerCommission(params)` → `GET /analytics/channel-partners/commission`

### 7.3 Sales Analytics page

Add a new **"Channel Partners"** tab beside the existing Overview / Team Performance /
Project Breakdown tabs. On tab activation (or page load) it calls
`getChannelPartnerVolume({ period, project })` using the page's existing `period` +
`project` filter state. Renders:
- Direct vs CP — sales count and revenue, with a percentage-split donut.
- Avg deal size — Direct vs CP, side by side.
- Revenue by category — bar chart, 4 categories.
- Per-firm table — firm, category, bookings, revenue.

### 7.4 Lead Analytics page

Add a new **"Channel Partners"** tab. Calls the same `/volume` endpoint. Renders:
- Direct vs CP — lead count, with a percentage-split visual.
- Conversion rate — CP vs Direct, side by side.
- Leads by category — bar chart, 4 categories.
- Per-firm table — firm, category, leads, bookings, conversion %.

### 7.5 Analytics Overview — `src/pages/analytics/AnalyticsDashboard.js`

Add a CP section below the existing cards/charts:
- **Open to all Analytics users:** a "Channel Partner Contribution" card showing the
  share of revenue and the share of leads sourced via CP (from `/volume`).
- **Gated by `CHANNEL_PARTNERS.VIEW`:** a "Commission & Payouts" block — net / paid /
  pending commission cards, a payment-status mini-chart, the effective-commission-rate
  KPI, and a top-performers table. The `/commission` request is made **only** when the
  user holds the permission. Permission is checked via the existing frontend permission
  helper that already gates the Channel Partners nav section (the plan must locate the
  exact helper / context value).

All three pages reuse the page's existing `period` + `project` state — no new filter
controls are introduced.

---

## 8. Edge Cases

| Case | Behaviour |
|---|---|
| Org has no channel partners, or no CP activity in the period | Each CP section renders a clean empty state ("No channel-partner activity in the selected period"). No crash, no NaN, no divide-by-zero. |
| Legacy partner without `category` | Backfill script sets it; pipelines `$ifNull`-default to `broker_firm`. |
| Sale split across multiple partners | Whole revenue counts once on the Direct-vs-CP top line; per-firm / per-category revenue apportioned by `sharePct`. |
| User lacks `CHANNEL_PARTNERS.VIEW` | Overview "Commission & Payouts" block does not render; `/commission` is not called. The `/commission` route also rejects the request server-side. |
| Cancelled sale / cancelled commission record | Excluded from revenue, counts, and commission summary; cancelled commission still shown as a `paymentStatus` row. |
| `period` with zero leads but some sales (or vice versa) | Conversion and avg-deal-size guard against divide-by-zero, returning `0`. |

## 9. Testing

**Backend** — unit tests for `channelPartnerAnalyticsService.js` against seeded fixtures:
- Direct-vs-CP sales split and lead split compute correctly.
- `byCategory` always returns 4 zero-filled rows; roll-up sums match the CP totals.
- `byFirm` revenue apportioned by `sharePct` reconciles to `sales.channelPartner.revenue`.
- Commission `summary` and `paymentStatus` sums are correct; cancelled records excluded
  from `summary` but present in `paymentStatus`.
- Empty-org case returns a fully zero-filled payload (no throw).
- `effectiveCommissionRate` and `conversion` return `0` rather than `NaN`/`Infinity`
  when a denominator is zero.

**Copilot** — the two new tools are thin wrappers over the tested service, so they need
no separate aggregation tests. Verify by manual copilot chat on the demo org: a
performance question (e.g. "how much revenue came via channel partners this year")
returns data; a commission question is answered for a financial-role user and refused for
a non-financial role.

**Frontend** — `CI=true npm run build` compiles clean; manual UI verification on the
demo org (seeder updated to span all 4 categories): CP tabs on Sales/Lead Analytics, the
Overview contribution card, and (with permission) the gated Commission block.

## 10. AI Copilot Integration

The AI copilot (`controllers/aiCopilotController.js`, `services/aiCopilotService.js`,
`services/copilotFunctions.js`) is an OpenAI GPT-4o **tool-calling** chat. The chat UI is
fully backend-driven — registering a new tool surfaces it in the chat with **no frontend
change**. The copilot already has a `get_commission_summary` tool (per-partner commission
lookup); that tool stays. This section adds the org-wide CP **analytics** view.

### 10.1 Two new copilot tools — `services/copilotFunctions.js`

Both tools **reuse the same `services/channelPartnerAnalyticsService.js`** from Section 6 —
no aggregation logic is duplicated. Each tool is a thin wrapper: parse params, resolve the
date range and project scope, call the service, return the structured object.

- **`get_channel_partner_performance`** → calls `getVolumeBreakdown(...)`. Answers
  Direct-vs-CP volume, by-category, by-firm, conversion, and avg-deal-size questions.
- **`get_channel_partner_commission_analytics`** → calls `getCommissionBreakdown(...)`.
  Answers commission accrued/paid/pending, payment-status, by-firm, top-performer, and
  effective-commission-rate questions.

**Tool parameters (both):**
- `period` — enum `this_month | this_quarter | this_year | last_month | last_quarter`,
  mapped to a `{ startDate, endDate }` range. The plan must reconcile this enum with the
  `period`→date-range helper used by the web endpoints (Section 6.3) and reuse a single
  resolution path.
- `project_id` — optional ObjectId; when present, narrows the project scope (still
  intersected with the caller's project-access list).

Register each tool's definition in the `copilotTools` array and its implementation in the
`functionImplementations` map, following the existing tool pattern in the file.

### 10.2 Role gating — `services/aiCopilotService.js`

`get_channel_partner_commission_analytics` is added to the copilot's `FINANCIAL_FUNCTIONS`
list — the same role gate that already restricts `get_commission_summary` (Business Head,
Project Director, Finance Head, Finance Manager, Sales Head). `get_channel_partner_performance`
follows the default copilot tool access (no financial gate).

The copilot uses its own established role-based gating, separate from the web routes'
`CHANNEL_PARTNERS.VIEW` permission. Each channel keeps its existing mechanism — they are
not unified in this work.

### 10.3 Intent detection — `services/aiCopilotService.js`

`detectIntent()` gets a branch: when a called tool name includes `channel_partner`, the
detected category is `channel_partners`. Used for logging/analytics only — it does not
change UI behaviour.

### 10.4 No frontend copilot change

The copilot chat UI (`src/components/copilot/`) renders whatever structured cards the
backend returns through its existing card renderers. No frontend work is needed for the
copilot to answer CP questions.

---

## 11. File Summary

**Backend — create**
- `services/channelPartnerAnalyticsService.js`
- `controllers/channelPartnerAnalyticsController.js`
- `data/backfillChannelPartnerCategory.js`
- Service test file (path per repo test convention)

**Backend — modify**
- `models/channelPartnerModel.js` — `category` field + index
- `routes/analyticsRoutes.js` — two new routes
- `controllers/channelPartnerController.js` — accept `category` on create/update
- `data/mumbaiLuxuryCPSeeder.js` — assign categories
- `services/copilotFunctions.js` — two new copilot tools (definitions + implementations)
- `services/aiCopilotService.js` — `FINANCIAL_FUNCTIONS` entry + `detectIntent()` branch

**Frontend — modify**
- `src/services/api.js` — two `analyticsAPI` methods
- `src/pages/channel-partners/ChannelPartnerFormPage.js` — category select
- Sales Analytics page — Channel Partners tab
- Lead Analytics page — Channel Partners tab
- `src/pages/analytics/AnalyticsDashboard.js` — CP section (open card + gated block)
