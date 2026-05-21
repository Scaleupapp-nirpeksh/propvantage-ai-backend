# Channel Partner Analytics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface Channel Partner (CP) performance — Direct-vs-CP volume, by-category and by-firm breakdowns, commission, and payment status — inside the existing Analytics pages and the AI copilot.

**Architecture:** A new backend aggregation service (`channelPartnerAnalyticsService.js`) holds all CP analytics pipelines. Two new web endpoints under `/api/analytics/channel-partners` and two new copilot tools both call that one service. The frontend adds CP sections to three existing Analytics pages and a category field to the CP form.

**Tech Stack:** Node/Express, MongoDB/Mongoose (backend); React 18, MUI v5, recharts (frontend); OpenAI GPT-4o tool-calling (copilot).

**Spec:** `docs/superpowers/specs/2026-05-21-channel-partner-analytics-design.md`

**Repos:**
- Backend: `/Users/nirpekshnandan/My Products/propvantage-ai-backend`
- Frontend: `/Users/nirpekshnandan/My Products/propvantage-ai-frontend`

Both are on branch `main`. Tasks 1-5 are backend; Tasks 6-9 are frontend; Task 10 is manual verification.

---

## Background an implementer needs

**`channelPartnerAttribution` sub-document** (identical shape on both `Sale` and `Lead`):
```js
channelPartnerAttribution: {
  viaChannelPartner: { type: Boolean, default: false },
  partners: [{
    channelPartner: { type: ObjectId, ref: 'ChannelPartner' },
    agent: { type: ObjectId, ref: 'ChannelPartnerAgent', default: null },
    sharePct: { type: Number, default: 0, min: 0, max: 100 },
  }],
  status: { /* 'tagged'|'pending'|'approved'|'rejected' */ },
  // ...taggedBy, taggedAt, history
}
```

**Key facts:**
- A sale/lead is "CP-sourced" when `channelPartnerAttribution.viaChannelPartner === true`.
- `Sale.status` enum includes `'Cancelled'` (capital C). `Sale.salePrice` is the revenue field. `Sale.bookingDate` is the date field. `Sale` has a `project` field.
- `Lead` has `createdAt` (timestamps) and a `project` field.
- `CommissionRecord`: `status` enum `['accrued','partially_paid','paid','cancelled']`; `grossAmount`, `tdsAmount`, `netAmount`; `payouts: [{ label, amount, trigger, status:'pending'|'paid', dueOn, paidOn, paidBy }]`; refs `channelPartner`, `agent`, `sale`; has `createdAt`. No `project` field — project scope comes via the linked `sale`.
- `projectAccessFilter(req)` (from `utils/projectAccessHelper.js`) returns `{}` (full access), `{ project: { $in: [ObjectId,...] } }`, or `{ project: { $in: [] } }`.
- Org scoping: every query matches `organization: req.user.organization`.

---

## Task 1: Add `category` to ChannelPartner — model, backfill, seeder, controller

**Files:**
- Modify: `models/channelPartnerModel.js`
- Create: `data/backfillChannelPartnerCategory.js`
- Modify: `data/mumbaiLuxuryCPSeeder.js`
- Modify: `controllers/channelPartnerController.js`

The CP create/update controllers already spread `...body` / `...updatable` from `req.body`, so once the schema has `category` they accept it automatically — no controller code change is strictly required, but Step 4 adds an explicit allow so an invalid value is rejected with a clear error rather than silently defaulting.

- [ ] **Step 1: Add the `category` field to the model**

In `models/channelPartnerModel.js`, add this field to the schema immediately after the `status` field block:

```js
    category: {
      type: String,
      enum: ['broker_firm', 'individual_agent', 'corporate', 'digital_aggregator'],
      default: 'broker_firm',
      index: true,
    },
```

And add this compound index next to the existing `channelPartnerSchema.index(...)` lines:

```js
channelPartnerSchema.index({ organization: 1, category: 1 });
```

- [ ] **Step 2: Create the backfill script**

Create `data/backfillChannelPartnerCategory.js`. Model it on any existing one-off script in `data/` for the DB-connection boilerplate (look at the top of `data/mumbaiLuxuryCPSeeder.js` for the exact `mongoose.connect` pattern and env loading used in this repo, and copy it):

```js
// File: data/backfillChannelPartnerCategory.js
// One-time: set category='broker_firm' on ChannelPartner docs that predate the field.
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import ChannelPartner from '../models/channelPartnerModel.js';

dotenv.config();

const run = async () => {
  await mongoose.connect(process.env.MONGO_URI);
  const res = await ChannelPartner.updateMany(
    { category: { $exists: false } },
    { $set: { category: 'broker_firm' } }
  );
  console.log(`Backfilled category on ${res.modifiedCount} channel partner(s).`);
  await mongoose.disconnect();
};

run().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
```

If `data/mumbaiLuxuryCPSeeder.js` loads env or connects differently (e.g. a shared `config/db.js`), match that exactly instead of the lines above.

- [ ] **Step 3: Assign categories in the demo seeder**

In `data/mumbaiLuxuryCPSeeder.js`, the `FIRM_SPECS` array has 6 firm objects. Add a `category` key to each so all four categories appear. Use these values (apply in array order):

```js
// Crest Luxury Advisors
category: 'broker_firm',
// Marine Drive Realty
category: 'corporate',
// Sterling Estate Partners
category: 'broker_firm',
// Pinnacle Property Consultants
category: 'individual_agent',
// Bandra Bay Realtors
category: 'digital_aggregator',
// Heritage Homes Brokerage
category: 'individual_agent',
```

Then, in the `ChannelPartner.create({...})` call inside the seeding loop, add `category: spec.category,` to the object passed to `create`.

- [ ] **Step 4: Make the CP controller validate `category` explicitly**

In `controllers/channelPartnerController.js`, in BOTH `createChannelPartner` and `updateChannelPartner`, add this guard right after the existing `req.body` destructuring (before the `ChannelPartner.create` / `Object.assign`):

```js
  const VALID_CATEGORIES = ['broker_firm', 'individual_agent', 'corporate', 'digital_aggregator'];
  if (req.body.category !== undefined && !VALID_CATEGORIES.includes(req.body.category)) {
    res.status(400);
    throw new Error('Invalid channel partner category');
  }
```

`category` then flows through the existing `...body` / `...updatable` spread — no further change needed.

- [ ] **Step 5: Smoke-check the model loads**

Run: `node -e "import('./models/channelPartnerModel.js').then(()=>console.log('model OK'))"`
Expected: prints `model OK` with no schema error.

- [ ] **Step 6: Commit**

```bash
git add models/channelPartnerModel.js data/backfillChannelPartnerCategory.js data/mumbaiLuxuryCPSeeder.js controllers/channelPartnerController.js
git commit -m "feat(channel-partner): add category field to channel partners"
```

---

## Task 2: CP analytics service — volume breakdown

**Files:**
- Create: `services/channelPartnerAnalyticsService.js`

This task creates the service file with shared internal helpers and the exported `getVolumeBreakdown`. Task 3 appends `getCommissionBreakdown` to the same file.

Reference pattern: `controllers/channelPartnerController.js` → `getChannelPartnerDashboard` already does CP aggregations over `Lead`/`Sale`/`CommissionRecord` (unwinding `channelPartnerAttribution.partners`, two-level `$group` dedupe, `status: { $ne: 'Cancelled' }`). Mirror that style.

- [ ] **Step 1: Create the service file with helpers and `getVolumeBreakdown`**

Create `services/channelPartnerAnalyticsService.js`:

```js
// File: services/channelPartnerAnalyticsService.js
// Description: Aggregation pipelines for Channel Partner analytics — Direct-vs-CP
//   volume and commission breakdowns. Consumed by the analytics web endpoints and
//   by the AI copilot tools. Every pipeline is organization-scoped.

import mongoose from 'mongoose';
import Sale from '../models/salesModel.js';
import Lead from '../models/leadModel.js';
import ChannelPartner from '../models/channelPartnerModel.js';
import CommissionRecord from '../models/commissionRecordModel.js';

const CATEGORIES = ['broker_firm', 'individual_agent', 'corporate', 'digital_aggregator'];

// Safe division — returns 0 instead of NaN/Infinity when the denominator is 0.
const safeDiv = (a, b) => (b > 0 ? a / b : 0);

// Build a date-range match fragment for `field`, or {} when no range is given.
const dateMatch = (field, startDate, endDate) =>
  startDate && endDate ? { [field]: { $gte: startDate, $lte: endDate } } : {};

/**
 * Per-channel-partner sales aggregation: deals involved in + revenue apportioned
 * by sharePct. Used by both getVolumeBreakdown and getCommissionBreakdown.
 * Returns: [{ _id: channelPartnerObjectId, sales, revenue }]
 */
const aggregateSalesByPartner = ({ organization, projectFilter, startDate, endDate }) =>
  Sale.aggregate([
    {
      $match: {
        organization,
        status: { $ne: 'Cancelled' },
        'channelPartnerAttribution.viaChannelPartner': true,
        ...projectFilter,
        ...dateMatch('bookingDate', startDate, endDate),
      },
    },
    { $unwind: '$channelPartnerAttribution.partners' },
    // Dedupe per (sale, CP) so a CP listed twice in one split is counted once.
    {
      $group: {
        _id: { sale: '$_id', cp: '$channelPartnerAttribution.partners.channelPartner' },
        salePrice: { $first: '$salePrice' },
        sharePct: { $sum: { $ifNull: ['$channelPartnerAttribution.partners.sharePct', 0] } },
      },
    },
    {
      $group: {
        _id: '$_id.cp',
        sales: { $sum: 1 },
        revenue: {
          $sum: {
            $multiply: ['$salePrice', { $divide: [{ $min: ['$sharePct', 100] }, 100] }],
          },
        },
      },
    },
  ]);

/**
 * Per-channel-partner lead aggregation: leads tagged to each CP.
 * Returns: [{ _id: channelPartnerObjectId, leads }]
 */
const aggregateLeadsByPartner = ({ organization, projectFilter, startDate, endDate }) =>
  Lead.aggregate([
    {
      $match: {
        organization,
        'channelPartnerAttribution.viaChannelPartner': true,
        ...projectFilter,
        ...dateMatch('createdAt', startDate, endDate),
      },
    },
    { $unwind: '$channelPartnerAttribution.partners' },
    { $group: { _id: { lead: '$_id', cp: '$channelPartnerAttribution.partners.channelPartner' } } },
    { $group: { _id: '$_id.cp', leads: { $sum: 1 } } },
  ]);

/**
 * Direct-vs-CP volume breakdown for the given org/project/date scope.
 * @param {Object} args
 * @param {ObjectId} args.organization
 * @param {Object} args.projectFilter - mongo fragment for the `project` field ({} = all)
 * @param {Date|null} args.startDate
 * @param {Date|null} args.endDate
 */
export const getVolumeBreakdown = async ({ organization, projectFilter = {}, startDate = null, endDate = null }) => {
  // Top-line Direct-vs-CP split — a CP-sourced sale counts its whole revenue once.
  const salesSplit = await Sale.aggregate([
    {
      $match: {
        organization,
        status: { $ne: 'Cancelled' },
        ...projectFilter,
        ...dateMatch('bookingDate', startDate, endDate),
      },
    },
    {
      $group: {
        _id: { $ifNull: ['$channelPartnerAttribution.viaChannelPartner', false] },
        count: { $sum: 1 },
        revenue: { $sum: '$salePrice' },
      },
    },
  ]);

  const leadsSplit = await Lead.aggregate([
    {
      $match: {
        organization,
        ...projectFilter,
        ...dateMatch('createdAt', startDate, endDate),
      },
    },
    {
      $group: {
        _id: { $ifNull: ['$channelPartnerAttribution.viaChannelPartner', false] },
        count: { $sum: 1 },
      },
    },
  ]);

  const pickSplit = (rows, viaValue) => rows.find((r) => r._id === viaValue) || {};
  const cpSales = pickSplit(salesSplit, true);
  const directSales = pickSplit(salesSplit, false);
  const cpLeads = pickSplit(leadsSplit, true);
  const directLeads = pickSplit(leadsSplit, false);

  const sales = {
    direct: { count: directSales.count || 0, revenue: directSales.revenue || 0 },
    channelPartner: { count: cpSales.count || 0, revenue: cpSales.revenue || 0 },
  };
  sales.total = {
    count: sales.direct.count + sales.channelPartner.count,
    revenue: sales.direct.revenue + sales.channelPartner.revenue,
  };
  sales.cpSharePct = Math.round(safeDiv(sales.channelPartner.revenue, sales.total.revenue) * 100);

  const leads = {
    direct: { count: directLeads.count || 0 },
    channelPartner: { count: cpLeads.count || 0 },
  };
  leads.total = { count: leads.direct.count + leads.channelPartner.count };
  leads.cpSharePct = Math.round(safeDiv(leads.channelPartner.count, leads.total.count) * 100);

  const conversion = {
    direct: Math.round(safeDiv(sales.direct.count, leads.direct.count) * 100),
    channelPartner: Math.round(safeDiv(sales.channelPartner.count, leads.channelPartner.count) * 100),
  };
  const avgDealSize = {
    direct: Math.round(safeDiv(sales.direct.revenue, sales.direct.count)),
    channelPartner: Math.round(safeDiv(sales.channelPartner.revenue, sales.channelPartner.count)),
  };

  // Per-firm rows — merge sales + leads aggregations with the partner registry.
  const [salesByPartner, leadsByPartner, partners] = await Promise.all([
    aggregateSalesByPartner({ organization, projectFilter, startDate, endDate }),
    aggregateLeadsByPartner({ organization, projectFilter, startDate, endDate }),
    ChannelPartner.find({ organization }).select('firmName category').lean(),
  ]);

  const salesMap = Object.fromEntries(salesByPartner.map((r) => [String(r._id), r]));
  const leadsMap = Object.fromEntries(leadsByPartner.map((r) => [String(r._id), r]));

  const byFirm = partners
    .map((p) => {
      const id = String(p._id);
      const s = salesMap[id] || {};
      const l = leadsMap[id] || {};
      const firmSales = s.sales || 0;
      const firmLeads = l.leads || 0;
      return {
        channelPartnerId: p._id,
        firmName: p.firmName,
        category: p.category || 'broker_firm',
        leads: firmLeads,
        sales: firmSales,
        revenue: Math.round(s.revenue || 0),
        conversionPct: Math.round(safeDiv(firmSales, firmLeads) * 100),
      };
    })
    .filter((r) => r.leads > 0 || r.sales > 0)
    .sort((a, b) => b.revenue - a.revenue);

  // Category roll-up — always 4 rows, zero-filled, derived from byFirm.
  const byCategory = CATEGORIES.map((category) => {
    const rows = byFirm.filter((r) => r.category === category);
    return {
      category,
      leads: rows.reduce((n, r) => n + r.leads, 0),
      sales: rows.reduce((n, r) => n + r.sales, 0),
      revenue: rows.reduce((n, r) => n + r.revenue, 0),
    };
  });

  return { sales, leads, conversion, avgDealSize, byCategory, byFirm };
};
```

- [ ] **Step 2: Smoke-check the service imports cleanly**

Run: `node -e "import('./services/channelPartnerAnalyticsService.js').then(m=>console.log(typeof m.getVolumeBreakdown))"`
Expected: prints `function`.

- [ ] **Step 3: Commit**

```bash
git add services/channelPartnerAnalyticsService.js
git commit -m "feat(channel-partner): add volume breakdown to CP analytics service"
```

---

## Task 3: CP analytics service — commission breakdown

**Files:**
- Modify: `services/channelPartnerAnalyticsService.js`

Append a second exported function. It reuses `aggregateSalesByPartner` (already in the file from Task 2) for top-performer booked revenue.

- [ ] **Step 1: Append `getCommissionBreakdown` to the service**

Add to the end of `services/channelPartnerAnalyticsService.js`:

```js
/**
 * Commission + payment-status breakdown for the given org/project/date scope.
 * Same args as getVolumeBreakdown.
 */
export const getCommissionBreakdown = async ({ organization, projectFilter = {}, startDate = null, endDate = null }) => {
  // CommissionRecord has no `project` field — project scope is applied via the
  // linked Sale. A `paidAmount` field is derived from the paid payouts.
  const buildPipeline = (groupStage) => {
    const pipeline = [
      {
        $match: {
          organization,
          status: { $ne: 'cancelled' },
          ...dateMatch('createdAt', startDate, endDate),
        },
      },
    ];
    if (projectFilter.project) {
      pipeline.push(
        { $lookup: { from: 'sales', localField: 'sale', foreignField: '_id', as: 'saleDoc' } },
        { $unwind: { path: '$saleDoc', preserveNullAndEmptyArrays: false } },
        { $match: { 'saleDoc.project': projectFilter.project } }
      );
    }
    pipeline.push({
      $addFields: {
        paidAmount: {
          $sum: {
            $map: {
              input: { $filter: { input: '$payouts', as: 'p', cond: { $eq: ['$$p.status', 'paid'] } } },
              as: 'p',
              in: '$$p.amount',
            },
          },
        },
      },
    });
    pipeline.push(groupStage);
    return pipeline;
  };

  // Org-wide summary.
  const summaryRows = await CommissionRecord.aggregate(
    buildPipeline({
      $group: {
        _id: null,
        grossAccrued: { $sum: '$grossAmount' },
        tds: { $sum: '$tdsAmount' },
        netAccrued: { $sum: '$netAmount' },
        paid: { $sum: '$paidAmount' },
      },
    })
  );
  const s = summaryRows[0] || { grossAccrued: 0, tds: 0, netAccrued: 0, paid: 0 };
  const summary = {
    grossAccrued: Math.round(s.grossAccrued),
    tds: Math.round(s.tds),
    netAccrued: Math.round(s.netAccrued),
    paid: Math.round(s.paid),
    pending: Math.round(s.netAccrued - s.paid),
  };

  // Payment status — count + net amount per CommissionRecord.status. Note the
  // status:{$ne:'cancelled'} match means 'cancelled' never appears here, which
  // is the intended behaviour for the analytics view.
  const statusRows = await CommissionRecord.aggregate(
    buildPipeline({
      $group: { _id: '$status', count: { $sum: 1 }, netAmount: { $sum: '$netAmount' } },
    })
  );
  const paymentStatus = statusRows.map((r) => ({
    status: r._id,
    count: r.count,
    netAmount: Math.round(r.netAmount),
  }));

  // Per-firm commission.
  const firmRows = await CommissionRecord.aggregate(
    buildPipeline({
      $group: {
        _id: '$channelPartner',
        netCommission: { $sum: '$netAmount' },
        paid: { $sum: '$paidAmount' },
      },
    })
  );

  // CP-sourced booked revenue per firm — reuse the volume helper for ranking.
  const salesByPartner = await aggregateSalesByPartner({ organization, projectFilter, startDate, endDate });
  const revenueMap = Object.fromEntries(salesByPartner.map((r) => [String(r._id), r.revenue || 0]));

  const partners = await ChannelPartner.find({ organization }).select('firmName category').lean();
  const partnerMap = Object.fromEntries(partners.map((p) => [String(p._id), p]));
  const commMap = Object.fromEntries(firmRows.map((r) => [String(r._id), r]));

  const byFirm = partners
    .map((p) => {
      const id = String(p._id);
      const c = commMap[id] || {};
      const net = Math.round(c.netCommission || 0);
      const paid = Math.round(c.paid || 0);
      return {
        channelPartnerId: p._id,
        firmName: p.firmName,
        category: p.category || 'broker_firm',
        netCommission: net,
        paid,
        pending: net - paid,
      };
    })
    .filter((r) => r.netCommission > 0)
    .sort((a, b) => b.netCommission - a.netCommission);

  const cpRevenueTotal = salesByPartner.reduce((n, r) => n + (r.revenue || 0), 0);
  const effectiveCommissionRate =
    Math.round(safeDiv(summary.netAccrued, cpRevenueTotal) * 1000) / 10; // one decimal %

  const topPerformers = partners
    .map((p) => {
      const id = String(p._id);
      return {
        channelPartnerId: p._id,
        firmName: p.firmName,
        category: p.category || 'broker_firm',
        bookedRevenue: Math.round(revenueMap[id] || 0),
        netCommission: Math.round((commMap[id] || {}).netCommission || 0),
      };
    })
    .filter((r) => r.bookedRevenue > 0)
    .sort((a, b) => b.bookedRevenue - a.bookedRevenue)
    .slice(0, 10);

  return { summary, paymentStatus, effectiveCommissionRate, byFirm, topPerformers };
};
```

- [ ] **Step 2: Smoke-check both exports are present**

Run: `node -e "import('./services/channelPartnerAnalyticsService.js').then(m=>console.log(typeof m.getVolumeBreakdown, typeof m.getCommissionBreakdown))"`
Expected: prints `function function`.

- [ ] **Step 3: Commit**

```bash
git add services/channelPartnerAnalyticsService.js
git commit -m "feat(channel-partner): add commission breakdown to CP analytics service"
```

---

## Task 4: CP analytics web endpoints — controller, routes, regression test

**Files:**
- Create: `controllers/channelPartnerAnalyticsController.js`
- Modify: `routes/analyticsRoutes.js`
- Create: `tests/regression/suites/24-channel-partner-analytics.test.js`

The two endpoints accept `dateFrom` / `dateTo` (ISO strings, optional) and `project` (ObjectId, optional) query params. The frontend computes the dates; if absent the controller defaults to start-of-year → now.

- [ ] **Step 1: Create the controller**

Create `controllers/channelPartnerAnalyticsController.js`:

```js
// File: controllers/channelPartnerAnalyticsController.js
// Description: Web endpoints for Channel Partner analytics. Thin wrappers over
//   services/channelPartnerAnalyticsService.js.

import asyncHandler from 'express-async-handler';
import mongoose from 'mongoose';
import { projectAccessFilter, verifyProjectAccess } from '../utils/projectAccessHelper.js';
import {
  getVolumeBreakdown,
  getCommissionBreakdown,
} from '../services/channelPartnerAnalyticsService.js';

// Resolve query params into { organization, projectFilter, startDate, endDate }.
const resolveScope = (req, res) => {
  const organization = req.user.organization;

  // Date range — explicit ISO params, else default to start-of-year → now.
  let startDate = null;
  let endDate = null;
  if (req.query.dateFrom && req.query.dateTo) {
    const from = new Date(req.query.dateFrom);
    const to = new Date(req.query.dateTo);
    if (!isNaN(from) && !isNaN(to)) {
      startDate = from;
      endDate = to;
    }
  }
  if (!startDate) {
    const now = new Date();
    startDate = new Date(now.getFullYear(), 0, 1);
    endDate = now;
  }

  // Project scope — start from the access filter; narrow if a valid project given.
  let projectFilter = projectAccessFilter(req);
  const { project } = req.query;
  if (project && project !== 'all' && mongoose.isValidObjectId(project)) {
    verifyProjectAccess(req, res, project); // throws 403 if not allowed
    projectFilter = { project: new mongoose.Types.ObjectId(project) };
  }

  return { organization, projectFilter, startDate, endDate };
};

// @route GET /api/analytics/channel-partners/volume
export const getChannelPartnerVolumeAnalytics = asyncHandler(async (req, res) => {
  const scope = resolveScope(req, res);
  const data = await getVolumeBreakdown(scope);
  res.json({ success: true, data });
});

// @route GET /api/analytics/channel-partners/commission
export const getChannelPartnerCommissionAnalytics = asyncHandler(async (req, res) => {
  const scope = resolveScope(req, res);
  const data = await getCommissionBreakdown(scope);
  res.json({ success: true, data });
});
```

> If the repo does not use the `express-async-handler` package (check `controllers/analyticsController.js`'s import — it imports `asyncHandler`), match whatever import that file uses for `asyncHandler`.

- [ ] **Step 2: Wire the routes**

In `routes/analyticsRoutes.js`, add the two new controller functions to the import block, then register the routes. The file already has `router.use(protect)` at the top and imports `hasPermission` and `PERMISSIONS`. Add:

```js
import {
  getSalesSummary,
  getLeadFunnel,
  getDashboardAnalytics,
  getSalesReport,
  // existing imports above — keep them
} from '../controllers/analyticsController.js';
import {
  getChannelPartnerVolumeAnalytics,
  getChannelPartnerCommissionAnalytics,
} from '../controllers/channelPartnerAnalyticsController.js';
```

And add these route registrations before `export default router;`:

```js
// @route GET /api/analytics/channel-partners/volume
// @desc  Direct-vs-CP volume breakdown (counts/revenue) — open to Analytics users
router.get(
  '/channel-partners/volume',
  hasPermission(PERMISSIONS.ANALYTICS.BASIC),
  getChannelPartnerVolumeAnalytics
);

// @route GET /api/analytics/channel-partners/commission
// @desc  CP commission + payment status — gated by CHANNEL_PARTNERS.VIEW
router.get(
  '/channel-partners/commission',
  hasPermission(PERMISSIONS.CHANNEL_PARTNERS.VIEW),
  getChannelPartnerCommissionAnalytics
);
```

> The volume route uses `ANALYTICS.BASIC` to match its sibling routes (`sales-summary`, `lead-funnel`) — this is the practical reading of the spec's "same as the existing analytics routes." The commission route uses `CHANNEL_PARTNERS.VIEW` per the spec.

- [ ] **Step 3: Write the regression test**

This repo's backend tests are regression smoke tests that hit a live API (no unit-test/in-memory-DB infra exists — see `tests/regression/suites/13-analytics-leadership.test.js`). Create `tests/regression/suites/24-channel-partner-analytics.test.js` modelled exactly on `13-analytics-leadership.test.js`:

```js
// 24-channel-partner-analytics.test.js — channel partner analytics endpoints
import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import { api, hasAuthToken } from '../_lib/api.js';
import { tryAcquireToken, disconnectAuth } from '../_lib/auth.js';

describe('channel partner analytics (authenticated read)', () => {
  beforeAll(async () => { await tryAcquireToken(); });
  afterAll(async () => { await disconnectAuth(); });

  const itAuthed = (name, fn) => test(name, async () => {
    if (!hasAuthToken()) { console.warn(`  ⏭️  ${name} skipped — no auth token`); return; }
    return fn();
  });

  itAuthed('GET /api/analytics/channel-partners/volume', async () => {
    // No date params — the endpoint defaults to start-of-year → now.
    const res = await api('GET', '/api/analytics/channel-partners/volume');
    expect([200, 403]).toContain(res.status);
    if (res.status === 200) {
      expect(res.body?.data).toHaveProperty('sales');
      expect(res.body?.data).toHaveProperty('leads');
      expect(Array.isArray(res.body?.data?.byCategory)).toBe(true);
      expect(res.body?.data?.byCategory).toHaveLength(4);
      expect(Array.isArray(res.body?.data?.byFirm)).toBe(true);
    }
  });

  itAuthed('GET /api/analytics/channel-partners/commission', async () => {
    const res = await api('GET', '/api/analytics/channel-partners/commission');
    expect([200, 403]).toContain(res.status);
    if (res.status === 200) {
      expect(res.body?.data).toHaveProperty('summary');
      expect(Array.isArray(res.body?.data?.topPerformers)).toBe(true);
    }
  });
});
```

> If `tests/regression/suites/` already has a file numbered `24`, use the next free number in the filename. Confirm the exact import paths and the `api()`/`hasAuthToken()`/`tryAcquireToken()` signatures against `13-analytics-leadership.test.js` and copy them verbatim.

- [ ] **Step 4: Run the regression test**

Run: `npm test -- 24-channel-partner-analytics` (or the repo's documented way to run a single regression suite — check `package.json` and `jest.regression.config.mjs`).
Expected: both tests pass (status `200` against a running seeded server, or skip cleanly if no auth token / server). They must not error on a missing route — a `404` would fail the `[200,403]` assertion, proving the routes are wired.

- [ ] **Step 5: Commit**

```bash
git add controllers/channelPartnerAnalyticsController.js routes/analyticsRoutes.js tests/regression/suites/24-channel-partner-analytics.test.js
git commit -m "feat(channel-partner): add CP analytics web endpoints"
```

---

## Task 5: AI copilot integration — two CP analytics tools

**Files:**
- Modify: `services/copilotFunctions.js`
- Modify: `services/aiCopilotService.js`

`copilotFunctions.js` has a `getDateRange(period, startDate, endDate)` helper (named periods → `{ start, end }`), an exported `copilotTools` array of tool definitions, and a `functionImplementations` map. Implementations have signature `(params, user, accessibleProjectIds)`. `getProjectScopeFilter(accessibleProjectIds)` and `isProjectAccessible(...)` are file-local helpers.

- [ ] **Step 1: Add two tool definitions to `copilotTools`**

In `services/copilotFunctions.js`, add these two objects to the `copilotTools` array (place them next to the existing `get_commission_summary` definition):

```js
  {
    type: 'function',
    function: {
      name: 'get_channel_partner_performance',
      description:
        'Channel partner VOLUME analytics — direct-vs-channel-partner split of sales revenue and leads, breakdown by partner category (broker firm / individual agent / corporate / digital aggregator) and by individual firm, conversion rate, and average deal size. Use for "how much business came through channel partners", "which partner brought the most bookings", "CP vs direct".',
      parameters: {
        type: 'object',
        properties: {
          period: {
            type: 'string',
            enum: ['this_month', 'this_quarter', 'this_year', 'last_month', 'last_quarter'],
            description: 'Time window; defaults to this_year.',
          },
          project_id: { type: 'string', description: 'Optional ObjectId of a project to filter by' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_channel_partner_commission_analytics',
      description:
        'Channel partner COMMISSION analytics — total commission accrued / paid / pending, payment status breakdown, commission per firm, top-performing partners by booked revenue, and the effective commission rate (commission as a % of CP-sourced revenue). Use for "how much commission have we paid channel partners", "what is our pending commission", "top channel partners".',
      parameters: {
        type: 'object',
        properties: {
          period: {
            type: 'string',
            enum: ['this_month', 'this_quarter', 'this_year', 'last_month', 'last_quarter'],
            description: 'Time window; defaults to this_year.',
          },
          project_id: { type: 'string', description: 'Optional ObjectId of a project to filter by' },
        },
      },
    },
  },
```

- [ ] **Step 2: Add the two implementations**

First ensure the service is imported at the top of `services/copilotFunctions.js` (alongside the existing model imports):

```js
import {
  getVolumeBreakdown,
  getCommissionBreakdown,
} from './channelPartnerAnalyticsService.js';
```

Then add these two entries to the `functionImplementations` map (next to `get_commission_summary`):

```js
  get_channel_partner_performance: async (params, user, accessibleProjectIds) => {
    const { start, end } = getDateRange(params.period || 'this_year');
    let projectFilter = {};
    if (params.project_id) {
      if (!isProjectAccessible(accessibleProjectIds, params.project_id)) {
        return { error: 'You do not have access to this project' };
      }
      projectFilter = { project: new mongoose.Types.ObjectId(params.project_id) };
    } else {
      projectFilter = { project: getProjectScopeFilter(accessibleProjectIds) };
    }
    return getVolumeBreakdown({
      organization: user.organization,
      projectFilter,
      startDate: start,
      endDate: end,
    });
  },

  get_channel_partner_commission_analytics: async (params, user, accessibleProjectIds) => {
    const { start, end } = getDateRange(params.period || 'this_year');
    let projectFilter = {};
    if (params.project_id) {
      if (!isProjectAccessible(accessibleProjectIds, params.project_id)) {
        return { error: 'You do not have access to this project' };
      }
      projectFilter = { project: new mongoose.Types.ObjectId(params.project_id) };
    } else {
      projectFilter = { project: getProjectScopeFilter(accessibleProjectIds) };
    }
    return getCommissionBreakdown({
      organization: user.organization,
      projectFilter,
      startDate: start,
      endDate: end,
    });
  },
```

> Note: `getProjectScopeFilter(null)` returns `{ $exists: true }` for full-access users — `{ project: { $exists: true } }` is a harmless no-op match on the Sale/Lead pipelines, and the commission pipeline only adds the sale `$lookup` when `projectFilter.project` is truthy (which `{ $exists: true }` is), so a full-access user still gets a sale lookup that matches everything. That is correct but does an unnecessary lookup; acceptable. Do not optimize further in this task.

- [ ] **Step 3: Gate the commission tool by financial role**

In `services/aiCopilotService.js`, add `'get_channel_partner_commission_analytics'` to the `FINANCIAL_FUNCTIONS` array:

```js
const FINANCIAL_FUNCTIONS = ['get_revenue_analysis', 'get_payment_summary', 'get_overdue_payments', 'get_payments_due_today', 'get_commission_summary', 'get_channel_partner_commission_analytics'];
```

Leave `get_channel_partner_performance` out of the list — it is volume data, available to all roles (consistent with the web volume endpoint being open to Analytics users).

- [ ] **Step 4: Add the intent branch**

In `services/aiCopilotService.js`, in `detectIntent()`, add a branch to the `if/else if` category chain. Place it **before** the existing `n.includes('commission')` branch so the more specific match wins:

```js
  } else if (functionNames.some(n => n.includes('channel_partner'))) {
    category = 'channel_partners';
    confidence = 0.9;
```

- [ ] **Step 5: Smoke-check both files import cleanly**

Run: `node -e "import('./services/copilotFunctions.js').then(m=>console.log('copilot OK', Array.isArray(m.copilotTools)))"`
Expected: prints `copilot OK true`.
Run: `node -e "import('./services/aiCopilotService.js').then(()=>console.log('service OK'))"`
Expected: prints `service OK`.

- [ ] **Step 6: Commit**

```bash
git add services/copilotFunctions.js services/aiCopilotService.js
git commit -m "feat(channel-partner): add CP analytics tools to the AI copilot"
```

---

## Task 6: Frontend — CP form category field + analytics API methods

**Files:**
- Modify: `src/pages/channel-partners/ChannelPartnerFormPage.js`
- Modify: `src/services/api.js`

- [ ] **Step 1: Add `category` to the form's initial state**

In `src/pages/channel-partners/ChannelPartnerFormPage.js`, the `emptyForm` object has `status: 'active'`. Add `category` next to it:

```js
  address: '', status: 'active', category: 'broker_firm',
```

- [ ] **Step 2: Add the Category select to the form JSX**

Immediately after the existing Status `<Grid item>` block (the `<TextField select label="Status" ...>`), add:

```jsx
            <Grid item xs={12} sm={6}>
              <TextField fullWidth select label="Category" value={form.category}
                onChange={(e) => setField('category', e.target.value)}>
                <MenuItem value="broker_firm">Broker Firm</MenuItem>
                <MenuItem value="individual_agent">Individual Agent</MenuItem>
                <MenuItem value="corporate">Corporate</MenuItem>
                <MenuItem value="digital_aggregator">Digital Aggregator</MenuItem>
              </TextField>
            </Grid>
```

`category` is part of `form`, which the existing `save()` handler already sends whole to `createChannelPartner` / `updateChannelPartner` — no submit-handler change needed.

- [ ] **Step 3: Add the analytics API methods**

In `src/services/api.js`, inside the `analyticsAPI` object, add two methods (next to `getDashboardSummary`):

```js
  /**
   * Channel Partner volume analytics — direct-vs-CP, by category, by firm.
   * Params: { dateFrom, dateTo, project }
   */
  getChannelPartnerVolume: (params = {}) =>
    api.get('/analytics/channel-partners/volume', { params }),

  /**
   * Channel Partner commission analytics — gated by channel_partners:view.
   * Params: { dateFrom, dateTo, project }
   */
  getChannelPartnerCommission: (params = {}) =>
    api.get('/analytics/channel-partners/commission', { params }),
```

- [ ] **Step 4: Verify the build**

Run: `CI=true npm run build`
Expected: `Compiled successfully.`

- [ ] **Step 5: Commit**

```bash
git add src/pages/channel-partners/ChannelPartnerFormPage.js src/services/api.js
git commit -m "feat(channel-partner): add category field to CP form + analytics API methods"
```

---

## Task 7: Frontend — Channel Partners tab on Sales Analytics

**Files:**
- Modify: `src/pages/analytics/SalesAnalytics.js`

`SalesAnalytics.js` has `activeTab` state, a `<Tabs>` with three `<Tab>`s, and conditional `{activeTab === N && <SomeTab .../>}` rendering. It holds `filters.period` (values `'all'|'7'|'30'|'90'|'180'|'365'`) and `filters.project`. `generateDateRange(period)` (defined in the file) returns `{ startDate, endDate }` (Date objects, or nulls for `'all'`). The recharts components used in this file: `RechartsBarChart`, `Bar`, `XAxis`, `YAxis`, `CartesianGrid`, `RechartsTooltip`, `ResponsiveContainer`, `RechartsPieChart`, `Pie`, `Cell`.

- [ ] **Step 1: Observe how the existing tab components are defined**

Open `src/pages/analytics/SalesAnalytics.js` and find where `OverviewTab` is defined — either an in-file `function OverviewTab(...)` / `const OverviewTab = ...`, or an `import` from another file. Define the new `ChannelPartnerTab` the **same way** (in-file if they are in-file).

- [ ] **Step 2: Add the `ChannelPartnerTab` component**

Add this component definition alongside the other tab components in the file. It fetches its own data via `analyticsAPI.getChannelPartnerVolume`, converting the page's `period` to ISO dates:

```jsx
function ChannelPartnerTab({ period, project }) {
  const theme = useTheme();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const range = generateDateRange(period);
    const params = {};
    if (range.startDate && range.endDate) {
      params.dateFrom = range.startDate.toISOString();
      params.dateTo = range.endDate.toISOString();
    }
    if (project) params.project = project;
    analyticsAPI
      .getChannelPartnerVolume(params)
      .then((res) => { if (!cancelled) setData(res.data?.data || null); })
      .catch(() => { if (!cancelled) setData(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [period, project]);

  if (loading) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>;

  const hasCP = data && data.sales && data.sales.channelPartner.count > 0;
  if (!hasCP) {
    return <Alert severity="info" sx={{ mt: 1 }}>No channel-partner sales activity in the selected period.</Alert>;
  }

  const CATEGORY_LABELS = {
    broker_firm: 'Broker Firm',
    individual_agent: 'Individual Agent',
    corporate: 'Corporate',
    digital_aggregator: 'Digital Aggregator',
  };
  const fmtCr = (n) => `₹${(Number(n || 0) / 10000000).toFixed(2)} Cr`;
  const splitData = [
    { name: 'Direct', value: data.sales.direct.revenue, fill: theme.palette.grey[500] },
    { name: 'Channel Partner', value: data.sales.channelPartner.revenue, fill: theme.palette.primary.main },
  ];
  const categoryData = data.byCategory.map((c) => ({
    name: CATEGORY_LABELS[c.category] || c.category,
    revenue: c.revenue,
  }));

  return (
    <Grid container spacing={2}>
      <Grid item xs={12} md={4}>
        <Card variant="outlined"><CardContent>
          <Typography variant="subtitle2" color="text.secondary">Direct vs Channel Partner — Revenue</Typography>
          <ResponsiveContainer width="100%" height={240}>
            <RechartsPieChart>
              <Pie data={splitData} cx="50%" cy="50%" outerRadius={80} dataKey="value"
                label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={false}>
                {splitData.map((e, i) => <Cell key={i} fill={e.fill} />)}
              </Pie>
              <RechartsTooltip formatter={(v) => fmtCr(v)} />
            </RechartsPieChart>
          </ResponsiveContainer>
        </CardContent></Card>
      </Grid>
      <Grid item xs={12} md={4}>
        <Card variant="outlined"><CardContent>
          <Typography variant="subtitle2" color="text.secondary">Channel Partner Sales</Typography>
          <Typography variant="h4" sx={{ mt: 1 }}>{data.sales.channelPartner.count}</Typography>
          <Typography variant="body2" color="text.secondary">{fmtCr(data.sales.channelPartner.revenue)} revenue</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            {data.sales.cpSharePct}% of total revenue
          </Typography>
        </CardContent></Card>
      </Grid>
      <Grid item xs={12} md={4}>
        <Card variant="outlined"><CardContent>
          <Typography variant="subtitle2" color="text.secondary">Avg Deal Size</Typography>
          <Typography variant="body2" sx={{ mt: 1 }}>Direct: {fmtCr(data.avgDealSize.direct)}</Typography>
          <Typography variant="body2">Channel Partner: {fmtCr(data.avgDealSize.channelPartner)}</Typography>
        </CardContent></Card>
      </Grid>
      <Grid item xs={12} md={6}>
        <Card variant="outlined"><CardContent>
          <Typography variant="subtitle2" color="text.secondary" gutterBottom>Revenue by Partner Category</Typography>
          <ResponsiveContainer width="100%" height={260}>
            <RechartsBarChart data={categoryData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tickFormatter={(v) => `${(v / 10000000).toFixed(0)}Cr`} tick={{ fontSize: 11 }} />
              <RechartsTooltip formatter={(v) => fmtCr(v)} />
              <Bar dataKey="revenue" fill={theme.palette.primary.main} radius={[4, 4, 0, 0]} />
            </RechartsBarChart>
          </ResponsiveContainer>
        </CardContent></Card>
      </Grid>
      <Grid item xs={12} md={6}>
        <Card variant="outlined"><CardContent>
          <Typography variant="subtitle2" color="text.secondary" gutterBottom>By Partner Firm</Typography>
          <Table size="small">
            <TableHead><TableRow>
              <TableCell>Firm</TableCell><TableCell>Category</TableCell>
              <TableCell align="right">Bookings</TableCell><TableCell align="right">Revenue</TableCell>
            </TableRow></TableHead>
            <TableBody>
              {data.byFirm.map((r) => (
                <TableRow key={r.channelPartnerId}>
                  <TableCell>{r.firmName}</TableCell>
                  <TableCell>{CATEGORY_LABELS[r.category] || r.category}</TableCell>
                  <TableCell align="right">{r.sales}</TableCell>
                  <TableCell align="right">{fmtCr(r.revenue)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent></Card>
      </Grid>
    </Grid>
  );
}
```

- [ ] **Step 3: Ensure required imports exist**

At the top of `src/pages/analytics/SalesAnalytics.js`, confirm these are imported (add any missing): from `@mui/material` — `Card`, `CardContent`, `Grid`, `Typography`, `Box`, `CircularProgress`, `Alert`, `Table`, `TableHead`, `TableBody`, `TableRow`, `TableCell`, `useTheme`; from `react` — `useState`, `useEffect`; `analyticsAPI` from `../../services/api` (match the path style of the existing `salesAPI` import in this file). The recharts components listed in this task's intro are already imported (the file uses them) — verify and add any that are not.

- [ ] **Step 4: Add the tab to the `<Tabs>` and the render switch**

Add a fourth `<Tab>` after the existing three:

```jsx
    <Tab label="Channel Partners" sx={{ textTransform: 'none', fontWeight: 600 }} />
```

And add the render branch after the existing `{activeTab === 2 && ...}` block:

```jsx
    {activeTab === 3 && (
      <ChannelPartnerTab period={filters.period} project={filters.project} />
    )}
```

- [ ] **Step 5: Verify the build**

Run: `CI=true npm run build`
Expected: `Compiled successfully.`

- [ ] **Step 6: Commit**

```bash
git add src/pages/analytics/SalesAnalytics.js
git commit -m "feat(channel-partner): add Channel Partners tab to Sales Analytics"
```

---

## Task 8: Frontend — Channel Partners tab on Lead Analytics

**Files:**
- Modify: `src/pages/analytics/LeadAnalytics.js`

`LeadAnalytics.js` mirrors `SalesAnalytics.js`: `activeTab` state, three `<Tab>`s, `filters.period` (`'all'|'7'|'30'|...|'365'`), `filters.project`. It does NOT have a `generateDateRange` helper — it computes dates inline (`parseInt(days)`). The new tab fetches the SAME `getChannelPartnerVolume` endpoint but renders the lead-focused fields.

- [ ] **Step 1: Observe the existing tab component definition style**

Same as Task 7 Step 1 — find how `OverviewTab` is defined in `LeadAnalytics.js` and match it.

- [ ] **Step 2: Add the `ChannelPartnerLeadTab` component**

Add alongside the other tab components in `LeadAnalytics.js`:

```jsx
function ChannelPartnerLeadTab({ period, project }) {
  const theme = useTheme();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const params = {};
    if (period && period !== 'all') {
      const days = parseInt(period, 10);
      if (!isNaN(days)) {
        const to = new Date();
        const from = new Date();
        from.setDate(to.getDate() - days);
        params.dateFrom = from.toISOString();
        params.dateTo = to.toISOString();
      }
    }
    if (project) params.project = project;
    analyticsAPI
      .getChannelPartnerVolume(params)
      .then((res) => { if (!cancelled) setData(res.data?.data || null); })
      .catch(() => { if (!cancelled) setData(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [period, project]);

  if (loading) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>;

  const hasCP = data && data.leads && data.leads.channelPartner.count > 0;
  if (!hasCP) {
    return <Alert severity="info" sx={{ mt: 1 }}>No channel-partner lead activity in the selected period.</Alert>;
  }

  const CATEGORY_LABELS = {
    broker_firm: 'Broker Firm',
    individual_agent: 'Individual Agent',
    corporate: 'Corporate',
    digital_aggregator: 'Digital Aggregator',
  };
  const splitData = [
    { name: 'Direct', value: data.leads.direct.count, fill: theme.palette.grey[500] },
    { name: 'Channel Partner', value: data.leads.channelPartner.count, fill: theme.palette.primary.main },
  ];
  const categoryData = data.byCategory.map((c) => ({
    name: CATEGORY_LABELS[c.category] || c.category,
    leads: c.leads,
  }));

  return (
    <Grid container spacing={2}>
      <Grid item xs={12} md={4}>
        <Card variant="outlined"><CardContent>
          <Typography variant="subtitle2" color="text.secondary">Direct vs Channel Partner — Leads</Typography>
          <ResponsiveContainer width="100%" height={240}>
            <RechartsPieChart>
              <Pie data={splitData} cx="50%" cy="50%" outerRadius={80} dataKey="value"
                label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={false}>
                {splitData.map((e, i) => <Cell key={i} fill={e.fill} />)}
              </Pie>
              <RechartsTooltip />
            </RechartsPieChart>
          </ResponsiveContainer>
        </CardContent></Card>
      </Grid>
      <Grid item xs={12} md={4}>
        <Card variant="outlined"><CardContent>
          <Typography variant="subtitle2" color="text.secondary">Channel Partner Leads</Typography>
          <Typography variant="h4" sx={{ mt: 1 }}>{data.leads.channelPartner.count}</Typography>
          <Typography variant="body2" color="text.secondary">{data.leads.cpSharePct}% of total leads</Typography>
        </CardContent></Card>
      </Grid>
      <Grid item xs={12} md={4}>
        <Card variant="outlined"><CardContent>
          <Typography variant="subtitle2" color="text.secondary">Conversion Rate</Typography>
          <Typography variant="body2" sx={{ mt: 1 }}>Direct: {data.conversion.direct}%</Typography>
          <Typography variant="body2">Channel Partner: {data.conversion.channelPartner}%</Typography>
        </CardContent></Card>
      </Grid>
      <Grid item xs={12} md={6}>
        <Card variant="outlined"><CardContent>
          <Typography variant="subtitle2" color="text.secondary" gutterBottom>Leads by Partner Category</Typography>
          <ResponsiveContainer width="100%" height={260}>
            <RechartsBarChart data={categoryData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <RechartsTooltip />
              <Bar dataKey="leads" fill={theme.palette.primary.main} radius={[4, 4, 0, 0]} />
            </RechartsBarChart>
          </ResponsiveContainer>
        </CardContent></Card>
      </Grid>
      <Grid item xs={12} md={6}>
        <Card variant="outlined"><CardContent>
          <Typography variant="subtitle2" color="text.secondary" gutterBottom>By Partner Firm</Typography>
          <Table size="small">
            <TableHead><TableRow>
              <TableCell>Firm</TableCell><TableCell>Category</TableCell>
              <TableCell align="right">Leads</TableCell><TableCell align="right">Bookings</TableCell>
              <TableCell align="right">Conv %</TableCell>
            </TableRow></TableHead>
            <TableBody>
              {data.byFirm.map((r) => (
                <TableRow key={r.channelPartnerId}>
                  <TableCell>{r.firmName}</TableCell>
                  <TableCell>{CATEGORY_LABELS[r.category] || r.category}</TableCell>
                  <TableCell align="right">{r.leads}</TableCell>
                  <TableCell align="right">{r.sales}</TableCell>
                  <TableCell align="right">{r.conversionPct}%</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent></Card>
      </Grid>
    </Grid>
  );
}
```

- [ ] **Step 3: Ensure required imports exist**

Same import checklist as Task 7 Step 3, applied to `LeadAnalytics.js` (MUI components, react hooks, `analyticsAPI`, recharts components — add any missing).

- [ ] **Step 4: Add the tab and render branch**

Add a fourth `<Tab label="Channel Partners" sx={{ textTransform: 'none', fontWeight: 600 }} />` after the existing three, and after the `{activeTab === 2 && ...}` block add:

```jsx
    {activeTab === 3 && (
      <ChannelPartnerLeadTab period={filters.period} project={filters.project} />
    )}
```

- [ ] **Step 5: Verify the build**

Run: `CI=true npm run build`
Expected: `Compiled successfully.`

- [ ] **Step 6: Commit**

```bash
git add src/pages/analytics/LeadAnalytics.js
git commit -m "feat(channel-partner): add Channel Partners tab to Lead Analytics"
```

---

## Task 9: Frontend — Channel Partner section on the Analytics Overview

**Files:**
- Modify: `src/pages/analytics/AnalyticsDashboard.js`

`AnalyticsDashboard.js` holds `period` state (`'month'|'quarter'|'year'`) and `projectFilter` (`'all'` or an id). Its `fetchData` `useCallback` runs on `[period, projectFilter]`. Permission helper: `const { canAccess } = useAuth()` then `canAccess.channelPartners()` returns whether the user has `channel_partners:view`.

- [ ] **Step 1: Add a period→date-range helper near the top of the file**

`AnalyticsDashboard.js` uses named periods (`month`/`quarter`/`year`). Add this helper just below the `TIME_PERIODS` constant:

```js
// Convert the dashboard's named period into an ISO date range for CP analytics.
const periodToRange = (period) => {
  const now = new Date();
  let start;
  if (period === 'month') start = new Date(now.getFullYear(), now.getMonth(), 1);
  else if (period === 'quarter') start = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
  else start = new Date(now.getFullYear(), 0, 1); // 'year'
  return { dateFrom: start.toISOString(), dateTo: now.toISOString() };
};
```

- [ ] **Step 2: Add CP state and a fetch effect**

Add state near the other `useState` declarations:

```js
  const [cpVolume, setCpVolume] = useState(null);
  const [cpCommission, setCpCommission] = useState(null);
```

The component already has `const { canAccess } = useAuth();` — if not, add it (match how `useAuth` is imported/used elsewhere in the file or in `SalesAnalytics.js`). Then add this effect after the existing `useEffect` that calls `fetchData`:

```js
  useEffect(() => {
    const range = periodToRange(period);
    const params = { ...range };
    if (projectFilter !== 'all') params.project = projectFilter;

    analyticsAPI.getChannelPartnerVolume(params)
      .then((res) => setCpVolume(res.data?.data || null))
      .catch(() => setCpVolume(null));

    if (canAccess?.channelPartners?.()) {
      analyticsAPI.getChannelPartnerCommission(params)
        .then((res) => setCpCommission(res.data?.data || null))
        .catch(() => setCpCommission(null));
    } else {
      setCpCommission(null);
    }
  }, [period, projectFilter, canAccess]);
```

- [ ] **Step 3: Add the CP section to the render output**

Near the bottom of the dashboard's JSX, after the last existing chart/list `<Grid container>` and before the closing wrapper, add:

```jsx
      {/* ─── Channel Partner Contribution ─────────────────────────── */}
      {cpVolume && cpVolume.sales && cpVolume.sales.channelPartner.count > 0 && (
        <Grid container spacing={{ xs: 1.5, sm: 2 }} sx={{ mb: { xs: 2, sm: 3 } }}>
          <Grid item xs={12} md={cpCommission ? 4 : 12}>
            <ChartCard title="Channel Partner Contribution" loading={false} minHeight={160}>
              <Box sx={{ p: 1 }}>
                <Typography variant="body2" color="text.secondary">Share of revenue via channel partners</Typography>
                <Typography variant="h4">{cpVolume.sales.cpSharePct}%</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                  Share of leads via channel partners
                </Typography>
                <Typography variant="h5">{cpVolume.leads.cpSharePct}%</Typography>
              </Box>
            </ChartCard>
          </Grid>

          {cpCommission && (
            <>
              <Grid item xs={12} md={4}>
                <ChartCard title="Commission & Payouts" loading={false} minHeight={160}>
                  <Box sx={{ p: 1 }}>
                    <Typography variant="body2" color="text.secondary">Net commission accrued</Typography>
                    <Typography variant="h5">{fmtCurrency(cpCommission.summary.netAccrued)}</Typography>
                    <Typography variant="body2" sx={{ mt: 1 }}>
                      Paid: {fmtCurrency(cpCommission.summary.paid)} &nbsp;•&nbsp;
                      Pending: {fmtCurrency(cpCommission.summary.pending)}
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                      Effective commission rate
                    </Typography>
                    <Typography variant="h6">{cpCommission.effectiveCommissionRate}%</Typography>
                  </Box>
                </ChartCard>
              </Grid>
              <Grid item xs={12} md={4}>
                <ChartCard title="Top Channel Partners" loading={false} minHeight={160}>
                  <Table size="small">
                    <TableHead><TableRow>
                      <TableCell>Firm</TableCell>
                      <TableCell align="right">Booked</TableCell>
                      <TableCell align="right">Commission</TableCell>
                    </TableRow></TableHead>
                    <TableBody>
                      {cpCommission.topPerformers.slice(0, 5).map((r) => (
                        <TableRow key={r.channelPartnerId}>
                          <TableCell>{r.firmName}</TableCell>
                          <TableCell align="right">{fmtCurrency(r.bookedRevenue)}</TableCell>
                          <TableCell align="right">{fmtCurrency(r.netCommission)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ChartCard>
              </Grid>
            </>
          )}
        </Grid>
      )}
```

> `fmtCurrency` and `ChartCard` are already used in this file (see the existing charts/KPIs). Reuse them exactly as-is. If `fmtCurrency` is named differently in the file, use that name. Confirm `Table`, `TableHead`, `TableBody`, `TableRow`, `TableCell`, `Box`, `Typography`, `Grid` are imported — add any missing.

- [ ] **Step 4: Verify the build**

Run: `CI=true npm run build`
Expected: `Compiled successfully.`

- [ ] **Step 5: Commit**

```bash
git add src/pages/analytics/AnalyticsDashboard.js
git commit -m "feat(channel-partner): add CP contribution + commission section to Analytics Overview"
```

---

## Task 10: Manual verification

**No files changed.** This task confirms the feature works end-to-end on the demo org.

- [ ] **Step 1: Backend — backfill + seeder**

If the demo DB has CP records predating the `category` field, run `node data/backfillChannelPartnerCategory.js`. If re-seeding the demo org, the updated `mumbaiLuxuryCPSeeder.js` assigns categories automatically.

- [ ] **Step 2: Web UI — list pages**

On the demo org: open **Analytics → Sales Analytics**, click the **Channel Partners** tab — confirm the Direct-vs-CP donut, category bar chart, and per-firm table render. Repeat on **Analytics → Lead Analytics**. Change the Period filter and confirm the data updates.

- [ ] **Step 3: Web UI — Overview**

Open **Analytics → Overview**. Confirm the "Channel Partner Contribution" card shows. As a user WITH `channel_partners:view`, confirm "Commission & Payouts" and "Top Channel Partners" also show. As a user WITHOUT it, confirm only the Contribution card shows and no commission request is made (check the network tab — `/commission` should not be called).

- [ ] **Step 4: CP form**

Open **Channel Partners → add/edit a partner**. Confirm the **Category** dropdown appears, saves, and persists on reload.

- [ ] **Step 5: AI copilot**

Open the copilot chat. As a financial-role user, ask *"how much revenue came through channel partners this year?"* and *"what is our pending channel partner commission?"* — confirm both answer with real numbers. As a Sales Executive, ask the commission question — confirm it is refused (access denied), while the performance question still answers.

---

## Notes for the executor

- **Test approach deviation from spec:** The spec's testing section assumed service-level unit tests. This repo has no unit-test/in-memory-DB infrastructure — backend tests are regression smoke tests against a live API (`tests/regression/suites/`). Task 4 follows the repo's actual pattern. This is a deliberate, documented adaptation.
- **Backend Tasks 1-5** can be implemented and reviewed before the frontend; the frontend (Tasks 6-9) depends on the endpoints from Task 4 existing but does not need them deployed to compile.
- **Do not push.** All tasks commit locally only. Pushing/deploying is a separate, user-authorized step.
