# Channel Partner Platform — SP4: Cross-Org Lead Lifecycle & Standalone CP Workspace

**Date:** 2026-05-21
**Status:** Approved for planning
**Repos:** `propvantage-ai-backend` (Node/Express/MongoDB/Mongoose), `propvantage-ai-frontend` (React 18 + MUI v5 + React Router v6)

---

## 1. Context

PropVantage AI is becoming a two-sided platform (developers ⇄ channel partners). This is
**SP4** of the six-sub-project roadmap defined in
`2026-05-21-channel-partner-platform-sp1-design.md` (§2–§3). SP1 (CP orgs +
onboarding), SP2 (developer portfolio), and SP3 (marketplace + partnership lifecycle)
are shipped. SP4 is the first sub-project that makes a partnership *do* something —
and is the largest of the six.

**SP4 — Cross-Org Lead Lifecycle & Standalone CP Workspace.** SP4 builds:
1. **Cross-org lead lifecycle** — when both parties are on the platform, a CP submits
   leads to a developer through an active Partnership; the developer reviews and
   accepts/rejects; the CP can log activities and propose status changes; the
   developer-side commission engine attributes back to the CP.
2. **Standalone CP workspace** — a CP can use the platform end-to-end (prospect
   tracking, agent assignment, activity logging, manual commission tracking) even
   when the developer they work with is **not** on the platform. Off-platform
   developers are first-class entities the CP tracks locally.
3. **Backward-compatible late onboarding** — either party can join the platform
   later (via an invitation link). Historical records get correctly re-tagged and
   the relationship converts from independent to collaborative.

SP4 ends at: a partnered CP can run their full sales workflow against developers
on or off the platform, push leads to on-platform developers under a partnership,
and track commission either through the developer-side official engine (when the
developer is on-platform) or via a manual ledger on the CP side (when the developer
is off-platform).

This spec is **self-contained**: an engineer implementing this from a fresh
context can build SP4 with only this document + the existing codebase. Cross-
references to SP1/SP2/SP3 specs are pointers to background context, not
implementation details that must be re-read.

## 2. Decisions Locked (during brainstorming)

| Decision | Choice |
|---|---|
| Sub-project decomposition | One big SP4 (NOT SP4a/SP4b) — user explicit |
| CP-submitted leads | Pending-review queue (dev staff accepts/rejects) |
| CP control on accepted leads | View + log activities + propose status changes (dev accepts/rejects proposal) |
| Duplicate detection | Soft-flag — warn reviewer, dev decides |
| Standalone CP workspace | Mandatory in SP4 — CP can operate end-to-end without the developer being on-platform |
| Off-platform developer tracking | Dedicated `ExternalDeveloper` model in CP org |
| Late-onboarding flow | Either party can invite the other; on registration with a valid invite token, partnership is created and historical records re-tagged |
| Commission tracking | Manual ledger on the CP side via Prospect (commissionAgreement + booking + payments); developer-side official `CommissionRecord` engine unchanged |
| Architecture | Approach A — separate `Prospect` (CP-side) and `Lead` (dev-side) models, linked via `Lead.sourceProspect` when pushed |
| Notifications | Reuse existing in-app `/api/notifications` system; no email/SMS |
| Permissions | New `cp_prospects:*` and `cp_external_developers:*` on CP side; reuse existing `leads:*` on developer side |

## 3. Data Model

### 3.1 New model — `Prospect` (CP-side)

Create `models/prospectModel.js`. The Prospect lives in a CP org and represents a
person the CP is working with, regardless of whether the developer is on or off
platform.

```js
{
  organization: { type: ObjectId, ref: 'Organization', required: true, index: true },
  // Must be a CP org (validated in schema pre-save by checking org.type === 'channel_partner').

  firstName: { type: String, required: true, trim: true },
  lastName:  { type: String, trim: true },
  email:     { type: String, trim: true, lowercase: true },
  phone:     { type: String, required: true, trim: true },

  developerContext: {
    type: { type: String, enum: ['external', 'platform'], required: true },
    externalDeveloper: { type: ObjectId, ref: 'ExternalDeveloper' }, // when type='external'
    partnership:       { type: ObjectId, ref: 'Partnership' },        // when type='platform'
  },

  project: {
    external: { name: String, location: String, type: String }, // when developerContext.type='external'
    platform: { type: ObjectId, ref: 'Project' },               // when developerContext.type='platform'
  },

  assignedAgent: { type: ObjectId, ref: 'User', required: true, index: true },
  // Must be a User in the same CP org.

  status: {
    type: String,
    enum: ['New', 'Contacted', 'Qualified', 'Site Visit Scheduled',
           'Site Visit Completed', 'Negotiating', 'Booked', 'Lost', 'Unqualified'],
    default: 'New',
    index: true,
  },

  priority: { type: String, enum: ['Low', 'Medium', 'High'], default: 'Medium' },
  budget:   { min: Number, max: Number, currency: { type: String, default: 'INR' } },
  requirements: { type: String, trim: true },
  notes:    { type: String, trim: true },

  activities: [{
    type:  { type: String, enum: ['call','site_visit','note','follow_up_scheduled','status_change','system'], required: true },
    note:  { type: String, trim: true },
    at:    { type: Date, default: Date.now },
    by:    { type: ObjectId, ref: 'User' }, // null for system activities
  }],

  followUp: {
    nextDate: Date,
    type: { type: String, enum: ['call','site_visit','meeting','other'] },
    note: String,
  },

  // Set when the Prospect is pushed to an on-platform developer as a Lead.
  pushedToLead: { type: ObjectId, ref: 'Lead', default: null, index: { sparse: true } },
  pushedAt:     { type: Date, default: null },
  pushedBy:     { type: ObjectId, ref: 'User', default: null },

  // Manual commission tracking (works regardless of developer being on/off platform).
  commissionAgreement: {
    type:     { type: String, enum: ['percentage', 'flat'] },
    value:    Number,          // % when type='percentage', currency amount when type='flat'
    currency: { type: String, default: 'INR' },
    notes:    String,
  },

  booking: {
    bookedAt:  Date,
    unitInfo:  String,         // free text, e.g. "3BHK Tower A Unit 1204"
    salePrice: Number,
    currency:  { type: String, default: 'INR' },
    notes:     String,
  },

  commission: {
    expectedAmount: Number,    // auto from agreement+booking for %, manual for flat
    status: { type: String, enum: ['pending','partially_paid','paid','written_off'], default: 'pending' },
    payments: [{
      amount:          { type: Number, required: true },
      receivedAt:      { type: Date, required: true },
      method:          { type: String, enum: ['bank_transfer','cheque','cash','upi','other'] },
      referenceNumber: String,
      notes:           String,
      recordedBy:      { type: ObjectId, ref: 'User', required: true },
      recordedAt:      { type: Date, default: Date.now },
    }],
    writeOffReason: String,    // required when status='written_off'
  },
}
```

**Indexes:**
- `{ organization: 1, status: 1 }`
- `{ organization: 1, assignedAgent: 1 }`
- `{ pushedToLead: 1 }` (sparse)
- `{ 'developerContext.externalDeveloper': 1 }` (sparse)
- `{ 'developerContext.partnership': 1 }` (sparse)

**Validation rules (pre-save):**
- If `developerContext.type === 'external'`: `developerContext.externalDeveloper` required.
- If `developerContext.type === 'platform'`: `developerContext.partnership` AND `project.platform` required; partnership must be `active` AND `channelPartnerOrg === organization`.
- `commission.payments` is append-only (no UI/API to delete a payment in SP4).
- `commission.status='written_off'` requires `commission.writeOffReason`.

**Auto-calc helper (in the service layer, not schema):**
- When `commissionAgreement.type==='percentage'` AND `booking.salePrice` set: `commission.expectedAmount = booking.salePrice * (commissionAgreement.value / 100)`.
- When `commissionAgreement.type==='flat'`: `commission.expectedAmount = commissionAgreement.value`.
- Recompute on every update of `commissionAgreement` or `booking`.
- `commission.status` auto-derives from `expectedAmount` vs sum(payments): 0 paid = `pending`, partial = `partially_paid`, ≥ expected = `paid`. Never auto-set `written_off` — that requires explicit action.

### 3.2 New model — `ExternalDeveloper` (CP-side)

Create `models/externalDeveloperModel.js`. Tracks off-platform developers the CP
works with. Lives in the CP org.

```js
{
  organization: { type: ObjectId, ref: 'Organization', required: true, index: true },
  // Must be a CP org.

  name:        { type: String, required: true, trim: true },
  description: { type: String, trim: true },

  contact: {
    person: String,
    email:  { type: String, trim: true, lowercase: true },
    phone:  String,
  },
  address: String,
  city:    { type: String, trim: true, index: true },

  projects: [{
    name:     { type: String, required: true },
    location: String,
    type:     String,    // free text e.g. 'Residential', 'Commercial'
    notes:    String,
  }],

  invite: {
    token:      { type: String, sparse: true, unique: true }, // 64-char hex
    email:      String,
    invitedAt:  Date,
    invitedBy:  { type: ObjectId, ref: 'User' },
    expiresAt:  Date,   // 90 days from invitedAt
  },

  claimedByOrg: { type: ObjectId, ref: 'Organization', default: null },
  claimedAt:    { type: Date, default: null },
}
```

**Indexes:**
- `{ organization: 1 }`
- `{ 'invite.token': 1 }` (sparse, unique)
- `{ claimedByOrg: 1 }` (sparse)

### 3.3 `Lead` additions (developer-side)

Modify `models/leadModel.js`:

```js
// Top-level additions
sourceProspect: { type: ObjectId, ref: 'Prospect', default: null, index: { sparse: true } },

proposedStatusChange: {
  status:     { type: String /* same enum as Lead.status */ },
  proposedBy: { type: ObjectId, ref: 'User' },  // CP agent's User
  proposedAt: Date,
  note:       String,
  // Null when no pending proposal. Cleared when accepted/rejected.
},

// Inside channelPartnerAttribution.partners[]:
agentUser: { type: ObjectId, ref: 'User' },
// New field — references the CP-side User who originated the lead.
// Coexists with the legacy `agent` (ChannelPartnerAgent ref) for backward compatibility.
// agentUser is used by partnerAccessScope() to narrow CP Agents to their own leads.
```

**Pending submissions live as regular Leads with `status: 'pending'`** (the dev-side
Lead status enum already supports pending-style states; if not, add `'pending'` to
the enum). The lead is created immediately on push but is filtered from normal
lead views by status until accepted (becomes 'New').

### 3.4 `Notification` additions

Modify `models/notificationModel.js`:

**Add to `NOTIFICATION_TYPES` enum:**
- `lead_registration_received` (to developer leadership)
- `lead_registration_accepted` (to CP agent + CP leadership)
- `lead_registration_rejected` (to CP agent + CP leadership)
- `cp_lead_status_changed` (to CP agent + CP leadership)
- `lead_status_proposed` (to developer lead owner)
- `lead_status_proposal_accepted` (to CP agent)
- `lead_status_proposal_rejected` (to CP agent)
- `external_developer_claimed` (to CP that invited)

**Add to `RELATED_ENTITY_TYPES` enum:** `Prospect`, `ExternalDeveloper`.

### 3.5 Permissions

Modify `config/permissions.js` — add to the CP permission group:
```js
CP_PROSPECTS: {
  VIEW:   'cp_prospects:view',
  MANAGE: 'cp_prospects:manage',
},
CP_EXTERNAL_DEVELOPERS: {
  MANAGE: 'cp_external_developers:manage',
},
```

Modify `data/defaultCpRoles.js` (the seeded CP role definitions):
- **CP Owner** — already gets all via `ALL_CP_PERMISSIONS` (no change required, just verify).
- **CP Manager** — add `cp_prospects:view`, `cp_prospects:manage`, `cp_external_developers:manage`.
- **CP Agent** — add `cp_prospects:view`, `cp_prospects:manage` (NOT `cp_external_developers:manage`).

Developer side: **no new permissions.** All developer-side endpoints in SP4 reuse
existing `leads:read` / `leads:update`. The Lead Registrations queue is gated by
`leads:read`; accept/reject/proposal-decisions by `leads:update`.

**Backfill script** `data/backfillSp4CpPermissions.js`: iterate all existing CP-org
Role documents, add the new perms to CP Manager / CP Agent role names per the
matrix above. Idempotent (skip if already present). Pattern: see existing
`data/backfill*.js` scripts.

## 4. Backend

### 4.1 Services

**Create `services/prospectService.js`** with:

| Function | Notes |
|---|---|
| `createProspect(data, user)` | Validates context per §3.1 rules; if `developerContext.type==='platform'` verifies partnership is active and belongs to caller's CP org. |
| `updateProspect(id, data, user)` | Org-scoped; CP Agent restricted to own prospects (`assignedAgent === user._id`). Cannot change `pushedToLead`, `pushedAt`, `pushedBy` directly. Recomputes commission on agreement/booking change. |
| `deleteProspect(id, user)` | Blocked when `pushedToLead` is set. Org-scoped + agent-scoped. |
| `addActivity(id, activityData, user)` | Appends to `activities`; sets `by: user._id` and `at: now`. |
| `pushProspectToDeveloper(prospectId, user)` | Requires `developerContext.type==='platform'`, partnership active, `pushedToLead` null. Creates a Lead with: project from `project.platform`, attribution `{partners:[{channelPartner: <reconciled ChannelPartner._id>, agentUser: prospect.assignedAgent, status: 'pending'}], status: 'pending'}`, status `'pending'`, `sourceProspect: prospect._id`. Sets prospect's `pushedToLead/pushedAt/pushedBy`, adds an activity entry. Fires `lead_registration_received` notification. |
| `proposeStatusChange(prospectId, status, note, user)` | Requires `pushedToLead` set, lead exists & not already at that status. 409 if `lead.proposedStatusChange` is non-null. Sets `lead.proposedStatusChange = {status, proposedBy: user._id, proposedAt: now, note}`. Fires `lead_status_proposed` notification. |
| `recordBooking(id, bookingData, user)` | Sets `booking`; recomputes `commission.expectedAmount`. |
| `addCommissionPayment(id, paymentData, user)` | Appends to `commission.payments`; recomputes `commission.status`. |
| `updateCommission(id, data, user)` | Updates `commissionAgreement` (recomputes expected) or explicit `status` (only write-off transitions, requires `writeOffReason` and CP Manager/Owner perm). |

**Create `utils/partnerAccessHelper.js`** — the security-critical scoping helper.

```js
// Returns a Mongo filter object to AND with Lead queries, scoping a CP user
// to only the leads they should see (across all their active partnerships).
// For non-CP users (developer-side), returns null — caller skips the AND.
async function partnerAccessScope(req) {
  const user = req.user;
  const org  = req.organization; // already loaded by middleware
  if (org.type !== 'channel_partner') return null;

  // 1. Active partnerships for this CP org → developer orgs.
  const partnerships = await Partnership.find({
    channelPartnerOrg: org._id,
    status: 'active',
  }).select('developerOrg').lean();
  const devOrgIds = partnerships.map(p => p.developerOrg);
  if (devOrgIds.length === 0) {
    return { _id: { $in: [] } }; // returns nothing
  }

  // 2. ChannelPartner records in those dev orgs that point back at this CP org.
  const cpRecords = await ChannelPartner.find({
    organization: { $in: devOrgIds },
    channelPartnerOrg: org._id,
  }).select('_id').lean();
  const cpRecordIds = cpRecords.map(c => c._id);

  // 3. Base scope: leads attributed to those ChannelPartner records.
  const filter = {
    'channelPartnerAttribution.partners.channelPartner': { $in: cpRecordIds },
  };

  // 4. Narrow CP Agents to their own attribution.
  const isCpAgent = user.role === 'CP Agent'; // or check perms — pick whichever pattern the codebase uses
  if (isCpAgent) {
    filter['channelPartnerAttribution.partners.agentUser'] = user._id;
  }
  return filter;
}

module.exports = { partnerAccessScope };
```

This helper is the single source of truth for "what cross-org leads can this CP
user see/edit?" Any new CP-facing lead endpoint MUST AND its query with the
result.

**Create `services/externalDeveloperService.js`** with:

| Function | Notes |
|---|---|
| `createExternalDeveloper(data, user)` | Org-scoped; CP Manager/Owner only. |
| `updateExternalDeveloper(id, data, user)` | Org-scoped. Blocked when `claimedByOrg` set. |
| `deleteExternalDeveloper(id, user)` | Blocked when linked to any Prospect OR claimed. |
| `inviteExternalDeveloper(id, email, user)` | Generates a 64-char hex token via `crypto.randomBytes(32).toString('hex')`. Sets `invite = {token, email, invitedAt: now, invitedBy: user._id, expiresAt: now+90d}`. Returns the invite URL (frontend constructs full URL using `process.env.FRONTEND_URL`). |
| `getInviteByToken(token)` | Returns `{externalDeveloper, valid: bool, reason}`. valid=false if expired or claimed. |
| `claimExternalDeveloper(token, newOrgId, user)` | Transaction (or sequenced ops): (a) verify token valid + not claimed; (b) set `claimedByOrg = newOrgId, claimedAt = now`; (c) create Partnership(`developerOrg=newOrgId, channelPartnerOrg=externalDeveloper.organization, status='active', initiatedBy='channel_partner', requestedAt=externalDeveloper.invite.invitedAt, decidedAt=now, history:[claim-event]`); (d) run SP3's reconciliation to create the dev-side `ChannelPartner` record with `channelPartnerOrg` set; (e) update all Prospects in this CP org where `developerContext.externalDeveloper === externalDeveloper._id`: set `developerContext.type='platform'`, `developerContext.partnership=<new partnership._id>`, clear `developerContext.externalDeveloper`; add a system activity "Developer joined the platform"; (f) fire `external_developer_claimed` notification to CP leadership. |

### 4.2 Controllers & routes

**Create `controllers/prospectController.js`** + `routes/prospectRoutes.js` mounted at `/api/cp/prospects`.

All routes: `protect` + `requireOrgType('channel_partner')` + the listed permission.

| Method | Path | Permission | Handler |
|---|---|---|---|
| GET | `/api/cp/prospects` | `cp_prospects:view` | List with filters (status, assignedAgent, developerContext.type, priority, search). CP Agent auto-scoped to own. |
| POST | `/api/cp/prospects` | `cp_prospects:manage` | Create. |
| GET | `/api/cp/prospects/:id` | `cp_prospects:view` | Get one. CP Agent: own only → else 404. |
| PUT | `/api/cp/prospects/:id` | `cp_prospects:manage` | Update. |
| DELETE | `/api/cp/prospects/:id` | `cp_prospects:manage` | Delete (blocked if pushed). |
| POST | `/api/cp/prospects/:id/activities` | `cp_prospects:manage` | Add activity. |
| POST | `/api/cp/prospects/:id/push` | `cp_prospects:manage` | Push to developer. |
| POST | `/api/cp/prospects/:id/propose-status` | `cp_prospects:manage` | Propose status change. Body: `{status, note}`. |
| POST | `/api/cp/prospects/:id/booking` | `cp_prospects:manage` | Set booking. Body: booking fields. |
| POST | `/api/cp/prospects/:id/commission/payments` | `cp_prospects:manage` | Append payment. Body: payment fields. |
| PUT | `/api/cp/prospects/:id/commission` | `cp_prospects:manage` | Update agreement or status (write-off requires Manager/Owner). |

**Create `controllers/externalDeveloperController.js`** + `routes/externalDeveloperRoutes.js` mounted at `/api/cp/external-developers`.

All routes: `protect` + `requireOrgType('channel_partner')` + `cp_external_developers:manage`.

| Method | Path | Handler |
|---|---|---|
| GET | `/api/cp/external-developers` | List org's external developers. |
| POST | `/api/cp/external-developers` | Create. |
| GET | `/api/cp/external-developers/:id` | Get one. |
| PUT | `/api/cp/external-developers/:id` | Update. |
| DELETE | `/api/cp/external-developers/:id` | Delete. |
| POST | `/api/cp/external-developers/:id/invite` | Generate invite token. Body: `{email}`. |

**Public invite lookup** — `routes/externalDeveloperInviteRoutes.js` mounted at `/api/external-developer-invites`, NO auth:

| Method | Path | Handler |
|---|---|---|
| GET | `/api/external-developer-invites/:token` | `getInviteByToken` — returns `{name, contact, city, projects, invitedByOrgName, valid, reason}` for pre-fill, or `410 Gone` if claimed/expired. |

**Developer-side lead endpoints** — modify `controllers/leadController.js` + `routes/leadRoutes.js`:

| Method | Path | Permission | Handler |
|---|---|---|---|
| GET | `/api/leads/registrations` | `leads:read` | List leads where `status === 'pending'` and `sourceProspect != null`. Org-scoped to caller's developer org. Returns each lead enriched with: CP org name, agent name, duplicate-match (search existing non-pending Leads where same project + (email OR phone) match within last 60 days; soft-flag with the matching lead's `_id` + `firstName`). |
| PATCH | `/api/leads/:id/registration` | `leads:update` | Body: `{action: 'accept'|'reject', note?}`. Accept: `status='New'`, fires `lead_registration_accepted`. Reject: keep lead with `status='Lost'` and a status-change history entry `{from:'pending', to:'Lost', reason: 'Registration rejected: <note>'}`, fires `lead_registration_rejected`. |
| PATCH | `/api/leads/:id/proposal` | `leads:update` | Body: `{action: 'accept'|'reject', note?}`. Requires `lead.proposedStatusChange` non-null. Accept: applies the proposed status, adds history entry, clears `proposedStatusChange`, fires `lead_status_proposal_accepted`. Reject: clears `proposedStatusChange`, adds history entry, fires `lead_status_proposal_rejected`. |

**`getLeads` (existing) — modification:** AND `await partnerAccessScope(req)` into the
query when caller is a CP user. By default exclude `status: 'pending'` from normal
lead lists (those only show via `/api/leads/registrations`). When CP queries their
own leads, they DO see pending ones (so the CP can see their submission queue too).

**`getLeadById` (existing) — modification:** also AND `partnerAccessScope(req)` for
CP users; if the lead doesn't match the scope, return 404.

### 4.3 Registration extension

Modify `controllers/authController.js → registerUser`:

```js
// After successful org + user creation, before sending response:
if (req.body.externalDeveloperInviteToken && newOrg.type === 'builder') {
  try {
    await claimExternalDeveloper(
      req.body.externalDeveloperInviteToken,
      newOrg._id,
      newUser
    );
  } catch (err) {
    // Don't fail registration. Log + attach warning.
    response.claimWarning = err.message;
  }
}
```

### 4.4 Notifications fan-out

Use the existing `services/notificationService.js → createNotification` helper.
Recipients are users in the named org with the named permission (the service has
a `notifyUsersWithPermission` pattern — reuse it).

| Trigger | Type | Recipients |
|---|---|---|
| `pushProspectToDeveloper` succeeds | `lead_registration_received` | Developer-org users with `leads:update` |
| Dev accepts registration | `lead_registration_accepted` | The CP agent (the `agentUser`) + CP Manager/Owner |
| Dev rejects registration | `lead_registration_rejected` | The CP agent + CP Manager/Owner |
| Dev changes status of a CP-attributed lead | `cp_lead_status_changed` | The CP agent + CP Manager/Owner |
| CP proposes status change | `lead_status_proposed` | The lead's `assignedTo` (dev side) + dev Manager/Owner of the project |
| Dev accepts proposal | `lead_status_proposal_accepted` | The CP agent |
| Dev rejects proposal | `lead_status_proposal_rejected` | The CP agent |
| `claimExternalDeveloper` succeeds | `external_developer_claimed` | CP Manager/Owner of the inviting CP org |

### 4.5 App wiring

Modify `app.js` (or whichever entrypoint mounts routes):
```js
app.use('/api/cp/prospects', require('./routes/prospectRoutes'));
app.use('/api/cp/external-developers', require('./routes/externalDeveloperRoutes'));
app.use('/api/external-developer-invites', require('./routes/externalDeveloperInviteRoutes'));
```

## 5. Frontend

### 5.1 API client

Modify `src/services/api.js` — add:

```js
export const cpProspectsAPI = {
  list:           (params) => api.get('/cp/prospects', { params }),
  get:            (id)     => api.get(`/cp/prospects/${id}`),
  create:         (data)   => api.post('/cp/prospects', data),
  update:         (id, d)  => api.put(`/cp/prospects/${id}`, d),
  delete:         (id)     => api.delete(`/cp/prospects/${id}`),
  addActivity:    (id, d)  => api.post(`/cp/prospects/${id}/activities`, d),
  push:           (id)     => api.post(`/cp/prospects/${id}/push`),
  proposeStatus:  (id, d)  => api.post(`/cp/prospects/${id}/propose-status`, d),
  recordBooking:  (id, d)  => api.post(`/cp/prospects/${id}/booking`, d),
  addPayment:     (id, d)  => api.post(`/cp/prospects/${id}/commission/payments`, d),
  updateCommission:(id, d) => api.put(`/cp/prospects/${id}/commission`, d),
};

export const cpExternalDevelopersAPI = {
  list:   ()         => api.get('/cp/external-developers'),
  get:    (id)       => api.get(`/cp/external-developers/${id}`),
  create: (data)     => api.post('/cp/external-developers', data),
  update: (id, d)    => api.put(`/cp/external-developers/${id}`, d),
  delete: (id)       => api.delete(`/cp/external-developers/${id}`),
  invite: (id, d)    => api.post(`/cp/external-developers/${id}/invite`, d),
};

export const externalDeveloperInviteAPI = {
  // Public (no auth) — used by the registration page.
  lookup: (token) => api.get(`/external-developer-invites/${token}`),
};

export const leadRegistrationsAPI = {
  list:        ()              => api.get('/leads/registrations'),
  decide:      (id, data)      => api.patch(`/leads/${id}/registration`, data),
  decideProp:  (id, data)      => api.patch(`/leads/${id}/proposal`, data),
};
```

### 5.2 CP portal — navigation

Modify the CP portal app shell (the `requireOrgType('channel_partner')` layout):

- New top-level "Prospects" nav item (icon: `PersonSearch`), route `/partner/prospects`, gated `cp_prospects:view`.
- New nav item "Off-Platform Developers" under the existing "Marketplace" group, route `/partner/external-developers`, gated `cp_external_developers:manage`.

### 5.3 CP portal — Prospects list page

**Create `src/pages/partner/ProspectsListPage.jsx`**:

- Header: "Prospects" + "+ New Prospect" button (Manager/Owner sees agent picker in dialog; Agent's prospects are auto-assigned to self).
- Filter bar: Status (multi-select), Assigned Agent (Manager/Owner only), Developer Context (All / Platform / External), Priority, Search (name/phone/email).
- DataGrid columns: Name, Phone, Developer (with chip "Platform"/"External"), Project, Status, Agent, Last Activity (relative time), Follow-up Date.
- Row click → `/partner/prospects/:id`.
- "+ New Prospect" dialog:
  - Contact fields (firstName, lastName, email, phone).
  - Radio: *On-platform partner* | *Off-platform developer*.
  - If on-platform: dropdown of active Partnerships (call SP3's `/api/cp/partnerships?status=active`) → after selection, dropdown of that developer's published projects (call SP2's `/api/portfolio/view/:orgId`).
  - If off-platform: dropdown of ExternalDevelopers (with "+ Create new" inline option opening a sub-dialog) + free-text project name/location/type.
  - Assigned agent picker (Manager/Owner only — for Agent role, locked to self).
  - Priority/budget/requirements.

### 5.4 CP portal — Prospect Detail page

**Create `src/pages/partner/ProspectDetailPage.jsx`** with tabs:

1. **Overview** — contact card, developer-context card (link to Partnership or ExternalDeveloper), assigned agent, priority/budget/requirements, status badge, status timeline (synthesized from `activities` filtered by `type:'status_change'`).

2. **Activities** — chronological feed (newest first); "+ Log Activity" dialog with type radio (call / site_visit / note / follow_up_scheduled) + note + follow-up date (when type='follow_up_scheduled').

3. **Status & Push** —
   - If `developerContext.type === 'external'`: "Update Status" select-and-save (free local update; appends a `status_change` activity). "Invite developer to platform" CTA links to the ExternalDeveloper card with the invite dialog open.
   - If `developerContext.type === 'platform' && !pushedToLead`: "Push to Developer" button → confirmation → calls `cpProspectsAPI.push(id)`. On success, redirects to the same page (now in pushed state).
   - If `pushedToLead`: read-only banner "Pushed to [Dev Org Name] — status: [lead.status]" with timestamp. If `lead.proposedStatusChange` is non-null: yellow banner "Status change proposed: [status] — pending developer review" with a "Withdraw" button (calls `proposeStatus` with `{withdraw: true}` — alternatively, model withdrawal as DELETE; spec leaves this to plan-time but document the UX). Else: "Propose Status Change" button → dialog with status select + note.

4. **Commission** — visible for BOTH external and platform context.
   - **Commission Agreement** card (editable): type radio (Percentage / Flat), value (with currency), notes. Save calls `updateCommission`.
   - **Booking** card: bookedAt (date), unit info (free text), sale price, currency, notes. Save calls `recordBooking`. Shown collapsed until status reaches Booked or user expands manually.
   - **Commission Summary** card: expected amount (auto-calculated, read-only with formula tooltip), status chip with color (pending=grey, partially_paid=orange, paid=green, written_off=red), total received (sum of payments), balance outstanding.
   - **Payments Ledger** table: amount, receivedAt, method, reference, notes, recordedBy. "+ Record Payment" dialog.
   - **Write Off** button (Manager/Owner only) — dialog with reason textarea. Disabled when status is already `paid`.

### 5.5 CP portal — External Developers page

**Create `src/pages/partner/ExternalDevelopersListPage.jsx`**:

- Header: "Off-Platform Developers" + "+ Add Developer" button.
- Grid of cards: name, city, contact person, # of linked prospects (computed client-side), claimed badge if `claimedByOrg` set.
- Card click → opens a side-drawer with full detail + edit form + invite section.
- Invite section:
  - If `invite` not set OR expired: "Invite to Platform" button → dialog with email field → on submit, displays the resulting invite URL (`{FRONTEND_URL}/register?inviteToken={token}`) with a copy-to-clipboard button and a "Send via email" note ("Email integration is not yet supported — please share this link manually").
  - If `invite` set and active: shows status "Invite sent to X on Y, expires Z" + "Regenerate" button.
  - If `claimedByOrg` set: shows "Claimed by [Org Name] on Z" + link to the resulting Partnership in the Marketplace section.

### 5.6 Developer-side — Lead Registrations page

**Create `src/pages/leads/LeadRegistrationsPage.jsx`**, mount at `/leads/registrations`, gated `leads:read`:

- Surface in the existing Leads nav as "Pending Registrations" with a count badge (poll `/api/leads/registrations?countOnly=true` or include the count in the existing leads summary — implementer's choice).
- Table: CP Org, Agent (User name), Contact (name+phone), Project, Submitted At, Duplicate? (chip linking to existing lead when soft-flagged).
- Row click opens a side-drawer with full submission detail (contact, requirements, budget, CP agent's notes).
- Drawer actions: "Accept" (becomes 'New') and "Reject" (textarea for reason → submits).
- Bulk select + "Accept Selected" / "Reject Selected".

### 5.7 Developer-side — Lead Detail additions

Modify `src/pages/leads/LeadDetailPage.jsx`:

- **"Channel Partner" section** (new card on the right column) — visible when `channelPartnerAttribution.partners[0].channelPartnerOrg` is set. Shows: CP Org name (link to a CP profile page if one exists, else just text), Agent (User name + email), Submitted At, Original Prospect Note (from `sourceProspect.notes` — fetched as part of lead detail).
- **Proposed status banner** — visible when `proposedStatusChange` is non-null. Yellow banner across the top of the page: *"[Agent Name] from [CP Org Name] proposes moving this lead to **[new status]**. Note: [note]"* with two buttons: "Accept Proposal" / "Reject Proposal" (both gated `leads:update`).
- **Status timeline** — inline-render proposal accept/reject history entries with attribution to the CP agent.

### 5.8 Registration page — invite-token wiring

Modify `src/pages/RegisterPage.jsx` (the developer/CP fork registration page):

```js
// On mount:
const params = new URLSearchParams(location.search);
const inviteToken = params.get('inviteToken');

useEffect(() => {
  if (!inviteToken) return;
  externalDeveloperInviteAPI.lookup(inviteToken)
    .then(res => {
      if (!res.data.valid) {
        setInviteWarning(res.data.reason);
        return;
      }
      // Pre-fill org fields, lock type='builder'
      setOrgType('builder');
      setOrgTypeLocked(true);
      setFormData(prev => ({
        ...prev,
        organizationName: res.data.name,
        organizationContactPhone: res.data.contact?.phone || '',
        organizationContactEmail: res.data.contact?.email || '',
        city: res.data.city || '',
      }));
      setInviteBanner(`You've been invited by ${res.data.invitedByOrgName} to join the platform. Completing this registration will activate a partnership with them.`);
    })
    .catch(() => setInviteWarning('Invalid or expired invite link.'));
}, [inviteToken]);

// On submit:
const submitBody = { ...formData };
if (inviteToken) submitBody.externalDeveloperInviteToken = inviteToken;
// ... post to /api/auth/register
// If response.data.claimWarning, show non-blocking warning toast.
```

### 5.9 Reused unchanged

CP portal shell (SP1), auth, the existing notification bell + `/api/notifications`
consumer, Lead detail tabs/timeline framework, existing Leads list + DataGrid
infra, file-upload flow (not used in SP4).

## 6. Scope Boundaries — Not in SP4

- **Cross-org analytics dashboards** (unified commission/revenue rollups, CP performance scorecards across multiple developers) → SP5.
- **CP subscription & billing** → SP6.
- **Email/SMS notifications** — in-app only; the invite URL must be shared manually.
- **Lead reassignment workflow** between CP agents — CP Manager edits `assignedAgent` directly; no workflow.
- **Bulk import** of prospects or external developers.
- **Attachments** on prospects.
- **Automatic commission calculation engine on the CP side** — SP4 is manual entry; the developer-side `CommissionRecord` engine is unchanged.
- **Unified commission view** that reconciles manual Prospect ledger vs. official `CommissionRecord` when both exist for the same prospect/lead → SP5.

## 7. Edge Cases

| Case | Behaviour |
|---|---|
| CP Agent tries to view a prospect not assigned to them | 404 (server enforces; UI hides). |
| CP pushes a prospect, dev rejects the registration | Lead status → 'Lost' with reason; Prospect keeps `pushedToLead` ref + adds a "rejected by developer" activity. CP can clone-and-edit (new Prospect) or re-push the same prospect (clear `pushedToLead` first — Manager-only action). For SP4, the simplest behaviour: rejected → Prospect stays in pushed state and a new Prospect must be created to re-attempt. |
| CP proposes a status change while another is pending | 409 — must wait for dev decision or withdraw current proposal. |
| Dev acts on a proposal that's already been withdrawn | 409 — proposal state changed. |
| External Developer invite token already claimed | Pre-fill lookup returns 410 Gone; registration page shows "this invite has already been used". |
| External Developer invite token expired (90d) | 410 Gone; CP can regenerate from the External Developer card. |
| Developer registers with valid invite token, but RERA collision | Registration fails as normal; `claimExternalDeveloper` is not attempted; the ExternalDeveloper invite remains valid. |
| `claimExternalDeveloper` partially fails after Partnership created but before reconciliation | Wrap in transaction. On error, attempt manual reconciliation via SP3's reconciliation script (already exists); log error for ops. |
| CP org suspended/terminated mid-flow | Existing prospects retained; cannot push new leads (`partnerAccessScope` returns empty); existing pushed Leads stay in dev's system. |
| Partnership terminated after Prospect pushed | Lead remains in dev's system; CP loses visibility via `partnerAccessScope`. Prospect retains `pushedToLead` ref. |
| Duplicate detection match found at registration queue | Soft-flag banner on dev's review row: "Possible duplicate of [Lead Name] (last contacted X days ago)" — link opens existing lead; dev can still accept. |
| Prospect deleted after push | Blocked when `pushedToLead` set — explanation shown. |
| Manual commission recorded on Prospect whose ExternalDeveloper later gets claimed | Prospect transitions to `developerContext.type='platform'` but manual commission ledger preserved; SP5 will reconcile vs. official CommissionRecord. |
| External Developer with prospects gets claimed | All linked Prospects' `developerContext` updates: `type='platform'`, `partnership=<new>`, `externalDeveloper` cleared; system activity "Developer joined the platform" added to each. |
| CP Agent pushes a prospect, then is removed from the CP org | Lead retains `agentUser` ref (User document still exists, just inactive); attribution preserved; new CP Agent must be assigned to the Prospect for proposal/activity actions. |
| Auto-calc race: agreement and booking both edited rapidly | Service recomputes on every save; eventual consistency. No locking needed (single-user editing context). |
| Write-off on a commission with payments | Allowed; status='written_off', payments preserved; `writeOffReason` required. Total received still shown for audit. |

## 8. Testing

### 8.1 Backend regression suite

Add suites under `tests/regression/suites/` (follow the existing pattern in
`tests/regression/suites/sp3-*.js`):

1. **`sp4-prospect-crud.js`** — CRUD + agent-scoping (CP Agent cannot see/edit other agents' prospects, gets 404).
2. **`sp4-prospect-push.js`** — push flow creates Lead with `status='pending'`, `sourceProspect` set, correct attribution (`channelPartner`, `agentUser`); non-active partnership blocks push; second push on already-pushed prospect blocked.
3. **`sp4-lead-registration-queue.js`** — `GET /leads/registrations` returns only pending CP-submitted leads scoped to caller's dev org; accept transitions status to 'New' + fires notification; reject sets 'Lost' with history + fires notification; duplicate detection flags same project + (email OR phone) within last 60 days.
4. **`sp4-status-proposal.js`** — propose creates `proposedStatusChange`; second propose returns 409; dev accept applies status + clears proposal + adds history; dev reject clears proposal + adds history; both fire correct notifications.
5. **`sp4-partner-access-scope.js`** — `partnerAccessScope(req)` returns leads from active partnerships only; CP Agent narrowed to own `agentUser`; terminated partnership blocks access; multi-partnership CP sees union; non-CP user gets `null`.
6. **`sp4-external-developer.js`** — CRUD; invite generates unique 64-char hex token + 90d expiry; lookup endpoint returns developer info; expired/claimed token returns 410; delete blocked when linked to prospects or claimed.
7. **`sp4-claim-flow.js`** — registering with valid token creates Partnership(active, initiatedBy='channel_partner'), marks ExternalDeveloper claimed, re-tags all linked Prospects (`developerContext.type='platform'`, partnership set, externalDeveloper cleared, system activity added), runs SP3 reconciliation creating dev-side ChannelPartner with `channelPartnerOrg`, sends `external_developer_claimed` notification; invalid token: registration succeeds with `claimWarning` in response.
8. **`sp4-commission-manual.js`** — agreement CRUD; payment ledger append-only (no delete); expected-amount auto-calc for %, manual for flat; status auto-transitions (pending→partially_paid→paid); write-off requires reason + Manager/Owner perm; write-off allowed even with payments recorded.
9. **`sp4-notifications.js`** — every event in §4.4 fires the listed notification type to the listed recipients.

### 8.2 Frontend

- `CI=true npm run build` compiles clean.
- Manual smoke through all five narrative scenarios:
  1. **Standalone CP, off-platform developer:** Create CP org → add ExternalDeveloper → create Prospect → log activities → record booking + manual commission + payment.
  2. **Both on platform, collaborative:** CP and dev orgs both exist, active partnership → create Prospect against partnership → push to dev → dev accepts in registration queue → CP proposes status change → dev accepts proposal → status updates on both sides.
  3. **CP-initiated late onboarding:** Standalone CP invites their off-platform developer → developer registers via invite link → ExternalDeveloper marked claimed → Partnership created active → Prospects re-tagged → CP sees collaborative view + retains manual commission ledger.
  4. **Dev-initiated late onboarding (SP3 flow):** Developer's existing ChannelPartner record is invited (SP3 already covers this) → CP joins → existing dev-side ChannelPartner data + commission visible to new CP via `partnerAccessScope`.
  5. **Retroactive re-tagging:** After a claim, existing pushed leads (if any pre-existed via SP3's CP onboarding) become visible to the CP via `partnerAccessScope`.

## 9. File Summary

### Backend — create
- `models/prospectModel.js`
- `models/externalDeveloperModel.js`
- `services/prospectService.js`
- `services/externalDeveloperService.js`
- `utils/partnerAccessHelper.js`
- `controllers/prospectController.js`
- `controllers/externalDeveloperController.js`
- `routes/prospectRoutes.js`
- `routes/externalDeveloperRoutes.js`
- `routes/externalDeveloperInviteRoutes.js`
- `data/backfillSp4CpPermissions.js`
- 9 regression suites under `tests/regression/suites/sp4-*.js`

### Backend — modify
- `models/leadModel.js` — add `sourceProspect`, `proposedStatusChange`, `channelPartnerAttribution.partners[].agentUser`; add `'pending'` to status enum if absent.
- `models/notificationModel.js` — extend `NOTIFICATION_TYPES` and `RELATED_ENTITY_TYPES` enums per §3.4.
- `config/permissions.js` — add `CP_PROSPECTS` and `CP_EXTERNAL_DEVELOPERS` groups.
- `data/defaultCpRoles.js` — add new perms to CP Manager / CP Agent.
- `controllers/leadController.js` — modify `getLeads` & `getLeadById` to AND `partnerAccessScope`; add `getLeadRegistrations`, `decideLeadRegistration`, `decideLeadProposal` handlers.
- `routes/leadRoutes.js` — mount `GET /registrations`, `PATCH /:id/registration`, `PATCH /:id/proposal`.
- `controllers/authController.js → registerUser` — handle `externalDeveloperInviteToken`.
- `app.js` (entrypoint) — mount three new route modules.

### Frontend — create
- `src/pages/partner/ProspectsListPage.jsx`
- `src/pages/partner/ProspectDetailPage.jsx`
- `src/pages/partner/ExternalDevelopersListPage.jsx`
- `src/pages/leads/LeadRegistrationsPage.jsx`

### Frontend — modify
- `src/services/api.js` — add four API clients (§5.1).
- The CP portal app shell — two new nav items (§5.2).
- The developer app shell — "Pending Registrations" nav item with count badge.
- `src/pages/leads/LeadDetailPage.jsx` — Channel Partner section + proposed-status banner + history rendering.
- `src/pages/RegisterPage.jsx` — invite-token query param handling.
- The router — three new routes (`/partner/prospects`, `/partner/prospects/:id`, `/partner/external-developers`, `/leads/registrations`).

## 10. Implementation Order (recommended)

The plan that follows this spec will sequence tasks; this is a suggested macro order:

1. **Data models & permissions** — Prospect, ExternalDeveloper, Lead additions, Notification enums, permissions catalog, defaultCpRoles update, backfill script.
2. **`partnerAccessHelper`** — implement and unit-test in isolation; everything CP-side depends on this.
3. **Prospect service + CP-side CRUD endpoints** (no push yet).
4. **Prospect commission tracking** (agreement, booking, payments, auto-calc, write-off).
5. **ExternalDeveloper service + CP-side CRUD endpoints + public invite lookup.**
6. **`claimExternalDeveloper` + registration extension.**
7. **Push-to-developer flow + Lead status='pending' + developer-side registrations queue + accept/reject.**
8. **Status proposal flow + developer-side proposal accept/reject.**
9. **Modify `getLeads`/`getLeadById` with `partnerAccessScope` AND.**
10. **Notifications fan-out for all events.**
11. **Frontend in same order as backend slices** — API client → list pages → detail pages → registration queue → registration page wiring.
12. **Manual smoke through all five scenarios + regression suites green.**

## 11. Open Items for Implementation

These are minor decisions the implementer can resolve at task time without
re-brainstorming. Document the choice in the PR description:

- Exact mechanism for proposal withdrawal: dedicated DELETE endpoint vs. a `{withdraw: true}` body on the propose endpoint. Either is fine — pick whichever is more idiomatic in the codebase.
- Whether to add an explicit `'pending'` value to the Lead status enum or model it via a separate `status: 'New'` + `isPending: true` flag. The spec assumes `'pending'` on the enum; if the codebase already has a different convention for "awaiting review" leads, follow that convention.
- The exact shape of the duplicate-match payload (single best match vs. list of candidates) — single best match by recency suggested.
- Whether re-push of a rejected prospect requires clearing `pushedToLead` (Manager-only action) or creating a new Prospect. Spec leans toward "new Prospect"; implementer may relax this if it simplifies UX.

---

**End of SP4 spec.** Next step: planning via `superpowers:writing-plans`, then
execution via `superpowers:subagent-driven-development`.
