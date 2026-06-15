# Leads "Developer-Ready" Refactor — Design Spec

- **Date:** 2026-06-15
- **Status:** Approved (design) → pending implementation plan
- **Author:** Nirpeksh + Claude
- **Repos affected:** `propvantage-ai-backend` (BE), `propvantage-ai-frontend` (FE)
- **Scope:** The **Leads** feature and the platform **global search** bar only. Channel-partner internals, sales/booking internals, and the CP-portal prospect grading are touched only where Leads forces it; they are otherwise out of scope (separate future discussions).

---

## 1. Goal & guiding principle

Simplify the Leads experience to be demo-ready for real-estate promoters, without breaking existing flows (channel partner, sales conversion, scoring, analytics) or the demo dataset. Every enum/field change ships with a migration and a demo reseed so the promoter demo never fails.

## 2. Locked decisions (from stakeholder)

1. **Search:** Hybrid — fast indexed entity search + an "Ask AI" fallback to the existing Copilot.
2. **Priority/score:** Timeline-driven priority, **4 levels** (drop "Critical"). Lead score still computed but with **occupancy timeline as the largest weight**; score band relabeled High/Medium/Low/Very Low. **Hot/Warm/Cold removed** from the dev-side lead surfaces.
3. **Status migration (conservative):** `Contacted → New`, `Site Visit Scheduled → Qualified`, `Unqualified → Lost`.
4. **Demo data:** Fresh reseed with the new model + a migration script for any existing leads. **CP-portal prospect Hot/Warm/Cold grading left unchanged** for now.

---

## 3. Current-state reference (verified in code)

### Backend (`models/leadModel.js`, `services/leadScoringService.js`, `controllers/leadController.js`)
- `source` enum: `['Website','Property Portal','Referral','Walk-in','Social Media','Advertisement','Cold Call','Channel Partner','Other']`, default `'Other'`.
- `project`: **single required ObjectId ref** (one project per lead already enforced).
- `budget`: `{ min, max, isValidated, budgetSource ['self_reported','pre_approved','loan_approved','verified'], currency, lastUpdated, updatedBy }`.
- `requirements.floor`: `{ preference ['low','medium','high','any'], specific Number }`.
- `requirements.timeline`: `['immediate','1-3_months','3-6_months','6-12_months','12+_months']` (optional).
- `requirements.amenities`: `[String]` (free array). `requirements.specialRequirements`: String. `requirements.facing`: enum. No `preferredLocation` field persisted.
- `priority`: `['Critical','High','Medium','Low','Very Low']`, default `'Very Low'`, **score-derived** via `updatePriority()`.
- `status`: `['pending','New','Contacted','Qualified','Site Visit Scheduled','Site Visit Completed','Negotiating','Booked','Lost','Unqualified']`, default `'New'`. `statusChangedAt` maintained by pre-save hook. **No state machine. No status history array.**
- `assignedTo`: User ref, **optional**. Reassign endpoint already exists: `PUT /api/leads/:id/assign`.
- `followUpSchedule`: `{ nextFollowUpDate, followUpType ['call','email','site_visit','meeting','whatsapp'] default 'call', notes, isOverdue, overdueBy, remindersSent }`.
- `channelPartnerAttribution`: `{ viaChannelPartner, partners[{channelPartner, agent, agentUser, sharePct}], status, taggedBy, taggedAt, history[] }` — unchanged structurally.
- Interactions: separate `Interaction` model, type enum `['Call','Email','SMS','Meeting','Site Visit','WhatsApp','Note']`.
- Scoring weights: budgetAlignment **30%**, engagementLevel **25%**, timelineUrgency **20%**, sourceQuality **15%** (keyed on old source names), recencyFactor **10%**. Priority map: ≥85 Critical, ≥75 High, ≥60 Medium, ≥40 Low, else Very Low. Virtual `scoreStatus`: Hot/Warm/Moderate/Cold Lead.
- Analytics that `GROUP BY '$priority'`: `leadScoringController.getScoreAnalytics`, `copilotFunctions.getLeadSummary`, `leadershipDashboardService`.
- Convert-to-booking: there is **no** `/leads/:id/convert` endpoint. The FE button navigates to `/sales/create?leadId=` → `CreateSalePage` → `POST /api/sales` (`createSale`) which sets `lead.status='Booked'`. `deleteLead` blocks when status `'Booked'`.

### Frontend
- `CreateLeadPage.js` / `EditLeadPage.js`: 4 steps — **Contact Information / Requirements / Lead Details / Follow-up & Confirmation**. Has `sourceDetails`, CP toggle "Sourced via a channel partner", `BUDGET_RANGES` (Under ₹25L…Above ₹5Cr), manual min/max, `BUDGET_SOURCES` (4), `FLOOR_PREFERENCES` (any/low/medium/high w/ "(1-5)" labels) + specific floor, `TIMELINE_OPTIONS`, `LEAD_PRIORITIES` dropdown, `LEAD_STATUSES` "Initial Status" dropdown, single project picker (in Lead Details) + vestigial "Additional Interested Projects" multi-select (in Requirements, **not persisted**), `assignedTo` (create only, **absent in EditLeadPage**), `preferredLocation`, `specialRequirements`, amenities (fixed list, no add), `FOLLOW_UP_TYPES` (7), `followUpNotes`, research-sources accordion (in Lead Details).
- `LeadDetailPage.js`: top card (score + "Hot/Warm/Moderate/Cold Lead" chip, status, priority, source, phone, email, budget/unit/project). Three-dots: Call/Email/WhatsApp (functional `window.open`), **View Analytics & Generate Report (no-ops)**. Tabs: Overview / AI Insights / Interactions / Follow-up. **CP shown in 3 places** (dedicated card + top banner + contact-info source chip). Convert-to-Booking → `navigate('/sales/create?leadId='+id)`.
- `LeadsListPage.js`: score column renders number + `getScoreLabel` (Hot/Warm/Moderate/Cold). Filters: status, priority, source, project, channelPartner.
- `LeadsPipelinePage.js`: title "Sales Pipeline", 8 hardcoded kanban stages. "Pipeline" nav label in `DashboardLayout.js` (leads + sales), `CommandPalette.js`.
- `constants/statusConfig.js`: central `LEAD_STATUS` map (9 statuses). Temperature derived from score in page-level `getScoreLabel`, not stored.
- "Search": `CommandPalette.js` (Cmd+K) filters **static PAGES + ACTIONS** lists locally; no backend call, no entity search.

---

## 4. Target design by workstream

### A. Data model & enums (BE `models/leadModel.js`) + migration `data/migrateLeadsDeveloperReady.js`

| Field | New value | Migration of existing data |
|---|---|---|
| `source` | `['Channel Partner','Management','Direct','Referral','Marketing','Cold Calling']` | Referral→Referral; Channel Partner→Channel Partner; Walk-in→Direct; Cold Call→Cold Calling; Website/Property Portal/Social Media/Advertisement→Marketing; Other→Direct |
| `budget.budgetSource` | `['self_funded','bank_loan']` | self_reported→self_funded; pre_approved/loan_approved/verified→bank_loan |
| `requirements.floor.preference` | values unchanged `any/low/medium/high`; **labels** Any/Lower/Mid/Higher; **drop `specific`** | clear `specific` |
| `followUpSchedule.followUpType` | UI: `['call','email','meeting','text']`; **enum kept as superset** incl. legacy `whatsapp,site_visit` | whatsapp→text, site_visit→meeting (data only; enum stays permissive) |
| `priority` | `['High','Medium','Low','Very Low']` (drop Critical); **now timeline-derived, not score-derived** | Critical→High; otherwise recomputed from timeline |
| `status` | `['pending','New','Qualified','Site Visit Completed','Negotiating','Booked','Lost','Revived']` (internal `Booked`, **label "Booking"**) | Contacted→New; Site Visit Scheduled→Qualified; Unqualified→Lost; pending stays |
| `assignedTo` | **required for active leads** (enforced in controller, not schema, to protect `pending` CP queue) | backfill any null active leads to a default manager |

**New on the model:**
- `statusHistory: [{ status, changedAt, changedBy, note }]` — appended by the status-change path (replaces today's "no history" gap). Powers the revival report.
- `revival` virtual/derived: `wasRevived = statusHistory.some(h => h.status === 'Revived')`, plus a stored `revivedCount` increment when entering Revived.

**Status state machine** (new helper `utils/leadStatusMachine.js`, enforced in `updateLead` + a new quick-status path):
```
New                  → Qualified | Lost
Qualified            → Site Visit Completed | Lost
Site Visit Completed → Negotiating | Booked(Booking) | Lost
Negotiating          → Booked(Booking) | Lost
Booked               → Lost            (rare correction)
Lost                 → Revived
Revived              → Site Visit Completed | Negotiating
pending              → New | Lost      (existing CP intake accept/reject)
```
Transitions are centralized and reused by `createSale` (→Booked) and CP flows. Invalid transitions return 400.

### B. Scoring & priority (BE `services/leadScoringService.js`, `models/leadModel.js`)
- **Priority is set from occupancy timeline**, instantly, by `derivePriorityFromTimeline(timeline)`:
  - `immediate` & `1-3_months` → **High**
  - `3-6_months` → **Medium**
  - `6-12_months` → **Low**
  - `12+_months` (or missing) → **Very Low**
- `updatePriority()` is repointed from score → timeline. The create controller no longer accepts a priority from the client.
- **Reweighted scoring** (timeline dominant): timeline **40%**, budget **25%**, engagement **20%**, source **10%**, recency **5%**.
- **`sourceQuality` map rekeyed** to the 6 new sources: Referral 100, Channel Partner 85, Management 80, Direct 70, Marketing 55, Cold Calling 30.
- **Hot/Warm/Cold killed:** virtual `scoreStatus` either removed or repurposed to return the High/Medium/Low/Very Low band. Score band thresholds map to the same 4 labels. The **primary chip rendered on all surfaces is `priority`** (timeline-based); the numeric score remains available but never labeled with a temperature word.
- Analytics `GROUP BY priority` keep working; the `Critical` bucket simply disappears.

### C. Create/Edit wizard → 3 tabs (FE `CreateLeadPage.js`, `EditLeadPage.js`)
**Tab 1 — Contact Information:** name, phone, email, **Source** dropdown (6), and a single **"Add source details" toggle**:
- Source = **Channel Partner** → existing `ChannelPartnerAttributionFields` (firm + agent + share %, sum to 100%).
- Source = **Management** → new lightweight capture: **management/promoter/investor contact name + optional note** (no commission). Stored under a new `sourceDetail` sub-object (see below).
- Source = Direct/Referral/Marketing/Cold Calling → single free-text detail (absorbs old `sourceDetails`).
- **Research Sources** (LinkedIn/company/articles) move here.

**Tab 2 — Requirements:** project (single-select, moved here, required), budget **range** (new ladder, no min/max inputs), budget source (2), unit type, floor (Any/Lower/Mid/Higher), occupancy **timeline** (required; shows the auto-priority badge live), amenities (catalog + add), **Assign To (required)**, **Notes** (optional, bottom). **Removed:** Preferred Location, Special Requirements, multi-project picker, priority dropdown.

**Tab 3 — "Lead Summary and Follow up":** read-only summary + follow-up (types Call/Email/Meeting/Text), **"Follow-up Agenda"** (was Follow-up Notes).

**Deleted:** the entire **Lead Details** tab (priority gone; initial status gone → always `New`; project/assign/notes/research relocated). `EditLeadPage` gains the **Assign To** field it currently lacks.

**New model field** `sourceDetail`:
```js
sourceDetail: {
  text: String,                 // free-text for non-CP/non-Management sources
  management: {                 // when source === 'Management'
    contactName: String,
    note: String,
  }
}
```
(CP details continue to live in `channelPartnerAttribution`.)

### D. Amenity catalog + promoter report (#11)
- New BE model `models/amenityModel.js`: `{ organization, name (unique per org), createdBy, usageCount? }`.
- New routes `routes/amenityRoutes.js` + `controllers/amenityController.js`: `GET /api/amenities` (list for org), `POST /api/amenities` (add; idempotent on name).
- New report: `GET /api/leads/amenity-demand` → aggregate `lead.requirements.amenities` counts across the org (for promoters: "what amenities do buyers want most").
- FE: amenities autocomplete gains **"+ Add '<typed>'"** → calls `POST /api/amenities`, then selects it. Lead still stores `requirements.amenities: string[]`.

### E. Lead detail page redesign (FE `LeadDetailPage.js`)
- **Top bar (only):** name, email, phone, **source, priority, research links (LinkedIn), status**. Remove the duplicate CP banner and the source chip's CP duplication.
- **AI Profile Summary** stays immediately below.
- **Tabs:** **Overview** · **Property Requirements** (budget range, unit type, project, floor, amenities, facing) · **Follow-up** (with **Interactions** nested). CP **%** appears only in its dedicated card.
- **Three-dots menu:** **Edit Lead**, **Change Status** (quick dialog driven by the state machine), **Assign / Reassign** (quick dialog → existing `PUT /leads/:id/assign`). **Remove** Call / Email / WhatsApp / View / Analytics / Generate Report.
- Remove all Hot/Warm/Cold rendering; show `priority` chip.

### F. List + Funnel (FE `LeadsListPage.js`, `LeadsPipelinePage.js`, `DashboardLayout.js`, `CommandPalette.js`, `statusConfig.js`)
- **List:** drop the temperature label from the score column; show **status** chip (new set) + **priority** chip; keep score number (no temperature word). Update status/priority/source filter option sources.
- **`statusConfig.js`:** replace `LEAD_STATUS` map with the 7 new statuses (+ `pending`), `Booked` keyed but **labeled "Booking"**, add `Revived`. Add a `LEAD_PRIORITY` config (High/Medium/Low/Very Low).
- **Funnel:** rename "Pipeline"→"Funnel" in the leads nav item, page title, and command palette entry for leads. Rebuild kanban columns from the new status set (7 columns). **Keep `/leads/pipeline` URL** (label-only rename). Sales Pipeline untouched.

### G. Hybrid global search (#1)
- BE: new `controllers/searchController.js` + `routes/searchRoutes.js`: `GET /api/search?q=&types=` — org-scoped, role-aware, indexed/regex across **leads** (firstName/lastName/phone/email/status/source/priority), **projects** (name), **units**, **contacts/users**. Returns typed, grouped, ranked results, capped per type, <150ms target. Add the supporting indexes.
- FE: repurpose the top search/`CommandPalette` to call `/api/search` with debounce, render **grouped live results** (Leads / Projects / Units / People), navigate on select. **Drop the static "actions" list.** Add a trailing **"Ask AI: '<query>'"** row that routes to the existing `/api/ai/copilot/chat`. Light NL parsing (e.g. status/source keywords) can pre-filter, but the AI path is the catch-all.

### H. Convert-to-booking fix (#18)
- **First implementation task:** reproduce `/sales/create?leadId=` blank page, root-cause inside `CreateSalePage` (suspected: lead fetch/pre-fill failure or a thrown error in initial load), fix, and verify the lead→sale→`Booked(Booking)` path end-to-end. Root cause **not yet confirmed**.

### I. Demo data — fresh reseed (BE `data/mumbaiLuxuryDemoSeeder*.js`, new amenity seed)
Reseed with the new model:
- Sources across all 6, including a meaningful set of **Channel Partner** leads (with `channelPartnerAttribution.partners[]` + share %) and **Management** leads (with `sourceDetail.management`).
- Statuses across the new set, including a few **Lost → Revived** leads (with `statusHistory` containing Revived) so the revival report has data.
- Priority **derived from timeline** (not random). Budget source self_funded/bank_loan. Budgets already in ₹ Cr → fit the new ladder (>50Cr → "50Cr+").
- Seed an **amenity catalog** for the org and populate `requirements.amenities` from it (so the demand report is populated).
- All leads assigned (already true). Keep follow-up types within Call/Email/Meeting/Text.
- Provide/refresh the migration script for any pre-existing leads.

---

## 5. Backward-compat / must-not-break checklist
- **Channel partner:** attribution schema unchanged; `source='Channel Partner'` + toggle still drives the same CP UI; CP-push intake (`status='pending'` → accept→`New`) and CP-proposed status changes must use the new state machine and new status set; CP→prospect status sync (`syncProspectStatusFromLead`) must map new statuses (incl. Revived) safely.
- **Sales/booking:** `createSale` must set status via the state machine (Negotiating/Site Visit Completed → Booked) and still mark units sold + create payment plans; `deleteLead` guard on `Booked` preserved.
- **Scoring/analytics:** keep `score` numeric; ensure `GROUP BY priority` consumers tolerate the removed `Critical` bucket; copilot `getLeadSummary` still returns priority breakdown.
- **Assignment-required** enforced only for active leads, never the `pending` CP intake (which auto-assigns on accept).
- **Enum permissiveness:** `followUpType` keeps legacy values valid to avoid save failures on un-migrated embedded docs.

## 6. Verification plan
- Unit/regression: status state-machine transitions (valid + invalid), `derivePriorityFromTimeline`, scoring reweight totals = 100%, source migration map, amenity catalog idempotency, search endpoint shape.
- E2E (demo): create a lead per source (esp. CP + Management), walk New→Qualified→Site Visit Completed→Negotiating→Booking, do a Lost→Revived→Negotiating, quick status-change + quick reassign from the detail three-dots, convert-to-booking, amenity "+ add" + demand report, global search for a lead by name/status, Funnel board renders 7 columns.
- Reseed the demo DB and click through the promoter happy-path; confirm no console/network errors and no orphaned old enum values.

## 7. Phased delivery
1. Model + enums + state machine + `statusHistory` + migration (foundation).
2. Scoring/priority rework (timeline-driven, reweight, kill temperature).
3. Amenity catalog + demand report.
4. Create/Edit wizard → 3 tabs.
5. Detail page redesign (top bar, tabs, three-dots quick actions, de-dup CP).
6. List + Funnel rename + status/priority display + `statusConfig`.
7. Convert-to-booking fix.
8. Hybrid search (BE endpoint + FE bar).
9. Demo reseed + full E2E verification.

## 8. Open items
- Convert-to-booking exact root cause (to confirm during Phase 7, or earlier if quick).
- Final scoring weights are a starting point (timeline 40/25/20/10/5) — tune against reseeded demo if score bands look off.
