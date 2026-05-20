# Channel Partner — Plan 2: Attribution & Commission Engine

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tag leads and bookings with the channel partner(s) that sourced them, auto-generate commission records when a CP-attributed booking is created, and deprecate the legacy commission system.

**Architecture:** Lead and Sale gain an identical `channelPartnerAttribution` sub-document (multi-CP split). A new `CommissionRecord` model holds per-booking-per-CP commission. A `commissionService.syncCommissionForSale(saleId)` runs after a Sale is created or its attribution edited, computing records from the project's `CommissionRule`. The legacy commission system (models, controller, routes, UI pages) is banner-flagged and unwired; `leadershipDashboardService` is repointed to `CommissionRecord`.

**Tech Stack:** Backend — Node/Express/Mongoose. Frontend — React 18 + MUI v5.

**Spec:** `docs/superpowers/specs/2026-05-20-channel-partner-module-design.md`

**Plan 2 of 3.** Plan 1 (CP registry + commission rules) is built. This plan adds attribution + the commission engine + legacy deprecation. Plan 3 adds the CP performance dashboard + analytics integration. This plan depends on Plan 1's models (`ChannelPartner`, `ChannelPartnerAgent`, `CommissionRule`) and the `CHANNEL_PARTNERS` permissions already existing.

**Two repos:**
- Backend: `/Users/nirpekshnandan/My Products/propvantage-ai-backend`
- Frontend: `/Users/nirpekshnandan/My Products/propvantage-ai-frontend`

All paths in each task are relative to the repo named in that task's **Files** block. Work on `main`; commit per task with the given messages; do **not** push.

---

## Task 1: `channelPartnerAttribution` sub-document on Lead & Sale

**Files:**
- Modify (backend): `models/leadModel.js`
- Modify (backend): `models/salesModel.js`

- [ ] **Step 1: Add the sub-document to `leadModel.js`**

In `models/leadModel.js`, the last field in the schema is the `enrichment` block, which ends like this (the closing `}` of `enrichment`, then the schema-fields closing `},`, then the options object):

```js
      researchedAt: { type: Date, default: null },
      researchedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    }
  },
  {
    timestamps: true,
```

Insert a comma after the `enrichment` block's closing `}` and add the `channelPartnerAttribution` block before the schema-fields closing `},`:

```js
      researchedAt: { type: Date, default: null },
      researchedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    },

    // Channel partner attribution — which CP(s) sourced this lead
    channelPartnerAttribution: {
      viaChannelPartner: { type: Boolean, default: false },
      partners: [
        {
          channelPartner: { type: mongoose.Schema.Types.ObjectId, ref: 'ChannelPartner' },
          agent: { type: mongoose.Schema.Types.ObjectId, ref: 'ChannelPartnerAgent', default: null },
          sharePct: { type: Number, default: 0, min: 0, max: 100 },
        },
      ],
      status: {
        type: String,
        enum: ['tagged', 'pending', 'approved', 'rejected'],
        default: 'tagged',
      },
      taggedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
      taggedAt: { type: Date, default: null },
      history: [
        {
          at: { type: Date, default: Date.now },
          by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
          action: { type: String },
          note: { type: String },
        },
      ],
    }
  },
  {
    timestamps: true,
```

- [ ] **Step 2: Add the identical sub-document to `salesModel.js`**

In `models/salesModel.js`, the `commission` sub-object ends at:

```js
    commission: {
      rate: { type: Number },
      amount: { type: Number },
    },
```

Insert the `channelPartnerAttribution` block directly after it (before `approvalRequest`):

```js
    commission: {
      rate: { type: Number },
      amount: { type: Number },
    },

    // Channel partner attribution — which CP(s) sourced this booking
    channelPartnerAttribution: {
      viaChannelPartner: { type: Boolean, default: false },
      partners: [
        {
          channelPartner: { type: mongoose.Schema.Types.ObjectId, ref: 'ChannelPartner' },
          agent: { type: mongoose.Schema.Types.ObjectId, ref: 'ChannelPartnerAgent', default: null },
          sharePct: { type: Number, default: 0, min: 0, max: 100 },
        },
      ],
      status: {
        type: String,
        enum: ['tagged', 'pending', 'approved', 'rejected'],
        default: 'tagged',
      },
      taggedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
      taggedAt: { type: Date, default: null },
      history: [
        {
          at: { type: Date, default: Date.now },
          by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
          action: { type: String },
          note: { type: String },
        },
      ],
    },
```

- [ ] **Step 3: Verify both files parse**

Run (from the backend repo root):

```bash
node --check models/leadModel.js && node --check models/salesModel.js
```

Expected: no output, exit code 0.

- [ ] **Step 4: Commit**

```bash
git add models/leadModel.js models/salesModel.js
git commit -m "feat(channel-partner): add channelPartnerAttribution to Lead and Sale"
```

---

## Task 2: CommissionRecord model

**Files:**
- Create (backend): `models/commissionRecordModel.js`

- [ ] **Step 1: Create `models/commissionRecordModel.js`**

```js
// File: models/commissionRecordModel.js
// Description: A channel-partner commission accrual for one booking, one CP.
//   Generated by services/commissionService.js when a CP-attributed Sale is
//   created or its attribution is edited.

import mongoose from 'mongoose';

const payoutSchema = new mongoose.Schema(
  {
    label: { type: String, required: true },
    amount: { type: Number, required: true, min: 0 },
    trigger: {
      type: String,
      enum: ['on_booking', 'on_agreement', 'on_registration', 'on_possession'],
      default: 'on_booking',
    },
    status: { type: String, enum: ['pending', 'paid'], default: 'pending' },
    dueOn: { type: Date, default: null },
    paidOn: { type: Date, default: null },
    paidBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { _id: false }
);

const historyEntrySchema = new mongoose.Schema(
  {
    at: { type: Date, default: Date.now },
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    action: { type: String },
    note: { type: String },
  },
  { _id: false }
);

const commissionRecordSchema = new mongoose.Schema(
  {
    organization: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
    sale: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Sale',
      required: true,
      index: true,
    },
    channelPartner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ChannelPartner',
      required: true,
      index: true,
    },
    agent: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ChannelPartnerAgent',
      default: null,
    },
    commissionRule: { type: mongoose.Schema.Types.ObjectId, ref: 'CommissionRule', default: null },
    sharePct: { type: Number, default: 100, min: 0, max: 100 },
    grossAmount: { type: Number, default: 0, min: 0 },
    tdsAmount: { type: Number, default: 0, min: 0 },
    netAmount: { type: Number, default: 0, min: 0 },
    payouts: [payoutSchema],
    status: {
      type: String,
      enum: ['accrued', 'partially_paid', 'paid', 'cancelled'],
      default: 'accrued',
      index: true,
    },
    history: [historyEntrySchema],
  },
  { timestamps: true }
);

commissionRecordSchema.index({ organization: 1, status: 1 });
commissionRecordSchema.index({ organization: 1, channelPartner: 1 });

// Keep `status` in sync with the payout states (unless cancelled).
commissionRecordSchema.methods.recomputeStatus = function () {
  if (this.status === 'cancelled') return;
  const payouts = this.payouts || [];
  const paid = payouts.filter((p) => p.status === 'paid').length;
  if (payouts.length > 0 && paid === payouts.length) this.status = 'paid';
  else if (paid > 0) this.status = 'partially_paid';
  else this.status = 'accrued';
};

const CommissionRecord = mongoose.model('CommissionRecord', commissionRecordSchema);

export default CommissionRecord;
```

- [ ] **Step 2: Verify the file parses**

Run (from the backend repo root):

```bash
node --check models/commissionRecordModel.js
```

Expected: no output, exit code 0.

- [ ] **Step 3: Commit**

```bash
git add models/commissionRecordModel.js
git commit -m "feat(channel-partner): add CommissionRecord model"
```

---

## Task 3: Commission service

**Files:**
- Create (backend): `services/commissionService.js`

This service generates/refreshes `CommissionRecord`s for a sale. A record with any `paid` payout is treated as immutable — sync never modifies or deletes it (it only appends a history note if the attribution no longer matches). Fully-unpaid (`accrued`) records are freely recomputed; a removed CP's unpaid record is cancelled.

- [ ] **Step 1: Create `services/commissionService.js`**

```js
// File: services/commissionService.js
// Description: Channel-partner commission engine. syncCommissionForSale()
//   (re)generates CommissionRecords for a sale from its channelPartnerAttribution
//   and the applicable CommissionRule. Records with a paid payout are immutable.

// Resolve the commission rule that applies to a sale's project:
// a project-specific active rule wins; otherwise the org-wide (appliesToProject
// null) active rule; most recently created if several match.
const resolveRule = async (CommissionRule, organizationId, projectId) => {
  const projectRule = await CommissionRule.findOne({
    organization: organizationId,
    status: 'active',
    appliesToProject: projectId,
  }).sort({ createdAt: -1 });
  if (projectRule) return projectRule;
  return CommissionRule.findOne({
    organization: organizationId,
    status: 'active',
    appliesToProject: null,
  }).sort({ createdAt: -1 });
};

// Compute gross/tds/net + payout breakdown for one CP's share.
const computeAmounts = (rule, sale, sharePct) => {
  const share = (Number(sharePct) || 0) / 100;
  let ruleAmount = 0;
  if (rule) {
    if (rule.rate?.method === 'flat') {
      ruleAmount = rule.rate.flatAmount || 0;
    } else {
      const base =
        rule.rate?.basis === 'base_price'
          ? sale.costSheetSnapshot?.basePrice || sale.salePrice || 0
          : sale.salePrice || 0;
      ruleAmount = (base * (rule.rate?.percentage || 0)) / 100;
    }
  }
  const grossAmount = Math.round(ruleAmount * share);
  const tdsPercent = rule?.tdsPercent || 0;
  const tdsAmount = Math.round((grossAmount * tdsPercent) / 100);
  const netAmount = grossAmount - tdsAmount;

  let payouts;
  if (rule?.payout?.schedule === 'tranches' && (rule.payout.tranches || []).length > 0) {
    payouts = rule.payout.tranches.map((t) => ({
      label: t.label,
      amount: Math.round((netAmount * (t.percentage || 0)) / 100),
      trigger: t.trigger,
      status: 'pending',
    }));
  } else {
    payouts = [{ label: 'Full commission', amount: netAmount, trigger: 'on_booking', status: 'pending' }];
  }
  return { grossAmount, tdsAmount, netAmount, payouts };
};

/**
 * (Re)generate CommissionRecords for a sale.
 * Safe to call repeatedly. Never throws into the caller's critical path —
 * callers should still await it but a failure only logs.
 *
 * @param {ObjectId|string} saleId
 * @param {ObjectId|string} [userId] - who triggered the sync (for history)
 */
const syncCommissionForSale = async (saleId, userId = null) => {
  try {
    const { default: Sale } = await import('../models/salesModel.js');
    const { default: CommissionRule } = await import('../models/commissionRuleModel.js');
    const { default: CommissionRecord } = await import('../models/commissionRecordModel.js');

    const sale = await Sale.findById(saleId);
    if (!sale) return;

    const attribution = sale.channelPartnerAttribution || {};
    const partners =
      attribution.viaChannelPartner && Array.isArray(attribution.partners)
        ? attribution.partners.filter((p) => p.channelPartner)
        : [];

    const existing = await CommissionRecord.find({ sale: sale._id });
    const keepPartnerIds = new Set(partners.map((p) => String(p.channelPartner)));

    // Cancel records for CPs no longer attributed — unless a payout is paid.
    for (const rec of existing) {
      if (!keepPartnerIds.has(String(rec.channelPartner))) {
        const hasPaid = (rec.payouts || []).some((p) => p.status === 'paid');
        if (hasPaid) {
          rec.history.push({ by: userId, action: 'attribution_removed',
            note: 'CP removed from the booking but a payout is already paid — needs manual reconciliation.' });
        } else if (rec.status !== 'cancelled') {
          rec.status = 'cancelled';
          rec.history.push({ by: userId, action: 'cancelled',
            note: 'CP removed from the booking attribution.' });
        }
        await rec.save();
      }
    }

    const rule = await resolveRule(CommissionRule, sale.organization, sale.project);

    for (const partner of partners) {
      const rec = existing.find(
        (r) => String(r.channelPartner) === String(partner.channelPartner)
      );
      const hasPaid = rec && (rec.payouts || []).some((p) => p.status === 'paid');

      if (hasPaid) {
        // Immutable — leave amounts/payouts; just note if the share drifted.
        if (rec.sharePct !== partner.sharePct) {
          rec.history.push({ by: userId, action: 'share_changed_after_payout',
            note: `Attribution share changed to ${partner.sharePct}% but a payout is already paid — record left unchanged.` });
          await rec.save();
        }
        continue;
      }

      const { grossAmount, tdsAmount, netAmount, payouts } = computeAmounts(
        rule, sale, partner.sharePct
      );

      if (rec) {
        rec.agent = partner.agent || null;
        rec.commissionRule = rule?._id || null;
        rec.sharePct = partner.sharePct;
        rec.grossAmount = grossAmount;
        rec.tdsAmount = tdsAmount;
        rec.netAmount = netAmount;
        rec.payouts = payouts;
        rec.status = 'cancelled' === rec.status ? 'accrued' : rec.status;
        rec.recomputeStatus();
        rec.history.push({ by: userId, action: 'recalculated',
          note: rule ? `Recalculated from rule "${rule.name}".` : 'No applicable commission rule.' });
        await rec.save();
      } else {
        await CommissionRecord.create({
          organization: sale.organization,
          sale: sale._id,
          channelPartner: partner.channelPartner,
          agent: partner.agent || null,
          commissionRule: rule?._id || null,
          sharePct: partner.sharePct,
          grossAmount,
          tdsAmount,
          netAmount,
          payouts,
          status: 'accrued',
          history: [
            { by: userId, action: 'created',
              note: rule ? `Generated from rule "${rule.name}".` : 'No applicable commission rule — recorded at zero.' },
          ],
        });
      }
    }
  } catch (err) {
    console.error(`[Commission] syncCommissionForSale failed for ${saleId}:`, err.message);
  }
};

export { syncCommissionForSale };
```

- [ ] **Step 2: Verify the file parses**

Run (from the backend repo root):

```bash
node --check services/commissionService.js
```

Expected: no output, exit code 0.

- [ ] **Step 3: Commit**

```bash
git add services/commissionService.js
git commit -m "feat(channel-partner): add commission generation service"
```

---

## Task 4: Trigger commission sync on sale create/update

**Files:**
- Modify (backend): `controllers/salesController.js`

- [ ] **Step 1: Import the service**

In `controllers/salesController.js`, find the import block at the top of the file (the `import` statements). Add this line at the end of that block:

```js
import { syncCommissionForSale } from '../services/commissionService.js';
```

- [ ] **Step 2: Trigger sync after a sale is created**

`createSale` builds and saves a `Sale`, then responds. The `req.body` is destructured at the top — the form's `channelPartnerAttribution` is **not** in the destructured list, so add it. Find the destructuring near the top of `createSale`:

```js
const createSale = asyncHandler(async (req, res) => {
  const { unitId, leadId, discountPercentage = 0, discountAmount = 0, costSheetSnapshot, paymentPlanSnapshot } = req.body;
```

Change it to also pull `channelPartnerAttribution`:

```js
const createSale = asyncHandler(async (req, res) => {
  const { unitId, leadId, discountPercentage = 0, discountAmount = 0, costSheetSnapshot, paymentPlanSnapshot, channelPartnerAttribution } = req.body;
```

Then find where the `Sale` document is constructed — `const sale = new Sale({ ... })`. Add the attribution to it. The current object ends with `paymentPlanSnapshot: paymentPlanSnapshot`:

```js
    const sale = new Sale({
      project: unit.project._id,
      unit: unitId,
      lead: leadId,
      organization: req.user.organization,
      salesPerson: req.user._id,
      salePrice: finalSalePrice,
      discountAmount: calculatedDiscountAmount,
      costSheetSnapshot: costSheet,
      status: 'Booked',
      bookingDate: new Date(),
      paymentPlanSnapshot: paymentPlanSnapshot
    });
```

Add the attribution field (only when the request provides it), with `taggedBy`/`taggedAt` stamped:

```js
    const sale = new Sale({
      project: unit.project._id,
      unit: unitId,
      lead: leadId,
      organization: req.user.organization,
      salesPerson: req.user._id,
      salePrice: finalSalePrice,
      discountAmount: calculatedDiscountAmount,
      costSheetSnapshot: costSheet,
      status: 'Booked',
      bookingDate: new Date(),
      paymentPlanSnapshot: paymentPlanSnapshot,
      ...(channelPartnerAttribution && channelPartnerAttribution.viaChannelPartner
        ? {
            channelPartnerAttribution: {
              viaChannelPartner: true,
              partners: channelPartnerAttribution.partners || [],
              status: 'tagged',
              taggedBy: req.user._id,
              taggedAt: new Date(),
              history: [{ by: req.user._id, action: 'tagged', note: 'Set at booking creation.' }],
            },
          }
        : {})
    });
```

Then, after the sale is fully created and the transaction is committed — locate the point in `createSale` after `session.commitTransaction()` / `session.endSession()` for the main (non-pending-approval) booking path, before the success `res.status(201).json(...)`. Add:

```js
    // Generate channel-partner commission records for the new booking.
    await syncCommissionForSale(sale._id, req.user._id);
```

There is also a `pendingApproval` branch earlier in `createSale` that commits its own transaction and responds. After that branch's `session.endSession()` and before its `res....json(...)`, add the same line:

```js
    await syncCommissionForSale(sale._id, req.user._id);
```

(`syncCommissionForSale` never throws — a missing CP rule or attribution simply produces no/zero records — so it is safe in both paths.)

- [ ] **Step 3: Trigger sync after a sale is updated**

`updateSale` does `Object.assign(sale, updateData)` then saves — so an edited `channelPartnerAttribution` in the body flows onto the sale automatically. After `updateSale` saves the sale (after the `await sale.save()` call), add:

```js
    // Refresh commission records if the booking changed.
    await syncCommissionForSale(sale._id, req.user._id);
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
git commit -m "feat(channel-partner): generate commission records on sale create/update"
```

---

## Task 5: Commission record + attribution-edit endpoints

**Files:**
- Modify (backend): `controllers/channelPartnerController.js`

- [ ] **Step 1: Add the model imports**

In `controllers/channelPartnerController.js`, the import block currently ends with:

```js
import Project from '../models/projectModel.js';
```

Add below it:

```js
import CommissionRecord from '../models/commissionRecordModel.js';
import Sale from '../models/salesModel.js';
import { syncCommissionForSale } from '../services/commissionService.js';
```

- [ ] **Step 2: Add the handlers**

Add these four handlers directly above the `export {` block:

```js
// ─── Commission records ──────────────────────────────────────

/**
 * @desc    List commission records
 * @route   GET /api/channel-partners/commission-records
 * @access  Private (channel_partners:view)
 */
const getCommissionRecords = asyncHandler(async (req, res) => {
  const { status, channelPartner } = req.query;
  const query = { organization: req.user.organization };
  if (status) query.status = status;
  if (channelPartner) query.channelPartner = channelPartner;

  const records = await CommissionRecord.find(query)
    .populate('channelPartner', 'firmName')
    .populate('agent', 'name')
    .populate({ path: 'sale', select: 'salePrice bookingDate project', populate: { path: 'project', select: 'name' } })
    .sort({ createdAt: -1 });

  res.json({ success: true, count: records.length, data: records });
});

/**
 * @desc    Mark one payout of a commission record as paid
 * @route   PUT /api/channel-partners/commission-records/:id/payouts/:index/pay
 * @access  Private (channel_partners:manage_commissions)
 */
const markPayoutPaid = asyncHandler(async (req, res) => {
  const record = await CommissionRecord.findOne({
    _id: req.params.id,
    organization: req.user.organization,
  });
  if (!record) {
    res.status(404);
    throw new Error('Commission record not found');
  }
  const idx = Number(req.params.index);
  const payout = record.payouts[idx];
  if (!payout) {
    res.status(404);
    throw new Error('Payout not found');
  }
  if (payout.status === 'paid') {
    res.status(400);
    throw new Error('Payout is already paid');
  }
  payout.status = 'paid';
  payout.paidOn = new Date();
  payout.paidBy = req.user._id;
  record.history.push({ by: req.user._id, action: 'payout_paid', note: `Payout "${payout.label}" marked paid.` });
  record.recomputeStatus();
  await record.save();

  res.json({ success: true, data: record });
});

/**
 * @desc    Edit the channel-partner attribution on an existing booking
 * @route   PUT /api/channel-partners/sales/:saleId/attribution
 * @access  Private (channel_partners:edit_booking_attribution)
 */
const editSaleAttribution = asyncHandler(async (req, res) => {
  const sale = await Sale.findOne({
    _id: req.params.saleId,
    organization: req.user.organization,
  });
  if (!sale) {
    res.status(404);
    throw new Error('Booking not found');
  }

  const { viaChannelPartner, partners } = req.body;
  const list = Array.isArray(partners) ? partners.filter((p) => p && p.channelPartner) : [];

  if (viaChannelPartner && list.length > 0) {
    const sum = list.reduce((a, p) => a + (Number(p.sharePct) || 0), 0);
    if (Math.abs(sum - 100) > 0.01) {
      res.status(400);
      throw new Error(`Commission split must sum to 100% (got ${sum})`);
    }
  }

  const prev = sale.channelPartnerAttribution || {};
  sale.channelPartnerAttribution = {
    viaChannelPartner: Boolean(viaChannelPartner) && list.length > 0,
    partners: Boolean(viaChannelPartner) ? list : [],
    status: prev.status || 'tagged',
    taggedBy: prev.taggedBy || req.user._id,
    taggedAt: prev.taggedAt || new Date(),
    history: [
      ...(prev.history || []),
      { by: req.user._id, action: 'attribution_edited', note: 'Booking CP attribution edited.' },
    ],
  };
  await sale.save();

  await syncCommissionForSale(sale._id, req.user._id);

  res.json({ success: true, data: sale.channelPartnerAttribution });
});
```

Add the three names to the `export {` block:

```js
export {
  createChannelPartner,
  getChannelPartners,
  getChannelPartnerById,
  updateChannelPartner,
  createAgent,
  getAgents,
  updateAgent,
  createCommissionRule,
  getCommissionRules,
  getCommissionRuleById,
  updateCommissionRule,
  getCommissionRecords,
  markPayoutPaid,
  editSaleAttribution,
};
```

- [ ] **Step 3: Verify the file parses**

Run (from the backend repo root):

```bash
node --check controllers/channelPartnerController.js
```

Expected: no output, exit code 0.

- [ ] **Step 4: Commit**

```bash
git add controllers/channelPartnerController.js
git commit -m "feat(channel-partner): add commission-record + attribution-edit endpoints"
```

---

## Task 6: Routes for the new endpoints

**Files:**
- Modify (backend): `routes/channelPartnerRoutes.js`

- [ ] **Step 1: Import the handlers**

In `routes/channelPartnerRoutes.js`, the controller import block ends with:

```js
  createCommissionRule,
  getCommissionRules,
  getCommissionRuleById,
  updateCommissionRule,
} from '../controllers/channelPartnerController.js';
```

Change it to:

```js
  createCommissionRule,
  getCommissionRules,
  getCommissionRuleById,
  updateCommissionRule,
  getCommissionRecords,
  markPayoutPaid,
  editSaleAttribution,
} from '../controllers/channelPartnerController.js';
```

- [ ] **Step 2: Register the routes**

In `routes/channelPartnerRoutes.js`, after the `commission-rules` route block and before the `// ─── Agents ───` section, add:

```js
// ─── Commission records ─────────────────────────────────────
router.get(
  '/commission-records',
  hasPermission(PERMISSIONS.CHANNEL_PARTNERS.VIEW),
  getCommissionRecords
);

router.put(
  '/commission-records/:id/payouts/:index/pay',
  hasPermission(PERMISSIONS.CHANNEL_PARTNERS.MANAGE_COMMISSIONS),
  markPayoutPaid
);

// ─── Booking attribution edit ───────────────────────────────
router.put(
  '/sales/:saleId/attribution',
  hasPermission(PERMISSIONS.CHANNEL_PARTNERS.EDIT_BOOKING_ATTRIBUTION),
  editSaleAttribution
);
```

These static-prefixed paths (`/commission-records`, `/sales/...`) do not collide with `/:id` because they are registered before it (the `/:id` firm routes come later in the file).

- [ ] **Step 3: Verify the file parses**

Run (from the backend repo root):

```bash
node --check routes/channelPartnerRoutes.js
```

Expected: no output, exit code 0.

- [ ] **Step 4: Commit**

```bash
git add routes/channelPartnerRoutes.js
git commit -m "feat(channel-partner): register commission-record + attribution routes"
```

---

## Task 7: Deprecate the legacy commission backend

**Files:**
- Modify (backend): `models/partnerCommissionModel.js`, `models/commissionStructureModel.js`, `controllers/commissionController.js`, `routes/commissionRoutes.js`, `server.js`

- [ ] **Step 1: Add a deprecation banner to each legacy file**

At the very top of each of these four files — `models/partnerCommissionModel.js`, `models/commissionStructureModel.js`, `controllers/commissionController.js`, `routes/commissionRoutes.js` — insert this comment as the first lines (above the existing first line):

```js
// DEPRECATED (2026-05-20): superseded by the Channel Partner module
//   (models/commissionRecordModel.js, services/commissionService.js,
//   controllers/channelPartnerController.js). No longer wired into the app.
//   Pending removal — do not extend.
```

- [ ] **Step 2: Unwire the legacy commission routes in `server.js`**

In `server.js`, find the import line:

```js
import commissionRoutes from './routes/commissionRoutes.js';
```

Comment it out:

```js
// DEPRECATED — Channel Partner module supersedes the legacy commission system
// import commissionRoutes from './routes/commissionRoutes.js';
```

Then find the mount line:

```js
app.use('/api/commissions', commissionRoutes);
```

Comment it out:

```js
// DEPRECATED — legacy commission API removed; see /api/channel-partners
// app.use('/api/commissions', commissionRoutes);
```

- [ ] **Step 3: Verify `server.js` parses and starts cleanly**

Run (from the backend repo root):

```bash
node --check server.js
```

Expected: no output, exit code 0. (The legacy controller/model files still parse — they are just no longer imported.)

- [ ] **Step 4: Commit**

```bash
git add models/partnerCommissionModel.js models/commissionStructureModel.js controllers/commissionController.js routes/commissionRoutes.js server.js
git commit -m "chore(channel-partner): deprecate and unwire the legacy commission system"
```

---

## Task 8: Repoint the leadership dashboard to CommissionRecord

**Files:**
- Modify (backend): `services/leadershipDashboardService.js`

The leadership dashboard service reads the legacy `PartnerCommission` model in two places. Repoint both to `CommissionRecord`.

- [ ] **Step 1: Replace the model reference**

In `services/leadershipDashboardService.js`, the service lazy-loads models. Find the `PartnerCommission` model variable declaration (it is declared in a `let` list alongside `Project, Sale, ...`) and the line that assigns it from a dynamic import of `../models/partnerCommissionModel.js`.

Rename the variable `PartnerCommission` to `CommissionRecord` everywhere it appears in this file, and change its dynamic import source from `'../models/partnerCommissionModel.js'` to `'../models/commissionRecordModel.js'`.

- [ ] **Step 2: Rewrite the two aggregations to the new schema**

The legacy aggregations referenced `commissionCalculation.netCommission`, `commissionCalculation.grossCommission`, `paymentDetails.totalPaid`, `paymentDetails.totalPending`, and `$status`. The `CommissionRecord` schema is different: top-level `grossAmount` / `netAmount`, a `payouts[]` array with per-payout `status` and `amount`, and a top-level `status`.

Find the `aggregateChannelPartner` function. Replace its aggregation pipeline so the `$facet` computes:

```js
  const result = await CommissionRecord.aggregate([
    { $match: { organization: orgObjectId, ...pf } },
    {
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
    },
    {
      $facet: {
        byStatus: [
          { $group: { _id: '$status', count: { $sum: 1 }, totalNet: { $sum: '$netAmount' } } },
        ],
        totals: [
          {
            $group: {
              _id: null,
              totalGross: { $sum: '$grossAmount' },
              totalNet: { $sum: '$netAmount' },
              totalPaid: { $sum: '$paidAmount' },
              totalPending: { $sum: { $subtract: ['$netAmount', '$paidAmount'] } },
            },
          },
        ],
      },
    },
  ]);
```

Keep the function's surrounding code (how it reads `result[0].byStatus` / `result[0].totals` and shapes the return value) unchanged — the field names produced (`totalGross`, `totalNet`, `totalPaid`, `totalPending`, `byStatus` with `_id`/`count`/`totalNet`) are the same as before, so downstream code does not change.

Then find the project-comparison `PartnerCommission.aggregate([...])` call (the one grouped by `$project`). Replace it with:

```js
    CommissionRecord.aggregate([
      { $match: { organization: orgObjectId } },
      {
        $lookup: {
          from: 'sales',
          localField: 'sale',
          foreignField: '_id',
          as: 'saleDoc',
        },
      },
      { $unwind: { path: '$saleDoc', preserveNullAndEmptyArrays: true } },
      {
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
      },
      {
        $group: {
          _id: '$saleDoc.project',
          totalCommission: { $sum: '$netAmount' },
          paidCommission: { $sum: '$paidAmount' },
          salesViaCp: { $sum: 1 },
        },
      },
    ]),
```

This produces the same `{ _id: <projectId>, totalCommission, paidCommission, salesViaCp }` shape the legacy pipeline produced (the `CommissionRecord` has `sale`, not `project`, so it `$lookup`s the sale to get the project), so the consuming code does not change.

- [ ] **Step 3: Verify the file parses**

Run (from the backend repo root):

```bash
node --check services/leadershipDashboardService.js
```

Expected: no output, exit code 0.

- [ ] **Step 4: Commit**

```bash
git add services/leadershipDashboardService.js
git commit -m "refactor(channel-partner): repoint leadership dashboard to CommissionRecord"
```

---

## Task 9: Backend smoke test

**Files:**
- Create (backend): `tests/testChannelPartnerCommission.js`

- [ ] **Step 1: Create `tests/testChannelPartnerCommission.js`**

```js
// File: tests/testChannelPartnerCommission.js
// Description: End-to-end test for CP attribution → commission generation.
// Usage: node tests/testChannelPartnerCommission.js
// Requires the backend server running locally and a seeded org/project/unit.

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import fetch from 'node-fetch';

dotenv.config();

const BASE_URL = `http://localhost:${process.env.PORT || 3000}`;
let AUTH_TOKEN = null;
const results = { passed: 0, failed: 0 };
const created = {};

const log = (status, name, detail = '') => {
  const icon = status === 'PASS' ? '✅' : '❌';
  console.log(`  ${icon} ${name}${detail ? ` — ${detail}` : ''}`);
  if (status === 'PASS') results.passed++;
  else results.failed++;
};

const api = async (method, path, body = null) => {
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(AUTH_TOKEN ? { Authorization: `Bearer ${AUTH_TOKEN}` } : {}),
    },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE_URL}${path}`, opts);
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  return { status: res.status, data, ok: res.ok };
};

const main = async () => {
  console.log('═══════════════════════════════════════════════════');
  console.log('  CP Attribution → Commission — End-to-End Test');
  console.log('═══════════════════════════════════════════════════\n');

  try {
    await mongoose.connect(process.env.MONGO_URI);
    const { default: User } = await import('../models/userModel.js');
    const { default: Project } = await import('../models/projectModel.js');
    const { default: Unit } = await import('../models/unitModel.js');

    const user =
      (await User.findOne({ email: /owner/i })) ||
      (await User.findOne().sort({ createdAt: 1 }));
    const project = await Project.findOne({ organization: user.organization });
    const unit = await Unit.findOne({ organization: user.organization, status: 'available' });
    if (!user || !project || !unit) {
      console.error('  ❌ Need a user, a project, and an available unit — seed data first.');
      process.exit(1);
    }
    AUTH_TOKEN = jwt.sign(
      { userId: user._id.toString() },
      process.env.JWT_SECRET,
      { expiresIn: '1h', algorithm: 'HS256' }
    );
    console.log(`  User: ${user.firstName} ${user.lastName}  ·  Project: ${project.name}\n`);

    // ── Setup: a CP firm + a commission rule ──
    const cpRes = await api('POST', '/api/channel-partners', {
      firmName: 'Commission SmokeTest CP', status: 'active',
    });
    created.cpId = cpRes.data?.data?._id;
    const ruleRes = await api('POST', '/api/channel-partners/commission-rules', {
      name: 'Commission SmokeTest Rule',
      rate: { method: 'percentage', percentage: 2, basis: 'sale_price' },
      payout: { schedule: 'lump_sum', tranches: [] },
      tdsPercent: 5,
    });
    created.ruleId = ruleRes.data?.data?._id;
    if (created.cpId && created.ruleId) {
      log('PASS', 'Setup: CP firm + commission rule created');
    } else {
      log('FAIL', 'Setup', `cp=${cpRes.status} rule=${ruleRes.status}`);
      throw new Error('Setup failed');
    }

    // ── Create a lead with CP attribution ──
    const leadRes = await api('POST', '/api/leads', {
      project: project._id.toString(),
      firstName: 'Commission', lastName: 'SmokeTest', phone: '+919000000004',
      source: 'Referral',
      channelPartnerAttribution: {
        viaChannelPartner: true,
        partners: [{ channelPartner: created.cpId, sharePct: 100 }],
      },
    });
    created.leadId = leadRes.data?.data?._id;
    if (leadRes.status === 201 && leadRes.data.data?.channelPartnerAttribution?.viaChannelPartner) {
      log('PASS', 'Lead created with CP attribution');
    } else {
      log('FAIL', 'Lead with CP attribution', `${leadRes.status}: ${JSON.stringify(leadRes.data).slice(0, 150)}`);
    }

    // ── Create a booking with CP attribution → commission should generate ──
    const saleRes = await api('POST', '/api/sales', {
      unitId: unit._id.toString(),
      leadId: created.leadId,
      costSheetSnapshot: { basePrice: unit.basePrice || unit.currentPrice || 1000000 },
      paymentPlanSnapshot: {},
      channelPartnerAttribution: {
        viaChannelPartner: true,
        partners: [{ channelPartner: created.cpId, sharePct: 100 }],
      },
    });
    created.saleId = saleRes.data?.data?._id || saleRes.data?.data?.sale?._id;
    if (saleRes.status === 201 || saleRes.status === 202) {
      log('PASS', 'Booking created with CP attribution', `status ${saleRes.status}`);
    } else {
      log('FAIL', 'Booking with CP attribution', `${saleRes.status}: ${JSON.stringify(saleRes.data).slice(0, 150)}`);
    }

    // ── A commission record should now exist for that CP ──
    await new Promise((r) => setTimeout(r, 1500));
    const recRes = await api('GET', `/api/channel-partners/commission-records?channelPartner=${created.cpId}`);
    const rec = (recRes.data?.data || [])[0];
    if (recRes.ok && rec && rec.netAmount > 0 && Array.isArray(rec.payouts) && rec.payouts.length > 0) {
      log('PASS', 'Commission record generated', `net ₹${rec.netAmount}, ${rec.payouts.length} payout(s)`);
      created.recordId = rec._id;
    } else {
      log('FAIL', 'Commission record generation', `${recRes.status}: ${JSON.stringify(recRes.data).slice(0, 150)}`);
    }

    // ── Mark the payout paid ──
    if (created.recordId) {
      const payRes = await api('PUT', `/api/channel-partners/commission-records/${created.recordId}/payouts/0/pay`);
      if (payRes.ok && payRes.data.data?.status === 'paid') {
        log('PASS', 'Mark payout paid → record status paid');
      } else {
        log('FAIL', 'Mark payout paid', `${payRes.status}: ${JSON.stringify(payRes.data).slice(0, 150)}`);
      }
    }
  } catch (err) {
    console.error('\n💥 FATAL ERROR:', err.message);
  } finally {
    console.log('\n🧹 CLEANUP\n');
    const { default: ChannelPartner } = await import('../models/channelPartnerModel.js');
    const { default: CommissionRule } = await import('../models/commissionRuleModel.js');
    const { default: CommissionRecord } = await import('../models/commissionRecordModel.js');
    const { default: Lead } = await import('../models/leadModel.js');
    const { default: Sale } = await import('../models/salesModel.js');
    if (created.saleId) {
      await CommissionRecord.deleteMany({ sale: created.saleId });
      await Sale.deleteOne({ _id: created.saleId });
    }
    if (created.leadId) await Lead.deleteOne({ _id: created.leadId });
    if (created.ruleId) await CommissionRule.deleteOne({ _id: created.ruleId });
    if (created.cpId) await ChannelPartner.deleteOne({ _id: created.cpId });
    console.log('  Cleaned up test records');
    console.log('\n═══════════════════════════════════════════════════');
    console.log(`  RESULTS: ✅ ${results.passed} passed  ❌ ${results.failed} failed`);
    console.log('═══════════════════════════════════════════════════\n');
    await mongoose.disconnect();
    process.exit(results.failed > 0 ? 1 : 0);
  }
};

main();
```

- [ ] **Step 2: Verify the file parses**

Run (from the backend repo root):

```bash
node --check tests/testChannelPartnerCommission.js
```

Expected: no output, exit code 0.

- [ ] **Step 3: Run the smoke test (server must be running)**

Start the backend (`node server.js`), then in another terminal (backend repo root):

```bash
node tests/testChannelPartnerCommission.js
```

Expected: all checks PASS — lead + booking created with attribution, a commission record generated with a non-zero net amount, and the payout marks paid. If no seeded available `Unit` exists the test exits early with a clear message — that is acceptable; note it.

- [ ] **Step 4: Commit**

```bash
git add tests/testChannelPartnerCommission.js
git commit -m "test(channel-partner): add attribution → commission smoke test"
```

---

## Task 10: Frontend API client — commission & attribution methods

**Files:**
- Modify (frontend): `src/services/api.js`

- [ ] **Step 1: Extend `channelPartnerAPI`**

In `src/services/api.js`, the `channelPartnerAPI` object's last entry is:

```js
  updateCommissionRule: (id, data) => api.put(`/channel-partners/commission-rules/${id}`, data),
};
```

Add the new methods before the closing `};`:

```js
  updateCommissionRule: (id, data) => api.put(`/channel-partners/commission-rules/${id}`, data),
  // Commission records
  getCommissionRecords: (params = {}) => api.get('/channel-partners/commission-records', { params }),
  markPayoutPaid: (recordId, index) =>
    api.put(`/channel-partners/commission-records/${recordId}/payouts/${index}/pay`),
  // Booking attribution edit
  editSaleAttribution: (saleId, data) =>
    api.put(`/channel-partners/sales/${saleId}/attribution`, data),
};
```

- [ ] **Step 2: Commit**

```bash
git add src/services/api.js
git commit -m "feat(channel-partner): add commission-record + attribution API methods"
```

---

## Task 11: Shared CP attribution form component

**Files:**
- Create (frontend): `src/components/channel-partners/ChannelPartnerAttributionFields.js`

A reusable controlled component for picking "via channel partner?" + a multi-CP split. Used by the lead and sale forms and the edit dialog.

- [ ] **Step 1: Create `src/components/channel-partners/ChannelPartnerAttributionFields.js`**

```jsx
// File: src/components/channel-partners/ChannelPartnerAttributionFields.js
// Description: Controlled form fields for channel-partner attribution — a
//   "via CP?" toggle plus a multi-CP commission split. Value shape:
//   { viaChannelPartner: bool, partners: [{ channelPartner, agent, sharePct }] }

import React, { useEffect, useState } from 'react';
import {
  Box, FormControlLabel, Switch, Stack, Autocomplete, TextField, IconButton,
  Button, Typography, Alert,
} from '@mui/material';
import { Delete, Add } from '@mui/icons-material';
import { channelPartnerAPI } from '../../services/api';

const ChannelPartnerAttributionFields = ({ value, onChange }) => {
  const v = value || { viaChannelPartner: false, partners: [] };
  const [partners, setPartners] = useState([]);

  useEffect(() => {
    channelPartnerAPI
      .getChannelPartners({ status: 'active' })
      .then((res) => setPartners(res.data?.data || []))
      .catch(() => setPartners([]));
  }, []);

  const emit = (next) => onChange({ ...v, ...next });

  const setRow = (i, key, val) => {
    const rows = [...(v.partners || [])];
    rows[i] = { ...rows[i], [key]: val };
    emit({ partners: rows });
  };
  const addRow = () =>
    emit({ partners: [...(v.partners || []), { channelPartner: '', agent: null, sharePct: 0 }] });
  const removeRow = (i) =>
    emit({ partners: (v.partners || []).filter((_, idx) => idx !== i) });

  const sum = (v.partners || []).reduce((a, p) => a + (Number(p.sharePct) || 0), 0);

  return (
    <Box>
      <FormControlLabel
        control={
          <Switch
            checked={Boolean(v.viaChannelPartner)}
            onChange={(e) =>
              emit({
                viaChannelPartner: e.target.checked,
                partners: e.target.checked && (v.partners || []).length === 0
                  ? [{ channelPartner: '', agent: null, sharePct: 100 }]
                  : v.partners,
              })
            }
          />
        }
        label="Sourced via a channel partner"
      />

      {v.viaChannelPartner && (
        <Stack spacing={1} sx={{ mt: 1 }}>
          {(v.partners || []).map((row, i) => (
            <Stack key={i} direction="row" spacing={1} alignItems="center">
              <Autocomplete
                sx={{ flex: 3 }}
                options={partners}
                value={partners.find((p) => p._id === row.channelPartner) || null}
                getOptionLabel={(o) => o.firmName || ''}
                isOptionEqualToValue={(o, val) => o._id === val._id}
                onChange={(e, val) => setRow(i, 'channelPartner', val?._id || '')}
                renderInput={(params) => (
                  <TextField {...params} size="small" label="Channel partner" />
                )}
              />
              <TextField
                sx={{ flex: 1 }}
                size="small"
                type="number"
                label="Share %"
                value={row.sharePct}
                onChange={(e) => setRow(i, 'sharePct', e.target.value)}
              />
              <IconButton onClick={() => removeRow(i)} aria-label="remove">
                <Delete />
              </IconButton>
            </Stack>
          ))}
          <Box>
            <Button size="small" startIcon={<Add />} onClick={addRow}>
              Add channel partner
            </Button>
          </Box>
          {(v.partners || []).length > 0 && Math.abs(sum - 100) > 0.01 && (
            <Alert severity="warning">
              Commission split is {sum}% — it must total 100%.
            </Alert>
          )}
          <Typography variant="caption" color="text.secondary">
            When the booking closes, commission is generated per partner by their share.
          </Typography>
        </Stack>
      )}
    </Box>
  );
};

export default ChannelPartnerAttributionFields;
```

- [ ] **Step 2: Commit**

```bash
git add src/components/channel-partners/ChannelPartnerAttributionFields.js
git commit -m "feat(channel-partner): add shared CP attribution form component"
```

---

## Task 12: Wire CP attribution into the lead form

**Files:**
- Modify (frontend): `src/pages/leads/CreateLeadPage.js`

- [ ] **Step 1: Import the component**

In `src/pages/leads/CreateLeadPage.js`, add to the imports (near the other component imports at the top):

```js
import ChannelPartnerAttributionFields from '../../components/channel-partners/ChannelPartnerAttributionFields';
```

- [ ] **Step 2: Add `channelPartnerAttribution` to `formData`**

The `formData` state object ends with the `researchSources` block:

```js
    // AI enrichment research sources (optional)
    researchSources: {
      linkedinUrl: '',
      companyWebsite: '',
      articleUrls: [''],
    },
  });
```

Add the attribution field before the closing `});`:

```js
    // AI enrichment research sources (optional)
    researchSources: {
      linkedinUrl: '',
      companyWebsite: '',
      articleUrls: [''],
    },

    // Channel partner attribution (optional)
    channelPartnerAttribution: { viaChannelPartner: false, partners: [] },
  });
```

- [ ] **Step 3: Render the component in the Lead Details step**

In `renderLeadDetails()`, the "Research sources" `Accordion` (added by an earlier feature) sits in a `<Grid item xs={12}>`. After that grid item's closing `</Grid>` and before the container's closing `</Grid>`, add a new grid item:

```js
      <Grid item xs={12}>
        <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
          Channel partner
        </Typography>
        <ChannelPartnerAttributionFields
          value={formData.channelPartnerAttribution}
          onChange={(val) =>
            setFormData((prev) => ({ ...prev, channelPartnerAttribution: val }))
          }
        />
      </Grid>
```

- [ ] **Step 4: Include it in the `handleSubmit` payload**

In `handleSubmit`, the `leadData` object is built explicitly. After the `notes` line (`notes: formData.notes.trim() || undefined,`), add — only sending the attribution when the toggle is on and a partner is selected:

```js
        notes: formData.notes.trim() || undefined,

        // Channel partner attribution (only when provided)
        ...((() => {
          const cpa = formData.channelPartnerAttribution;
          const validPartners = (cpa?.partners || []).filter(
            (p) => p.channelPartner && Number(p.sharePct) > 0
          );
          return cpa?.viaChannelPartner && validPartners.length > 0
            ? {
                channelPartnerAttribution: {
                  viaChannelPartner: true,
                  partners: validPartners.map((p) => ({
                    channelPartner: p.channelPartner,
                    agent: p.agent || null,
                    sharePct: Number(p.sharePct) || 0,
                  })),
                },
              }
            : {};
        })()),
```

- [ ] **Step 5: Verify the build compiles**

Run (from the frontend repo root):

```bash
CI=true npm run build
```

Expected: `Compiled successfully.`

- [ ] **Step 6: Commit**

```bash
git add src/pages/leads/CreateLeadPage.js
git commit -m "feat(channel-partner): capture CP attribution on the lead form"
```

---

## Task 13: Wire CP attribution into the sale form

**Files:**
- Modify (frontend): `src/pages/sales/CreateSalePage.js`

- [ ] **Step 1: Import the component**

In `src/pages/sales/CreateSalePage.js`, add to the imports:

```js
import ChannelPartnerAttributionFields from '../../components/channel-partners/ChannelPartnerAttributionFields';
```

- [ ] **Step 2: Add attribution state**

In the `CreateSalePage` component, alongside the other `useState` declarations (near `const [discount, setDiscount] = useState(...)`), add:

```js
  const [channelPartnerAttribution, setChannelPartnerAttribution] = useState({
    viaChannelPartner: false,
    partners: [],
  });
```

- [ ] **Step 3: Render the component in the customer step**

`CreateSalePage` selects a customer/lead in one of its steps. In the JSX where the lead/customer is selected (search the render for `selectedCustomer`), add the attribution fields directly below the customer selector — inside the same step's container:

```jsx
        <Box sx={{ mt: 2 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
            Channel partner
          </Typography>
          <ChannelPartnerAttributionFields
            value={channelPartnerAttribution}
            onChange={setChannelPartnerAttribution}
          />
        </Box>
```

- [ ] **Step 4: Include it in the `saleData` payload**

The `saleData` object is built before `salesAPI.createSale(saleData)`. After the discount lines (`saleData.discountPercentage = ...` / `saleData.discountAmount = ...`), add:

```js
      const cpaPartners = (channelPartnerAttribution.partners || []).filter(
        (p) => p.channelPartner && Number(p.sharePct) > 0
      );
      if (channelPartnerAttribution.viaChannelPartner && cpaPartners.length > 0) {
        saleData.channelPartnerAttribution = {
          viaChannelPartner: true,
          partners: cpaPartners.map((p) => ({
            channelPartner: p.channelPartner,
            agent: p.agent || null,
            sharePct: Number(p.sharePct) || 0,
          })),
        };
      }
```

- [ ] **Step 5: Verify the build compiles**

Run (from the frontend repo root):

```bash
CI=true npm run build
```

Expected: `Compiled successfully.`

- [ ] **Step 6: Commit**

```bash
git add src/pages/sales/CreateSalePage.js
git commit -m "feat(channel-partner): capture CP attribution on the booking form"
```

---

## Task 14: Commission Records page

**Files:**
- Create (frontend): `src/pages/channel-partners/CommissionRecordListPage.js`

- [ ] **Step 1: Create `src/pages/channel-partners/CommissionRecordListPage.js`**

```jsx
// File: src/pages/channel-partners/CommissionRecordListPage.js
// Description: Lists channel-partner commission records and lets an authorised
//   user mark individual payouts paid.

import React, { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, Table, TableBody, TableCell, TableHead, TableRow, Chip,
  CircularProgress, Alert, Button, MenuItem, TextField, Stack, Collapse,
  IconButton,
} from '@mui/material';
import { KeyboardArrowDown, KeyboardArrowUp } from '@mui/icons-material';
import { channelPartnerAPI } from '../../services/api';

const STATUS_COLOR = {
  accrued: 'default',
  partially_paid: 'warning',
  paid: 'success',
  cancelled: 'error',
};

const inr = (n) =>
  n === null || n === undefined ? '—' : `₹${Math.round(n).toLocaleString('en-IN')}`;

const RecordRow = ({ record, onPay }) => {
  const [open, setOpen] = useState(false);
  return (
    <>
      <TableRow hover>
        <TableCell>
          <IconButton size="small" onClick={() => setOpen((o) => !o)}>
            {open ? <KeyboardArrowUp /> : <KeyboardArrowDown />}
          </IconButton>
        </TableCell>
        <TableCell>{record.channelPartner?.firmName || '—'}</TableCell>
        <TableCell>{record.sale?.project?.name || '—'}</TableCell>
        <TableCell align="right">{record.sharePct}%</TableCell>
        <TableCell align="right">{inr(record.grossAmount)}</TableCell>
        <TableCell align="right">{inr(record.netAmount)}</TableCell>
        <TableCell>
          <Chip size="small" label={record.status} color={STATUS_COLOR[record.status] || 'default'} />
        </TableCell>
      </TableRow>
      <TableRow>
        <TableCell colSpan={7} sx={{ py: 0, border: open ? undefined : 0 }}>
          <Collapse in={open} timeout="auto" unmountOnExit>
            <Box sx={{ p: 2 }}>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>Payouts</Typography>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Label</TableCell>
                    <TableCell>Trigger</TableCell>
                    <TableCell align="right">Amount</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {(record.payouts || []).map((p, i) => (
                    <TableRow key={i}>
                      <TableCell>{p.label}</TableCell>
                      <TableCell>{p.trigger}</TableCell>
                      <TableCell align="right">{inr(p.amount)}</TableCell>
                      <TableCell>
                        <Chip size="small" label={p.status}
                          color={p.status === 'paid' ? 'success' : 'default'} />
                      </TableCell>
                      <TableCell align="right">
                        {p.status === 'pending' && record.status !== 'cancelled' && (
                          <Button size="small" onClick={() => onPay(record._id, i)}>
                            Mark paid
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
          </Collapse>
        </TableCell>
      </TableRow>
    </>
  );
};

const CommissionRecordListPage = () => {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const fetchRecords = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = {};
      if (statusFilter) params.status = statusFilter;
      const res = await channelPartnerAPI.getCommissionRecords(params);
      setRecords(res.data?.data || []);
    } catch (e) {
      setError(e.response?.data?.message || 'Failed to load commission records.');
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    fetchRecords();
  }, [fetchRecords]);

  const handlePay = async (recordId, index) => {
    try {
      await channelPartnerAPI.markPayoutPaid(recordId, index);
      fetchRecords();
    } catch (e) {
      setError(e.response?.data?.message || 'Failed to mark payout paid.');
    }
  };

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h4" sx={{ fontWeight: 700, mb: 3 }}>
        Commission Records
      </Typography>

      <Stack direction="row" spacing={2} sx={{ mb: 2 }}>
        <TextField
          size="small"
          select
          label="Status"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          sx={{ minWidth: 180 }}
        >
          <MenuItem value="">All</MenuItem>
          <MenuItem value="accrued">Accrued</MenuItem>
          <MenuItem value="partially_paid">Partially paid</MenuItem>
          <MenuItem value="paid">Paid</MenuItem>
          <MenuItem value="cancelled">Cancelled</MenuItem>
        </TextField>
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      ) : records.length === 0 ? (
        <Alert severity="info">
          No commission records yet. They are generated when a booking with a
          channel-partner attribution is created.
        </Alert>
      ) : (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell />
              <TableCell>Channel partner</TableCell>
              <TableCell>Project</TableCell>
              <TableCell align="right">Share</TableCell>
              <TableCell align="right">Gross</TableCell>
              <TableCell align="right">Net</TableCell>
              <TableCell>Status</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {records.map((r) => (
              <RecordRow key={r._id} record={r} onPay={handlePay} />
            ))}
          </TableBody>
        </Table>
      )}
    </Box>
  );
};

export default CommissionRecordListPage;
```

- [ ] **Step 2: Commit**

```bash
git add src/pages/channel-partners/CommissionRecordListPage.js
git commit -m "feat(channel-partner): add commission records page"
```

---

## Task 15: Routing, navigation & legacy frontend deprecation

**Files:**
- Modify (frontend): `src/App.js`
- Modify (frontend): `src/components/layout/DashboardLayout.js`

- [ ] **Step 1: Add the Commission Records route**

In `src/App.js`, add the lazy import alongside the other channel-partner imports:

```js
const CommissionRecordListPage = React.lazy(() => import('./pages/channel-partners/CommissionRecordListPage'));
```

Add a route, placed with the other `/channel-partners/*` routes and **before** `/channel-partners/:id`:

```jsx
      <Route path="/channel-partners/commission-records" element={
        <ProtectedRoute requiredPermission={(canAccess) => canAccess.channelPartners()}>
          <DashboardLayout>
            <Suspense fallback={<LoadingFallback message="Loading commission records..." />}>
              <CommissionRecordListPage />
            </Suspense>
          </DashboardLayout>
        </ProtectedRoute>
      } />
```

- [ ] **Step 2: Remove the legacy commission routes from `App.js`**

In `src/App.js`, delete the six commission lazy-import lines:

```js
const CommissionDashboardPage = React.lazy(() => import('./pages/sales/CommissionDashboardPage'));
const CommissionListPage = React.lazy(() => import('./pages/sales/CommissionListPage'));
const CommissionDetailPage = React.lazy(() => import('./pages/sales/CommissionDetailPage'));
const CommissionStructurePage = React.lazy(() => import('./pages/sales/CommissionStructurePage'));
const CommissionPaymentsPage = React.lazy(() => import('./pages/sales/CommissionPaymentsPage'));
const CommissionReportsPage = React.lazy(() => import('./pages/sales/CommissionReportsPage'));
```

And delete the entire commission routes block — the seven `<Route>` elements bounded by the comments `{/* COMMISSION MANAGEMENT ROUTES - UNCHANGED */}` and the next section's `{/* PAYMENT MANAGEMENT ROUTES - UNCHANGED */}`. Delete the commission routes and their leading comment banner; leave the `PAYMENT MANAGEMENT` banner and everything after it intact.

- [ ] **Step 3: Add the Commission Records nav item; remove the legacy commission nav item**

In `src/components/layout/DashboardLayout.js`, in `getNavigationItems`, the Channel Partners nav entry (added in Plan 1) has a `children` array with `cp-list` and `cp-rules`. Add a third child:

```js
{ id: 'cp-records', title: 'Commission Records', path: '/channel-partners/commission-records' },
```

Then remove the legacy commission nav child — the entry inside the `sales` item's `children` array:

```js
{ id: 'commissions', title: 'Commissions', icon: Handshake, path: '/sales/commissions', requiredAccess: () => canAccess.salesPipeline() || canAccess.viewFinancials() },
```

Delete that single line.

- [ ] **Step 4: Banner the legacy commission page files**

Add this comment as the first line of each of the six legacy commission page files in `src/pages/sales/` — `CommissionDashboardPage.js`, `CommissionListPage.js`, `CommissionDetailPage.js`, `CommissionStructurePage.js`, `CommissionPaymentsPage.js`, `CommissionReportsPage.js`:

```js
// DEPRECATED (2026-05-20): superseded by the Channel Partners module. No longer routed. Pending removal.
```

- [ ] **Step 5: Verify the build compiles**

Run (from the frontend repo root):

```bash
CI=true npm run build
```

Expected: `Compiled successfully.` The six commission page files are no longer imported, so even though they remain in the repo they are not part of the bundle. Fix any compile error (e.g. a now-dangling reference) before continuing.

- [ ] **Step 6: Commit**

```bash
git add src/App.js src/components/layout/DashboardLayout.js src/pages/sales/CommissionDashboardPage.js src/pages/sales/CommissionListPage.js src/pages/sales/CommissionDetailPage.js src/pages/sales/CommissionStructurePage.js src/pages/sales/CommissionPaymentsPage.js src/pages/sales/CommissionReportsPage.js
git commit -m "feat(channel-partner): route commission records; deprecate legacy commission UI"
```

---

## Task 16: Manual end-to-end verification

**Files:** none (verification only).

- [ ] **Step 1: Start both servers** — backend `node server.js`, frontend `npm start`.

- [ ] **Step 2: Attribution on a lead** — create a lead, toggle "Sourced via a channel partner", pick a CP with 100% share, save. Confirm the lead saves.

- [ ] **Step 3: Attribution on a booking → commission** — create a booking for a unit, toggle the CP attribution (one CP, 100%), complete the booking. Open **Channel Partners → Commission Records** — confirm a record was generated with a non-zero gross/net (it requires an active commission rule for that project or org-wide).

- [ ] **Step 4: Mark a payout paid** — expand the record, click "Mark paid" on a payout; confirm the payout and the record status update.

- [ ] **Step 5: Multi-CP split** — create another booking with two CPs at 60/40; confirm two commission records are generated with the split amounts.

- [ ] **Step 6: Legacy gone** — confirm the old "Commissions" item under Sales & Bookings is gone from the nav and `/sales/commissions` no longer resolves; confirm the Leadership dashboard still loads (its commission figures now come from the new records).

- [ ] **Step 7** — commit any verification-driven fixes; if all worked, nothing to commit.

---

## Notes for the implementer

- **Two repos.** Tasks 1–9 are backend; Tasks 10–15 are frontend. Run git commands from the repo named in each task's **Files** block.
- **No pushing.** Commit locally; do not push.
- **Plan 1 dependency:** this plan assumes `ChannelPartner`, `ChannelPartnerAgent`, `CommissionRule` models, the `CHANNEL_PARTNERS` permissions, and `channelPartnerAPI` already exist (Plan 1). If any are missing, STOP and report.
- **`syncCommissionForSale` never throws** — a missing rule or attribution yields no/zero records; it must not break booking creation.
- The legacy commission page files and model/controller/route files are intentionally left in the repo (banner-flagged, unwired) for a later clean deletion — do not delete them in this plan.
- The `editSaleAttribution` endpoint + API method are built here so the capability exists, but the **UI** for a senior role to edit a booking's CP attribution after the fact ships in Plan 3 — it is intentionally not wired to a screen in this plan. The `channelPartnerAPI.editSaleAttribution` method being unused by a Plan 2 screen is expected, not an oversight.
- Backend does not hard-reject attributing a `suspended`/`blacklisted` CP; the attribution component only lists `active` CPs, which is the operative control. Hardening the API against that edge case is a known minor follow-up.
