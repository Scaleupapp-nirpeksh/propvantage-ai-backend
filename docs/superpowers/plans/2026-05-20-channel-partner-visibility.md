# Channel Partner Visibility on Leads & Sales — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface each lead's / booking's channel-partner attribution on the Leads and Sales list pages (a column + a filter) and on the lead-detail and sale-detail pages (a Channel Partner card).

**Architecture:** The `Lead` and `Sale` models already carry a `channelPartnerAttribution` sub-document. This plan only adds *display* and *filtering*: the list/detail endpoints populate the partner firm name and the list endpoints accept a `channelPartner` filter param; the frontend renders a compact CP cell on the list rows, a CP filter dropdown, and a read-only CP card (one shared component) on both detail pages.

**Tech Stack:** Backend — Node/Express/Mongoose. Frontend — React 18 + MUI v5.

**Context:** This is a follow-on to the Channel Partner module (Plans 1-3, already shipped). It captures no new data — `channelPartnerAttribution` is set on the create forms and stored on Lead/Sale; this plan just shows it back.

**Two repos:**
- Backend: `/Users/nirpekshnandan/My Products/propvantage-ai-backend`
- Frontend: `/Users/nirpekshnandan/My Products/propvantage-ai-frontend`

All paths in each task are relative to the repo named in that task's **Files** block. Work on `main`; commit per task with the given messages; do **not** push.

---

## Task 1: Backend — lead list & detail expose channel partner

**Files:**
- Modify (backend): `controllers/leadController.js`

- [ ] **Step 1: `getLeads` — accept the filter, select + populate the field**

In `getLeads`, the query params are destructured. The current block is:

```js
  const {
    page = 1, limit = 10, status, source, assignedTo, project,
    minScore, maxScore, priority, qualificationStatus,
    sortBy = 'score', sortOrder = 'desc', search
  } = req.query;
```

Add `channelPartner`:

```js
  const {
    page = 1, limit = 10, status, source, assignedTo, project,
    minScore, maxScore, priority, qualificationStatus,
    sortBy = 'score', sortOrder = 'desc', search, channelPartner
  } = req.query;
```

Then the query-building block has `if (project) query.project = project;`. Add directly after it:

```js
  if (project) query.project = project;
  if (channelPartner) {
    query['channelPartnerAttribution.partners.channelPartner'] = channelPartner;
  }
```

Then the `.find(query)` chain currently is:

```js
  const leads = await Lead.find(query)
    .populate('project', 'name location')
    .populate('assignedTo', 'firstName lastName')
    .sort(sort)
    .limit(limit * 1)
    .skip((page - 1) * limit)
    .select('firstName lastName phone email score scoreGrade priority confidence qualificationStatus status source createdAt lastScoreUpdate assignedTo project engagementMetrics followUpSchedule');
```

Change it to also populate the partner firm and include `channelPartnerAttribution` in the projection:

```js
  const leads = await Lead.find(query)
    .populate('project', 'name location')
    .populate('assignedTo', 'firstName lastName')
    .populate('channelPartnerAttribution.partners.channelPartner', 'firmName')
    .sort(sort)
    .limit(limit * 1)
    .skip((page - 1) * limit)
    .select('firstName lastName phone email score scoreGrade priority confidence qualificationStatus status source createdAt lastScoreUpdate assignedTo project engagementMetrics followUpSchedule channelPartnerAttribution');
```

- [ ] **Step 2: `getLeadById` — populate the partner firm + agent**

In `getLeadById`, the current chain is:

```js
  const lead = await Lead.findOne({
    _id: req.params.id,
    organization: req.user.organization,
  })
    .populate('project', 'name targetRevenue location')
    .populate('assignedTo', 'firstName lastName email');
```

Add two populate calls:

```js
  const lead = await Lead.findOne({
    _id: req.params.id,
    organization: req.user.organization,
  })
    .populate('project', 'name targetRevenue location')
    .populate('assignedTo', 'firstName lastName email')
    .populate('channelPartnerAttribution.partners.channelPartner', 'firmName')
    .populate('channelPartnerAttribution.partners.agent', 'name');
```

- [ ] **Step 3: Verify the file parses**

Run (from the backend repo root):

```bash
node --check controllers/leadController.js
```

Expected: no output, exit code 0.

- [ ] **Step 4: Commit**

```bash
git add controllers/leadController.js
git commit -m "feat(channel-partner): expose CP attribution on lead list + detail"
```

---

## Task 2: Backend — sale list & detail expose channel partner

**Files:**
- Modify (backend): `controllers/salesController.js`

- [ ] **Step 1: `getSales` — accept the filter**

In `getSales`, the query params block is:

```js
  const {
    page = 1, limit = 25, search = '', status = '', paymentStatus = '',
    project = '', salesperson = '', dateFrom = '', dateTo = '',
    sortBy = 'bookingDate', sortOrder = 'desc'
  } = req.query;
```

Add `channelPartner`:

```js
  const {
    page = 1, limit = 25, search = '', status = '', paymentStatus = '',
    project = '', salesperson = '', dateFrom = '', dateTo = '',
    sortBy = 'bookingDate', sortOrder = 'desc', channelPartner = ''
  } = req.query;
```

The filter block has `if (salesperson && salesperson !== 'all') baseFilters.salesPerson = salesperson;`. Add directly after it:

```js
  if (salesperson && salesperson !== 'all') baseFilters.salesPerson = salesperson;
  if (channelPartner && channelPartner !== 'all') {
    baseFilters['channelPartnerAttribution.partners.channelPartner'] = channelPartner;
  }
```

- [ ] **Step 2: `getSales` — populate the partner firm on both query paths**

`getSales` has two populate paths. The regular `salesQuery` chain:

```js
  const salesQuery = Sale.find(baseFilters)
    .populate('project', 'name location type status')
    .populate('unit', 'unitNumber fullAddress floor area')
    .populate('lead', 'firstName lastName email phone source priority')
    .populate('salesPerson', 'firstName lastName email role')
    .sort(sort)
    .skip(skip)
    .limit(pageSize);
```

Add the partner populate:

```js
  const salesQuery = Sale.find(baseFilters)
    .populate('project', 'name location type status')
    .populate('unit', 'unitNumber fullAddress floor area')
    .populate('lead', 'firstName lastName email phone source priority')
    .populate('salesPerson', 'firstName lastName email role')
    .populate('channelPartnerAttribution.partners.channelPartner', 'firmName')
    .sort(sort)
    .skip(skip)
    .limit(pageSize);
```

And the search/aggregation path's `Sale.populate(...)` array:

```js
    const populatedSales = await Sale.populate(salesData, [
      { path: 'project', select: 'name location type status' },
      { path: 'unit', select: 'unitNumber fullAddress floor area' },
      { path: 'lead', select: 'firstName lastName email phone source priority' },
      { path: 'salesPerson', select: 'firstName lastName email role' }
    ]);
```

Add the partner path:

```js
    const populatedSales = await Sale.populate(salesData, [
      { path: 'project', select: 'name location type status' },
      { path: 'unit', select: 'unitNumber fullAddress floor area' },
      { path: 'lead', select: 'firstName lastName email phone source priority' },
      { path: 'salesPerson', select: 'firstName lastName email role' },
      { path: 'channelPartnerAttribution.partners.channelPartner', select: 'firmName' }
    ]);
```

- [ ] **Step 3: `getSale` — populate the partner firm + agent**

In `getSale`, the chain is:

```js
  const sale = await Sale.findOne({
    _id: id,
    organization: req.user.organization
  })
    .populate('project', 'name location type status configuration')
    .populate('unit', 'unitNumber fullAddress floor area bedrooms bathrooms')
    .populate('lead', 'firstName lastName email phone source priority requirements')
    .populate('salesPerson', 'firstName lastName email role')
    .populate('paymentPlan');
```

Add the two partner populate calls:

```js
  const sale = await Sale.findOne({
    _id: id,
    organization: req.user.organization
  })
    .populate('project', 'name location type status configuration')
    .populate('unit', 'unitNumber fullAddress floor area bedrooms bathrooms')
    .populate('lead', 'firstName lastName email phone source priority requirements')
    .populate('salesPerson', 'firstName lastName email role')
    .populate('paymentPlan')
    .populate('channelPartnerAttribution.partners.channelPartner', 'firmName')
    .populate('channelPartnerAttribution.partners.agent', 'name');
```

- [ ] **Step 4: Verify the file parses**

Run (from the backend repo root):

```bash
node --check controllers/salesController.js
```

Expected: no output, exit code 0.

- [ ] **Step 5: Commit**

```bash
git add controllers/salesController.js
git commit -m "feat(channel-partner): expose CP attribution on sale list + detail"
```

---

## Task 3: Frontend — shared CP attribution display component

**Files:**
- Create (frontend): `src/components/channel-partners/ChannelPartnerAttributionSummary.js`

A read-only display of a `channelPartnerAttribution` object — used by both detail pages.

- [ ] **Step 1: Create `src/components/channel-partners/ChannelPartnerAttributionSummary.js`**

```jsx
// File: src/components/channel-partners/ChannelPartnerAttributionSummary.js
// Description: Read-only display of a lead/sale channelPartnerAttribution —
//   the sourcing channel partner(s), their agent, and the commission split.

import React from 'react';
import { Box, Typography, Chip, Stack } from '@mui/material';

const ChannelPartnerAttributionSummary = ({ attribution }) => {
  const a = attribution || {};
  const partners = a.partners || [];

  if (!a.viaChannelPartner || partners.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        Direct — not sourced through a channel partner.
      </Typography>
    );
  }

  return (
    <Stack spacing={1.5}>
      {partners.map((p, i) => {
        const firm =
          (p.channelPartner && p.channelPartner.firmName) || 'Channel partner';
        const agent = p.agent && p.agent.name;
        return (
          <Box
            key={i}
            sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}
          >
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
                {firm}
              </Typography>
              {agent && (
                <Typography variant="caption" color="text.secondary">
                  Agent: {agent}
                </Typography>
              )}
            </Box>
            <Chip size="small" label={`${p.sharePct ?? 0}%`} />
          </Box>
        );
      })}
    </Stack>
  );
};

export default ChannelPartnerAttributionSummary;
```

- [ ] **Step 2: Commit**

```bash
git add src/components/channel-partners/ChannelPartnerAttributionSummary.js
git commit -m "feat(channel-partner): add read-only CP attribution summary component"
```

---

## Task 4: Frontend — Leads list: CP column + filter

**Files:**
- Modify (frontend): `src/pages/leads/LeadsListPage.js`

- [ ] **Step 1: Load channel partners for the filter dropdown**

`LeadsListPage` already loads `projects` into state for the project filter. Find the `projects` state declaration (`const [projects, setProjects] = useState([])` or similar) and add a sibling:

```js
  const [channelPartners, setChannelPartners] = useState([]);
```

Find where `projects` is fetched (a `useEffect` calling `projectAPI.getProjects()` or similar). In that same effect — or a new `useEffect(() => { ... }, [])` next to it — fetch channel partners. Add the import for `channelPartnerAPI` to the existing `../../services/api` import line if not present, then:

```js
  useEffect(() => {
    channelPartnerAPI
      .getChannelPartners({ status: 'active' })
      .then((res) => setChannelPartners(res.data?.data || []))
      .catch(() => setChannelPartners([]));
  }, []);
```

- [ ] **Step 2: Add `channelPartner` to the filters state**

The page has a `filters` state object (`{ search, status, priority, source, project, ... }`). Add `channelPartner: ''` to its initial value, and to any `clearFilters` reset object that resets each key to `''`.

- [ ] **Step 3: Add the filter control**

The `filterConfig` array is:

```js
  const filterConfig = [
    { key: 'search', type: 'search', label: 'Leads', placeholder: 'Search leads...' },
    { key: 'status', type: 'select', label: 'Status', options: LEAD_STATUSES.map(s => ({ value: s, label: s })) },
    { key: 'priority', type: 'select', label: 'Priority', options: PRIORITIES.map(p => ({ value: p, label: p })) },
    { key: 'source', type: 'select', label: 'Source', options: LEAD_SOURCES.map(s => ({ value: s, label: s })) },
    { key: 'project', type: 'select', label: 'Project', options: projects.map(p => ({ value: p._id, label: p.name })) },
  ];
```

Add a Channel Partner entry after `project`:

```js
  const filterConfig = [
    { key: 'search', type: 'search', label: 'Leads', placeholder: 'Search leads...' },
    { key: 'status', type: 'select', label: 'Status', options: LEAD_STATUSES.map(s => ({ value: s, label: s })) },
    { key: 'priority', type: 'select', label: 'Priority', options: PRIORITIES.map(p => ({ value: p, label: p })) },
    { key: 'source', type: 'select', label: 'Source', options: LEAD_SOURCES.map(s => ({ value: s, label: s })) },
    { key: 'project', type: 'select', label: 'Project', options: projects.map(p => ({ value: p._id, label: p.name })) },
    { key: 'channelPartner', type: 'select', label: 'Channel Partner', options: channelPartners.map(cp => ({ value: cp._id, label: cp.firmName })) },
  ];
```

The page already passes the `filters` object's keys as query params to `leadAPI.getLeads` — confirm `channelPartner` flows through (it will, since the page spreads `filters` into the request params). If the page maps filters to params explicitly key-by-key, add `channelPartner` to that mapping.

- [ ] **Step 4: Add the Channel Partner column**

The page has a `columns` array. Each column is an object with a `key`, a header label, an optional `render` function, and flags like `hideOnMobile`. Read the existing `source` and `project` column objects to get the **exact** column-object shape used in this file (the key names — e.g. `label` vs `header`, `render(row)` vs `render(value, row)`).

Add a new column, placed after the `project` column, matching that exact shape. The cell content:

```jsx
// render: a compact channel-partner cell
(row) => {
  const a = row.channelPartnerAttribution;
  if (!a || !a.viaChannelPartner || !(a.partners || []).length) {
    return <Typography variant="body2" color="text.secondary">—</Typography>;
  }
  const first = (a.partners[0]?.channelPartner?.firmName) || 'Channel partner';
  const extra = a.partners.length > 1 ? ` +${a.partners.length - 1}` : '';
  return <Chip size="small" label={`${first}${extra}`} />;
}
```

Mark the column `hideOnMobile: true` (consistent with `source`/`project`). Ensure `Chip` and `Typography` are imported from `@mui/material` in this file (they almost certainly already are — confirm).

- [ ] **Step 5: Verify the build compiles**

Run (from the frontend repo root):

```bash
CI=true npm run build
```

Expected: `Compiled successfully.`

- [ ] **Step 6: Commit**

```bash
git add src/pages/leads/LeadsListPage.js
git commit -m "feat(channel-partner): add CP column + filter to the leads list"
```

---

## Task 5: Frontend — Lead detail: Channel Partner card

**Files:**
- Modify (frontend): `src/pages/leads/LeadDetailPage.js`

- [ ] **Step 1: Import the summary component**

In `src/pages/leads/LeadDetailPage.js`, add near the other component imports:

```js
import ChannelPartnerAttributionSummary from '../../components/channel-partners/ChannelPartnerAttributionSummary';
```

- [ ] **Step 2: Add a Channel Partner card to `LeadOverview`**

`LeadOverview` returns a `<Grid container spacing={3}>` with cards. The third card is "Lead Management" (`<Grid item xs={12} md={6}>`). Immediately after that card's closing `</Grid>`, add a new card:

```jsx
      {/* Channel Partner */}
      <Grid item xs={12} md={6}>
        <Card>
          <CardContent>
            <Typography
              variant="h6"
              sx={{ fontWeight: 600, mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}
            >
              <Handshake color="primary" />
              Channel Partner
            </Typography>
            <ChannelPartnerAttributionSummary attribution={lead.channelPartnerAttribution} />
          </CardContent>
        </Card>
      </Grid>
```

`Handshake` must be imported from `@mui/icons-material`. Check the existing `@mui/icons-material` import in this file; if `Handshake` is not there, add it to that import. (`Card`, `CardContent`, `Typography`, `Grid` are already imported — they are used by the neighbouring cards.)

- [ ] **Step 3: Verify the build compiles**

Run (from the frontend repo root):

```bash
CI=true npm run build
```

Expected: `Compiled successfully.`

- [ ] **Step 4: Commit**

```bash
git add src/pages/leads/LeadDetailPage.js
git commit -m "feat(channel-partner): show CP attribution on the lead detail page"
```

---

## Task 6: Frontend — Sales list: CP column + filter

**Files:**
- Modify (frontend): `src/pages/sales/SalesListPage.js`

- [ ] **Step 1: Load channel partners for the filter dropdown**

`SalesListPage` already loads `projects` and `users` into state. Add a sibling state:

```js
  const [channelPartners, setChannelPartners] = useState([]);
```

In the same place those are fetched (or a new `useEffect(() => { ... }, [])`), fetch channel partners. Ensure `channelPartnerAPI` is imported from `../../services/api`, then:

```js
  useEffect(() => {
    channelPartnerAPI
      .getChannelPartners({ status: 'active' })
      .then((res) => setChannelPartners(res.data?.data || []))
      .catch(() => setChannelPartners([]));
  }, []);
```

- [ ] **Step 2: Add `channelPartner` to the filters state**

The `filters` state is `{ search, status, paymentStatus, project, salesperson, sortBy, sortOrder }`. Add `channelPartner: ''` to its initial value, and to the `clearFilters` reset object (which resets keys to `''`).

- [ ] **Step 3: Add the filter control**

The `filterConfig` array is:

```js
  const filterConfig = [
    { key: 'search', type: 'search', label: 'Sales', placeholder: 'Search customer, sale number, unit...' },
    { key: 'status', type: 'select', label: 'Status', options: SALE_STATUSES.map(s => ({ value: s.value, label: s.label })) },
    { key: 'paymentStatus', type: 'select', label: 'Payment', options: PAYMENT_STATUSES.map(s => ({ value: s.value, label: s.label })) },
    { key: 'project', type: 'select', label: 'Project', options: projects.map(p => ({ value: p._id, label: p.name })) },
    { key: 'salesperson', type: 'select', label: 'Salesperson', options: users.filter(u => u.role?.includes('Sales')).map(u => ({ value: u._id, label: `${u.firstName} ${u.lastName}` })) },
  ];
```

Add a Channel Partner entry at the end:

```js
    { key: 'channelPartner', type: 'select', label: 'Channel Partner', options: channelPartners.map(cp => ({ value: cp._id, label: cp.firmName })) },
```

If the page maps filter keys to request params explicitly, add `channelPartner` to that mapping so it reaches `salesAPI.getSales`.

- [ ] **Step 4: Add the Channel Partner column**

The `columns` array has columns `customer`, `project`, `salePrice`, `status`, `paymentStatus`, `salesPerson`, `bookingDate`, `actions`. Read the existing `salesPerson` column object to get the exact column-object shape. Add a new column placed after `salesPerson`, matching that shape, with this cell content:

```jsx
// render: a compact channel-partner cell
(row) => {
  const a = row.channelPartnerAttribution;
  if (!a || !a.viaChannelPartner || !(a.partners || []).length) {
    return <Typography variant="body2" color="text.secondary">—</Typography>;
  }
  const first = (a.partners[0]?.channelPartner?.firmName) || 'Channel partner';
  const extra = a.partners.length > 1 ? ` +${a.partners.length - 1}` : '';
  return <Chip size="small" label={`${first}${extra}`} />;
}
```

Mark the column `hideOnMobile: true`. Confirm `Chip` and `Typography` are imported from `@mui/material` in this file.

- [ ] **Step 5: Verify the build compiles**

Run (from the frontend repo root):

```bash
CI=true npm run build
```

Expected: `Compiled successfully.`

- [ ] **Step 6: Commit**

```bash
git add src/pages/sales/SalesListPage.js
git commit -m "feat(channel-partner): add CP column + filter to the sales list"
```

---

## Task 7: Frontend — Sale detail: Channel Partner card

**Files:**
- Modify (frontend): `src/pages/sales/SaleDetailPage.js`

- [ ] **Step 1: Import the summary component**

In `src/pages/sales/SaleDetailPage.js`, add near the other component/util imports:

```js
import ChannelPartnerAttributionSummary from '../../components/channel-partners/ChannelPartnerAttributionSummary';
```

- [ ] **Step 2: Add a Channel Partner card to the right column**

`SaleDetailPage`'s right column is a `<Grid item xs={12} lg={4}>` with a `<Stack spacing={3}>` containing `PaymentBreakdownCard`, `SalesPersonCard`, and a "Quick Actions" Card. Insert a Channel Partner card into that `Stack` directly after `<SalesPersonCard ... />` and before the "Quick Actions" Card:

```jsx
            <Card>
              <CardHeader title="Channel Partner" />
              <CardContent>
                <ChannelPartnerAttributionSummary attribution={sale.channelPartnerAttribution} />
              </CardContent>
            </Card>
```

`Card`, `CardHeader`, `CardContent` are already imported in this file (used by `SalesPersonCard` and the other cards). The `sale` object is the loaded sale in scope where the right column renders — use the same variable name the neighbouring cards use (e.g. if `SalesPersonCard` gets `sale={sale}`, then `sale.channelPartnerAttribution` is correct; match the in-scope variable).

- [ ] **Step 3: Verify the build compiles**

Run (from the frontend repo root):

```bash
CI=true npm run build
```

Expected: `Compiled successfully.`

- [ ] **Step 4: Commit**

```bash
git add src/pages/sales/SaleDetailPage.js
git commit -m "feat(channel-partner): show CP attribution on the sale detail page"
```

---

## Task 8: Manual verification

**Files:** none (verification only).

- [ ] **Step 1: Start both servers** — backend `node server.js`, frontend `npm start`.

- [ ] **Step 2: Leads list** — open Lead Management. The table shows a **Channel Partner** column — leads sourced via a CP show the firm as a chip (with `+N` if multiple), others show `—`. The filter bar has a **Channel Partner** dropdown; selecting a partner filters the list to that partner's leads.

- [ ] **Step 3: Lead detail** — open a CP-sourced lead → the Overview tab shows a **Channel Partner** card listing the firm(s), agent, and split. Open a direct lead → the card says "Direct — not sourced through a channel partner."

- [ ] **Step 4: Sales list** — open Sales Management. Same: a **Channel Partner** column and filter.

- [ ] **Step 5: Sale detail** — open a CP-sourced booking → the right column shows a **Channel Partner** card with the firm(s) and split.

- [ ] **Step 6** — commit any verification-driven fixes; if all worked, nothing to commit.

---

## Notes for the implementer

- **Two repos.** Tasks 1-2 are backend; Tasks 3-7 are frontend. Run git commands from the repo named in each task's **Files** block.
- **No pushing.** Commit locally; do not push.
- This plan only adds display + filtering — it does not change how attribution is captured (the create forms already do that) or any data model.
- The list pages (`LeadsListPage`, `SalesListPage`) use a shared filter-bar + data-table convention driven by `filterConfig` and `columns` arrays. Match the exact object shapes already in each file — read a neighbouring entry before adding the new one.
