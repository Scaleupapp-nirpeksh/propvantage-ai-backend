# Channel Partner Module — Design Spec

**Date:** 2026-05-20
**Status:** Approved (design phase)
**Repos affected:** `propvantage-ai-backend`, `propvantage-ai-frontend`

## Problem

In Indian residential real estate, channel partners (CPs) — external broker
firms and their agents — source a large share of buyers. A promoter needs to
register their CP network, attribute leads and bookings to the CPs that
sourced them, compute and pay CP commissions under org-defined rules, and see
how each CP performs. PropVantage has a half-built CP commission engine that
was never wired to any real flow (no way to attribute a lead or sale to a CP),
so it has never fired. There is no CP registry and no CP performance view.

## Goals

- A **CP registry**: register partner firms and their agents.
- **Attribution**: tag a lead — and the resulting booking — with the channel
  partner(s) that sourced it, including a commission **split across multiple
  CPs** for one lead.
- **Org-configurable commission rules**: when commission is paid (lump sum or
  tranches tied to booking milestones) and how it is calculated.
- **Automatic commission generation** when a CP-attributed booking is created.
- A **CP Performance Dashboard**: per-CP leaderboard and funnel.
- CP data flowing into the existing **Analytics** and **Leadership** sections.
- The new module is the **single canonical** CP + commission system; the
  legacy commission system is deprecated.

## Non-goals

- **No CP-facing portal / CP login** in this effort. CP firms and agents are
  records the developer's staff manage. A later effort adds CP authentication,
  a CP dashboard, and CP-side lead creation with approve/reject.
- **No tiered / bonus / performance-based / clawback commission machinery.**
  Commission rules are flat-rate or percentage, paid lump-sum or in tranches.
- No re-use of the legacy `PartnerCommission` / `CommissionStructure` models.

## Existing state & why a clean slate

The legacy system has `PartnerCommission`, `CommissionStructure`, a
~20-endpoint commission controller/routes, and 5 commission UI pages. Per the
approved decision this is **fully deprecated** — the new module rebuilds
commission handling cleanly rather than bolting onto models that assume
org-ref CPs and carry unused tiered/bonus/clawback complexity. See section 8.

## Design

### 1. Module structure

A new self-contained module:

- Backend: `models/channelPartnerModel.js`, `models/channelPartnerAgentModel.js`,
  `models/commissionRuleModel.js`, `models/commissionRecordModel.js`;
  `controllers/channelPartnerController.js`; `routes/channelPartnerRoutes.js`
  mounted at `/api/channel-partners`; a `services/commissionService.js`
  (new — the legacy one is deprecated) for commission generation.
- Frontend: a new `Channel Partners` section under `src/pages/channel-partners/`.

### 2. Data model

**`ChannelPartner`** — the partner firm.

```jsonc
{
  organization: ObjectId,            // developer org (required)
  firmName: String,                  // required
  reraRegistrationNumber: String,
  pan: String,
  gstin: String,
  primaryContact: { name, email, phone },
  address: String,
  approvedProjects: [ObjectId],      // ref Project — which projects this CP may sell
  status: 'active' | 'suspended' | 'blacklisted',   // default 'active'
  bankDetails: { accountName, accountNumber, ifsc, bankName },  // for payouts
  agreementNotes: String,
  onboardedBy: ObjectId,             // ref User
  // timestamps
}
```

**`ChannelPartnerAgent`** — an individual agent under a firm.

```jsonc
{
  organization: ObjectId,
  channelPartner: ObjectId,          // ref ChannelPartner (required)
  name: String,                      // required
  email: String,
  phone: String,
  reraAgentNumber: String,
  status: 'active' | 'inactive',     // default 'active'
}
```

**`CommissionRule`** — org-configurable commission policy.

```jsonc
{
  organization: ObjectId,
  name: String,                      // required
  description: String,
  appliesToProject: ObjectId | null, // ref Project; null = applies to all projects
  rate: {
    method: 'percentage' | 'flat',
    percentage: Number,              // used when method = 'percentage'
    flatAmount: Number,              // used when method = 'flat'
    basis: 'sale_price' | 'base_price',   // what the percentage applies to
  },
  payout: {
    schedule: 'lump_sum' | 'tranches',
    tranches: [                      // used when schedule = 'tranches'
      { label: String, percentage: Number, trigger: String },
    ],
  },
  tdsPercent: Number,                // default 5
  status: 'active' | 'inactive',     // default 'active'
}
```

`tranche.trigger` is one of `on_booking | on_agreement | on_registration |
on_possession`, mapping to the Sale status reaching `Booked` / `Agreement
Signed` / `Registered` / `Completed`. Tranche percentages must sum to 100.

**`CommissionRecord`** — generated per booking, per CP in the split.

```jsonc
{
  organization: ObjectId,
  sale: ObjectId,                    // ref Sale
  channelPartner: ObjectId,          // ref ChannelPartner
  agent: ObjectId | null,            // ref ChannelPartnerAgent
  commissionRule: ObjectId,          // ref CommissionRule — which rule was applied
  // grossAmount/tdsAmount/netAmount/payouts below are the frozen computed
  // result; a later edit to the rule does not retroactively change a record.
  sharePct: Number,                  // this CP's share of the booking (from the split)
  grossAmount: Number,               // rule amount × sharePct
  tdsAmount: Number,
  netAmount: Number,
  payouts: [
    { label: String, amount: Number, trigger: String,
      status: 'pending' | 'paid', dueOn: Date | null,
      paidOn: Date | null, paidBy: ObjectId | null },
  ],
  status: 'accrued' | 'partially_paid' | 'paid' | 'cancelled',
  history: [ { at: Date, by: ObjectId, action: String, note: String } ],
}
```

### 3. Attribution sub-document — Lead & Sale

Both the `Lead` and `Sale` models gain an identical `channelPartnerAttribution`
sub-document:

```jsonc
channelPartnerAttribution: {
  viaChannelPartner: Boolean,        // the "came through a CP?" toggle; default false
  partners: [
    { channelPartner: ObjectId, agent: ObjectId | null, sharePct: Number },
  ],
  status: 'tagged' | 'pending' | 'approved' | 'rejected',  // default 'tagged'
  taggedBy: ObjectId,
  taggedAt: Date,
  history: [ { at: Date, by: ObjectId, action: String, note: String } ],
}
```

- `partners[].sharePct` must sum to 100 when `viaChannelPartner` is true.
- `status` is always `tagged` in this effort (staff-created tags are
  auto-approved). The field exists now so the future CP portal can introduce
  `pending` → `approved` / `rejected` for CP-originated leads with no migration.
- A CP whose firm status is `suspended` or `blacklisted` cannot be newly
  attributed.

**Flow:** the lead create/edit form shows a "Sourced via channel partner?"
toggle; when on, the user picks one or more CPs (and optionally an agent each)
from the registry and sets the split. On booking, the attribution is copied
from the Lead onto the Sale. Senior roles (see section 7) can add / edit /
remove the CP attribution on an existing Sale; every change appends to
`history[]`.

### 4. Commission generation

`services/commissionService.js` exposes `syncCommissionForSale(saleId)`:

- Called when a Sale is created with a CP attribution, and whenever a Sale's
  attribution is edited.
- For each CP in `partners[]`: resolve the applicable `CommissionRule`
  (project-specific rule if one exists, else the org's all-projects rule),
  compute `grossAmount = ruleAmount × sharePct/100`, `tdsAmount`, `netAmount`,
  and expand `payouts[]` from the rule (one entry for lump-sum, or one per
  tranche). Create or update the `CommissionRecord` for that CP+sale.
- Editing the split recalculates **only** records whose status is `accrued`
  or `partially_paid`; a record with `paid` payouts is never silently
  destroyed — if an edit would reduce a CP's share below what is already paid,
  the operation is rejected with a clear error.
- Removing a CP from the split cancels that CP's record (`status: cancelled`)
  if nothing is paid, or flags it for manual reconciliation if a payout is paid.
- Marking a payout `paid` is a manual, permission-gated action.

### 5. CP Performance Dashboard

A new page in the Channel Partners section:

- **Leaderboard** — per CP: leads tagged, site visits, bookings, total sale
  value, commission earned (net) vs. pending. Sortable; project + date filters.
- **CP funnel** — tagged leads → site visits → bookings, per CP.
- **Drill-in** — a CP detail view: its firms's agents, its tagged leads, its
  bookings, and its commission records with payout status.

The dashboard reads from `Lead.channelPartnerAttribution`,
`Sale.channelPartnerAttribution`, and `CommissionRecord`.

### 6. Analytics & Leadership integration

- **Analytics section** — add a CP cut: leads / bookings / revenue split by
  channel partner, and CP-sourced vs. direct.
- **Leadership dashboard** — `services/leadershipDashboardService.js`
  currently reads legacy `PartnerCommission`; repoint it to `CommissionRecord`,
  and add a "CP contribution" metric (share of bookings/revenue via CPs).

### 7. Permissions

A new `CHANNEL_PARTNERS` permission group:

- `CHANNEL_PARTNERS.VIEW` — view the registry, dashboard, commission records.
- `CHANNEL_PARTNERS.MANAGE` — create/edit CP firms and agents.
- `CHANNEL_PARTNERS.ATTRIBUTE` — set CP attribution when creating a lead/sale.
- `CHANNEL_PARTNERS.EDIT_BOOKING_ATTRIBUTION` — add/edit/remove the CP tag on
  an **existing** Sale (the senior-role action).
- `CHANNEL_PARTNERS.MANAGE_COMMISSION_RULES` — create/edit commission rules.
- `CHANNEL_PARTNERS.MANAGE_COMMISSIONS` — approve/cancel records, mark payouts
  paid.

The default org roles are updated so Owner / senior roles get the management
permissions; the three existing CP role definitions are left intact.

### 8. Deprecation of the legacy commission system

These files receive a banner comment
`// DEPRECATED — superseded by the Channel Partner module (2026-05-20); pending removal`
and are made **unreachable** (kept in-repo for eventual deletion):

- Backend: `models/partnerCommissionModel.js`,
  `models/commissionStructureModel.js`, `controllers/commissionController.js`,
  `routes/commissionRoutes.js`. The `commissionRoutes` mount in `server.js` is
  removed/commented.
- Frontend: `CommissionListPage.js`, `CommissionDashboardPage.js`,
  `CommissionDetailPage.js`, `CommissionPaymentsPage.js`,
  `CommissionReportsPage.js`, `CommissionStructurePage.js` — their routes in
  `App.js`, their lazy imports, and their navigation links are removed.

Anything that read the legacy models — notably
`services/leadershipDashboardService.js` — is repointed to `CommissionRecord`
(section 6). The legacy `COMMISSIONS` permission group and the CP role
definitions are left in place (roles are unaffected; only the commission
machinery is replaced).

### 9. Error handling & edge cases

- Split `sharePct` values must sum to 100; reject otherwise.
- A `suspended`/`blacklisted` CP cannot be newly attributed (existing records
  for it are untouched).
- Editing/removing attribution on a Sale with already-paid payouts: never
  destroy paid records — reject the conflicting edit with an explanatory error.
- A booking whose project has no matching `CommissionRule`: the
  `CommissionRecord` is created with `grossAmount: 0` and a history note "no
  applicable commission rule", so the attribution is still recorded.
- All registry, attribution, commission queries are organization-scoped.

## Testing

- Backend smoke test `tests/testChannelPartner.js`: create a CP firm + agent;
  create a commission rule; create a lead with a multi-CP split attribution;
  convert it to a booking; assert `CommissionRecord`s are generated per CP with
  correct split amounts and tranche payouts; edit the booking attribution and
  assert recalculation; assert the registry/dashboard endpoints respond.
- Manual UI pass: register a CP, tag a lead via the toggle with a 2-CP split,
  book it, verify commission records, edit the booking's attribution as a
  senior role, view the CP Performance Dashboard, and confirm the legacy
  commission pages are gone.

## Out of scope / future

- CP-facing portal: CP login, CP dashboard, CP-side lead creation with
  developer approve/reject, CP self-service commission statements, inventory &
  collateral access. (The attribution `status` field already anticipates the
  approve/reject flow.)
- Tiered / bonus / clawback commission structures.
- CP communication / broadcasts.
- Deleting the deprecated legacy commission files (a later cleanup).
