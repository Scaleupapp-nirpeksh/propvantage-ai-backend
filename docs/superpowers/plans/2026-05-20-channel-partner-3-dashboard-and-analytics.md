# Channel Partner — Plan 3: Performance Dashboard & Loose Ends

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A CP Performance Dashboard (per-CP leaderboard + funnel), the senior-role booking-attribution-edit UI deferred from Plan 2, and repointing the AI copilot's commission summary to the new model.

**Architecture:** One new synchronous endpoint aggregates per-CP performance from `Lead`, `Sale`, and `CommissionRecord`. A new frontend dashboard page renders it. An attribution-edit dialog on the Commission Records page reuses the Plan 2 `ChannelPartnerAttributionFields` component and the existing `editSaleAttribution` endpoint. The copilot's `get_commission_summary` is rewritten against `CommissionRecord`.

**Tech Stack:** Backend — Node/Express/Mongoose. Frontend — React 18 + MUI v5.

**Spec:** `docs/superpowers/specs/2026-05-20-channel-partner-module-design.md`

**Plan 3 of 3.** Plans 1 (registry + rules) and 2 (attribution + commission engine + legacy deprecation) are built. This plan completes the module.

**Scope note — Analytics & Leadership:** the spec asked for CP data in the Analytics and Leadership sections. The Leadership dashboard *already* has a `ChannelPartnerSection` consuming `aggregateChannelPartner`, which Plan 2 repointed to `CommissionRecord` — so leadership is done. The dedicated CP Performance Dashboard built here *is* the CP analytics deep-dive; a redundant CP tab bolted onto the generic Analytics dashboard would be over-building, so it is intentionally not added.

**Two repos:**
- Backend: `/Users/nirpekshnandan/My Products/propvantage-ai-backend`
- Frontend: `/Users/nirpekshnandan/My Products/propvantage-ai-frontend`

All paths in each task are relative to the repo named in that task's **Files** block. Work on `main`; commit per task with the given messages; do **not** push.

---

## Task 1: CP dashboard endpoint

**Files:**
- Modify (backend): `controllers/channelPartnerController.js`

- [ ] **Step 1: Add the `getChannelPartnerDashboard` handler**

In `controllers/channelPartnerController.js`, the model imports already include `ChannelPartner`, `CommissionRecord`, `Sale` (added in Plans 1-2). Add one more import below the existing `import Sale from '../models/salesModel.js';` line:

```js
import Lead from '../models/leadModel.js';
```

Then, directly above the `export {` block (after the `editSaleAttribution` handler), add:

```js
// ─── Performance dashboard ───────────────────────────────────

/**
 * @desc    Per-channel-partner performance leaderboard + funnel
 * @route   GET /api/channel-partners/dashboard
 * @access  Private (channel_partners:view)
 */
const getChannelPartnerDashboard = asyncHandler(async (req, res) => {
  const orgId = req.user.organization;

  const partners = await ChannelPartner.find({ organization: orgId }).select('firmName status');

  // Leads tagged to each CP
  const leadAgg = await Lead.aggregate([
    { $match: { organization: orgId, 'channelPartnerAttribution.viaChannelPartner': true } },
    { $unwind: '$channelPartnerAttribution.partners' },
    {
      $group: {
        _id: '$channelPartnerAttribution.partners.channelPartner',
        leadsTagged: { $sum: 1 },
      },
    },
  ]);

  // Bookings + booked value attributed to each CP (cancelled bookings excluded)
  const saleAgg = await Sale.aggregate([
    {
      $match: {
        organization: orgId,
        'channelPartnerAttribution.viaChannelPartner': true,
        status: { $ne: 'Cancelled' },
      },
    },
    { $unwind: '$channelPartnerAttribution.partners' },
    {
      $group: {
        _id: '$channelPartnerAttribution.partners.channelPartner',
        bookings: { $sum: 1 },
        bookingValue: { $sum: '$salePrice' },
      },
    },
  ]);

  // Commission earned / paid per CP (cancelled records excluded)
  const commAgg = await CommissionRecord.aggregate([
    { $match: { organization: orgId, status: { $ne: 'cancelled' } } },
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
        _id: '$channelPartner',
        commissionNet: { $sum: '$netAmount' },
        commissionPaid: { $sum: '$paidAmount' },
      },
    },
  ]);

  const byId = (rows) => Object.fromEntries(rows.map((r) => [String(r._id), r]));
  const leadMap = byId(leadAgg);
  const saleMap = byId(saleAgg);
  const commMap = byId(commAgg);

  const leaderboard = partners
    .map((p) => {
      const id = String(p._id);
      const lead = leadMap[id] || {};
      const sale = saleMap[id] || {};
      const comm = commMap[id] || {};
      const commissionNet = comm.commissionNet || 0;
      const commissionPaid = comm.commissionPaid || 0;
      return {
        channelPartnerId: p._id,
        firmName: p.firmName,
        status: p.status,
        leadsTagged: lead.leadsTagged || 0,
        bookings: sale.bookings || 0,
        bookingValue: sale.bookingValue || 0,
        commissionNet,
        commissionPaid,
        commissionPending: commissionNet - commissionPaid,
      };
    })
    .sort((a, b) => b.bookingValue - a.bookingValue);

  const funnel = leaderboard.reduce(
    (acc, r) => ({
      leadsTagged: acc.leadsTagged + r.leadsTagged,
      bookings: acc.bookings + r.bookings,
      bookingValue: acc.bookingValue + r.bookingValue,
      commissionNet: acc.commissionNet + r.commissionNet,
      commissionPaid: acc.commissionPaid + r.commissionPaid,
      commissionPending: acc.commissionPending + r.commissionPending,
    }),
    { leadsTagged: 0, bookings: 0, bookingValue: 0, commissionNet: 0, commissionPaid: 0, commissionPending: 0 }
  );
  funnel.conversionPct =
    funnel.leadsTagged > 0 ? Math.round((funnel.bookings / funnel.leadsTagged) * 100) : 0;

  res.json({
    success: true,
    data: { leaderboard, funnel, partnerCount: partners.length },
  });
});
```

- [ ] **Step 2: Add it to the export block**

The export block currently ends:

```js
  getCommissionRecords,
  markPayoutPaid,
  editSaleAttribution,
};
```

Change to:

```js
  getCommissionRecords,
  markPayoutPaid,
  editSaleAttribution,
  getChannelPartnerDashboard,
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
git commit -m "feat(channel-partner): add performance dashboard endpoint"
```

---

## Task 2: Dashboard route

**Files:**
- Modify (backend): `routes/channelPartnerRoutes.js`

- [ ] **Step 1: Import the handler**

In `routes/channelPartnerRoutes.js`, the controller import block ends with:

```js
  getCommissionRecords,
  markPayoutPaid,
  editSaleAttribution,
} from '../controllers/channelPartnerController.js';
```

Change to:

```js
  getCommissionRecords,
  markPayoutPaid,
  editSaleAttribution,
  getChannelPartnerDashboard,
} from '../controllers/channelPartnerController.js';
```

- [ ] **Step 2: Register the route**

In `routes/channelPartnerRoutes.js`, find the `// ─── Commission records ───` section. Directly after the commission-records routes and before the `// ─── Booking attribution edit ───` section, add:

```js
// ─── Performance dashboard ──────────────────────────────────
router.get(
  '/dashboard',
  hasPermission(PERMISSIONS.CHANNEL_PARTNERS.VIEW),
  getChannelPartnerDashboard
);
```

This static path is registered before the `/:id` firm routes, so there is no path collision.

- [ ] **Step 3: Verify the file parses**

Run (from the backend repo root):

```bash
node --check routes/channelPartnerRoutes.js
```

Expected: no output, exit code 0.

- [ ] **Step 4: Commit**

```bash
git add routes/channelPartnerRoutes.js
git commit -m "feat(channel-partner): register the performance dashboard route"
```

---

## Task 3: Repoint the AI copilot commission summary

**Files:**
- Modify (backend): `services/copilotFunctions.js`

The `get_commission_summary` copilot function queries the deprecated `PartnerCommission` model. Repoint it to `CommissionRecord`.

- [ ] **Step 1: Replace the model import**

In `services/copilotFunctions.js`, find the import:

```js
import PartnerCommission from '../models/partnerCommissionModel.js';
```

Replace it with:

```js
import CommissionRecord from '../models/commissionRecordModel.js';
```

- [ ] **Step 2: Rewrite `get_commission_summary`**

Find the `get_commission_summary` function (it starts with `get_commission_summary: async (params, user, accessibleProjectIds) => {`). Replace the **entire function** (from `get_commission_summary:` through its closing `},`) with:

```js
  get_commission_summary: async (params, user, accessibleProjectIds) => {
    // CommissionRecord is organization-scoped; the channel partner is a firm
    // (not a User), so the legacy per-user role scope does not apply here.
    const match = { organization: user.organization, status: { $ne: 'cancelled' } };
    if (params.channel_partner_id) {
      match.channelPartner = new mongoose.Types.ObjectId(params.channel_partner_id);
    }
    if (params.status) match.status = params.status;

    const pipeline = [{ $match: match }];

    // Project filter / scope is resolved through the linked Sale.
    if (params.project_id || accessibleProjectIds) {
      pipeline.push(
        { $lookup: { from: 'sales', localField: 'sale', foreignField: '_id', as: 'saleDoc' } },
        { $unwind: { path: '$saleDoc', preserveNullAndEmptyArrays: true } }
      );
      if (params.project_id) {
        if (!isProjectAccessible(accessibleProjectIds, params.project_id)) {
          return { error: 'You do not have access to this project' };
        }
        pipeline.push({
          $match: { 'saleDoc.project': new mongoose.Types.ObjectId(params.project_id) },
        });
      } else if (accessibleProjectIds) {
        pipeline.push({
          $match: { 'saleDoc.project': getProjectScopeFilter(accessibleProjectIds) },
        });
      }
    }

    pipeline.push(
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
          _id: '$status',
          count: { $sum: 1 },
          totalAmount: { $sum: '$netAmount' },
          totalPaid: { $sum: '$paidAmount' },
          totalPending: { $sum: { $subtract: ['$netAmount', '$paidAmount'] } },
        },
      }
    );

    const summary = await CommissionRecord.aggregate(pipeline);

    const statusMap = {};
    let grandTotal = 0, grandPaid = 0, grandPending = 0;
    summary.forEach((s) => {
      statusMap[s._id] = { count: s.count, amount: s.totalAmount, paid: s.totalPaid, pending: s.totalPending };
      grandTotal += s.totalAmount;
      grandPaid += s.totalPaid;
      grandPending += s.totalPending;
    });

    return {
      totalCommissions: grandTotal,
      totalPaid: grandPaid,
      totalPending: grandPending,
      byStatus: statusMap,
    };
  },
```

The return shape (`totalCommissions`, `totalPaid`, `totalPending`, `byStatus`) is unchanged, so any copilot prompt template consuming it still works. The only behavioural change is that `params.partner_id` is now `params.channel_partner_id` (a CP firm id) — acceptable since the legacy `partner` (a User) concept no longer exists.

- [ ] **Step 3: Verify the file parses**

Run (from the backend repo root):

```bash
node --check services/copilotFunctions.js
```

Expected: no output, exit code 0.

- [ ] **Step 4: Commit**

```bash
git add services/copilotFunctions.js
git commit -m "refactor(channel-partner): repoint copilot commission summary to CommissionRecord"
```

---

## Task 4: Backend smoke test

**Files:**
- Create (backend): `tests/testChannelPartnerDashboard.js`

- [ ] **Step 1: Create `tests/testChannelPartnerDashboard.js`**

```js
// File: tests/testChannelPartnerDashboard.js
// Description: End-to-end test for the CP performance dashboard endpoint.
// Usage: node tests/testChannelPartnerDashboard.js
// Requires the backend server running locally and a seeded org/user.

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import fetch from 'node-fetch';

dotenv.config();

const BASE_URL = `http://localhost:${process.env.PORT || 3000}`;
let AUTH_TOKEN = null;
const results = { passed: 0, failed: 0 };

const log = (status, name, detail = '') => {
  const icon = status === 'PASS' ? '✅' : '❌';
  console.log(`  ${icon} ${name}${detail ? ` — ${detail}` : ''}`);
  if (status === 'PASS') results.passed++;
  else results.failed++;
};

const api = async (method, path) => {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(AUTH_TOKEN ? { Authorization: `Bearer ${AUTH_TOKEN}` } : {}),
    },
  });
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
  console.log('  CP Performance Dashboard — End-to-End Test');
  console.log('═══════════════════════════════════════════════════\n');

  try {
    await mongoose.connect(process.env.MONGO_URI);
    const { default: User } = await import('../models/userModel.js');
    const user =
      (await User.findOne({ email: /owner/i })) ||
      (await User.findOne().sort({ createdAt: 1 }));
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

    const res = await api('GET', '/api/channel-partners/dashboard');
    if (res.ok && res.data.data) {
      const d = res.data.data;
      const shapeOk =
        Array.isArray(d.leaderboard) &&
        d.funnel &&
        typeof d.funnel.leadsTagged === 'number' &&
        typeof d.funnel.bookings === 'number' &&
        typeof d.funnel.conversionPct === 'number';
      if (shapeOk) {
        log('PASS', 'Dashboard returns leaderboard + funnel',
          `${d.leaderboard.length} partners, ${d.funnel.bookings} bookings, ${d.funnel.conversionPct}% conversion`);
      } else {
        log('FAIL', 'Dashboard shape', JSON.stringify(d).slice(0, 200));
      }
    } else {
      log('FAIL', 'Dashboard endpoint', `${res.status}: ${JSON.stringify(res.data).slice(0, 200)}`);
    }
  } catch (err) {
    console.error('\n💥 FATAL ERROR:', err.message);
  } finally {
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
node --check tests/testChannelPartnerDashboard.js
```

Expected: no output, exit code 0.

- [ ] **Step 3: Run the smoke test (server must be running)**

Start the backend (`node server.js`), then in another terminal (backend repo root):

```bash
node tests/testChannelPartnerDashboard.js
```

Expected: 1 check PASS — the dashboard returns a leaderboard array and a funnel object with numeric fields.

- [ ] **Step 4: Commit**

```bash
git add tests/testChannelPartnerDashboard.js
git commit -m "test(channel-partner): add performance dashboard smoke test"
```

---

## Task 5: Frontend API method

**Files:**
- Modify (frontend): `src/services/api.js`

- [ ] **Step 1: Add `getDashboard` to `channelPartnerAPI`**

In `src/services/api.js`, the `channelPartnerAPI` object's last entry is:

```js
  // Booking attribution edit (UI wired in Plan 3 — see channel-partner spec)
  editSaleAttribution: (saleId, data) =>
    api.put(`/channel-partners/sales/${saleId}/attribution`, data),
};
```

Add the `getDashboard` method before the closing `};`:

```js
  // Booking attribution edit (UI wired in Plan 3 — see channel-partner spec)
  editSaleAttribution: (saleId, data) =>
    api.put(`/channel-partners/sales/${saleId}/attribution`, data),
  // Performance dashboard
  getDashboard: (params = {}) => api.get('/channel-partners/dashboard', { params }),
};
```

- [ ] **Step 2: Commit**

```bash
git add src/services/api.js
git commit -m "feat(channel-partner): add dashboard API method"
```

---

## Task 6: CP Performance Dashboard page

**Files:**
- Create (frontend): `src/pages/channel-partners/ChannelPartnerDashboardPage.js`

- [ ] **Step 1: Create `src/pages/channel-partners/ChannelPartnerDashboardPage.js`**

```jsx
// File: src/pages/channel-partners/ChannelPartnerDashboardPage.js
// Description: CP performance dashboard — per-partner leaderboard + a funnel
//   summary (leads tagged → bookings → commission).

import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, Typography, Grid, Card, CardContent, Table, TableBody, TableCell,
  TableHead, TableRow, Chip, CircularProgress, Alert,
} from '@mui/material';
import { channelPartnerAPI } from '../../services/api';

const STATUS_COLOR = { active: 'success', suspended: 'warning', blacklisted: 'error' };

const inr = (n) => {
  if (n === null || n === undefined) return '—';
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`;
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(1)} L`;
  return `₹${Math.round(n).toLocaleString('en-IN')}`;
};

const StatCard = ({ label, value }) => (
  <Card sx={{ height: '100%' }}>
    <CardContent>
      <Typography variant="overline" color="text.secondary">{label}</Typography>
      <Typography variant="h5" sx={{ fontWeight: 700 }}>{value}</Typography>
    </CardContent>
  </Card>
);

const ChannelPartnerDashboardPage = () => {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchDashboard = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await channelPartnerAPI.getDashboard();
      setData(res.data?.data || null);
    } catch (e) {
      setError(e.response?.data?.message || 'Failed to load the dashboard.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDashboard();
  }, [fetchDashboard]);

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">{error}</Alert>
      </Box>
    );
  }

  const funnel = data?.funnel || {};
  const leaderboard = data?.leaderboard || [];

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h4" sx={{ fontWeight: 700, mb: 1 }}>
        Channel Partner Performance
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        How your channel partner network is contributing.
      </Typography>

      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={6} md={3}><StatCard label="Leads tagged" value={funnel.leadsTagged ?? 0} /></Grid>
        <Grid item xs={6} md={3}><StatCard label="Bookings" value={funnel.bookings ?? 0} /></Grid>
        <Grid item xs={6} md={3}><StatCard label="Conversion" value={`${funnel.conversionPct ?? 0}%`} /></Grid>
        <Grid item xs={6} md={3}><StatCard label="Booked value" value={inr(funnel.bookingValue)} /></Grid>
        <Grid item xs={6} md={3}><StatCard label="Commission (net)" value={inr(funnel.commissionNet)} /></Grid>
        <Grid item xs={6} md={3}><StatCard label="Commission paid" value={inr(funnel.commissionPaid)} /></Grid>
        <Grid item xs={6} md={3}><StatCard label="Commission pending" value={inr(funnel.commissionPending)} /></Grid>
        <Grid item xs={6} md={3}><StatCard label="Partners" value={data?.partnerCount ?? 0} /></Grid>
      </Grid>

      <Card>
        <CardContent>
          <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
            Partner Leaderboard
          </Typography>
          {leaderboard.length === 0 ? (
            <Alert severity="info">
              No channel partner activity yet. Tag leads and bookings with a partner to populate this.
            </Alert>
          ) : (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Partner</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell align="right">Leads</TableCell>
                  <TableCell align="right">Bookings</TableCell>
                  <TableCell align="right">Booked value</TableCell>
                  <TableCell align="right">Commission (net)</TableCell>
                  <TableCell align="right">Pending</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {leaderboard.map((r) => (
                  <TableRow
                    key={r.channelPartnerId}
                    hover
                    sx={{ cursor: 'pointer' }}
                    onClick={() => navigate(`/channel-partners/${r.channelPartnerId}`)}
                  >
                    <TableCell>{r.firmName}</TableCell>
                    <TableCell>
                      <Chip size="small" label={r.status} color={STATUS_COLOR[r.status] || 'default'} />
                    </TableCell>
                    <TableCell align="right">{r.leadsTagged}</TableCell>
                    <TableCell align="right">{r.bookings}</TableCell>
                    <TableCell align="right">{inr(r.bookingValue)}</TableCell>
                    <TableCell align="right">{inr(r.commissionNet)}</TableCell>
                    <TableCell align="right">{inr(r.commissionPending)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </Box>
  );
};

export default ChannelPartnerDashboardPage;
```

- [ ] **Step 2: Commit**

```bash
git add src/pages/channel-partners/ChannelPartnerDashboardPage.js
git commit -m "feat(channel-partner): add performance dashboard page"
```

---

## Task 7: Booking attribution-edit dialog

**Files:**
- Modify (frontend): `src/pages/channel-partners/CommissionRecordListPage.js`

The Commission Records page lists records (one per CP per booking). Add an "Edit attribution" action that opens a dialog — pre-filled with all of that booking's CP records, reusing the Plan 2 `ChannelPartnerAttributionFields` component — and saves through the existing `editSaleAttribution` endpoint.

- [ ] **Step 1: Add imports**

In `src/pages/channel-partners/CommissionRecordListPage.js`, the imports include MUI components and `channelPartnerAPI`. Add `Dialog`, `DialogTitle`, `DialogContent`, `DialogActions`, and `Button` to the `@mui/material` import if not already present (`Button` is already imported — confirm; add only the missing `Dialog*` names). Add a new import line for the attribution component:

```js
import ChannelPartnerAttributionFields from '../../components/channel-partners/ChannelPartnerAttributionFields';
```

- [ ] **Step 2: Add edit-dialog state and handlers to `CommissionRecordListPage`**

In the `CommissionRecordListPage` component, after the existing `useState` declarations (`records`, `loading`, `error`, `statusFilter`, `payingKey`), add:

```js
  const [editSale, setEditSale] = useState(null); // { saleId, projectName }
  const [editValue, setEditValue] = useState({ viaChannelPartner: false, partners: [] });
  const [savingEdit, setSavingEdit] = useState(false);

  // Open the edit dialog for a booking — prefill from all of that sale's records.
  const openEditDialog = (saleId, projectName) => {
    const saleRecords = records.filter((r) => (r.sale?._id || r.sale) === saleId);
    setEditSale({ saleId, projectName });
    setEditValue({
      viaChannelPartner: true,
      partners: saleRecords.map((r) => ({
        channelPartner: r.channelPartner?._id || r.channelPartner,
        agent: r.agent?._id || r.agent || null,
        sharePct: r.sharePct,
      })),
    });
  };

  const saveEdit = async () => {
    const validPartners = (editValue.partners || []).filter(
      (p) => p.channelPartner && Number(p.sharePct) > 0
    );
    const sum = validPartners.reduce((a, p) => a + Number(p.sharePct), 0);
    if (editValue.viaChannelPartner && (validPartners.length === 0 || Math.abs(sum - 100) > 0.01)) {
      setError('Commission split must total 100% across selected partners.');
      return;
    }
    setSavingEdit(true);
    try {
      await channelPartnerAPI.editSaleAttribution(editSale.saleId, {
        viaChannelPartner: editValue.viaChannelPartner,
        partners: validPartners.map((p) => ({
          channelPartner: p.channelPartner,
          agent: p.agent || null,
          sharePct: Number(p.sharePct) || 0,
        })),
      });
      setEditSale(null);
      await fetchRecords();
    } catch (e) {
      setError(e.response?.data?.message || 'Failed to update attribution.');
    } finally {
      setSavingEdit(false);
    }
  };
```

- [ ] **Step 3: Pass an edit handler into `RecordRow` and render the button**

Change the `<RecordRow ... />` render line to also pass `onEditAttribution`:

```jsx
              <RecordRow
                key={r._id}
                record={r}
                onPay={handlePay}
                payingKey={payingKey}
                onEditAttribution={openEditDialog}
              />
```

In the `RecordRow` component, change its signature to accept `onEditAttribution`:

```js
const RecordRow = ({ record, onPay, payingKey, onEditAttribution }) => {
```

Inside `RecordRow`'s expanded `Collapse` panel, after the payouts `Table`, add an edit button (only meaningful when the record is not cancelled):

```jsx
              {record.status !== 'cancelled' && (
                <Box sx={{ mt: 1 }}>
                  <Button
                    size="small"
                    onClick={() =>
                      onEditAttribution(record.sale?._id || record.sale, record.sale?.project?.name)
                    }
                  >
                    Edit booking attribution
                  </Button>
                </Box>
              )}
```

- [ ] **Step 4: Render the dialog**

At the end of `CommissionRecordListPage`'s returned JSX, before the final closing `</Box>`, add the dialog:

```jsx
      <Dialog open={Boolean(editSale)} onClose={() => setEditSale(null)} fullWidth maxWidth="sm">
        <DialogTitle>
          Edit attribution{editSale?.projectName ? ` — ${editSale.projectName}` : ''}
        </DialogTitle>
        <DialogContent>
          <Box sx={{ mt: 1 }}>
            <ChannelPartnerAttributionFields value={editValue} onChange={setEditValue} />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditSale(null)} disabled={savingEdit}>Cancel</Button>
          <Button variant="contained" onClick={saveEdit} disabled={savingEdit}>
            {savingEdit ? 'Saving…' : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>
```

- [ ] **Step 5: Verify the build compiles**

Run (from the frontend repo root):

```bash
CI=true npm run build
```

Expected: `Compiled successfully.`

- [ ] **Step 6: Commit**

```bash
git add src/pages/channel-partners/CommissionRecordListPage.js
git commit -m "feat(channel-partner): add booking attribution-edit dialog"
```

---

## Task 8: Routing & navigation

**Files:**
- Modify (frontend): `src/App.js`
- Modify (frontend): `src/components/layout/DashboardLayout.js`

- [ ] **Step 1: Add the lazy import + route in `App.js`**

In `src/App.js`, alongside the other channel-partner lazy imports, add:

```js
const ChannelPartnerDashboardPage = React.lazy(() => import('./pages/channel-partners/ChannelPartnerDashboardPage'));
```

Add the route — placed with the other `/channel-partners/*` routes and **before** `/channel-partners/:id`:

```jsx
      <Route path="/channel-partners/dashboard" element={
        <ProtectedRoute requiredPermission={(canAccess) => canAccess.channelPartners()}>
          <DashboardLayout>
            <Suspense fallback={<LoadingFallback message="Loading dashboard..." />}>
              <ChannelPartnerDashboardPage />
            </Suspense>
          </DashboardLayout>
        </ProtectedRoute>
      } />
```

- [ ] **Step 2: Add the nav child in `DashboardLayout.js`**

In `src/components/layout/DashboardLayout.js`, the Channel Partners nav entry has a `children` array:

```js
  children: [
    { id: 'cp-list',    title: 'All Partners',       path: '/channel-partners' },
    { id: 'cp-rules',   title: 'Commission Rules',   path: '/channel-partners/commission-rules' },
    { id: 'cp-records', title: 'Commission Records', path: '/channel-partners/commission-records' },
  ],
```

Add a `Performance` child as the first entry:

```js
  children: [
    { id: 'cp-dashboard', title: 'Performance',        path: '/channel-partners/dashboard' },
    { id: 'cp-list',      title: 'All Partners',       path: '/channel-partners' },
    { id: 'cp-rules',     title: 'Commission Rules',   path: '/channel-partners/commission-rules' },
    { id: 'cp-records',   title: 'Commission Records', path: '/channel-partners/commission-records' },
  ],
```

- [ ] **Step 3: Verify the build compiles**

Run (from the frontend repo root):

```bash
CI=true npm run build
```

Expected: `Compiled successfully.` Fix any compile error before continuing.

- [ ] **Step 4: Commit**

```bash
git add src/App.js src/components/layout/DashboardLayout.js
git commit -m "feat(channel-partner): route and navigate the performance dashboard"
```

---

## Task 9: Manual end-to-end verification

**Files:** none (verification only).

- [ ] **Step 1: Start both servers** — backend `node server.js`, frontend `npm start`.

- [ ] **Step 2: Dashboard** — open **Channel Partners → Performance**. Confirm the funnel stat cards and the partner leaderboard render. With CP-attributed bookings from Plan 2 testing present, the leaderboard should show non-zero leads/bookings/commission for at least one partner. Click a leaderboard row → it navigates to that partner's detail page.

- [ ] **Step 3: Attribution edit** — go to **Commission Records**, expand a record, click "Edit booking attribution". The dialog opens pre-filled with that booking's partner split. Change a share or add a partner so the split totals 100%, save. Confirm the records refresh and reflect the change. Try saving a split that is not 100% — confirm it is blocked with the error message.

- [ ] **Step 4: Leadership** — open the Leadership dashboard; confirm its Channel Partner section still renders commission figures (now sourced from `CommissionRecord`).

- [ ] **Step 5** — commit any verification-driven fixes; if all worked, nothing to commit.

---

## Notes for the implementer

- **Two repos.** Tasks 1–4 are backend; Tasks 5–8 are frontend. Run git commands from the repo named in each task's **Files** block.
- **No pushing.** Commit locally; do not push.
- **Plan 1 + 2 dependency:** this plan assumes the `ChannelPartner` / `CommissionRecord` models, the `channelPartnerAttribution` sub-document, the `editSaleAttribution` endpoint, `channelPartnerAPI`, the `ChannelPartnerAttributionFields` component, and the `CommissionRecordListPage` all already exist. If any is missing, STOP and report.
- This is the final plan of the Channel Partner module. After it, the whole module (Plans 1–3) is ready to push.
