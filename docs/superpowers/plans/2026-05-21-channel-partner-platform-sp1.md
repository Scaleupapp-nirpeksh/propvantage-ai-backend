# Channel Partner Platform — SP1: CP Organizations & Onboarding — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let channel partners register their own organization on PropVantage, log into a dedicated portal, and build a team — the foundation of the two-sided platform.

**Architecture:** A CP organization is an `Organization` with `type: 'channel_partner'`. It reuses the existing User/Role/auth/invitation machinery; it gets its own seeded role set (CP Owner/Manager/Agent) and a `cp_*` permission namespace. The frontend is one app that renders a developer shell or a CP shell based on the logged-in org's `type`.

**Tech Stack:** Node/Express/MongoDB/Mongoose (backend); React 18 + MUI v5 + React Router v6 (frontend).

**Spec:** `docs/superpowers/specs/2026-05-21-channel-partner-platform-sp1-design.md`

**Repos:** Backend `/Users/nirpekshnandan/My Products/propvantage-ai-backend`; Frontend `/Users/nirpekshnandan/My Products/propvantage-ai-frontend`. Both on `main`. Tasks 1-5 backend, 6-11 frontend, 12 manual verification.

---

## Key facts an implementer needs

- `Organization` (`models/organizationModel.js`): `name` (globally unique), `type` (enum **already** `['builder','channel_partner']`), `country`, `city`, `contactInfo {phone, website, address}`, `subscriptionPlan`, `isActive`.
- `registerUser` (`controllers/authController.js`) creates the org with `type:'builder'` hardcoded, creates the owner `User`, calls `seedDefaultRoles(orgId, userId)`, assigns the role where `isOwnerRole`, issues a JWT + refresh token, returns `{ ...user, roleRef, organization:{_id,name}, token }`.
- `User` email has a **global unique index** — email is already unique platform-wide.
- `Role` (`models/roleModel.js`): `organization`, `name`, `slug` (auto from name via pre-validate hook), `level`, `permissions[]`, `isDefault`, `isOwnerRole`, `isActive`, `createdBy`. Unique index `{organization, slug}`.
- `seedDefaultRoles(orgId, userId)` (`data/defaultRoles.js`): `Role.insertMany(DEFAULT_ROLES.map(r => ({...r, organization, isDefault:true, isActive:true, createdBy})))`.
- `config/permissions.js`: `PERMISSIONS` (object of groups), `ALL_PERMISSIONS = Object.values(PERMISSIONS).flatMap(g => Object.values(g))`, `PERMISSION_GROUPS` (UI helper).
- `protect` middleware sets `req.user` (with `roleRef` populated), `req.userPermissions`, `req.isOwner`. `hasPermission(...perms)` — **owner bypasses all checks** (`if (req.isOwner) return next()`). There is also `hasAnyPermission`.
- `generateInvitationLink` (`controllers/invitationController.js`) is org-agnostic: it reads `{firstName,lastName,email,role}` from the body, looks up the `Role` by `{organization: req.user.organization, name: role, isActive:true}`, runs the inviter-vs-target level hierarchy check, creates a pending `User` with `roleRef`, and returns an invite link `${FRONTEND_URL}/invite/:userId?token=...&email=...`.
- Backend tests: regression suites in `tests/regression/suites/*.test.js`, run via `npm run test:regression`.

---

## Task 1: Organization model — `category` + `reraRegistrationNumber`

**Files:**
- Modify: `models/organizationModel.js`

- [ ] **Step 1: Add the two CP fields**

In `models/organizationModel.js`, add these fields to the schema, immediately after the `contactInfo` block and before `subscriptionPlan`:

```js
    // Channel-partner-only fields (used when type === 'channel_partner').
    category: {
      type: String,
      enum: ['individual_agent', 'broker_firm', 'corporate', 'digital_aggregator'],
      default: null,
    },
    reraRegistrationNumber: {
      type: String,
      trim: true,
      uppercase: true,
      default: null,
    },
```

- [ ] **Step 2: Add the partial unique index**

After the schema definition (before `mongoose.model(...)`), add:

```js
// RERA registration number is unique among channel-partner orgs only —
// the partial filter keeps it from colliding with builder orgs (which have none).
organizationSchema.index(
  { reraRegistrationNumber: 1 },
  { unique: true, partialFilterExpression: { type: 'channel_partner' } }
);
```

- [ ] **Step 3: Smoke-check the model loads**

Run: `node -e "import('./models/organizationModel.js').then(()=>console.log('org model OK'))"`
Expected: prints `org model OK`.

- [ ] **Step 4: Commit**

```bash
git add models/organizationModel.js
git commit -m "feat(cp-platform): add category + RERA fields to Organization"
```

---

## Task 2: CP permissions + CP role seed

**Files:**
- Modify: `config/permissions.js`
- Create: `data/defaultChannelPartnerRoles.js`

- [ ] **Step 1: Add the `CP_PERMISSIONS` namespace**

In `config/permissions.js`, add a **separate** export (do NOT add these into the `PERMISSIONS` object — that would fold them into `ALL_PERMISSIONS` and leak them onto the developer Organization Owner role). Place it after the `PERMISSIONS` declaration:

```js
// ─── CHANNEL PARTNER PORTAL PERMISSIONS ──────────────────────────────
// A separate namespace for channel-partner organizations. Deliberately NOT
// part of PERMISSIONS / ALL_PERMISSIONS so it never leaks onto developer roles.
export const CP_PERMISSIONS = {
  TEAM: {
    VIEW: 'cp_team:view',
    MANAGE: 'cp_team:manage',
  },
  ORG: {
    VIEW: 'cp_org:view',
    MANAGE: 'cp_org:manage',
  },
  DASHBOARD: {
    VIEW: 'cp_dashboard:view',
  },
};

// Flat list of every CP permission — used to seed the CP Owner role.
export const ALL_CP_PERMISSIONS = Object.values(CP_PERMISSIONS).flatMap((group) =>
  Object.values(group)
);
```

- [ ] **Step 2: Create the CP role seed**

Create `data/defaultChannelPartnerRoles.js`. Model the structure on `data/defaultRoles.js` (same role-object shape, same `insertMany` seeding pattern):

```js
// File: data/defaultChannelPartnerRoles.js
// Description: Default roles seeded into a channel-partner organization at
//   registration. Parallel to data/defaultRoles.js (which seeds builder orgs).
import Role from '../models/roleModel.js';
import { ALL_CP_PERMISSIONS, CP_PERMISSIONS } from '../config/permissions.js';

const CP_DEFAULT_ROLES = [
  {
    name: 'CP Owner',
    description: 'Channel partner organization owner — full control.',
    level: 0,
    isOwnerRole: true,
    permissions: ALL_CP_PERMISSIONS,
  },
  {
    name: 'CP Manager',
    description: 'Runs the team day-to-day: members, org profile, dashboard.',
    level: 1,
    isOwnerRole: false,
    permissions: [
      CP_PERMISSIONS.TEAM.VIEW,
      CP_PERMISSIONS.TEAM.MANAGE,
      CP_PERMISSIONS.ORG.VIEW,
      CP_PERMISSIONS.ORG.MANAGE,
      CP_PERMISSIONS.DASHBOARD.VIEW,
    ],
  },
  {
    name: 'CP Agent',
    description: 'Works their own leads; views the org profile and dashboard.',
    level: 2,
    isOwnerRole: false,
    permissions: [CP_PERMISSIONS.ORG.VIEW, CP_PERMISSIONS.DASHBOARD.VIEW],
  },
];

/**
 * Seed the three CP roles into a newly-created channel-partner organization.
 * Returns the created Role documents.
 */
export const seedChannelPartnerRoles = async (organizationId, createdByUserId) => {
  const roleDocs = CP_DEFAULT_ROLES.map((role) => ({
    ...role,
    organization: organizationId,
    isDefault: true,
    isActive: true,
    createdBy: createdByUserId,
  }));
  return Role.insertMany(roleDocs);
};
```

> The `Role` pre-validate hook auto-generates `slug` from `name`, so "CP Owner" → `cp-owner`, etc. — no need to set `slug`.

- [ ] **Step 3: Smoke-check both files load**

Run: `node -e "import('./data/defaultChannelPartnerRoles.js').then(m=>console.log(typeof m.seedChannelPartnerRoles))"`
Expected: prints `function`.

- [ ] **Step 4: Commit**

```bash
git add config/permissions.js data/defaultChannelPartnerRoles.js
git commit -m "feat(cp-platform): add CP permission namespace + CP role seed"
```

---

## Task 3: `requireOrgType` middleware + registration fork

**Files:**
- Modify: `middleware/authMiddleware.js`
- Modify: `controllers/authController.js`

### Why `requireOrgType`
`hasPermission` lets a user with `isOwner` bypass every permission check. A developer Organization Owner is `isOwner`, so the `cp_*` permission gate alone would NOT keep them out of CP routes. `requireOrgType('channel_partner')` is a separate, non-bypassable guard placed before the permission checks on CP routes. (The reverse — a CP user calling a developer API — is benign: every developer endpoint is `organization`-scoped to the caller's org, and a CP org has no projects/leads/etc., so such a call returns empty rather than another tenant's data.)

- [ ] **Step 1: Add the `requireOrgType` middleware**

In `middleware/authMiddleware.js`, add a new exported middleware factory (place it next to `hasPermission`). Add `import Organization from '../models/organizationModel.js';` at the top if not already imported:

```js
/**
 * Restrict a route to organizations of a given type ('builder' | 'channel_partner').
 * Unlike hasPermission, this is NOT bypassed by isOwner — it is a hard org-type gate.
 */
const requireOrgType = (requiredType) =>
  asyncHandler(async (req, res, next) => {
    const org = await Organization.findById(req.user.organization).select('type');
    if (!org || org.type !== requiredType) {
      res.status(403);
      throw new Error('This area is not available for your organization type');
    }
    next();
  });
```

Add `requireOrgType` to the file's exports (match how `protect` / `hasPermission` are exported — e.g. `export { protect, hasPermission, hasAnyPermission, requireOrgType };`).

- [ ] **Step 2: Generalize `registerUser` for the CP path**

In `controllers/authController.js`:

(a) Add an import near the other `data/` imports:
```js
import { seedChannelPartnerRoles } from '../data/defaultChannelPartnerRoles.js';
```

(b) Replace the body-destructuring and org-creation portion of `registerUser`. The current code reads `{ orgName, country, city, firstName, lastName, email, password }` and creates the org with `type: 'builder'`. Change it to:

```js
  const {
    orgName, country, city, firstName, lastName, email, password,
    type = 'builder', category, reraRegistrationNumber,
  } = req.body;

  // 1. Validate common required fields
  if (!orgName || !country || !city || !firstName || !lastName || !email || !password) {
    res.status(400);
    throw new Error('Please provide all required fields');
  }

  // 1b. Channel-partner-specific validation
  const CP_CATEGORIES = ['individual_agent', 'broker_firm', 'corporate', 'digital_aggregator'];
  let normalizedRera = null;
  if (type === 'channel_partner') {
    if (!CP_CATEGORIES.includes(category)) {
      res.status(400);
      throw new Error('Please select a valid channel partner category');
    }
    normalizedRera = (reraRegistrationNumber || '').trim().toUpperCase();
    if (!normalizedRera) {
      res.status(400);
      throw new Error('RERA registration number is required');
    }
    const reraTaken = await Organization.findOne({
      type: 'channel_partner',
      reraRegistrationNumber: normalizedRera,
    });
    if (reraTaken) {
      res.status(400);
      throw new Error('A channel partner account already exists for this RERA registration number');
    }
  } else if (type !== 'builder') {
    res.status(400);
    throw new Error('Invalid organization type');
  }

  // 2. Org name uniqueness
  const orgExists = await Organization.findOne({ name: orgName });
  if (orgExists) {
    res.status(400);
    throw new Error('An organization with this name already exists');
  }

  // 3. Email uniqueness (global)
  const userExists = await User.findOne({ email });
  if (userExists) {
    res.status(400);
    throw new Error('A user with this email already exists');
  }

  // 4. Create the organization
  const organization = await Organization.create({
    name: orgName,
    country,
    city,
    type,
    ...(type === 'channel_partner'
      ? { category, reraRegistrationNumber: normalizedRera }
      : {}),
  });
```

(c) After the owner `User` is created, the existing code seeds roles and assigns the owner role. Change the role-seeding line to branch on `type`:

```js
      // 6. Seed default roles for this new organization
      const roles =
        type === 'channel_partner'
          ? await seedChannelPartnerRoles(organization._id, user._id)
          : await seedDefaultRoles(organization._id, user._id);

      // 7. Assign the owner role to the first user
      const ownerRole = roles.find((r) => r.isOwnerRole);
```

The rest (JWT, refresh token, response) is unchanged **except** the response's `organization` object — see Step 3.

> Note: the legacy `User.role` string field has an enum that does not include CP role names. The owner user is created with `role: 'Business Head'` today. For a CP org, pass a value the enum accepts — keep `role: 'Business Head'` as a harmless legacy placeholder (the real role is `roleRef`), OR if the User model's `role` enum is extended later that's out of SP1 scope. Use `role: 'Business Head'` for the CP owner too; `roleRef` is what the app actually uses.

- [ ] **Step 3: Include `type` in the auth responses**

In `registerUser`'s `res.status(201).json({...})`, change the `organization` object to include `type`:
```js
        organization: {
          _id: organization._id,
          name: organization.name,
          type: organization.type,
        },
```

In `loginUser`, find where it returns the `organization` object in the response and add `type` the same way. `loginUser` already loads the user; ensure the organization's `type` is available — if `loginUser` does not currently load the Organization document, add `const org = await Organization.findById(user.organization).select('name type');` and return `{ _id: org._id, name: org.name, type: org.type }`. (Check the existing `loginUser` response shape and match it; only add `type`.)

Also check `controllers/invitationController.js` `acceptInvitation` — its response after a successful accept should likewise include `organization.type` so an invited CP team member's app loads the CP shell. If it returns an `organization` object, add `type` to it the same way.

- [ ] **Step 4: Smoke-check**

Run: `node -e "import('./controllers/authController.js').then(()=>console.log('authController OK'))"`
Expected: prints `authController OK`.

- [ ] **Step 5: Commit**

```bash
git add middleware/authMiddleware.js controllers/authController.js
git commit -m "feat(cp-platform): CP registration fork + requireOrgType middleware"
```

---

## Task 4: CP portal backend — org profile + team endpoints

**Files:**
- Create: `controllers/cpPortalController.js`
- Create: `routes/cpPortalRoutes.js`
- Modify: the app entrypoint that mounts routes (e.g. `app.js` / `server.js` / `index.js` — find where other routers are mounted with `app.use('/api/...', ...)`)

- [ ] **Step 1: Create the CP portal controller**

Create `controllers/cpPortalController.js`:

```js
// File: controllers/cpPortalController.js
// Description: Channel-partner portal endpoints — the CP org's own profile and team.
//   All routes are guarded by requireOrgType('channel_partner') + a cp_* permission.

import asyncHandler from 'express-async-handler';
import mongoose from 'mongoose';
import Organization from '../models/organizationModel.js';
import User from '../models/userModel.js';
import Role from '../models/roleModel.js';

// GET /api/cp/org — the CP org's profile.
export const getOrgProfile = asyncHandler(async (req, res) => {
  const org = await Organization.findById(req.user.organization).select(
    'name type category reraRegistrationNumber country city contactInfo isActive'
  );
  if (!org) {
    res.status(404);
    throw new Error('Organization not found');
  }
  res.json({ success: true, data: org });
});

// PUT /api/cp/org — update editable profile fields (NOT the RERA number).
export const updateOrgProfile = asyncHandler(async (req, res) => {
  const org = await Organization.findById(req.user.organization);
  if (!org) {
    res.status(404);
    throw new Error('Organization not found');
  }
  const { name, category, country, city, contactInfo } = req.body;
  const CP_CATEGORIES = ['individual_agent', 'broker_firm', 'corporate', 'digital_aggregator'];

  if (name !== undefined) org.name = name;
  if (country !== undefined) org.country = country;
  if (city !== undefined) org.city = city;
  if (category !== undefined) {
    if (!CP_CATEGORIES.includes(category)) {
      res.status(400);
      throw new Error('Invalid channel partner category');
    }
    org.category = category;
  }
  if (contactInfo !== undefined) {
    org.contactInfo = { ...org.contactInfo?.toObject?.() , ...contactInfo };
  }
  // reraRegistrationNumber is intentionally NOT editable here.
  await org.save();
  res.json({ success: true, data: org });
});

// GET /api/cp/team — list the CP org's members.
export const listTeam = asyncHandler(async (req, res) => {
  const members = await User.find({ organization: req.user.organization })
    .select('firstName lastName email isActive invitationStatus roleRef lastLogin')
    .populate('roleRef', 'name slug level isOwnerRole')
    .sort({ createdAt: 1 });
  res.json({ success: true, data: members });
});

// PUT /api/cp/team/:userId/role — change a member's role.
export const changeMemberRole = asyncHandler(async (req, res) => {
  const { roleId } = req.body;
  if (!mongoose.isValidObjectId(req.params.userId) || !mongoose.isValidObjectId(roleId)) {
    res.status(400);
    throw new Error('Invalid user or role id');
  }
  const member = await User.findOne({
    _id: req.params.userId,
    organization: req.user.organization,
  }).populate('roleRef', 'isOwnerRole');
  if (!member) {
    res.status(404);
    throw new Error('Team member not found');
  }
  if (member.roleRef?.isOwnerRole) {
    res.status(400);
    throw new Error("The CP Owner's role cannot be changed");
  }
  const role = await Role.findOne({ _id: roleId, organization: req.user.organization });
  if (!role) {
    res.status(400);
    throw new Error('Role not found in this organization');
  }
  if (role.isOwnerRole) {
    res.status(400);
    throw new Error('Cannot assign the CP Owner role');
  }
  member.roleRef = role._id;
  await member.save({ validateBeforeSave: false });
  res.json({ success: true, data: { _id: member._id, roleRef: role._id } });
});

// PUT /api/cp/team/:userId/deactivate — deactivate a member.
export const deactivateMember = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.userId)) {
    res.status(400);
    throw new Error('Invalid user id');
  }
  const member = await User.findOne({
    _id: req.params.userId,
    organization: req.user.organization,
  }).populate('roleRef', 'isOwnerRole');
  if (!member) {
    res.status(404);
    throw new Error('Team member not found');
  }
  if (member.roleRef?.isOwnerRole) {
    res.status(400);
    throw new Error('The CP Owner cannot be deactivated');
  }
  if (String(member._id) === String(req.user._id)) {
    res.status(400);
    throw new Error('You cannot deactivate yourself');
  }
  member.isActive = false;
  await member.save({ validateBeforeSave: false });
  res.json({ success: true, data: { _id: member._id, isActive: false } });
});
```

- [ ] **Step 2: Create the CP portal routes**

Create `routes/cpPortalRoutes.js`. The team-invite endpoint **reuses** the existing `generateInvitationLink` controller — it is org-agnostic and looks up the CP role by name in the caller's org.

```js
// File: routes/cpPortalRoutes.js
import express from 'express';
import { protect, hasPermission, requireOrgType } from '../middleware/authMiddleware.js';
import { CP_PERMISSIONS } from '../config/permissions.js';
import {
  getOrgProfile,
  updateOrgProfile,
  listTeam,
  changeMemberRole,
  deactivateMember,
} from '../controllers/cpPortalController.js';
import { generateInvitationLink } from '../controllers/invitationController.js';

const router = express.Router();

// Every CP portal route requires auth AND a channel-partner organization.
router.use(protect);
router.use(requireOrgType('channel_partner'));

router.get('/org', hasPermission(CP_PERMISSIONS.ORG.VIEW), getOrgProfile);
router.put('/org', hasPermission(CP_PERMISSIONS.ORG.MANAGE), updateOrgProfile);

router.get('/team', hasPermission(CP_PERMISSIONS.TEAM.VIEW), listTeam);
router.post('/team/invite', hasPermission(CP_PERMISSIONS.TEAM.MANAGE), generateInvitationLink);
router.put('/team/:userId/role', hasPermission(CP_PERMISSIONS.TEAM.MANAGE), changeMemberRole);
router.put('/team/:userId/deactivate', hasPermission(CP_PERMISSIONS.TEAM.MANAGE), deactivateMember);

export default router;
```

> `generateInvitationLink` must be an exported named export of `invitationController.js` — confirm; it is used by `invitationRoutes.js` already. The frontend will POST `{ firstName, lastName, email, role }` where `role` is `'CP Manager'` or `'CP Agent'`.

- [ ] **Step 3: Mount the router**

In the app entrypoint where other routers are mounted (search for `app.use('/api/invitations'` to find the spot), add:

```js
import cpPortalRoutes from './routes/cpPortalRoutes.js';
// ...
app.use('/api/cp', cpPortalRoutes);
```

Match the existing import style and placement of the surrounding `app.use('/api/...')` lines.

- [ ] **Step 4: Smoke-check**

Run: `node -e "import('./routes/cpPortalRoutes.js').then(()=>console.log('cp routes OK'))"`
Expected: prints `cp routes OK`.

- [ ] **Step 5: Commit**

```bash
git add controllers/cpPortalController.js routes/cpPortalRoutes.js
git commit -m "feat(cp-platform): CP portal org-profile + team endpoints"
```
(Also `git add` the modified app entrypoint file.)

---

## Task 5: Backend regression tests

**Files:**
- Create: `tests/regression/suites/25-cp-platform.test.js`

- [ ] **Step 1: Write the regression suite**

Model it on an existing suite (read `tests/regression/suites/01-auth-gates.test.js` and another that does authenticated POSTs; copy the `_lib` import lines verbatim). Create `tests/regression/suites/25-cp-platform.test.js`:

```js
// 25-cp-platform.test.js — channel partner platform SP1: registration + portal gates.
import { describe, test, expect, beforeAll } from '@jest/globals';
import { api, setAuthToken } from '../_lib/api.js';

describe('CP platform — registration validation', () => {
  beforeAll(() => setAuthToken(null));

  test('CP registration without RERA is rejected', async () => {
    const res = await api('POST', '/api/auth/register', {
      type: 'channel_partner',
      orgName: `Test CP ${Date.now()}`,
      country: 'India', city: 'Mumbai',
      category: 'broker_firm',
      firstName: 'Test', lastName: 'Owner',
      email: `cp${Date.now()}@example.com`, password: 'StrongPass!234',
    });
    expect(res.status).toBe(400);
  });

  test('CP registration with an invalid category is rejected', async () => {
    const res = await api('POST', '/api/auth/register', {
      type: 'channel_partner',
      orgName: `Test CP ${Date.now()}`,
      country: 'India', city: 'Mumbai',
      category: 'not_a_category',
      reraRegistrationNumber: `RERA${Date.now()}`,
      firstName: 'Test', lastName: 'Owner',
      email: `cp${Date.now()}@example.com`, password: 'StrongPass!234',
    });
    expect(res.status).toBe(400);
  });
});

describe('CP platform — portal route gates', () => {
  beforeAll(() => setAuthToken(null));

  test.each([
    ['/api/cp/org'],
    ['/api/cp/team'],
  ])('GET %s rejects unauthenticated requests', async (path) => {
    const res = await api('GET', path);
    expect([401, 403]).toContain(res.status);
  });
});
```

> If `25-` is taken in `tests/regression/suites/`, use the next free number. Confirm the `_lib/api.js` helper's signature (`api(method, path, body?)`) against an existing suite and match it.

- [ ] **Step 2: Run the suite**

Run: `npm run test:regression -- 25-cp-platform` (or the repo's documented single-suite invocation).
Expected: tests pass against a running server, or skip cleanly if no server. They must not 404.

- [ ] **Step 3: Commit**

```bash
git add tests/regression/suites/25-cp-platform.test.js
git commit -m "test(cp-platform): registration + portal-gate regression suite"
```

---

## Task 6: Frontend — AuthContext org type + CP portal API

**Files:**
- Modify: `src/context/AuthContext.js`
- Modify: `src/services/api.js`

- [ ] **Step 1: Persist `organization.type` in AuthContext**

In `src/context/AuthContext.js`, the `organization` object is stored from the login/register response. The backend now returns `organization: { _id, name, type }`. Confirm the `login` action and the app-init/localStorage rehydration store the **whole** `organization` object (including `type`). If the code explicitly picks fields (e.g. `{ _id, name }`), add `type`. The auth state already holds `organization` — ensure `organization.type` survives a page reload (it is persisted to `localStorage` with the rest of the org object).

Add a convenience boolean to the context value, next to `isOwner`:
```js
  const isChannelPartnerOrg = state.organization?.type === 'channel_partner';
```
and include `isChannelPartnerOrg` in the context `value`.

- [ ] **Step 2: Add the CP portal API methods**

In `src/services/api.js`, add a new exported object next to `invitationAPI`:

```js
export const cpPortalAPI = {
  getOrgProfile: () => api.get('/cp/org'),
  updateOrgProfile: (data) => api.put('/cp/org', data),
  getTeam: () => api.get('/cp/team'),
  inviteMember: (data) => api.post('/cp/team/invite', data),
  changeMemberRole: (userId, roleId) => api.put(`/cp/team/${userId}/role`, { roleId }),
  deactivateMember: (userId) => api.put(`/cp/team/${userId}/deactivate`),
};
```

- [ ] **Step 3: Verify the build**

Run: `CI=true npm run build`
Expected: `Compiled successfully.`

- [ ] **Step 4: Commit**

```bash
git add src/context/AuthContext.js src/services/api.js
git commit -m "feat(cp-platform): AuthContext org type + CP portal API client"
```

---

## Task 7: Frontend — registration choice + CP registration page

**Files:**
- Create: `src/pages/auth/RegisterChoicePage.js`
- Create: `src/pages/auth/ChannelPartnerRegisterPage.js`
- Modify: `src/App.js` (routing)

- [ ] **Step 1: Create the registration choice page**

Create `src/pages/auth/RegisterChoicePage.js` — two cards. Match the MUI style of the existing auth pages (read `src/pages/auth/LoginPage.js` for the look):

```jsx
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, Card, CardActionArea, CardContent, Typography, Stack } from '@mui/material';
import { Business, Handshake } from '@mui/icons-material';

const RegisterChoicePage = () => {
  const navigate = useNavigate();
  const options = [
    { key: 'developer', title: "I'm a Real Estate Developer",
      desc: 'Manage your projects, inventory, leads, and sales.',
      icon: Business, to: '/register/developer' },
    { key: 'channel_partner', title: "I'm a Channel Partner",
      desc: 'Manage your team and the developers you work with, all in one place.',
      icon: Handshake, to: '/register/channel-partner' },
  ];
  return (
    <Box sx={{ maxWidth: 520, mx: 'auto' }}>
      <Typography variant="h5" sx={{ fontWeight: 700, mb: 1 }}>Create your account</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Tell us who you are so we can set up the right workspace.
      </Typography>
      <Stack spacing={2}>
        {options.map((o) => (
          <Card key={o.key} variant="outlined">
            <CardActionArea onClick={() => navigate(o.to)}>
              <CardContent sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                <o.icon color="primary" sx={{ fontSize: 36 }} />
                <Box>
                  <Typography sx={{ fontWeight: 600 }}>{o.title}</Typography>
                  <Typography variant="body2" color="text.secondary">{o.desc}</Typography>
                </Box>
              </CardContent>
            </CardActionArea>
          </Card>
        ))}
      </Stack>
      <Typography variant="body2" sx={{ mt: 3, textAlign: 'center' }}>
        Already have an account? <a href="/login">Sign in</a>
      </Typography>
    </Box>
  );
};

export default RegisterChoicePage;
```

- [ ] **Step 2: Create the CP registration page**

Create `src/pages/auth/ChannelPartnerRegisterPage.js`. It collects the CP fields and calls the register API with `type: 'channel_partner'`. Use the `AuthContext` `register` function (the same one the developer `RegisterPage` uses). Read the developer `RegisterPage.js` to match the form/validation/submit style:

```jsx
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, TextField, MenuItem, Button, Typography, Alert, CircularProgress, Grid,
} from '@mui/material';
import { useAuth } from '../../context/AuthContext';

const CATEGORIES = [
  { value: 'individual_agent', label: 'Individual Agent' },
  { value: 'broker_firm', label: 'Broker Firm' },
  { value: 'corporate', label: 'Corporate' },
  { value: 'digital_aggregator', label: 'Digital Aggregator' },
];

const ChannelPartnerRegisterPage = () => {
  const navigate = useNavigate();
  const { register } = useAuth();
  const [form, setForm] = useState({
    orgName: '', category: '', reraRegistrationNumber: '', country: 'India', city: '',
    firstName: '', lastName: '', email: '', password: '',
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    const required = ['orgName', 'category', 'reraRegistrationNumber', 'country', 'city',
      'firstName', 'lastName', 'email', 'password'];
    for (const k of required) {
      if (!String(form[k]).trim()) { setError('Please fill in all fields.'); return; }
    }
    setLoading(true);
    try {
      const result = await register({ ...form, type: 'channel_partner' });
      if (result?.success) navigate('/partner/dashboard');
      else setError(result?.error || 'Registration failed.');
    } catch (err) {
      setError(err.response?.data?.message || 'Registration failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box component="form" onSubmit={submit} sx={{ maxWidth: 520, mx: 'auto' }}>
      <Typography variant="h5" sx={{ fontWeight: 700, mb: 2 }}>
        Register your channel partner organization
      </Typography>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      <Grid container spacing={2}>
        <Grid item xs={12}>
          <TextField fullWidth label="Firm name" value={form.orgName} onChange={set('orgName')} />
        </Grid>
        <Grid item xs={12} sm={6}>
          <TextField fullWidth select label="Category" value={form.category} onChange={set('category')}>
            {CATEGORIES.map((c) => <MenuItem key={c.value} value={c.value}>{c.label}</MenuItem>)}
          </TextField>
        </Grid>
        <Grid item xs={12} sm={6}>
          <TextField fullWidth label="RERA registration number"
            value={form.reraRegistrationNumber} onChange={set('reraRegistrationNumber')} />
        </Grid>
        <Grid item xs={12} sm={6}>
          <TextField fullWidth label="Country" value={form.country} onChange={set('country')} />
        </Grid>
        <Grid item xs={12} sm={6}>
          <TextField fullWidth label="City" value={form.city} onChange={set('city')} />
        </Grid>
        <Grid item xs={12} sm={6}>
          <TextField fullWidth label="Your first name" value={form.firstName} onChange={set('firstName')} />
        </Grid>
        <Grid item xs={12} sm={6}>
          <TextField fullWidth label="Your last name" value={form.lastName} onChange={set('lastName')} />
        </Grid>
        <Grid item xs={12}>
          <TextField fullWidth label="Email" type="email" value={form.email} onChange={set('email')} />
        </Grid>
        <Grid item xs={12}>
          <TextField fullWidth label="Password" type="password" value={form.password} onChange={set('password')} />
        </Grid>
      </Grid>
      <Button type="submit" fullWidth variant="contained" size="large" disabled={loading}
        startIcon={loading ? <CircularProgress size={20} color="inherit" /> : null} sx={{ mt: 3 }}>
        {loading ? 'Creating account…' : 'Create channel partner account'}
      </Button>
    </Box>
  );
};

export default ChannelPartnerRegisterPage;
```

> Confirm the `register` function's argument/return shape against the developer `RegisterPage.js` and `AuthContext.js` — it currently passes a registration object and returns `{ success, error, ... }`. The new `type`/`category`/`reraRegistrationNumber` fields are passed straight through to `authAPI.register`, which posts to `/auth/register`. If `register` whitelists fields, ensure the three new fields are forwarded.

- [ ] **Step 3: Wire the routes**

In `src/App.js`: the existing developer `RegisterPage` is at `/register` wrapped in `<AuthLayout>`. Change so:
- `/register` → `RegisterChoicePage`
- `/register/developer` → the existing `RegisterPage`
- `/register/channel-partner` → `ChannelPartnerRegisterPage`

All three inside `<PublicRoute><AuthLayout>...</AuthLayout></PublicRoute>`, matching the existing `/register` route's wrappers. Add lazy imports for the two new pages alongside the existing `RegisterPage` import.

- [ ] **Step 4: Verify the build**

Run: `CI=true npm run build`
Expected: `Compiled successfully.`

- [ ] **Step 5: Commit**

```bash
git add src/pages/auth/RegisterChoicePage.js src/pages/auth/ChannelPartnerRegisterPage.js src/App.js
git commit -m "feat(cp-platform): registration choice + CP registration page"
```

---

## Task 8: Frontend — ChannelPartnerLayout + CP routing

**Files:**
- Create: `src/components/layout/ChannelPartnerLayout.js`
- Modify: `src/App.js`

- [ ] **Step 1: Create `ChannelPartnerLayout`**

Create `src/components/layout/ChannelPartnerLayout.js` — a sidebar + top-bar shell for the CP portal. Read `src/components/layout/DashboardLayout.js` to match the AppBar/Drawer structure and styling; build a **simpler** version with a fixed CP nav (no permission-gated builder nav). The nav items:

```jsx
import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Box, Drawer, AppBar, Toolbar, Typography, List, ListItemButton, ListItemIcon,
  ListItemText, IconButton, Avatar, Menu, MenuItem,
} from '@mui/material';
import { Dashboard, Groups, Business, Logout, Menu as MenuIcon } from '@mui/icons-material';
import { useAuth } from '../../context/AuthContext';

const DRAWER_WIDTH = 248;
const NAV = [
  { label: 'Dashboard', icon: Dashboard, path: '/partner/dashboard' },
  { label: 'My Team', icon: Groups, path: '/partner/team' },
  { label: 'Organization Profile', icon: Business, path: '/partner/profile' },
];

const ChannelPartnerLayout = ({ children }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, organization, logout } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [anchorEl, setAnchorEl] = useState(null);

  const drawer = (
    <Box>
      <Toolbar>
        <Typography variant="h6" sx={{ fontWeight: 700 }}>PropVantage</Typography>
      </Toolbar>
      <Typography variant="caption" sx={{ px: 2, color: 'text.secondary' }}>
        {organization?.name}
      </Typography>
      <List sx={{ mt: 1 }}>
        {NAV.map((item) => (
          <ListItemButton key={item.path}
            selected={location.pathname === item.path}
            onClick={() => { navigate(item.path); setMobileOpen(false); }}>
            <ListItemIcon><item.icon /></ListItemIcon>
            <ListItemText primary={item.label} />
          </ListItemButton>
        ))}
      </List>
    </Box>
  );

  return (
    <Box sx={{ display: 'flex' }}>
      <AppBar position="fixed" sx={{ zIndex: (t) => t.zIndex.drawer + 1 }}>
        <Toolbar>
          <IconButton color="inherit" edge="start" onClick={() => setMobileOpen(!mobileOpen)}
            sx={{ mr: 2, display: { sm: 'none' } }}>
            <MenuIcon />
          </IconButton>
          <Typography variant="h6" sx={{ flexGrow: 1 }}>Channel Partner Portal</Typography>
          <IconButton onClick={(e) => setAnchorEl(e.currentTarget)} color="inherit">
            <Avatar sx={{ width: 32, height: 32 }}>
              {user?.firstName?.[0]}{user?.lastName?.[0]}
            </Avatar>
          </IconButton>
          <Menu anchorEl={anchorEl} open={!!anchorEl} onClose={() => setAnchorEl(null)}>
            <MenuItem onClick={() => { setAnchorEl(null); logout(); }}>
              <ListItemIcon><Logout fontSize="small" /></ListItemIcon> Sign out
            </MenuItem>
          </Menu>
        </Toolbar>
      </AppBar>
      <Box component="nav" sx={{ width: { sm: DRAWER_WIDTH }, flexShrink: { sm: 0 } }}>
        <Drawer variant="temporary" open={mobileOpen} onClose={() => setMobileOpen(false)}
          ModalProps={{ keepMounted: true }}
          sx={{ display: { xs: 'block', sm: 'none' },
            '& .MuiDrawer-paper': { width: DRAWER_WIDTH } }}>
          {drawer}
        </Drawer>
        <Drawer variant="permanent" open
          sx={{ display: { xs: 'none', sm: 'block' },
            '& .MuiDrawer-paper': { width: DRAWER_WIDTH } }}>
          {drawer}
        </Drawer>
      </Box>
      <Box component="main" sx={{ flexGrow: 1, p: 3, width: { sm: `calc(100% - ${DRAWER_WIDTH}px)` } }}>
        <Toolbar />
        {children}
      </Box>
    </Box>
  );
};

export default ChannelPartnerLayout;
```

> Confirm `logout` is exposed by `useAuth()` (it is used in `DashboardLayout.js`). Match the name.

- [ ] **Step 2: Add CP routes + org-type redirect in `src/App.js`**

Add lazy imports for `ChannelPartnerLayout` and the three CP pages (created in Tasks 9-11). Add a CP route group and an org-type redirect:

```jsx
// A CP-only route wrapper: authenticated AND org type is channel_partner.
const ChannelPartnerRoute = ({ children }) => {
  const { isAuthenticated, isLoading, isChannelPartnerOrg } = useAuth();
  if (isLoading) return <LoadingFallback message="Authenticating..." />;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (!isChannelPartnerOrg) return <Navigate to="/dashboard" replace />;
  return children;
};
```

Add the CP routes (each wrapped in `ChannelPartnerRoute` + `ChannelPartnerLayout`):
```jsx
<Route path="/partner/dashboard" element={
  <ChannelPartnerRoute><ChannelPartnerLayout>
    <Suspense fallback={<LoadingFallback />}><CpPortalDashboardPage /></Suspense>
  </ChannelPartnerLayout></ChannelPartnerRoute>
} />
<Route path="/partner/team" element={
  <ChannelPartnerRoute><ChannelPartnerLayout>
    <Suspense fallback={<LoadingFallback />}><CpPortalTeamPage /></Suspense>
  </ChannelPartnerLayout></ChannelPartnerRoute>
} />
<Route path="/partner/profile" element={
  <ChannelPartnerRoute><ChannelPartnerLayout>
    <Suspense fallback={<LoadingFallback />}><CpPortalProfilePage /></Suspense>
  </ChannelPartnerLayout></ChannelPartnerRoute>
} />
```

In the existing developer `/dashboard` route (and `DashboardRouter`), add a guard so a CP-org user is redirected out: at the top of `DashboardRouter` (or in the `ProtectedRoute` for `/dashboard`), `if (isChannelPartnerOrg) return <Navigate to="/partner/dashboard" replace />;`. Also make the post-login redirect org-type-aware — find where login success navigates (the `redirectTo` from `AuthContext.login`, used by `LoginPage`); if `isChannelPartnerOrg`, send to `/partner/dashboard`. Simplest: in `LoginPage`'s post-login navigation, branch on the returned `organization.type`.

- [ ] **Step 3: Verify the build**

Run: `CI=true npm run build`
Expected: `Compiled successfully.` (Tasks 9-11 create the three pages; if doing Task 8 before them, create empty placeholder components first OR sequence Task 8 after 9-11. Recommended: implement Tasks 9, 10, 11, then 8 — adjust order at execution. If 8 is done first, the build fails on missing imports, so do 8 last among the frontend tasks.)

- [ ] **Step 4: Commit**

```bash
git add src/components/layout/ChannelPartnerLayout.js src/App.js
git commit -m "feat(cp-platform): ChannelPartnerLayout + CP portal routing"
```

> **Execution note:** implement Tasks 9, 10, 11 before Task 8 so the CP page components exist when Task 8 imports them. The plan lists Task 8 here for narrative flow; the executor should reorder to 9 → 10 → 11 → 8.

---

## Task 9: Frontend — CP Dashboard page

**Files:**
- Create: `src/pages/cp-portal/CpPortalDashboardPage.js`

- [ ] **Step 1: Create the dashboard page**

An onboarding-checklist landing. Create `src/pages/cp-portal/CpPortalDashboardPage.js`:

```jsx
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, Typography, Card, CardContent, List, ListItem, ListItemIcon, ListItemText,
  Button, Chip,
} from '@mui/material';
import { CheckCircle, RadioButtonUnchecked, Lock } from '@mui/icons-material';
import { useAuth } from '../../context/AuthContext';
import { cpPortalAPI } from '../../services/api';

const CpPortalDashboardPage = () => {
  const navigate = useNavigate();
  const { user, organization } = useAuth();
  const [teamCount, setTeamCount] = useState(null);

  useEffect(() => {
    cpPortalAPI.getTeam()
      .then((res) => setTeamCount((res.data?.data || []).length))
      .catch(() => setTeamCount(null));
  }, []);

  const profileComplete = !!(organization?.city && organization?.contactInfo?.phone);
  const hasTeam = teamCount !== null && teamCount > 1;

  const steps = [
    { done: true, label: 'Create your channel partner account', action: null },
    { done: profileComplete, label: 'Complete your organization profile',
      action: () => navigate('/partner/profile') },
    { done: hasTeam, label: 'Invite your team', action: () => navigate('/partner/team') },
  ];

  return (
    <Box>
      <Typography variant="h5" sx={{ fontWeight: 700 }}>
        Welcome, {user?.firstName}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        {organization?.name} · let's finish setting up.
      </Typography>

      <Card variant="outlined" sx={{ mb: 2, maxWidth: 640 }}>
        <CardContent>
          <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
            Getting started
          </Typography>
          <List dense>
            {steps.map((s) => (
              <ListItem key={s.label}
                secondaryAction={s.action && !s.done
                  ? <Button size="small" onClick={s.action}>Do it</Button> : null}>
                <ListItemIcon>
                  {s.done ? <CheckCircle color="success" /> : <RadioButtonUnchecked color="disabled" />}
                </ListItemIcon>
                <ListItemText primary={s.label} />
              </ListItem>
            ))}
          </List>
        </CardContent>
      </Card>

      <Card variant="outlined" sx={{ maxWidth: 640, opacity: 0.7 }}>
        <CardContent>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Lock fontSize="small" color="disabled" />
            <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
              Find developers to partner with
            </Typography>
            <Chip label="Coming soon" size="small" />
          </Box>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            Discover real-estate developers, apply to partner with them, and start
            registering leads — arriving in an upcoming release.
          </Typography>
        </CardContent>
      </Card>
    </Box>
  );
};

export default CpPortalDashboardPage;
```

- [ ] **Step 2: Verify the build** — `CI=true npm run build` → `Compiled successfully.`

- [ ] **Step 3: Commit**

```bash
git add src/pages/cp-portal/CpPortalDashboardPage.js
git commit -m "feat(cp-platform): CP portal dashboard (onboarding checklist)"
```

---

## Task 10: Frontend — CP Team page

**Files:**
- Create: `src/pages/cp-portal/CpPortalTeamPage.js`

- [ ] **Step 1: Create the team page**

List members, invite (generates a share link), change role, deactivate. Create `src/pages/cp-portal/CpPortalTeamPage.js`:

```jsx
import React, { useEffect, useState, useCallback } from 'react';
import {
  Box, Typography, Table, TableHead, TableBody, TableRow, TableCell, Button, Chip,
  Dialog, DialogTitle, DialogContent, DialogActions, TextField, MenuItem, Alert,
  IconButton, Tooltip,
} from '@mui/material';
import { PersonAdd, Block, ContentCopy } from '@mui/icons-material';
import { cpPortalAPI } from '../../services/api';
import { useAuth } from '../../context/AuthContext';

const INVITE_ROLES = ['CP Manager', 'CP Agent'];

const CpPortalTeamPage = () => {
  const { user } = useAuth();
  const [team, setTeam] = useState([]);
  const [error, setError] = useState('');
  const [inviteOpen, setInviteOpen] = useState(false);
  const [invite, setInvite] = useState({ firstName: '', lastName: '', email: '', role: 'CP Agent' });
  const [inviteLink, setInviteLink] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    cpPortalAPI.getTeam()
      .then((res) => setTeam(res.data?.data || []))
      .catch(() => setError('Could not load your team.'));
  }, []);
  useEffect(() => { load(); }, [load]);

  const submitInvite = async () => {
    setBusy(true); setError(''); setInviteLink('');
    try {
      const res = await cpPortalAPI.inviteMember(invite);
      const link = res.data?.data?.invitationLink || res.data?.invitationLink || '';
      setInviteLink(link);
      load();
    } catch (err) {
      setError(err.response?.data?.message || 'Could not send the invite.');
    } finally {
      setBusy(false);
    }
  };

  const deactivate = async (userId) => {
    try { await cpPortalAPI.deactivateMember(userId); load(); }
    catch (err) { setError(err.response?.data?.message || 'Could not deactivate the member.'); }
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h5" sx={{ fontWeight: 700 }}>My Team</Typography>
        <Button variant="contained" startIcon={<PersonAdd />}
          onClick={() => { setInvite({ firstName: '', lastName: '', email: '', role: 'CP Agent' }); setInviteLink(''); setInviteOpen(true); }}>
          Invite member
        </Button>
      </Box>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <Table size="small">
        <TableHead><TableRow>
          <TableCell>Name</TableCell><TableCell>Email</TableCell><TableCell>Role</TableCell>
          <TableCell>Status</TableCell><TableCell align="right">Actions</TableCell>
        </TableRow></TableHead>
        <TableBody>
          {team.map((m) => (
            <TableRow key={m._id}>
              <TableCell>{m.firstName} {m.lastName}</TableCell>
              <TableCell>{m.email}</TableCell>
              <TableCell>{m.roleRef?.name || '—'}</TableCell>
              <TableCell>
                <Chip size="small"
                  label={m.invitationStatus === 'pending' ? 'Invited' : (m.isActive ? 'Active' : 'Inactive')}
                  color={m.invitationStatus === 'pending' ? 'warning' : (m.isActive ? 'success' : 'default')} />
              </TableCell>
              <TableCell align="right">
                {!m.roleRef?.isOwnerRole && m.isActive && String(m._id) !== String(user?._id) && (
                  <Tooltip title="Deactivate">
                    <IconButton size="small" onClick={() => deactivate(m._id)}><Block fontSize="small" /></IconButton>
                  </Tooltip>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <Dialog open={inviteOpen} onClose={() => setInviteOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>Invite a team member</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
          {inviteLink ? (
            <Alert severity="success">
              Invite created. Share this link with the new member:
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1 }}>
                <TextField fullWidth size="small" value={inviteLink} InputProps={{ readOnly: true }} />
                <IconButton onClick={() => navigator.clipboard?.writeText(inviteLink)}>
                  <ContentCopy fontSize="small" />
                </IconButton>
              </Box>
            </Alert>
          ) : (
            <>
              <TextField label="First name" value={invite.firstName}
                onChange={(e) => setInvite((i) => ({ ...i, firstName: e.target.value }))} />
              <TextField label="Last name" value={invite.lastName}
                onChange={(e) => setInvite((i) => ({ ...i, lastName: e.target.value }))} />
              <TextField label="Email" type="email" value={invite.email}
                onChange={(e) => setInvite((i) => ({ ...i, email: e.target.value }))} />
              <TextField select label="Role" value={invite.role}
                onChange={(e) => setInvite((i) => ({ ...i, role: e.target.value }))}>
                {INVITE_ROLES.map((r) => <MenuItem key={r} value={r}>{r}</MenuItem>)}
              </TextField>
            </>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setInviteOpen(false)}>Close</Button>
          {!inviteLink && (
            <Button variant="contained" onClick={submitInvite} disabled={busy}>
              {busy ? 'Creating…' : 'Create invite link'}
            </Button>
          )}
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default CpPortalTeamPage;
```

> The invite reuses the backend `generateInvitationLink`, which returns an invitation link. Confirm the response field name (`invitationLink`) against `invitationController.js`'s response and adjust the `res.data?.data?.invitationLink` access if the shape differs. SP1 keeps role-change UI minimal (deactivate only); the `changeMemberRole` endpoint exists for later use.

- [ ] **Step 2: Verify the build** — `CI=true npm run build` → `Compiled successfully.`

- [ ] **Step 3: Commit**

```bash
git add src/pages/cp-portal/CpPortalTeamPage.js
git commit -m "feat(cp-platform): CP portal team management page"
```

---

## Task 11: Frontend — CP Organization Profile page

**Files:**
- Create: `src/pages/cp-portal/CpPortalProfilePage.js`

- [ ] **Step 1: Create the profile page**

Create `src/pages/cp-portal/CpPortalProfilePage.js`:

```jsx
import React, { useEffect, useState } from 'react';
import {
  Box, Typography, TextField, MenuItem, Button, Grid, Alert, CircularProgress,
} from '@mui/material';
import { cpPortalAPI } from '../../services/api';

const CATEGORIES = [
  { value: 'individual_agent', label: 'Individual Agent' },
  { value: 'broker_firm', label: 'Broker Firm' },
  { value: 'corporate', label: 'Corporate' },
  { value: 'digital_aggregator', label: 'Digital Aggregator' },
];

const CpPortalProfilePage = () => {
  const [org, setOrg] = useState(null);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    cpPortalAPI.getOrgProfile()
      .then((res) => setOrg(res.data?.data || null))
      .catch(() => setError('Could not load your organization profile.'));
  }, []);

  const setField = (k) => (e) => setOrg((o) => ({ ...o, [k]: e.target.value }));
  const setContact = (k) => (e) =>
    setOrg((o) => ({ ...o, contactInfo: { ...(o.contactInfo || {}), [k]: e.target.value } }));

  const save = async () => {
    setSaving(true); setError(''); setOk('');
    try {
      const res = await cpPortalAPI.updateOrgProfile({
        name: org.name, category: org.category, country: org.country, city: org.city,
        contactInfo: org.contactInfo,
      });
      setOrg(res.data?.data || org);
      setOk('Profile saved.');
    } catch (err) {
      setError(err.response?.data?.message || 'Could not save the profile.');
    } finally {
      setSaving(false);
    }
  };

  if (!org) {
    return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
      {error ? <Alert severity="error">{error}</Alert> : <CircularProgress />}
    </Box>;
  }

  return (
    <Box sx={{ maxWidth: 640 }}>
      <Typography variant="h5" sx={{ fontWeight: 700, mb: 2 }}>Organization Profile</Typography>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {ok && <Alert severity="success" sx={{ mb: 2 }}>{ok}</Alert>}
      <Grid container spacing={2}>
        <Grid item xs={12}>
          <TextField fullWidth label="Firm name" value={org.name || ''} onChange={setField('name')} />
        </Grid>
        <Grid item xs={12} sm={6}>
          <TextField fullWidth select label="Category" value={org.category || ''} onChange={setField('category')}>
            {CATEGORIES.map((c) => <MenuItem key={c.value} value={c.value}>{c.label}</MenuItem>)}
          </TextField>
        </Grid>
        <Grid item xs={12} sm={6}>
          <TextField fullWidth label="RERA registration number"
            value={org.reraRegistrationNumber || ''} InputProps={{ readOnly: true }}
            helperText="Set at registration — contact support to change." />
        </Grid>
        <Grid item xs={12} sm={6}>
          <TextField fullWidth label="Country" value={org.country || ''} onChange={setField('country')} />
        </Grid>
        <Grid item xs={12} sm={6}>
          <TextField fullWidth label="City" value={org.city || ''} onChange={setField('city')} />
        </Grid>
        <Grid item xs={12} sm={6}>
          <TextField fullWidth label="Phone" value={org.contactInfo?.phone || ''} onChange={setContact('phone')} />
        </Grid>
        <Grid item xs={12} sm={6}>
          <TextField fullWidth label="Website" value={org.contactInfo?.website || ''} onChange={setContact('website')} />
        </Grid>
        <Grid item xs={12}>
          <TextField fullWidth label="Address" value={org.contactInfo?.address || ''} onChange={setContact('address')} />
        </Grid>
      </Grid>
      <Button variant="contained" sx={{ mt: 3 }} onClick={save} disabled={saving}>
        {saving ? 'Saving…' : 'Save profile'}
      </Button>
    </Box>
  );
};

export default CpPortalProfilePage;
```

- [ ] **Step 2: Verify the build** — `CI=true npm run build` → `Compiled successfully.`

- [ ] **Step 3: Commit**

```bash
git add src/pages/cp-portal/CpPortalProfilePage.js
git commit -m "feat(cp-platform): CP portal organization profile page"
```

---

## Task 12: Manual verification

**No files changed.** Confirm SP1 end-to-end (needs both apps running).

- [ ] **Step 1** — Open `/register`; confirm the two-card choice; pick "Channel Partner"; register with a firm name, category, RERA number, owner details. Confirm you land on `/partner/dashboard` in the CP shell.
- [ ] **Step 2** — Try registering a second CP with the **same RERA number** → rejected with the duplicate message. Try with a blank RERA → rejected.
- [ ] **Step 3** — In the CP portal: open Organization Profile, edit and save; confirm RERA is read-only.
- [ ] **Step 4** — Open My Team; invite a CP Manager and a CP Agent; copy each invite link; open it in a fresh session; accept + set a password; confirm the invited user logs into the **CP shell** with the right role.
- [ ] **Step 5** — Deactivate the Agent; confirm the CP Owner row has no deactivate action.
- [ ] **Step 6** — Log in as an existing **developer** account; confirm it still lands in the developer shell (regression). Confirm a developer user visiting `/partner/dashboard` is redirected to `/dashboard`, and a CP user visiting `/dashboard` is redirected to `/partner/dashboard`.

---

## Notes for the executor

- **Frontend task order:** implement Tasks 9, 10, 11 before Task 8 (Task 8's routing imports the three CP pages). The plan numbers them 8→11 for narrative flow only.
- **`requireOrgType` rationale** (Task 3): `hasPermission`'s `isOwner` bypass means the `cp_*` gate alone would let a developer Org Owner into CP routes; `requireOrgType` is the non-bypassable guard. The reverse direction (a CP user calling a developer API) is benign — developer endpoints are `organization`-scoped, so a CP org simply sees its own (empty) data, never another tenant's.
- **Spec deviation — none material.** The spec said CP Owner has `isOwnerRole: true`; this plan keeps that (so `registerUser`'s owner-assignment works unchanged) and relies on `requireOrgType` for isolation rather than the permission gate.
- **Test approach:** backend uses the repo's regression-suite pattern (live-server smoke tests), not unit tests — consistent with the existing `tests/regression/suites/`.
- **Do not push.** All tasks commit locally; deploying is a separate, user-authorized step.
