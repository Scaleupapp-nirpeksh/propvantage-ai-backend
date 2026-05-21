# Channel Partner Platform — SP2: Developer Public Portfolio — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a real-estate developer publish projects to a curated, platform-visible portfolio and preview it as a channel partner will see it.

**Architecture:** Approach A — computed view. Curation choices are stored as a `portfolio` sub-document on `Project` and a `portfolioProfile` sub-document on `Organization`; a `portfolioService` assembles the curated portfolio on read (org profile + published projects + a live `Unit` configuration summary) behind a strict allow-list projection.

**Tech Stack:** Node/Express/MongoDB/Mongoose (backend); React 18 + MUI v5 + React Router v6 (frontend).

**Spec:** `docs/superpowers/specs/2026-05-21-channel-partner-platform-sp2-design.md`

**Repos:** Backend `/Users/nirpekshnandan/My Products/propvantage-ai-backend`; Frontend `/Users/nirpekshnandan/My Products/propvantage-ai-frontend`. Both on `main`. Tasks 1-5 backend, 6-10 frontend, 11 manual verification.

---

## Decisions & deviations an implementer must know

- **Image inputs:** the logo and project cover image are entered as **image URLs** (a `TextField` + a small preview), NOT a drag-drop uploader. The data model fields (`logoUrl`, `coverImageUrl`) are plain strings either way; a proper uploader is deferred. This is a deliberate, spec-acknowledged scope choice.
- **Permission:** `portfolio:manage` gates curation. Business Head's seeded permissions are `ALL_PERMISSIONS.filter(...)`, so once the permission is in the `PERMISSIONS` catalog, *new* Business Head roles get it automatically; Project Director / Marketing Head have explicit arrays and need explicit additions. *Existing* orgs' role documents are static snapshots — a backfill script covers them.
- Key existing facts: `Project` has `organization, name, description, type, status, location{city,area,pincode,state,landmark}, totalUnits, priceRange{min,max}, expectedCompletionDate, approvals.rera{number,...}, amenities, budgetTracking`. `Unit` has `project, organization, type, areaSqft, currentPrice, status` (enum incl. `'available'`). `updateProject` in `projectController.js` scopes by `Project.findOne({ _id, organization: req.user.organization })`. The app entrypoint is `server.js`.

---

## Task 1: Model fields — `Project.portfolio` + `Organization.portfolioProfile`

**Files:** Modify `models/projectModel.js`, `models/organizationModel.js`

- [ ] **Step 1: Add `portfolio` to the Project schema**

In `models/projectModel.js`, add this field to the schema, immediately after the `budgetTracking` field (the last field before the schema's closing `}`):

```js
    // Developer public portfolio (SP2) — curation choices for this project.
    portfolio: {
      isPublished: { type: Boolean, default: false },
      showPriceRange: { type: Boolean, default: true },
      showConfigurations: { type: Boolean, default: true },
      coverImageUrl: { type: String, default: null },
    },
```

- [ ] **Step 2: Add `portfolioProfile` to the Organization schema**

In `models/organizationModel.js`, add this field immediately after the `isActive` field:

```js
    // Developer public portfolio (SP2) — public-facing org profile (builder orgs).
    portfolioProfile: {
      logoUrl: { type: String, default: null },
      about: { type: String, default: '' },
    },
```

- [ ] **Step 3: Smoke-check both models load**

Run: `node -e "Promise.all([import('./models/projectModel.js'),import('./models/organizationModel.js')]).then(()=>console.log('models OK'))"`
Expected: prints `models OK`.

- [ ] **Step 4: Commit**

```bash
git add models/projectModel.js models/organizationModel.js
git commit -m "feat(portfolio): add portfolio sub-docs to Project + Organization"
```

---

## Task 2: `portfolio:manage` permission + role seed + backfill

**Files:** Modify `config/permissions.js`, `data/defaultRoles.js`; Create `data/backfillPortfolioPermission.js`

- [ ] **Step 1: Add the `PORTFOLIO` permission group**

In `config/permissions.js`, add a new group to the `PERMISSIONS` object (place it after the `CHANNEL_PARTNERS` group, matching the existing group style):

```js
  // ─── DEVELOPER PORTFOLIO ─────────────────────────────────
  PORTFOLIO: {
    MANAGE: 'portfolio:manage',
  },
```

This automatically flows into `ALL_PERMISSIONS` (so a *new* Organization Owner / Business Head gets it) and into `PERMISSION_GROUPS`.

- [ ] **Step 2: Add `portfolio:manage` to Project Director and Marketing Head**

In `data/defaultRoles.js`, add the string `'portfolio:manage'` to the `permissions` array of the **Project Director** role and the **Marketing Head** role. Add it next to their existing `'projects:*'` permissions (a sensible grouping). Do NOT touch Business Head (its permissions are `ALL_PERMISSIONS.filter(p => p !== 'roles:delete')`, so it picks up the new permission automatically).

- [ ] **Step 3: Create the backfill script for existing orgs**

Existing orgs' role documents are static snapshots and won't have the new permission. Create `data/backfillPortfolioPermission.js` — model it EXACTLY on `data/backfillChannelPartnerCategory.js` (same `connectDB` import, same `try/finally` + `disconnect` structure, same `run().catch(...)` footer):

```js
// File: data/backfillPortfolioPermission.js
// One-time: grant portfolio:manage to existing Business Head / Project Director /
//   Marketing Head role documents (which predate the permission).
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import connectDB from '../config/db.js';
import Role from '../models/roleModel.js';

dotenv.config();

const run = async () => {
  try {
    await connectDB();
    const res = await Role.updateMany(
      { name: { $in: ['Business Head', 'Project Director', 'Marketing Head'] } },
      { $addToSet: { permissions: 'portfolio:manage' } }
    );
    console.log(`Granted portfolio:manage to ${res.modifiedCount} role(s).`);
  } finally {
    await mongoose.disconnect();
  }
};

run().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
```

> If `data/backfillChannelPartnerCategory.js` uses a different connection helper or path, match that file exactly. `$addToSet` makes the script idempotent.

- [ ] **Step 4: Smoke-check**

Run: `node -e "import('./config/permissions.js').then(m=>console.log('perm OK', m.PERMISSIONS.PORTFOLIO.MANAGE))"`
Expected: prints `perm OK portfolio:manage`.
Run: `node --check data/backfillPortfolioPermission.js` → expect exit 0.

- [ ] **Step 5: Commit**

```bash
git add config/permissions.js data/defaultRoles.js data/backfillPortfolioPermission.js
git commit -m "feat(portfolio): add portfolio:manage permission + role seed + backfill"
```

---

## Task 3: `portfolioService` — the computed portfolio

**Files:** Create `services/portfolioService.js`

- [ ] **Step 1: Create the service**

Create `services/portfolioService.js`:

```js
// File: services/portfolioService.js
// Description: Assembles a developer's curated public portfolio — org profile +
//   published projects + a live per-configuration unit summary. Strict allow-list
//   projection: internal project data is never emitted.

import mongoose from 'mongoose';
import Organization from '../models/organizationModel.js';
import Project from '../models/projectModel.js';
import Unit from '../models/unitModel.js';

/**
 * Curate one project document into its public portfolio shape.
 * @param {Object} project - a Project mongoose doc (lean or hydrated)
 * @param {Array}  configSummary - [{ type, availableCount, sizeRange, priceRange }] for this project
 */
const curateProject = (project, configSummary) => {
  const p = project.portfolio || {};
  const curated = {
    id: project._id,
    name: project.name,
    type: project.type,
    status: project.status,
    location: { city: project.location?.city, area: project.location?.area },
    description: project.description || '',
    amenities: project.amenities || [],
    reraNumber: project.approvals?.rera?.number || null,
    expectedCompletionDate: project.expectedCompletionDate || null,
    totalUnits: project.totalUnits,
    coverImageUrl: p.coverImageUrl || null,
  };
  if (p.showPriceRange) {
    curated.priceRange = {
      min: project.priceRange?.min ?? null,
      max: project.priceRange?.max ?? null,
    };
  }
  if (p.showConfigurations) {
    curated.configurationSummary = configSummary || [];
  }
  return curated;
};

/**
 * Build the full curated portfolio for a developer organization.
 * Returns null if the org does not exist or is not a builder org.
 */
export const getDeveloperPortfolio = async (organizationId) => {
  const org = await Organization.findById(organizationId).select(
    'name type city contactInfo portfolioProfile'
  );
  if (!org || org.type !== 'builder') return null;

  const projects = await Project.find({
    organization: organizationId,
    'portfolio.isPublished': true,
  }).lean();

  // Live configuration summary — one aggregation across every published project
  // whose showConfigurations toggle is on.
  const configProjectIds = projects
    .filter((p) => p.portfolio?.showConfigurations)
    .map((p) => p._id);

  let configByProject = {};
  if (configProjectIds.length > 0) {
    const rows = await Unit.aggregate([
      {
        $match: {
          organization: new mongoose.Types.ObjectId(organizationId),
          project: { $in: configProjectIds },
          status: 'available',
        },
      },
      {
        $group: {
          _id: { project: '$project', type: '$type' },
          availableCount: { $sum: 1 },
          minSize: { $min: '$areaSqft' },
          maxSize: { $max: '$areaSqft' },
          minPrice: { $min: '$currentPrice' },
          maxPrice: { $max: '$currentPrice' },
        },
      },
    ]);
    configByProject = rows.reduce((acc, r) => {
      const key = String(r._id.project);
      (acc[key] = acc[key] || []).push({
        type: r._id.type,
        availableCount: r.availableCount,
        sizeRange: { min: r.minSize, max: r.maxSize },
        priceRange: { min: r.minPrice, max: r.maxPrice },
      });
      return acc;
    }, {});
  }

  return {
    profile: {
      name: org.name,
      logoUrl: org.portfolioProfile?.logoUrl || null,
      about: org.portfolioProfile?.about || '',
      city: org.city,
      contact: {
        phone: org.contactInfo?.phone || '',
        website: org.contactInfo?.website || '',
        address: org.contactInfo?.address || '',
      },
    },
    projects: projects
      .map((p) => curateProject(p, configByProject[String(p._id)]))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
};
```

- [ ] **Step 2: Smoke-check**

Run: `node -e "import('./services/portfolioService.js').then(m=>console.log(typeof m.getDeveloperPortfolio))"`
Expected: prints `function`.

- [ ] **Step 3: Commit**

```bash
git add services/portfolioService.js
git commit -m "feat(portfolio): add portfolioService computed view"
```

---

## Task 4: Portfolio controller + routes

**Files:** Create `controllers/portfolioController.js`, `routes/portfolioRoutes.js`; Modify `server.js`

- [ ] **Step 1: Create the controller**

Create `controllers/portfolioController.js`:

```js
// File: controllers/portfolioController.js
// Description: Developer public portfolio endpoints — org public profile, per-project
//   portfolio settings, and the computed portfolio read.

import asyncHandler from 'express-async-handler';
import mongoose from 'mongoose';
import Organization from '../models/organizationModel.js';
import Project from '../models/projectModel.js';
import { getDeveloperPortfolio } from '../services/portfolioService.js';

// GET /api/portfolio/profile — the caller's own org public profile.
export const getMyPortfolioProfile = asyncHandler(async (req, res) => {
  const org = await Organization.findById(req.user.organization).select(
    'name portfolioProfile contactInfo'
  );
  if (!org) {
    res.status(404);
    throw new Error('Organization not found');
  }
  res.json({ success: true, data: org });
});

// PUT /api/portfolio/profile — update the caller's org public profile.
export const updateMyPortfolioProfile = asyncHandler(async (req, res) => {
  const org = await Organization.findById(req.user.organization);
  if (!org) {
    res.status(404);
    throw new Error('Organization not found');
  }
  const { logoUrl, about, contactInfo } = req.body;
  org.portfolioProfile = {
    logoUrl: logoUrl !== undefined ? logoUrl : org.portfolioProfile?.logoUrl || null,
    about: about !== undefined ? about : org.portfolioProfile?.about || '',
  };
  if (contactInfo !== undefined) {
    org.contactInfo = {
      ...(org.contactInfo?.toObject?.() || org.contactInfo || {}),
      ...contactInfo,
    };
  }
  await org.save();
  res.json({ success: true, data: org });
});

// PUT /api/portfolio/projects/:id — set a project's portfolio settings.
export const updateProjectPortfolio = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    res.status(400);
    throw new Error('Invalid project id');
  }
  const project = await Project.findOne({
    _id: req.params.id,
    organization: req.user.organization,
  });
  if (!project) {
    res.status(404);
    throw new Error('Project not found');
  }
  const { isPublished, showPriceRange, showConfigurations, coverImageUrl } = req.body;
  const current = project.portfolio || {};
  project.portfolio = {
    isPublished: isPublished !== undefined ? !!isPublished : current.isPublished || false,
    showPriceRange:
      showPriceRange !== undefined ? !!showPriceRange : current.showPriceRange ?? true,
    showConfigurations:
      showConfigurations !== undefined
        ? !!showConfigurations
        : current.showConfigurations ?? true,
    coverImageUrl:
      coverImageUrl !== undefined ? coverImageUrl : current.coverImageUrl || null,
  };
  await project.save();
  res.json({ success: true, data: { id: project._id, portfolio: project.portfolio } });
});

// GET /api/portfolio/view/:organizationId — the computed portfolio for any developer org.
export const getPortfolioView = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.organizationId)) {
    res.status(400);
    throw new Error('Invalid organization id');
  }
  const portfolio = await getDeveloperPortfolio(req.params.organizationId);
  if (!portfolio) {
    res.status(404);
    throw new Error('Developer portfolio not found');
  }
  res.json({ success: true, data: portfolio });
});
```

> Match the repo's `asyncHandler` import (`import asyncHandler from 'express-async-handler'` — confirm against `controllers/projectController.js`).

- [ ] **Step 2: Create the routes**

Create `routes/portfolioRoutes.js`:

```js
// File: routes/portfolioRoutes.js
import express from 'express';
import { protect, hasPermission } from '../middleware/authMiddleware.js';
import { PERMISSIONS } from '../config/permissions.js';
import {
  getMyPortfolioProfile,
  updateMyPortfolioProfile,
  updateProjectPortfolio,
  getPortfolioView,
} from '../controllers/portfolioController.js';

const router = express.Router();

router.use(protect);

router.get('/profile', getMyPortfolioProfile);
router.put('/profile', hasPermission(PERMISSIONS.PORTFOLIO.MANAGE), updateMyPortfolioProfile);
router.put('/projects/:id', hasPermission(PERMISSIONS.PORTFOLIO.MANAGE), updateProjectPortfolio);
router.get('/view/:organizationId', getPortfolioView);

export default router;
```

- [ ] **Step 3: Mount the router in `server.js`**

In `server.js`, where other routers are mounted (search for `app.use('/api/cp'` — added in SP1), add an import for `portfolioRoutes` and `app.use('/api/portfolio', portfolioRoutes);`, matching the existing import style and `app.use` placement.

- [ ] **Step 4: Smoke-check**

Run: `node -e "import('./routes/portfolioRoutes.js').then(()=>console.log('routes OK'))"`
Expected: prints `routes OK`.

- [ ] **Step 5: Commit**

```bash
git add controllers/portfolioController.js routes/portfolioRoutes.js server.js
git commit -m "feat(portfolio): add portfolio controller + routes"
```

---

## Task 5: Backend regression tests

**Files:** Create `tests/regression/suites/26-portfolio.test.js`

- [ ] **Step 1: Write the regression suite**

Read `tests/regression/suites/25-cp-platform.test.js` (added in SP1) and copy its `_lib` import lines and the `api()`/`setAuthToken()` usage verbatim. Create `tests/regression/suites/26-portfolio.test.js`:

```js
// 26-portfolio.test.js — developer public portfolio (SP2): route gates.
import { describe, test, expect, beforeAll } from '@jest/globals';
import { api, setAuthToken } from '../_lib/api.js';

describe('portfolio — route gates', () => {
  beforeAll(() => setAuthToken(null));

  test.each([
    ['GET', '/api/portfolio/profile'],
    ['GET', '/api/portfolio/view/000000000000000000000000'],
  ])('%s %s rejects unauthenticated requests', async (method, path) => {
    const res = await api(method, path);
    expect([401, 403]).toContain(res.status);
  });

  test('PUT /api/portfolio/profile rejects unauthenticated requests', async () => {
    const res = await api('PUT', '/api/portfolio/profile', { about: 'x' });
    expect([401, 403]).toContain(res.status);
  });
});
```

> If a file numbered `26` already exists in `tests/regression/suites/`, use the next free number. Confirm the `_lib/api.js` helper signature against suite 25 and match it.

- [ ] **Step 2: Run the suite**

Run: `npm run test:regression -- 26-portfolio` (or the repo's documented single-suite invocation).
Expected: tests pass against a running server, or skip cleanly if no server. They must not 404.

- [ ] **Step 3: Commit**

```bash
git add tests/regression/suites/26-portfolio.test.js
git commit -m "test(portfolio): portfolio route-gate regression suite"
```

---

## Task 6: Frontend — `portfolioAPI` + permission helper

**Files:** Modify `src/services/api.js`, `src/context/AuthContext.js`

- [ ] **Step 1: Add `portfolioAPI`**

In `src/services/api.js`, add a new exported object next to the existing `projectAPI`:

```js
export const portfolioAPI = {
  getProfile: () => api.get('/portfolio/profile'),
  updateProfile: (data) => api.put('/portfolio/profile', data),
  updateProjectPortfolio: (projectId, data) => api.put(`/portfolio/projects/${projectId}`, data),
  getPortfolio: (organizationId) => api.get(`/portfolio/view/${organizationId}`),
};
```

- [ ] **Step 2: Add a permission helper**

In `src/context/AuthContext.js`, find the `canAccess` object (it has entries like `channelPartners: () => ...`). Add:

```js
  portfolioManage: () => _useNew ? checkPerm('portfolio:manage') : hasPermission('MANAGEMENT'),
```

Match the exact style of the surrounding `canAccess` entries (the `_useNew` ternary + `checkPerm`).

- [ ] **Step 3: Verify the build**

Run: `CI=true npm run build`
Expected: `Compiled successfully.`

- [ ] **Step 4: Commit**

```bash
git add src/services/api.js src/context/AuthContext.js
git commit -m "feat(portfolio): portfolioAPI client + permission helper"
```

---

## Task 7: Frontend — Project Detail "Portfolio" curation card

**Files:** Modify the Project Detail page (`src/pages/projects/ProjectDetailPage.js`)

- [ ] **Step 1: Add a `PortfolioCard` component to the Project Detail page**

`ProjectDetailPage.js` is a card/section-based layout. Add a self-contained `PortfolioCard` component (define it in-file alongside the page's other section components, or as a new file `src/pages/projects/PortfolioCard.js` imported by the page — match how the page organizes its sections). Render it within the page's main content area, after the existing sections.

```jsx
function PortfolioCard({ project }) {
  const [settings, setSettings] = useState({
    isPublished: project.portfolio?.isPublished || false,
    showPriceRange: project.portfolio?.showPriceRange ?? true,
    showConfigurations: project.portfolio?.showConfigurations ?? true,
    coverImageUrl: project.portfolio?.coverImageUrl || '',
  });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  const save = async (next) => {
    setSaving(true); setMsg('');
    try {
      await portfolioAPI.updateProjectPortfolio(project._id, next);
      setSettings(next);
      setMsg('Saved.');
    } catch (e) {
      setMsg(e.response?.data?.message || 'Could not save.');
    } finally {
      setSaving(false);
    }
  };
  const toggle = (key) => () => save({ ...settings, [key]: !settings[key] });
  const saveCover = () => save({ ...settings });

  return (
    <Card variant="outlined" sx={{ mt: 2 }}>
      <CardContent>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography variant="h6">Portfolio</Typography>
          <Button size="small" component={RouterLink} to="/portfolio/preview">Preview portfolio</Button>
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          Control whether this project appears in your channel-partner-facing portfolio.
        </Typography>
        <FormControlLabel
          control={<Switch checked={settings.isPublished} onChange={toggle('isPublished')} disabled={saving} />}
          label="Published to portfolio" />
        <Box sx={{ pl: 2 }}>
          <FormControlLabel
            control={<Switch checked={settings.showPriceRange} onChange={toggle('showPriceRange')} disabled={saving || !settings.isPublished} />}
            label="Show price range" />
          <FormControlLabel
            control={<Switch checked={settings.showConfigurations} onChange={toggle('showConfigurations')} disabled={saving || !settings.isPublished} />}
            label="Show available configurations" />
        </Box>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start', mt: 1 }}>
          <TextField size="small" fullWidth label="Cover image URL"
            value={settings.coverImageUrl}
            onChange={(e) => setSettings((s) => ({ ...s, coverImageUrl: e.target.value }))} />
          <Button variant="outlined" onClick={saveCover} disabled={saving}>Save</Button>
        </Box>
        {settings.coverImageUrl ? (
          <Box component="img" src={settings.coverImageUrl} alt="cover"
            sx={{ mt: 1, maxHeight: 120, borderRadius: 1 }}
            onError={(e) => { e.target.style.display = 'none'; }} />
        ) : null}
        {msg && <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>{msg}</Typography>}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Ensure imports**

At the top of the file, confirm/add imports: from `@mui/material` — `Card`, `CardContent`, `Box`, `Typography`, `Button`, `Switch`, `FormControlLabel`, `TextField`; from `react` — `useState`; `Link as RouterLink` from `react-router-dom`; `portfolioAPI` from the services api module (match the path used for the existing `projectAPI` import). Render `<PortfolioCard project={project} />` where `project` is the page's loaded project object — use the page's actual project state variable name.

- [ ] **Step 3: Verify the build**

Run: `CI=true npm run build`
Expected: `Compiled successfully.`

- [ ] **Step 4: Commit**

```bash
git add src/pages/projects/ProjectDetailPage.js
git commit -m "feat(portfolio): add portfolio curation card to Project Detail"
```
(Also `git add` `PortfolioCard.js` if you created it as a separate file.)

---

## Task 8: Frontend — Public Profile page

**Files:** Create `src/pages/portfolio/PortfolioProfilePage.js`

- [ ] **Step 1: Create the page**

Create `src/pages/portfolio/PortfolioProfilePage.js`:

```jsx
import React, { useEffect, useState } from 'react';
import {
  Box, Typography, TextField, Button, Grid, Alert, CircularProgress,
} from '@mui/material';
import { portfolioAPI } from '../../services/api';

const PortfolioProfilePage = () => {
  const [form, setForm] = useState(null);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    portfolioAPI.getProfile()
      .then((res) => {
        const org = res.data?.data || {};
        setForm({
          logoUrl: org.portfolioProfile?.logoUrl || '',
          about: org.portfolioProfile?.about || '',
          phone: org.contactInfo?.phone || '',
          website: org.contactInfo?.website || '',
          address: org.contactInfo?.address || '',
        });
      })
      .catch(() => setError('Could not load your portfolio profile.'));
  }, []);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async () => {
    setSaving(true); setError(''); setOk('');
    try {
      await portfolioAPI.updateProfile({
        logoUrl: form.logoUrl,
        about: form.about,
        contactInfo: { phone: form.phone, website: form.website, address: form.address },
      });
      setOk('Profile saved.');
    } catch (e) {
      setError(e.response?.data?.message || 'Could not save the profile.');
    } finally {
      setSaving(false);
    }
  };

  if (!form) {
    return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
      {error ? <Alert severity="error">{error}</Alert> : <CircularProgress />}
    </Box>;
  }

  return (
    <Box sx={{ maxWidth: 640 }}>
      <Typography variant="h5" sx={{ fontWeight: 700, mb: 2 }}>Portfolio — Public Profile</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        This is what channel partners see at the top of your portfolio.
      </Typography>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {ok && <Alert severity="success" sx={{ mb: 2 }}>{ok}</Alert>}
      <Grid container spacing={2}>
        <Grid item xs={12}>
          <TextField fullWidth label="Logo image URL" value={form.logoUrl} onChange={set('logoUrl')} disabled={saving} />
        </Grid>
        {form.logoUrl ? (
          <Grid item xs={12}>
            <Box component="img" src={form.logoUrl} alt="logo"
              sx={{ maxHeight: 80, borderRadius: 1 }}
              onError={(e) => { e.target.style.display = 'none'; }} />
          </Grid>
        ) : null}
        <Grid item xs={12}>
          <TextField fullWidth multiline rows={4} label="About" value={form.about} onChange={set('about')} disabled={saving} />
        </Grid>
        <Grid item xs={12} sm={6}>
          <TextField fullWidth label="Public phone" value={form.phone} onChange={set('phone')} disabled={saving} />
        </Grid>
        <Grid item xs={12} sm={6}>
          <TextField fullWidth label="Website" value={form.website} onChange={set('website')} disabled={saving} />
        </Grid>
        <Grid item xs={12}>
          <TextField fullWidth label="Address" value={form.address} onChange={set('address')} disabled={saving} />
        </Grid>
      </Grid>
      <Button variant="contained" sx={{ mt: 3 }} onClick={save} disabled={saving}>
        {saving ? 'Saving…' : 'Save profile'}
      </Button>
    </Box>
  );
};

export default PortfolioProfilePage;
```

- [ ] **Step 2: Verify the build** — `CI=true npm run build` → `Compiled successfully.`

- [ ] **Step 3: Commit**

```bash
git add src/pages/portfolio/PortfolioProfilePage.js
git commit -m "feat(portfolio): developer public-profile editor page"
```

---

## Task 9: Frontend — Portfolio Preview page

**Files:** Create `src/pages/portfolio/PortfolioPreviewPage.js`

- [ ] **Step 1: Create the page**

Create `src/pages/portfolio/PortfolioPreviewPage.js`:

```jsx
import React, { useEffect, useState } from 'react';
import {
  Box, Typography, Card, CardContent, Grid, Avatar, Chip, Alert, CircularProgress, Divider,
} from '@mui/material';
import { useAuth } from '../../context/AuthContext';
import { portfolioAPI } from '../../services/api';

const fmt = (n) => (n == null ? '—' : `₹${(Number(n) / 10000000).toFixed(2)} Cr`);

const PortfolioPreviewPage = () => {
  const { organization } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!organization?._id) return;
    portfolioAPI.getPortfolio(organization._id)
      .then((res) => setData(res.data?.data || null))
      .catch(() => setError('Could not load your portfolio.'));
  }, [organization]);

  if (error) return <Box sx={{ py: 6 }}><Alert severity="error">{error}</Alert></Box>;
  if (!data) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>;

  const { profile, projects } = data;

  return (
    <Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        This is how channel partners see your portfolio.
      </Typography>

      <Card variant="outlined" sx={{ mb: 3 }}>
        <CardContent sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
          <Avatar src={profile.logoUrl || undefined} sx={{ width: 64, height: 64 }}>
            {profile.name?.[0]}
          </Avatar>
          <Box>
            <Typography variant="h5" sx={{ fontWeight: 700 }}>{profile.name}</Typography>
            <Typography variant="body2" color="text.secondary">{profile.city}</Typography>
            {profile.about && <Typography variant="body2" sx={{ mt: 1 }}>{profile.about}</Typography>}
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
              {[profile.contact?.phone, profile.contact?.website].filter(Boolean).join(' · ')}
            </Typography>
          </Box>
        </CardContent>
      </Card>

      {projects.length === 0 ? (
        <Alert severity="info">Publish a project to build your portfolio.</Alert>
      ) : (
        <Grid container spacing={2}>
          {projects.map((p) => (
            <Grid item xs={12} md={6} key={p.id}>
              <Card variant="outlined" sx={{ height: '100%' }}>
                {p.coverImageUrl ? (
                  <Box component="img" src={p.coverImageUrl} alt={p.name}
                    sx={{ width: '100%', height: 160, objectFit: 'cover' }}
                    onError={(e) => { e.target.style.display = 'none'; }} />
                ) : null}
                <CardContent>
                  <Typography variant="h6">{p.name}</Typography>
                  <Box sx={{ display: 'flex', gap: 1, my: 1, flexWrap: 'wrap' }}>
                    <Chip size="small" label={p.type} />
                    <Chip size="small" label={p.status} />
                    {p.reraNumber && <Chip size="small" variant="outlined" label={`RERA: ${p.reraNumber}`} />}
                  </Box>
                  <Typography variant="body2" color="text.secondary">
                    {[p.location?.area, p.location?.city].filter(Boolean).join(', ')}
                  </Typography>
                  {p.description && (
                    <Typography variant="body2" sx={{ mt: 1 }}>{p.description}</Typography>
                  )}
                  {p.priceRange && (
                    <Typography variant="body2" sx={{ mt: 1 }}>
                      Price: {fmt(p.priceRange.min)} – {fmt(p.priceRange.max)}
                    </Typography>
                  )}
                  {p.amenities?.length > 0 && (
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                      {p.amenities.slice(0, 6).join(' · ')}
                    </Typography>
                  )}
                  {p.configurationSummary && (
                    <Box sx={{ mt: 1 }}>
                      <Divider sx={{ mb: 1 }} />
                      {p.configurationSummary.length === 0 ? (
                        <Typography variant="caption" color="text.secondary">No current availability</Typography>
                      ) : p.configurationSummary.map((c) => (
                        <Typography variant="body2" key={c.type}>
                          {c.type}: {c.availableCount} available · {c.sizeRange.min}–{c.sizeRange.max} sqft · {fmt(c.priceRange.min)}–{fmt(c.priceRange.max)}
                        </Typography>
                      ))}
                    </Box>
                  )}
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>
      )}
    </Box>
  );
};

export default PortfolioPreviewPage;
```

> Confirm `useAuth()` exposes `organization` with an `_id` (it does — used across the app). If the org id field differs, use the actual one.

- [ ] **Step 2: Verify the build** — `CI=true npm run build` → `Compiled successfully.`

- [ ] **Step 3: Commit**

```bash
git add src/pages/portfolio/PortfolioPreviewPage.js
git commit -m "feat(portfolio): channel-partner-view preview page"
```

---

## Task 10: Frontend — routes + navigation

**Files:** Modify `src/App.js`, `src/components/layout/DashboardLayout.js`

- [ ] **Step 1: Add the routes in `src/App.js`**

Add lazy imports next to the other lazy page imports:
```js
const PortfolioProfilePage = React.lazy(() => import('./pages/portfolio/PortfolioProfilePage'));
const PortfolioPreviewPage = React.lazy(() => import('./pages/portfolio/PortfolioPreviewPage'));
```

Add two routes inside the developer area — wrapped the SAME way the existing developer feature routes are (a `ProtectedRoute` + `DashboardLayout` + `Suspense`; copy the exact wrapper structure from an existing developer route such as `/projects`):
```jsx
<Route path="/portfolio/profile" element={
  <ProtectedRoute requiredPermission="portfolio:manage">
    <DashboardLayout>
      <Suspense fallback={<LoadingFallback />}><PortfolioProfilePage /></Suspense>
    </DashboardLayout>
  </ProtectedRoute>
} />
<Route path="/portfolio/preview" element={
  <ProtectedRoute>
    <DashboardLayout>
      <Suspense fallback={<LoadingFallback />}><PortfolioPreviewPage /></Suspense>
    </DashboardLayout>
  </ProtectedRoute>
} />
```
> `ProtectedRoute` accepts a `requiredPermission` prop (a `module:action` string) — confirm against `App.js` and match its usage. The Preview route is left ungated beyond auth (any developer-org user may preview).

- [ ] **Step 2: Add the nav group in `DashboardLayout.js`**

In `getNavigationItems`, add a nav item to the `OPERATIONS` section (after the `projects` item), matching the existing parent-with-children shape:
```js
{
  id: 'portfolio',
  title: 'Portfolio',
  icon: Storefront,
  path: '/portfolio/preview',
  requiredAccess: () => canAccess.portfolioManage(),
  children: [
    { id: 'portfolio-preview', title: 'Preview', icon: Visibility, path: '/portfolio/preview' },
    { id: 'portfolio-profile', title: 'Public Profile', icon: Settings, path: '/portfolio/profile' },
  ],
},
```
Import any missing icons (`Storefront`, `Visibility`, `Settings`) from `@mui/icons-material` at the top of the file — check which are already imported and only add the missing ones.

- [ ] **Step 3: Verify the build**

Run: `CI=true npm run build`
Expected: `Compiled successfully.`

- [ ] **Step 4: Commit**

```bash
git add src/App.js src/components/layout/DashboardLayout.js
git commit -m "feat(portfolio): portfolio routes + navigation"
```

---

## Task 11: Manual verification

**No files changed.** Confirm SP2 end-to-end (both apps running).

- [ ] **Step 1** — If existing developer orgs need non-owner roles to curate, run `node data/backfillPortfolioPermission.js`.
- [ ] **Step 2** — As a developer, open a Project Detail page → the "Portfolio" card. Toggle "Published to portfolio" on; set the section toggles; paste a cover image URL and Save.
- [ ] **Step 3** — Open **Portfolio → Public Profile**; set a logo URL + about + contact; save.
- [ ] **Step 4** — Open **Portfolio → Preview** — confirm the org header and the published project card render; confirm the configuration summary shows available configurations; toggle "Show price range" off on the project and confirm it disappears from the preview.
- [ ] **Step 5** — Confirm an unpublished project does NOT appear in the preview.
- [ ] **Step 6** — Confirm the `/api/portfolio/view/:organizationId` response contains no internal fields (`targetRevenue`, `budgetTracking`) — inspect the network response on the Preview page.

---

## Notes for the executor

- **Image inputs are URLs, not uploads** — a deliberate, de-risked scope choice (the file/document upload system requires `category`/`resourceType` plumbing with no clean verified example). The `logoUrl`/`coverImageUrl` data fields are strings regardless; a drag-drop uploader is a clean later addition.
- **Allow-list projection** — `portfolioService.curateProject` emits only explicitly-listed fields; a future internal `Project` field stays hidden unless added there.
- **Test approach** — backend uses the repo's regression-suite pattern (live-server smoke tests), consistent with SP1.
- **Frontend task order** — implement Tasks 6→7→8→9→10 in order (Task 7 needs `portfolioAPI` from Task 6; Task 10's routes need the pages from Tasks 8-9).
- **Do not push** — all tasks commit locally; deploying is a separate, user-authorized step.
