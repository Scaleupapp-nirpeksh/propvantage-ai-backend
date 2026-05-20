# Channel Partner — Plan 1: Registry & Commission Rules

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the Channel Partner registry — manage partner firms, their agents, and org-configurable commission rules.

**Architecture:** A new self-contained Channel Partner module: three new Mongoose models (`ChannelPartner`, `ChannelPartnerAgent`, `CommissionRule`), a new controller + routes mounted at `/api/channel-partners`, a new `CHANNEL_PARTNERS` permission group, and a new frontend Channel Partners section with registry and commission-rule CRUD pages.

**Tech Stack:** Backend — Node/Express/Mongoose. Frontend — React 18 + MUI v5.

**Spec:** `docs/superpowers/specs/2026-05-20-channel-partner-module-design.md`

**Plan 1 of 3.** This plan delivers the registry and rule management. Plan 2 adds lead/sale attribution + the commission engine + legacy-commission deprecation. Plan 3 adds the CP performance dashboard + analytics integration. This plan does NOT touch attribution, the legacy commission system, leads, or sales.

**Two repos:**
- Backend: `/Users/nirpekshnandan/My Products/propvantage-ai-backend`
- Frontend: `/Users/nirpekshnandan/My Products/propvantage-ai-frontend`

All paths in each task are relative to the repo named in that task's **Files** block. Work on `main`; commit per task with the given messages; do **not** push.

---

## Task 1: CHANNEL_PARTNERS permission group

**Files:**
- Modify (backend): `config/permissions.js`

- [ ] **Step 1: Add the permission group**

In `config/permissions.js`, the `PERMISSIONS` object's last group is `TASKS`, which ends with:

```js
    ANALYTICS: 'tasks:analytics',
    BULK_OPERATIONS: 'tasks:bulk_operations',
  },
};
```

Add the `CHANNEL_PARTNERS` group before the closing `};`:

```js
    ANALYTICS: 'tasks:analytics',
    BULK_OPERATIONS: 'tasks:bulk_operations',
  },

  // ─── CHANNEL PARTNERS ───────────────────────────────────
  CHANNEL_PARTNERS: {
    VIEW: 'channel_partners:view',
    CREATE: 'channel_partners:create',
    UPDATE: 'channel_partners:update',
    MANAGE_COMMISSION_RULES: 'channel_partners:manage_commission_rules',
    ATTRIBUTE: 'channel_partners:attribute',
    EDIT_BOOKING_ATTRIBUTION: 'channel_partners:edit_booking_attribution',
    MANAGE_COMMISSIONS: 'channel_partners:manage_commissions',
  },
};
```

`ALL_PERMISSIONS` and `PERMISSION_GROUPS` pick up the new group automatically — no other change in this file. (The `ATTRIBUTE` / `EDIT_BOOKING_ATTRIBUTION` / `MANAGE_COMMISSIONS` keys are unused in Plan 1 but defined now so Plans 2–3 need no further permission migration.)

- [ ] **Step 2: Verify the file parses**

Run (from the backend repo root):

```bash
node --check config/permissions.js
```

Expected: no output, exit code 0.

- [ ] **Step 3: Commit**

```bash
git add config/permissions.js
git commit -m "feat(channel-partner): add CHANNEL_PARTNERS permission group"
```

---

## Task 2: ChannelPartner model

**Files:**
- Create (backend): `models/channelPartnerModel.js`

- [ ] **Step 1: Create `models/channelPartnerModel.js`**

```js
// File: models/channelPartnerModel.js
// Description: A channel partner firm — an external broker organisation that
//   sources buyers for the developer. Managed records (no login in this phase).

import mongoose from 'mongoose';

const channelPartnerSchema = new mongoose.Schema(
  {
    organization: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
    firmName: {
      type: String,
      required: [true, 'Firm name is required'],
      trim: true,
    },
    reraRegistrationNumber: { type: String, trim: true, default: '' },
    pan: { type: String, trim: true, uppercase: true, default: '' },
    gstin: { type: String, trim: true, uppercase: true, default: '' },
    primaryContact: {
      name: { type: String, trim: true, default: '' },
      email: { type: String, trim: true, lowercase: true, default: '' },
      phone: { type: String, trim: true, default: '' },
    },
    address: { type: String, trim: true, default: '' },
    approvedProjects: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Project' }],
    status: {
      type: String,
      enum: ['active', 'suspended', 'blacklisted'],
      default: 'active',
      index: true,
    },
    bankDetails: {
      accountName: { type: String, trim: true, default: '' },
      accountNumber: { type: String, trim: true, default: '' },
      ifsc: { type: String, trim: true, uppercase: true, default: '' },
      bankName: { type: String, trim: true, default: '' },
    },
    agreementNotes: { type: String, trim: true, default: '' },
    onboardedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

const ChannelPartner = mongoose.model('ChannelPartner', channelPartnerSchema);

export default ChannelPartner;
```

- [ ] **Step 2: Verify the file parses**

Run (from the backend repo root):

```bash
node --check models/channelPartnerModel.js
```

Expected: no output, exit code 0.

- [ ] **Step 3: Commit**

```bash
git add models/channelPartnerModel.js
git commit -m "feat(channel-partner): add ChannelPartner model"
```

---

## Task 3: ChannelPartnerAgent model

**Files:**
- Create (backend): `models/channelPartnerAgentModel.js`

- [ ] **Step 1: Create `models/channelPartnerAgentModel.js`**

```js
// File: models/channelPartnerAgentModel.js
// Description: An individual agent working under a channel partner firm.
//   Managed records (no login in this phase).

import mongoose from 'mongoose';

const channelPartnerAgentSchema = new mongoose.Schema(
  {
    organization: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
    channelPartner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ChannelPartner',
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: [true, 'Agent name is required'],
      trim: true,
    },
    email: { type: String, trim: true, lowercase: true, default: '' },
    phone: { type: String, trim: true, default: '' },
    reraAgentNumber: { type: String, trim: true, default: '' },
    status: {
      type: String,
      enum: ['active', 'inactive'],
      default: 'active',
    },
  },
  { timestamps: true }
);

const ChannelPartnerAgent = mongoose.model(
  'ChannelPartnerAgent',
  channelPartnerAgentSchema
);

export default ChannelPartnerAgent;
```

- [ ] **Step 2: Verify the file parses**

Run (from the backend repo root):

```bash
node --check models/channelPartnerAgentModel.js
```

Expected: no output, exit code 0.

- [ ] **Step 3: Commit**

```bash
git add models/channelPartnerAgentModel.js
git commit -m "feat(channel-partner): add ChannelPartnerAgent model"
```

---

## Task 4: CommissionRule model

**Files:**
- Create (backend): `models/commissionRuleModel.js`

- [ ] **Step 1: Create `models/commissionRuleModel.js`**

```js
// File: models/commissionRuleModel.js
// Description: An org-configurable channel-partner commission policy — rate
//   and payout schedule. Consumed by the commission engine in Plan 2.

import mongoose from 'mongoose';

const trancheSchema = new mongoose.Schema(
  {
    label: { type: String, required: true, trim: true },
    percentage: { type: Number, required: true, min: 0, max: 100 },
    trigger: {
      type: String,
      enum: ['on_booking', 'on_agreement', 'on_registration', 'on_possession'],
      required: true,
    },
  },
  { _id: false }
);

const commissionRuleSchema = new mongoose.Schema(
  {
    organization: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: [true, 'Rule name is required'],
      trim: true,
    },
    description: { type: String, trim: true, default: '' },
    // null = applies to all projects; otherwise project-specific
    appliesToProject: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
      default: null,
    },
    rate: {
      method: {
        type: String,
        enum: ['percentage', 'flat'],
        default: 'percentage',
      },
      percentage: { type: Number, default: 0, min: 0 },
      flatAmount: { type: Number, default: 0, min: 0 },
      basis: {
        type: String,
        enum: ['sale_price', 'base_price'],
        default: 'sale_price',
      },
    },
    payout: {
      schedule: {
        type: String,
        enum: ['lump_sum', 'tranches'],
        default: 'lump_sum',
      },
      tranches: [trancheSchema],
    },
    tdsPercent: { type: Number, default: 5, min: 0, max: 100 },
    status: {
      type: String,
      enum: ['active', 'inactive'],
      default: 'active',
      index: true,
    },
  },
  { timestamps: true }
);

// Tranche percentages must sum to 100 when the schedule uses tranches.
commissionRuleSchema.pre('validate', function (next) {
  if (this.payout?.schedule === 'tranches') {
    const tranches = this.payout.tranches || [];
    if (tranches.length === 0) {
      return next(new Error('Tranche schedule requires at least one tranche'));
    }
    const sum = tranches.reduce((a, t) => a + (t.percentage || 0), 0);
    if (Math.round(sum) !== 100) {
      return next(new Error(`Tranche percentages must sum to 100 (got ${sum})`));
    }
  }
  next();
});

const CommissionRule = mongoose.model('CommissionRule', commissionRuleSchema);

export default CommissionRule;
```

- [ ] **Step 2: Verify the file parses**

Run (from the backend repo root):

```bash
node --check models/commissionRuleModel.js
```

Expected: no output, exit code 0.

- [ ] **Step 3: Commit**

```bash
git add models/commissionRuleModel.js
git commit -m "feat(channel-partner): add CommissionRule model"
```

---

## Task 5: Channel partner controller — firms & agents

**Files:**
- Create (backend): `controllers/channelPartnerController.js`

- [ ] **Step 1: Create `controllers/channelPartnerController.js` with the registry handlers**

```js
// File: controllers/channelPartnerController.js
// Description: Channel Partner module controller — registry (firms + agents)
//   and commission rules. All handlers are organization-scoped.

import asyncHandler from 'express-async-handler';
import ChannelPartner from '../models/channelPartnerModel.js';
import ChannelPartnerAgent from '../models/channelPartnerAgentModel.js';
import CommissionRule from '../models/commissionRuleModel.js';

// ─── Channel Partner firms ───────────────────────────────────

/**
 * @desc    Create a channel partner firm
 * @route   POST /api/channel-partners
 * @access  Private (channel_partners:create)
 */
const createChannelPartner = asyncHandler(async (req, res) => {
  const { firmName } = req.body;
  if (!firmName || !firmName.trim()) {
    res.status(400);
    throw new Error('Firm name is required');
  }

  const partner = await ChannelPartner.create({
    ...req.body,
    organization: req.user.organization,
    onboardedBy: req.user._id,
  });

  res.status(201).json({ success: true, data: partner });
});

/**
 * @desc    List channel partner firms
 * @route   GET /api/channel-partners
 * @access  Private (channel_partners:view)
 */
const getChannelPartners = asyncHandler(async (req, res) => {
  const { status, search } = req.query;
  const query = { organization: req.user.organization };
  if (status) query.status = status;
  if (search) query.firmName = { $regex: search, $options: 'i' };

  const partners = await ChannelPartner.find(query)
    .populate('approvedProjects', 'name')
    .sort({ firmName: 1 });

  res.json({ success: true, count: partners.length, data: partners });
});

/**
 * @desc    Get one channel partner firm with its agents
 * @route   GET /api/channel-partners/:id
 * @access  Private (channel_partners:view)
 */
const getChannelPartnerById = asyncHandler(async (req, res) => {
  const partner = await ChannelPartner.findOne({
    _id: req.params.id,
    organization: req.user.organization,
  }).populate('approvedProjects', 'name');

  if (!partner) {
    res.status(404);
    throw new Error('Channel partner not found');
  }

  const agents = await ChannelPartnerAgent.find({
    channelPartner: partner._id,
    organization: req.user.organization,
  }).sort({ name: 1 });

  res.json({ success: true, data: { ...partner.toObject(), agents } });
});

/**
 * @desc    Update a channel partner firm
 * @route   PUT /api/channel-partners/:id
 * @access  Private (channel_partners:update)
 */
const updateChannelPartner = asyncHandler(async (req, res) => {
  const partner = await ChannelPartner.findOne({
    _id: req.params.id,
    organization: req.user.organization,
  });
  if (!partner) {
    res.status(404);
    throw new Error('Channel partner not found');
  }

  // organization / onboardedBy are immutable via this endpoint
  const { organization, onboardedBy, ...updatable } = req.body;
  Object.assign(partner, updatable);
  await partner.save();

  res.json({ success: true, data: partner });
});

// ─── Channel Partner agents ──────────────────────────────────

/**
 * @desc    Add an agent to a channel partner firm
 * @route   POST /api/channel-partners/:id/agents
 * @access  Private (channel_partners:update)
 */
const createAgent = asyncHandler(async (req, res) => {
  const partner = await ChannelPartner.findOne({
    _id: req.params.id,
    organization: req.user.organization,
  });
  if (!partner) {
    res.status(404);
    throw new Error('Channel partner not found');
  }
  if (!req.body.name || !req.body.name.trim()) {
    res.status(400);
    throw new Error('Agent name is required');
  }

  const agent = await ChannelPartnerAgent.create({
    name: req.body.name,
    email: req.body.email,
    phone: req.body.phone,
    reraAgentNumber: req.body.reraAgentNumber,
    status: req.body.status,
    channelPartner: partner._id,
    organization: req.user.organization,
  });

  res.status(201).json({ success: true, data: agent });
});

/**
 * @desc    List agents of a channel partner firm
 * @route   GET /api/channel-partners/:id/agents
 * @access  Private (channel_partners:view)
 */
const getAgents = asyncHandler(async (req, res) => {
  const agents = await ChannelPartnerAgent.find({
    channelPartner: req.params.id,
    organization: req.user.organization,
  }).sort({ name: 1 });

  res.json({ success: true, count: agents.length, data: agents });
});

/**
 * @desc    Update an agent
 * @route   PUT /api/channel-partners/agents/:agentId
 * @access  Private (channel_partners:update)
 */
const updateAgent = asyncHandler(async (req, res) => {
  const agent = await ChannelPartnerAgent.findOne({
    _id: req.params.agentId,
    organization: req.user.organization,
  });
  if (!agent) {
    res.status(404);
    throw new Error('Agent not found');
  }

  const { organization, channelPartner, ...updatable } = req.body;
  Object.assign(agent, updatable);
  await agent.save();

  res.json({ success: true, data: agent });
});

export {
  createChannelPartner,
  getChannelPartners,
  getChannelPartnerById,
  updateChannelPartner,
  createAgent,
  getAgents,
  updateAgent,
};
```

- [ ] **Step 2: Verify the file parses**

Run (from the backend repo root):

```bash
node --check controllers/channelPartnerController.js
```

Expected: no output, exit code 0.

- [ ] **Step 3: Commit**

```bash
git add controllers/channelPartnerController.js
git commit -m "feat(channel-partner): add registry controller (firms + agents)"
```

---

## Task 6: Channel partner controller — commission rules

**Files:**
- Modify (backend): `controllers/channelPartnerController.js`

- [ ] **Step 1: Add the commission-rule handlers**

In `controllers/channelPartnerController.js`, add the model import. The current import block is:

```js
import ChannelPartner from '../models/channelPartnerModel.js';
import ChannelPartnerAgent from '../models/channelPartnerAgentModel.js';
import CommissionRule from '../models/commissionRuleModel.js';
```

(`CommissionRule` is already imported from Task 5 — no change needed.)

Add the four rule handlers directly above the `export {` block:

```js
// ─── Commission rules ────────────────────────────────────────

/**
 * @desc    Create a commission rule
 * @route   POST /api/channel-partners/commission-rules
 * @access  Private (channel_partners:manage_commission_rules)
 */
const createCommissionRule = asyncHandler(async (req, res) => {
  if (!req.body.name || !req.body.name.trim()) {
    res.status(400);
    throw new Error('Rule name is required');
  }
  try {
    const rule = await CommissionRule.create({
      ...req.body,
      organization: req.user.organization,
    });
    res.status(201).json({ success: true, data: rule });
  } catch (err) {
    // Surface the tranche-sum / schema validation message as a 400
    res.status(400);
    throw new Error(err.message);
  }
});

/**
 * @desc    List commission rules
 * @route   GET /api/channel-partners/commission-rules
 * @access  Private (channel_partners:view)
 */
const getCommissionRules = asyncHandler(async (req, res) => {
  const { status } = req.query;
  const query = { organization: req.user.organization };
  if (status) query.status = status;

  const rules = await CommissionRule.find(query)
    .populate('appliesToProject', 'name')
    .sort({ createdAt: -1 });

  res.json({ success: true, count: rules.length, data: rules });
});

/**
 * @desc    Get one commission rule
 * @route   GET /api/channel-partners/commission-rules/:id
 * @access  Private (channel_partners:view)
 */
const getCommissionRuleById = asyncHandler(async (req, res) => {
  const rule = await CommissionRule.findOne({
    _id: req.params.id,
    organization: req.user.organization,
  }).populate('appliesToProject', 'name');

  if (!rule) {
    res.status(404);
    throw new Error('Commission rule not found');
  }
  res.json({ success: true, data: rule });
});

/**
 * @desc    Update a commission rule
 * @route   PUT /api/channel-partners/commission-rules/:id
 * @access  Private (channel_partners:manage_commission_rules)
 */
const updateCommissionRule = asyncHandler(async (req, res) => {
  const rule = await CommissionRule.findOne({
    _id: req.params.id,
    organization: req.user.organization,
  });
  if (!rule) {
    res.status(404);
    throw new Error('Commission rule not found');
  }

  const { organization, ...updatable } = req.body;
  Object.assign(rule, updatable);
  try {
    await rule.save();
  } catch (err) {
    res.status(400);
    throw new Error(err.message);
  }
  res.json({ success: true, data: rule });
});
```

Then add the four names to the existing `export {` block so it reads:

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
};
```

- [ ] **Step 2: Verify the file parses**

Run (from the backend repo root):

```bash
node --check controllers/channelPartnerController.js
```

Expected: no output, exit code 0.

- [ ] **Step 3: Commit**

```bash
git add controllers/channelPartnerController.js
git commit -m "feat(channel-partner): add commission-rule controller handlers"
```

---

## Task 7: Routes + server mount

**Files:**
- Create (backend): `routes/channelPartnerRoutes.js`
- Modify (backend): `server.js`

- [ ] **Step 1: Create `routes/channelPartnerRoutes.js`**

```js
// File: routes/channelPartnerRoutes.js
// Description: Channel Partner module routes — registry + commission rules.

import express from 'express';
import { protect, hasPermission } from '../middleware/authMiddleware.js';
import { PERMISSIONS } from '../config/permissions.js';
import {
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
} from '../controllers/channelPartnerController.js';

const router = express.Router();

router.use(protect);

// ─── Commission rules (before /:id to avoid path capture) ────
router
  .route('/commission-rules')
  .get(hasPermission(PERMISSIONS.CHANNEL_PARTNERS.VIEW), getCommissionRules)
  .post(
    hasPermission(PERMISSIONS.CHANNEL_PARTNERS.MANAGE_COMMISSION_RULES),
    createCommissionRule
  );

router
  .route('/commission-rules/:id')
  .get(hasPermission(PERMISSIONS.CHANNEL_PARTNERS.VIEW), getCommissionRuleById)
  .put(
    hasPermission(PERMISSIONS.CHANNEL_PARTNERS.MANAGE_COMMISSION_RULES),
    updateCommissionRule
  );

// ─── Agents ──────────────────────────────────────────────────
router.put(
  '/agents/:agentId',
  hasPermission(PERMISSIONS.CHANNEL_PARTNERS.UPDATE),
  updateAgent
);

// ─── Channel partner firms ───────────────────────────────────
router
  .route('/')
  .get(hasPermission(PERMISSIONS.CHANNEL_PARTNERS.VIEW), getChannelPartners)
  .post(hasPermission(PERMISSIONS.CHANNEL_PARTNERS.CREATE), createChannelPartner);

router
  .route('/:id')
  .get(hasPermission(PERMISSIONS.CHANNEL_PARTNERS.VIEW), getChannelPartnerById)
  .put(hasPermission(PERMISSIONS.CHANNEL_PARTNERS.UPDATE), updateChannelPartner);

router
  .route('/:id/agents')
  .get(hasPermission(PERMISSIONS.CHANNEL_PARTNERS.VIEW), getAgents)
  .post(hasPermission(PERMISSIONS.CHANNEL_PARTNERS.UPDATE), createAgent);

export default router;
```

- [ ] **Step 2: Import and mount the routes in `server.js`**

In `server.js`, the route imports end with (line 53):

```js
import competitiveAnalysisRoutes from './routes/competitiveAnalysisRoutes.js';
```

Add directly below it:

```js
import channelPartnerRoutes from './routes/channelPartnerRoutes.js';
```

Then in the mount block, the last mount is (line 159):

```js
app.use('/api/competitive-analysis', competitiveAnalysisRoutes);
```

Add directly below it:

```js
app.use('/api/channel-partners', channelPartnerRoutes);
```

- [ ] **Step 3: Verify both files parse**

Run (from the backend repo root):

```bash
node --check routes/channelPartnerRoutes.js && node --check server.js
```

Expected: no output, exit code 0.

- [ ] **Step 4: Commit**

```bash
git add routes/channelPartnerRoutes.js server.js
git commit -m "feat(channel-partner): register channel partner routes"
```

---

## Task 8: Grant the new permissions to default roles

**Files:**
- Modify (backend): `data/defaultRoles.js`

- [ ] **Step 1: Add `channel_partners:*` permissions to the appropriate roles**

In `data/defaultRoles.js`, each role object has a flat `permissions` string array. Add the channel-partner permission strings to these roles' `permissions` arrays:

- **Owner / Business Head / Organization Owner role** (the top-level role, level 0 or the `isOwnerRole` one) — add all six:
  ```
  'channel_partners:view', 'channel_partners:create', 'channel_partners:update',
  'channel_partners:manage_commission_rules', 'channel_partners:attribute',
  'channel_partners:edit_booking_attribution', 'channel_partners:manage_commissions',
  ```
- **Sales Head** (`slug: 'sales-head'`) — add all six (sales leadership manages CPs and commissions).
- **Channel Partner Manager** — add: `'channel_partners:view'`, `'channel_partners:create'`, `'channel_partners:update'`, `'channel_partners:manage_commission_rules'`, `'channel_partners:attribute'`, `'channel_partners:edit_booking_attribution'`, `'channel_partners:manage_commissions'`.
- **Sales Manager / Sales Executive roles** — add only: `'channel_partners:view'`, `'channel_partners:attribute'` (they can tag a lead's CP but not manage the registry).

For each role, insert the strings as additional elements in the existing `permissions: [ ... ]` array (same flat-string style as the surrounding entries — e.g. alongside the `'commissions:*'` strings). Do not remove any existing permission.

If a role name above does not exist verbatim, apply the change to the closest equivalent (the owner-equivalent top role, the senior sales role, the CP manager role, and the line sales roles) — match by intent.

- [ ] **Step 2: Verify the file parses**

Run (from the backend repo root):

```bash
node --check data/defaultRoles.js
```

Expected: no output, exit code 0.

- [ ] **Step 3: Commit**

```bash
git add data/defaultRoles.js
git commit -m "feat(channel-partner): grant CHANNEL_PARTNERS permissions to default roles"
```

---

## Task 9: Backend smoke test

**Files:**
- Create (backend): `tests/testChannelPartner.js`

- [ ] **Step 1: Create `tests/testChannelPartner.js`**

```js
// File: tests/testChannelPartner.js
// Description: End-to-end test for the Channel Partner registry & rules.
// Usage: node tests/testChannelPartner.js
// Requires the backend server running locally and a seeded org/user.

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import fetch from 'node-fetch';

dotenv.config();

const BASE_URL = `http://localhost:${process.env.PORT || 3000}`;
let AUTH_TOKEN = null;
let createdPartnerId = null;
let createdRuleId = null;

const results = { passed: 0, failed: 0 };

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
  console.log('  Channel Partner Registry & Rules — End-to-End Test');
  console.log('═══════════════════════════════════════════════════\n');

  try {
    await mongoose.connect(process.env.MONGO_URI);
    const { default: User } = await import('../models/userModel.js');

    const user = await User.findOne().sort({ createdAt: 1 });
    if (!user) {
      console.error('  ❌ No user found — seed data first.');
      process.exit(1);
    }
    AUTH_TOKEN = jwt.sign(
      { userId: user._id.toString() },
      process.env.JWT_SECRET,
      { expiresIn: '1h', algorithm: 'HS256' }
    );
    console.log(`  User: ${user.firstName} ${user.lastName}\n`);

    // ── Create a channel partner firm ──
    console.log('📋 TEST: Channel partner firm CRUD\n');
    const createRes = await api('POST', '/api/channel-partners', {
      firmName: 'CP SmokeTest Realty',
      reraRegistrationNumber: 'A0123456789',
      primaryContact: { name: 'Test Broker', email: 't@example.com', phone: '+919000000002' },
      status: 'active',
    });
    if (createRes.status === 201 && createRes.data.data?._id) {
      createdPartnerId = createRes.data.data._id;
      log('PASS', 'Create channel partner firm', `ID: ${createdPartnerId}`);
    } else {
      log('FAIL', 'Create channel partner firm', `${createRes.status}: ${JSON.stringify(createRes.data)}`);
      throw new Error('Cannot continue without a partner');
    }

    const listRes = await api('GET', '/api/channel-partners');
    if (listRes.ok && Array.isArray(listRes.data.data)) {
      log('PASS', 'List channel partners', `${listRes.data.count} found`);
    } else {
      log('FAIL', 'List channel partners', `${listRes.status}`);
    }

    // ── Add an agent ──
    const agentRes = await api('POST', `/api/channel-partners/${createdPartnerId}/agents`, {
      name: 'Smoke Agent',
      phone: '+919000000003',
    });
    if (agentRes.status === 201 && agentRes.data.data?._id) {
      log('PASS', 'Add agent to firm');
    } else {
      log('FAIL', 'Add agent', `${agentRes.status}: ${JSON.stringify(agentRes.data)}`);
    }

    const getRes = await api('GET', `/api/channel-partners/${createdPartnerId}`);
    if (getRes.ok && Array.isArray(getRes.data.data?.agents) && getRes.data.data.agents.length >= 1) {
      log('PASS', 'Get firm includes its agents');
    } else {
      log('FAIL', 'Get firm with agents', `${getRes.status}`);
    }

    // ── Commission rule: valid tranches ──
    console.log('\n📋 TEST: Commission rule CRUD\n');
    const ruleRes = await api('POST', '/api/channel-partners/commission-rules', {
      name: 'Smoke Rule 2%',
      rate: { method: 'percentage', percentage: 2, basis: 'sale_price' },
      payout: {
        schedule: 'tranches',
        tranches: [
          { label: 'On booking', percentage: 50, trigger: 'on_booking' },
          { label: 'On registration', percentage: 50, trigger: 'on_registration' },
        ],
      },
      tdsPercent: 5,
    });
    if (ruleRes.status === 201 && ruleRes.data.data?._id) {
      createdRuleId = ruleRes.data.data._id;
      log('PASS', 'Create commission rule (tranches sum to 100)');
    } else {
      log('FAIL', 'Create commission rule', `${ruleRes.status}: ${JSON.stringify(ruleRes.data)}`);
    }

    // ── Commission rule: invalid tranches (must be rejected) ──
    const badRuleRes = await api('POST', '/api/channel-partners/commission-rules', {
      name: 'Bad Rule',
      payout: {
        schedule: 'tranches',
        tranches: [{ label: 'Half', percentage: 50, trigger: 'on_booking' }],
      },
    });
    if (badRuleRes.status === 400) {
      log('PASS', 'Reject commission rule whose tranches != 100');
    } else {
      log('FAIL', 'Tranche-sum validation', `expected 400, got ${badRuleRes.status}`);
    }
  } catch (err) {
    console.error('\n💥 FATAL ERROR:', err.message);
  } finally {
    console.log('\n🧹 CLEANUP\n');
    const { default: ChannelPartner } = await import('../models/channelPartnerModel.js');
    const { default: ChannelPartnerAgent } = await import('../models/channelPartnerAgentModel.js');
    const { default: CommissionRule } = await import('../models/commissionRuleModel.js');
    if (createdPartnerId) {
      await ChannelPartnerAgent.deleteMany({ channelPartner: createdPartnerId });
      await ChannelPartner.deleteOne({ _id: createdPartnerId });
      console.log('  Deleted test firm + agents');
    }
    if (createdRuleId) {
      await CommissionRule.deleteOne({ _id: createdRuleId });
      console.log('  Deleted test rule');
    }
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
node --check tests/testChannelPartner.js
```

Expected: no output, exit code 0.

- [ ] **Step 3: Run the smoke test (server must be running)**

Start the backend (`node server.js`), then in another terminal (backend repo root):

```bash
node tests/testChannelPartner.js
```

Expected: all 6 checks PASS. (No AI keys needed — this plan has no AI.)

- [ ] **Step 4: Commit**

```bash
git add tests/testChannelPartner.js
git commit -m "test(channel-partner): add registry & rules smoke test"
```

---

## Task 10: Frontend API client

**Files:**
- Modify (frontend): `src/services/api.js`

- [ ] **Step 1: Add the `channelPartnerAPI` object**

In `src/services/api.js`, the `commissionAPI` object ends at:

```js
  // Bulk operations
  bulkApproveCommissions: (commissionIds) => api.post('/commissions/bulk-approve', { commissionIds }),
};
```

Add directly after that closing `};`:

```js

// =============================================================================
// CHANNEL PARTNER SERVICES (/api/channel-partners)
// =============================================================================
export const channelPartnerAPI = {
  // Firms
  getChannelPartners: (params = {}) => api.get('/channel-partners', { params }),
  getChannelPartner: (id) => api.get(`/channel-partners/${id}`),
  createChannelPartner: (data) => api.post('/channel-partners', data),
  updateChannelPartner: (id, data) => api.put(`/channel-partners/${id}`, data),
  // Agents
  getAgents: (partnerId) => api.get(`/channel-partners/${partnerId}/agents`),
  createAgent: (partnerId, data) => api.post(`/channel-partners/${partnerId}/agents`, data),
  updateAgent: (agentId, data) => api.put(`/channel-partners/agents/${agentId}`, data),
  // Commission rules
  getCommissionRules: (params = {}) => api.get('/channel-partners/commission-rules', { params }),
  getCommissionRule: (id) => api.get(`/channel-partners/commission-rules/${id}`),
  createCommissionRule: (data) => api.post('/channel-partners/commission-rules', data),
  updateCommissionRule: (id, data) => api.put(`/channel-partners/commission-rules/${id}`, data),
};
```

- [ ] **Step 2: Register it in the default-export barrel**

In `src/services/api.js`, find the default-export object that lists the API groups (it contains a line `commission: commissionAPI,`). Add directly after that line:

```js
  channelPartner: channelPartnerAPI,
```

- [ ] **Step 3: Commit**

```bash
git add src/services/api.js
git commit -m "feat(channel-partner): add channelPartnerAPI client"
```

---

## Task 11: Frontend — channel partner registry pages

**Files:**
- Create (frontend): `src/pages/channel-partners/ChannelPartnerListPage.js`
- Create (frontend): `src/pages/channel-partners/ChannelPartnerFormPage.js`

- [ ] **Step 1: Create `src/pages/channel-partners/ChannelPartnerListPage.js`**

```jsx
// File: src/pages/channel-partners/ChannelPartnerListPage.js
// Description: Lists channel partner firms with status filter + search.

import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, Typography, Button, TextField, MenuItem, Table, TableBody, TableCell,
  TableHead, TableRow, Chip, CircularProgress, Alert, Stack,
} from '@mui/material';
import { Add } from '@mui/icons-material';
import { channelPartnerAPI } from '../../services/api';

const STATUS_COLOR = { active: 'success', suspended: 'warning', blacklisted: 'error' };

const ChannelPartnerListPage = () => {
  const navigate = useNavigate();
  const [partners, setPartners] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');

  const fetchPartners = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = {};
      if (statusFilter) params.status = statusFilter;
      if (search.trim()) params.search = search.trim();
      const res = await channelPartnerAPI.getChannelPartners(params);
      setPartners(res.data.data || []);
    } catch (e) {
      setError(e.response?.data?.message || 'Failed to load channel partners.');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, search]);

  useEffect(() => {
    fetchPartners();
  }, [fetchPartners]);

  return (
    <Box sx={{ p: 3 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4" sx={{ fontWeight: 700 }}>
          Channel Partners
        </Typography>
        <Button
          variant="contained"
          startIcon={<Add />}
          onClick={() => navigate('/channel-partners/create')}
        >
          Add Partner
        </Button>
      </Box>

      <Stack direction="row" spacing={2} sx={{ mb: 2 }}>
        <TextField
          size="small"
          label="Search firm"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <TextField
          size="small"
          select
          label="Status"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          sx={{ minWidth: 160 }}
        >
          <MenuItem value="">All</MenuItem>
          <MenuItem value="active">Active</MenuItem>
          <MenuItem value="suspended">Suspended</MenuItem>
          <MenuItem value="blacklisted">Blacklisted</MenuItem>
        </TextField>
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      ) : partners.length === 0 ? (
        <Alert severity="info">No channel partners yet. Add your first partner firm.</Alert>
      ) : (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Firm</TableCell>
              <TableCell>RERA No.</TableCell>
              <TableCell>Primary contact</TableCell>
              <TableCell>Approved projects</TableCell>
              <TableCell>Status</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {partners.map((p) => (
              <TableRow
                key={p._id}
                hover
                sx={{ cursor: 'pointer' }}
                onClick={() => navigate(`/channel-partners/${p._id}`)}
              >
                <TableCell>{p.firmName}</TableCell>
                <TableCell>{p.reraRegistrationNumber || '—'}</TableCell>
                <TableCell>{p.primaryContact?.name || '—'}</TableCell>
                <TableCell>{p.approvedProjects?.length || 0}</TableCell>
                <TableCell>
                  <Chip
                    size="small"
                    label={p.status}
                    color={STATUS_COLOR[p.status] || 'default'}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Box>
  );
};

export default ChannelPartnerListPage;
```

- [ ] **Step 2: Create `src/pages/channel-partners/ChannelPartnerFormPage.js`**

```jsx
// File: src/pages/channel-partners/ChannelPartnerFormPage.js
// Description: Create / edit a channel partner firm, with inline agent management.

import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box, Typography, TextField, MenuItem, Button, Grid, Card, CardContent,
  Stack, Divider, Table, TableBody, TableCell, TableHead, TableRow, Alert,
  CircularProgress, Dialog, DialogTitle, DialogContent, DialogActions,
} from '@mui/material';
import { channelPartnerAPI } from '../../services/api';

const emptyForm = {
  firmName: '', reraRegistrationNumber: '', pan: '', gstin: '',
  primaryContact: { name: '', email: '', phone: '' },
  address: '', status: 'active',
  bankDetails: { accountName: '', accountNumber: '', ifsc: '', bankName: '' },
  agreementNotes: '',
};

const ChannelPartnerFormPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const isEdit = Boolean(id);

  const [form, setForm] = useState(emptyForm);
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const [agentDialog, setAgentDialog] = useState(false);
  const [agentForm, setAgentForm] = useState({ name: '', email: '', phone: '', reraAgentNumber: '' });

  const load = useCallback(async () => {
    if (!isEdit) return;
    setLoading(true);
    try {
      const res = await channelPartnerAPI.getChannelPartner(id);
      const d = res.data.data;
      setForm({ ...emptyForm, ...d, primaryContact: { ...emptyForm.primaryContact, ...d.primaryContact },
        bankDetails: { ...emptyForm.bankDetails, ...d.bankDetails } });
      setAgents(d.agents || []);
    } catch (e) {
      setError(e.response?.data?.message || 'Failed to load partner.');
    } finally {
      setLoading(false);
    }
  }, [id, isEdit]);

  useEffect(() => {
    load();
  }, [load]);

  const setField = (path, value) => {
    setForm((prev) => {
      if (path.includes('.')) {
        const [group, key] = path.split('.');
        return { ...prev, [group]: { ...prev[group], [key]: value } };
      }
      return { ...prev, [path]: value };
    });
  };

  const save = async () => {
    if (!form.firmName.trim()) {
      setError('Firm name is required.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      if (isEdit) {
        await channelPartnerAPI.updateChannelPartner(id, form);
        navigate(`/channel-partners/${id}`);
      } else {
        const res = await channelPartnerAPI.createChannelPartner(form);
        navigate(`/channel-partners/${res.data.data._id}`);
      }
    } catch (e) {
      setError(e.response?.data?.message || 'Failed to save partner.');
      setSaving(false);
    }
  };

  const addAgent = async () => {
    if (!agentForm.name.trim()) return;
    try {
      const res = await channelPartnerAPI.createAgent(id, agentForm);
      setAgents((prev) => [...prev, res.data.data]);
      setAgentDialog(false);
      setAgentForm({ name: '', email: '', phone: '', reraAgentNumber: '' });
    } catch (e) {
      setError(e.response?.data?.message || 'Failed to add agent.');
    }
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h4" sx={{ fontWeight: 700, mb: 3 }}>
        {isEdit ? 'Edit Channel Partner' : 'Add Channel Partner'}
      </Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>Firm details</Typography>
          <Grid container spacing={2}>
            <Grid item xs={12} sm={6}>
              <TextField fullWidth label="Firm name" required value={form.firmName}
                onChange={(e) => setField('firmName', e.target.value)} />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField fullWidth select label="Status" value={form.status}
                onChange={(e) => setField('status', e.target.value)}>
                <MenuItem value="active">Active</MenuItem>
                <MenuItem value="suspended">Suspended</MenuItem>
                <MenuItem value="blacklisted">Blacklisted</MenuItem>
              </TextField>
            </Grid>
            <Grid item xs={12} sm={4}>
              <TextField fullWidth label="RERA registration no." value={form.reraRegistrationNumber}
                onChange={(e) => setField('reraRegistrationNumber', e.target.value)} />
            </Grid>
            <Grid item xs={12} sm={4}>
              <TextField fullWidth label="PAN" value={form.pan}
                onChange={(e) => setField('pan', e.target.value)} />
            </Grid>
            <Grid item xs={12} sm={4}>
              <TextField fullWidth label="GSTIN" value={form.gstin}
                onChange={(e) => setField('gstin', e.target.value)} />
            </Grid>
            <Grid item xs={12}>
              <TextField fullWidth label="Address" value={form.address}
                onChange={(e) => setField('address', e.target.value)} />
            </Grid>
          </Grid>

          <Divider sx={{ my: 2 }} />
          <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>Primary contact</Typography>
          <Grid container spacing={2}>
            <Grid item xs={12} sm={4}>
              <TextField fullWidth label="Contact name" value={form.primaryContact.name}
                onChange={(e) => setField('primaryContact.name', e.target.value)} />
            </Grid>
            <Grid item xs={12} sm={4}>
              <TextField fullWidth label="Contact email" value={form.primaryContact.email}
                onChange={(e) => setField('primaryContact.email', e.target.value)} />
            </Grid>
            <Grid item xs={12} sm={4}>
              <TextField fullWidth label="Contact phone" value={form.primaryContact.phone}
                onChange={(e) => setField('primaryContact.phone', e.target.value)} />
            </Grid>
          </Grid>

          <Divider sx={{ my: 2 }} />
          <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>Bank details (for payouts)</Typography>
          <Grid container spacing={2}>
            <Grid item xs={12} sm={6}>
              <TextField fullWidth label="Account name" value={form.bankDetails.accountName}
                onChange={(e) => setField('bankDetails.accountName', e.target.value)} />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField fullWidth label="Account number" value={form.bankDetails.accountNumber}
                onChange={(e) => setField('bankDetails.accountNumber', e.target.value)} />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField fullWidth label="IFSC" value={form.bankDetails.ifsc}
                onChange={(e) => setField('bankDetails.ifsc', e.target.value)} />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField fullWidth label="Bank name" value={form.bankDetails.bankName}
                onChange={(e) => setField('bankDetails.bankName', e.target.value)} />
            </Grid>
            <Grid item xs={12}>
              <TextField fullWidth multiline rows={2} label="Agreement notes" value={form.agreementNotes}
                onChange={(e) => setField('agreementNotes', e.target.value)} />
            </Grid>
          </Grid>

          <Stack direction="row" spacing={2} sx={{ mt: 3 }}>
            <Button variant="contained" onClick={save} disabled={saving}>
              {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create partner'}
            </Button>
            <Button onClick={() => navigate('/channel-partners')} disabled={saving}>Cancel</Button>
          </Stack>
        </CardContent>
      </Card>

      {isEdit && (
        <Card>
          <CardContent>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
              <Typography variant="h6" sx={{ fontWeight: 600 }}>Agents</Typography>
              <Button size="small" variant="outlined" onClick={() => setAgentDialog(true)}>
                Add agent
              </Button>
            </Box>
            {agents.length === 0 ? (
              <Typography variant="body2" color="text.secondary">No agents yet.</Typography>
            ) : (
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Name</TableCell>
                    <TableCell>Phone</TableCell>
                    <TableCell>Email</TableCell>
                    <TableCell>RERA agent no.</TableCell>
                    <TableCell>Status</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {agents.map((a) => (
                    <TableRow key={a._id}>
                      <TableCell>{a.name}</TableCell>
                      <TableCell>{a.phone || '—'}</TableCell>
                      <TableCell>{a.email || '—'}</TableCell>
                      <TableCell>{a.reraAgentNumber || '—'}</TableCell>
                      <TableCell>{a.status}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      <Dialog open={agentDialog} onClose={() => setAgentDialog(false)} fullWidth maxWidth="sm">
        <DialogTitle>Add agent</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField label="Name" required value={agentForm.name}
              onChange={(e) => setAgentForm((p) => ({ ...p, name: e.target.value }))} />
            <TextField label="Phone" value={agentForm.phone}
              onChange={(e) => setAgentForm((p) => ({ ...p, phone: e.target.value }))} />
            <TextField label="Email" value={agentForm.email}
              onChange={(e) => setAgentForm((p) => ({ ...p, email: e.target.value }))} />
            <TextField label="RERA agent no." value={agentForm.reraAgentNumber}
              onChange={(e) => setAgentForm((p) => ({ ...p, reraAgentNumber: e.target.value }))} />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAgentDialog(false)}>Cancel</Button>
          <Button variant="contained" onClick={addAgent}>Add</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default ChannelPartnerFormPage;
```

- [ ] **Step 3: Commit**

```bash
git add src/pages/channel-partners/ChannelPartnerListPage.js src/pages/channel-partners/ChannelPartnerFormPage.js
git commit -m "feat(channel-partner): add registry list + firm form pages"
```

---

## Task 12: Frontend — commission rule pages

**Files:**
- Create (frontend): `src/pages/channel-partners/CommissionRuleListPage.js`
- Create (frontend): `src/pages/channel-partners/CommissionRuleFormPage.js`

- [ ] **Step 1: Create `src/pages/channel-partners/CommissionRuleListPage.js`**

```jsx
// File: src/pages/channel-partners/CommissionRuleListPage.js
// Description: Lists channel-partner commission rules.

import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, Typography, Button, Table, TableBody, TableCell, TableHead, TableRow,
  Chip, CircularProgress, Alert,
} from '@mui/material';
import { Add } from '@mui/icons-material';
import { channelPartnerAPI } from '../../services/api';

const CommissionRuleListPage = () => {
  const navigate = useNavigate();
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchRules = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await channelPartnerAPI.getCommissionRules();
      setRules(res.data.data || []);
    } catch (e) {
      setError(e.response?.data?.message || 'Failed to load commission rules.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRules();
  }, [fetchRules]);

  const rateLabel = (r) =>
    r.rate?.method === 'flat'
      ? `₹${(r.rate.flatAmount || 0).toLocaleString('en-IN')} flat`
      : `${r.rate?.percentage || 0}% of ${r.rate?.basis === 'base_price' ? 'base price' : 'sale price'}`;

  return (
    <Box sx={{ p: 3 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4" sx={{ fontWeight: 700 }}>Commission Rules</Typography>
        <Button
          variant="contained"
          startIcon={<Add />}
          onClick={() => navigate('/channel-partners/commission-rules/create')}
        >
          Add Rule
        </Button>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      ) : rules.length === 0 ? (
        <Alert severity="info">No commission rules yet.</Alert>
      ) : (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>Applies to</TableCell>
              <TableCell>Rate</TableCell>
              <TableCell>Payout</TableCell>
              <TableCell>TDS</TableCell>
              <TableCell>Status</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rules.map((r) => (
              <TableRow
                key={r._id}
                hover
                sx={{ cursor: 'pointer' }}
                onClick={() => navigate(`/channel-partners/commission-rules/${r._id}`)}
              >
                <TableCell>{r.name}</TableCell>
                <TableCell>{r.appliesToProject?.name || 'All projects'}</TableCell>
                <TableCell>{rateLabel(r)}</TableCell>
                <TableCell>
                  {r.payout?.schedule === 'tranches'
                    ? `${r.payout.tranches?.length || 0} tranches`
                    : 'Lump sum'}
                </TableCell>
                <TableCell>{r.tdsPercent || 0}%</TableCell>
                <TableCell>
                  <Chip size="small" label={r.status}
                    color={r.status === 'active' ? 'success' : 'default'} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Box>
  );
};

export default CommissionRuleListPage;
```

- [ ] **Step 2: Create `src/pages/channel-partners/CommissionRuleFormPage.js`**

```jsx
// File: src/pages/channel-partners/CommissionRuleFormPage.js
// Description: Create / edit a channel-partner commission rule.

import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box, Typography, TextField, MenuItem, Button, Grid, Card, CardContent,
  Stack, Divider, IconButton, Alert, CircularProgress, Autocomplete,
} from '@mui/material';
import { Delete, Add } from '@mui/icons-material';
import { channelPartnerAPI, projectAPI } from '../../services/api';

const TRIGGERS = [
  { value: 'on_booking', label: 'On booking' },
  { value: 'on_agreement', label: 'On agreement' },
  { value: 'on_registration', label: 'On registration' },
  { value: 'on_possession', label: 'On possession' },
];

const emptyForm = {
  name: '', description: '', appliesToProject: null,
  rate: { method: 'percentage', percentage: 2, flatAmount: 0, basis: 'sale_price' },
  payout: { schedule: 'lump_sum', tranches: [] },
  tdsPercent: 5, status: 'active',
};

const CommissionRuleFormPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const isEdit = Boolean(id);

  const [form, setForm] = useState(emptyForm);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    projectAPI.getProjects()
      .then((res) => setProjects(res.data?.data || res.data || []))
      .catch(() => setProjects([]));
  }, []);

  const load = useCallback(async () => {
    if (!isEdit) return;
    setLoading(true);
    try {
      const res = await channelPartnerAPI.getCommissionRule(id);
      const d = res.data.data;
      setForm({
        ...emptyForm, ...d,
        appliesToProject: d.appliesToProject?._id || d.appliesToProject || null,
        rate: { ...emptyForm.rate, ...d.rate },
        payout: { schedule: d.payout?.schedule || 'lump_sum', tranches: d.payout?.tranches || [] },
      });
    } catch (e) {
      setError(e.response?.data?.message || 'Failed to load rule.');
    } finally {
      setLoading(false);
    }
  }, [id, isEdit]);

  useEffect(() => {
    load();
  }, [load]);

  const setRate = (k, v) => setForm((p) => ({ ...p, rate: { ...p.rate, [k]: v } }));
  const setTranche = (i, k, v) => setForm((p) => {
    const tranches = [...p.payout.tranches];
    tranches[i] = { ...tranches[i], [k]: v };
    return { ...p, payout: { ...p.payout, tranches } };
  });
  const addTranche = () => setForm((p) => ({
    ...p, payout: { ...p.payout, tranches: [...p.payout.tranches, { label: '', percentage: 0, trigger: 'on_booking' }] },
  }));
  const removeTranche = (i) => setForm((p) => ({
    ...p, payout: { ...p.payout, tranches: p.payout.tranches.filter((_, idx) => idx !== i) },
  }));

  const trancheSum = form.payout.tranches.reduce((a, t) => a + (Number(t.percentage) || 0), 0);

  const save = async () => {
    if (!form.name.trim()) {
      setError('Rule name is required.');
      return;
    }
    if (form.payout.schedule === 'tranches' && Math.round(trancheSum) !== 100) {
      setError(`Tranche percentages must sum to 100 (currently ${trancheSum}).`);
      return;
    }
    setSaving(true);
    setError('');
    const payload = {
      ...form,
      tranches: undefined,
      payout: {
        schedule: form.payout.schedule,
        tranches: form.payout.schedule === 'tranches'
          ? form.payout.tranches.map((t) => ({ ...t, percentage: Number(t.percentage) || 0 }))
          : [],
      },
    };
    try {
      if (isEdit) {
        await channelPartnerAPI.updateCommissionRule(id, payload);
      } else {
        await channelPartnerAPI.createCommissionRule(payload);
      }
      navigate('/channel-partners/commission-rules');
    } catch (e) {
      setError(e.response?.data?.message || 'Failed to save rule.');
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h4" sx={{ fontWeight: 700, mb: 3 }}>
        {isEdit ? 'Edit Commission Rule' : 'Add Commission Rule'}
      </Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <Card>
        <CardContent>
          <Grid container spacing={2}>
            <Grid item xs={12} sm={6}>
              <TextField fullWidth label="Rule name" required value={form.name}
                onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField fullWidth select label="Status" value={form.status}
                onChange={(e) => setForm((p) => ({ ...p, status: e.target.value }))}>
                <MenuItem value="active">Active</MenuItem>
                <MenuItem value="inactive">Inactive</MenuItem>
              </TextField>
            </Grid>
            <Grid item xs={12}>
              <TextField fullWidth label="Description" value={form.description}
                onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} />
            </Grid>
            <Grid item xs={12}>
              <Autocomplete
                options={projects}
                value={projects.find((p) => p._id === form.appliesToProject) || null}
                getOptionLabel={(o) => o.name || ''}
                isOptionEqualToValue={(o, v) => o._id === v._id}
                onChange={(e, val) => setForm((p) => ({ ...p, appliesToProject: val?._id || null }))}
                renderInput={(params) => (
                  <TextField {...params} label="Applies to project (leave blank = all projects)" />
                )}
              />
            </Grid>
          </Grid>

          <Divider sx={{ my: 2 }} />
          <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>Rate</Typography>
          <Grid container spacing={2}>
            <Grid item xs={12} sm={3}>
              <TextField fullWidth select label="Method" value={form.rate.method}
                onChange={(e) => setRate('method', e.target.value)}>
                <MenuItem value="percentage">Percentage</MenuItem>
                <MenuItem value="flat">Flat amount</MenuItem>
              </TextField>
            </Grid>
            {form.rate.method === 'percentage' ? (
              <>
                <Grid item xs={12} sm={3}>
                  <TextField fullWidth type="number" label="Percentage" value={form.rate.percentage}
                    onChange={(e) => setRate('percentage', e.target.value)} />
                </Grid>
                <Grid item xs={12} sm={3}>
                  <TextField fullWidth select label="Basis" value={form.rate.basis}
                    onChange={(e) => setRate('basis', e.target.value)}>
                    <MenuItem value="sale_price">Sale price</MenuItem>
                    <MenuItem value="base_price">Base price</MenuItem>
                  </TextField>
                </Grid>
              </>
            ) : (
              <Grid item xs={12} sm={3}>
                <TextField fullWidth type="number" label="Flat amount (₹)" value={form.rate.flatAmount}
                  onChange={(e) => setRate('flatAmount', e.target.value)} />
              </Grid>
            )}
            <Grid item xs={12} sm={3}>
              <TextField fullWidth type="number" label="TDS %" value={form.tdsPercent}
                onChange={(e) => setForm((p) => ({ ...p, tdsPercent: e.target.value }))} />
            </Grid>
          </Grid>

          <Divider sx={{ my: 2 }} />
          <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>Payout schedule</Typography>
          <TextField select label="Schedule" value={form.payout.schedule} sx={{ minWidth: 220, mb: 2 }}
            onChange={(e) => setForm((p) => ({ ...p, payout: { ...p.payout, schedule: e.target.value } }))}>
            <MenuItem value="lump_sum">Lump sum</MenuItem>
            <MenuItem value="tranches">Tranches</MenuItem>
          </TextField>

          {form.payout.schedule === 'tranches' && (
            <Box>
              {form.payout.tranches.map((t, i) => (
                <Stack key={i} direction="row" spacing={1} sx={{ mb: 1 }} alignItems="center">
                  <TextField label="Label" value={t.label} sx={{ flex: 2 }}
                    onChange={(e) => setTranche(i, 'label', e.target.value)} />
                  <TextField label="%" type="number" value={t.percentage} sx={{ flex: 1 }}
                    onChange={(e) => setTranche(i, 'percentage', e.target.value)} />
                  <TextField select label="Trigger" value={t.trigger} sx={{ flex: 2 }}
                    onChange={(e) => setTranche(i, 'trigger', e.target.value)}>
                    {TRIGGERS.map((tr) => (
                      <MenuItem key={tr.value} value={tr.value}>{tr.label}</MenuItem>
                    ))}
                  </TextField>
                  <IconButton onClick={() => removeTranche(i)}><Delete /></IconButton>
                </Stack>
              ))}
              <Button size="small" startIcon={<Add />} onClick={addTranche}>Add tranche</Button>
              <Typography variant="caption" sx={{ display: 'block', mt: 1 }}
                color={Math.round(trancheSum) === 100 ? 'text.secondary' : 'error'}>
                Tranche total: {trancheSum}% (must be 100%)
              </Typography>
            </Box>
          )}

          <Stack direction="row" spacing={2} sx={{ mt: 3 }}>
            <Button variant="contained" onClick={save} disabled={saving}>
              {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create rule'}
            </Button>
            <Button onClick={() => navigate('/channel-partners/commission-rules')} disabled={saving}>
              Cancel
            </Button>
          </Stack>
        </CardContent>
      </Card>
    </Box>
  );
};

export default CommissionRuleFormPage;
```

- [ ] **Step 3: Commit**

```bash
git add src/pages/channel-partners/CommissionRuleListPage.js src/pages/channel-partners/CommissionRuleFormPage.js
git commit -m "feat(channel-partner): add commission rule list + form pages"
```

---

## Task 13: Frontend — routing & navigation

**Files:**
- Modify (frontend): `src/App.js`
- Modify (frontend): `src/components/layout/DashboardLayout.js`
- Modify (frontend): the `canAccess` helper (see Step 1)

- [ ] **Step 1: Add a `channelPartners` access method**

The route guards use `canAccess.<method>()`. Find the file that defines `canAccess` — run, from the frontend repo root:

```bash
grep -rn "compAnalysisView" src/ | grep -v pages | grep -v App.js
```

That file defines the access methods (each is typically `someName: () => hasPermission('some:permission')` or similar). Add a method `channelPartners` that returns true when the user has the `channel_partners:view` permission — matching the exact style of the neighbouring methods (e.g. `compAnalysisView`). If methods are defined as `compAnalysisView: () => hasPermission(PERMISSIONS.COMPETITIVE_ANALYSIS.VIEW)`, add `channelPartners: () => hasPermission(PERMISSIONS.CHANNEL_PARTNERS.VIEW)`; if they use raw strings, use `'channel_partners:view'`.

- [ ] **Step 2: Add lazy imports + routes in `src/App.js`**

The competitive-analysis lazy imports are followed by other lazy imports; add these four anywhere in the lazy-import block (e.g. after the `CompetitivePerformancePage` import added by the scorecard feature):

```js
const ChannelPartnerListPage = React.lazy(() => import('./pages/channel-partners/ChannelPartnerListPage'));
const ChannelPartnerFormPage = React.lazy(() => import('./pages/channel-partners/ChannelPartnerFormPage'));
const CommissionRuleListPage = React.lazy(() => import('./pages/channel-partners/CommissionRuleListPage'));
const CommissionRuleFormPage = React.lazy(() => import('./pages/channel-partners/CommissionRuleFormPage'));
```

Then add the route blocks. Place them near the other top-level feature routes (e.g. just before the competitive-analysis routes). Use the standard wrapper shape already used throughout `App.js`:

```jsx
      <Route path="/channel-partners" element={
        <ProtectedRoute requiredPermission={(canAccess) => canAccess.channelPartners()}>
          <DashboardLayout>
            <Suspense fallback={<LoadingFallback message="Loading channel partners..." />}>
              <ChannelPartnerListPage />
            </Suspense>
          </DashboardLayout>
        </ProtectedRoute>
      } />
      <Route path="/channel-partners/create" element={
        <ProtectedRoute requiredPermission={(canAccess) => canAccess.channelPartners()}>
          <DashboardLayout>
            <Suspense fallback={<LoadingFallback message="Loading form..." />}>
              <ChannelPartnerFormPage />
            </Suspense>
          </DashboardLayout>
        </ProtectedRoute>
      } />
      <Route path="/channel-partners/commission-rules" element={
        <ProtectedRoute requiredPermission={(canAccess) => canAccess.channelPartners()}>
          <DashboardLayout>
            <Suspense fallback={<LoadingFallback message="Loading commission rules..." />}>
              <CommissionRuleListPage />
            </Suspense>
          </DashboardLayout>
        </ProtectedRoute>
      } />
      <Route path="/channel-partners/commission-rules/create" element={
        <ProtectedRoute requiredPermission={(canAccess) => canAccess.channelPartners()}>
          <DashboardLayout>
            <Suspense fallback={<LoadingFallback message="Loading form..." />}>
              <CommissionRuleFormPage />
            </Suspense>
          </DashboardLayout>
        </ProtectedRoute>
      } />
      <Route path="/channel-partners/commission-rules/:id" element={
        <ProtectedRoute requiredPermission={(canAccess) => canAccess.channelPartners()}>
          <DashboardLayout>
            <Suspense fallback={<LoadingFallback message="Loading rule..." />}>
              <CommissionRuleFormPage />
            </Suspense>
          </DashboardLayout>
        </ProtectedRoute>
      } />
      <Route path="/channel-partners/:id" element={
        <ProtectedRoute requiredPermission={(canAccess) => canAccess.channelPartners()}>
          <DashboardLayout>
            <Suspense fallback={<LoadingFallback message="Loading partner..." />}>
              <ChannelPartnerFormPage />
            </Suspense>
          </DashboardLayout>
        </ProtectedRoute>
      } />
```

Note: the `/channel-partners/commission-rules*` routes are listed **before** `/channel-partners/:id` so the literal `commission-rules` segment is not captured as an `:id`.

- [ ] **Step 3: Add the navigation entry in `DashboardLayout.js`**

In `src/components/layout/DashboardLayout.js`, the `getNavigationItems` function builds the nav. In the `OPERATIONS` section's `items` array, add a new top-level entry (match the shape of the existing items — `id`, `title`, `icon`, `path`, `requiredAccess`, optional `children`):

```js
{
  id: 'channel-partners',
  title: 'Channel Partners',
  icon: Handshake,
  path: '/channel-partners',
  requiredAccess: () => canAccess.channelPartners(),
  children: [
    { id: 'cp-list', title: 'All Partners', path: '/channel-partners' },
    { id: 'cp-rules', title: 'Commission Rules', path: '/channel-partners/commission-rules' },
  ],
},
```

`Handshake` is already imported in this file (it was used by the now-to-be-removed commission nav item — confirm it is in the `@mui/icons-material` import; if not, add it). Also add to the `DashboardBreadcrumbs` `labelMap` object an entry: `'channel-partners': 'Channel Partners',` and `'commission-rules': 'Commission Rules',`.

- [ ] **Step 4: Verify the build compiles**

Run (from the frontend repo root):

```bash
CI=true npm run build
```

Expected: `Compiled successfully.` Fix any compile error your changes introduced before continuing.

- [ ] **Step 5: Commit**

```bash
git add src/App.js src/components/layout/DashboardLayout.js
git commit -m "feat(channel-partner): route and navigate the Channel Partners section"
```

(If the `canAccess` helper is in a separate file, include that file in the `git add`.)

---

## Task 14: Manual verification

**Files:** none (verification only).

- [ ] **Step 1: Start both servers** — backend `node server.js`, frontend `npm start`.

- [ ] **Step 2: Registry** — open **Channel Partners** from the sidebar. Add a partner firm; confirm it appears in the list. Open it, edit a field, save. Add an agent via the dialog; confirm it shows in the agents table.

- [ ] **Step 3: Commission rules** — go to **Commission Rules**, add a percentage rule with a 2-tranche payout (50/50) — confirm it saves. Try a tranche split that does not sum to 100 — confirm the form blocks it with the error message.

- [ ] **Step 4: Permissions** — confirm a user without channel-partner permissions does not see the nav entry / cannot reach `/channel-partners`.

- [ ] **Step 5** — commit any verification-driven fixes; if everything worked, nothing to commit.

---

## Notes for the implementer

- **Two repos.** Tasks 1–9 are backend; Tasks 10–13 are frontend. Run git commands from the repo named in each task's **Files** block.
- **No pushing.** Commit locally; do not push.
- **Scope guard:** this plan does NOT touch leads, sales, the legacy commission system, or any dashboard — those are Plans 2 and 3. Do not modify `leadModel.js`, `salesModel.js`, or any commission* file from the legacy system.
