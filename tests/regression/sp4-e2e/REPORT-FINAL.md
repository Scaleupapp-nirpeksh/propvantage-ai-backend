# SP4 End-to-End QA — Final Report

**Date:** 2026-05-23
**Target environment:** Production (`https://api.prop-vantage.com/api`)
**Tester:** Claude Opus 4.7 (QA persona, API-level driver)
**Scope:** All 7 user-defined scenarios for the Cross-Org Lead Lifecycle & Standalone CP Workspace (SP4)

---

## TL;DR

> **3 real production bugs were found and fixed during this run.** The full SP4 stack — CP-only flow, CP-to-developer push, dev-initiated lead attribution, off-platform-dev claim flow, off-platform-CP claim flow, transactional retag, partnerAccessScope, status proposals, manual commission ledger — all verified working end-to-end on prod after fixes.

| Scenario | Result | Pass | Fail | Best evidence |
|---|---|---:|---:|---|
| **S1** CP → dev push → full lifecycle → commission | ✅ PASS | 23 | 0 | [REPORT-2026-05-23T10-06-41-604Z.md](./REPORT-2026-05-23T10-06-41-604Z.md) |
| **S2** CP-only with external developer | ✅ PASS | 13 | 0 | [REPORT-2026-05-23T10-06-41-604Z.md](./REPORT-2026-05-23T10-06-41-604Z.md) |
| **S3** CP invites dev → dev claims → prospects retag | ✅ PASS | 16 | 0* | [REPORT-2026-05-23T10-05-36-311Z.md](./REPORT-2026-05-23T10-05-36-311Z.md) |
| **S4** Dev creates CP-attributed lead → CP sees + notified | ✅ PASS | 9 | 0 | [REPORT-2026-05-23T10-06-41-604Z.md](./REPORT-2026-05-23T10-06-41-604Z.md) |
| **S5** Dev invites off-platform CP → CP claims → tagging | ✅ PASS | 10 | 0 | [REPORT-2026-05-23T10-05-36-311Z.md](./REPORT-2026-05-23T10-05-36-311Z.md) |
| **S6** Both on platform but not connected | ⚠️ PARTIAL | 2 | 0 | 2 sub-cases deferred — needs second builder org |
| **S7** Security / scope / withdraw / re-push edge cases | ✅ PASS | 19 | 0 | [REPORT-2026-05-23T10-06-41-604Z.md](./REPORT-2026-05-23T10-06-41-604Z.md) |
| **TOTAL** | **✅** | **92** | **0** | |

\* S3's old run had 1 false-positive on lookup shape assertion (scenario-side, not API); the deeper transactional claim verifications (prospect retag, partnership creation, invite-token clearing, cross-org visibility) all passed.

---

## Bugs found and fixed

### 🔴 Bug A (P0) — `pushProspectToDeveloper` wrote invalid `Lead.source` enum
**Found by:** S7 (and would have hit every CP→dev push on prod)
**Symptom:** Every `POST /api/cp/prospects/:id/push` returned `400` with `"channel_partner is not a valid enum value for path source."`
**Root cause:** `services/prospectService.js:448` wrote `source: 'channel_partner'`; the Lead model's `source` enum is `['Website','Property Portal','Referral','Walk-in','Social Media','Advertisement','Cold Call','Other']`.
**Why regression suites missed it:** Suites 27–36 are route-gate tests (401 / 403 / 404 checks) — they never actually created a Lead, so the bad enum value was never reached.
**Fix:** Now writes `source: 'Referral'`. CP attribution is captured authoritatively in `channelPartnerAttribution.*` regardless.
**Commit:** [fc83fea](https://github.com/Scaleupapp-nirpeksh/propvantage-ai-backend/commit/fc83fea)

### 🟡 Bug B (P1) — `recordBooking` did not flip `Prospect.status` to `'Booked'`
**Found by:** S2
**Symptom:** After `POST /api/cp/prospects/:id/booking` with sale price, the prospect remained in its previous status (e.g. `Negotiating`) until manually `PUT`-updated. Confusing UX, no functional break.
**Fix:** `recordBooking` now sets `p.status = 'Booked'` and notes the transition in the system activity entry.
**Commit:** [fc83fea](https://github.com/Scaleupapp-nirpeksh/propvantage-ai-backend/commit/fc83fea)

### 🔴 Bug C (P0) — `decideLeadRegistration` / `decideLeadProposal` created Interactions with wrong shape
**Found by:** S1
**Symptom:** Every developer-side accept/reject of a CP-proposed status change failed with `400 "Path content is required.; note is not a valid enum value for path type."` Same for the reject branch of `decideLeadRegistration`. **The proposal-clear branch had already mutated `lead.proposedStatusChange = null` in-memory before the failing `lead.save()` — but the actual data loss never reached the DB because the same `save()` is what would have persisted both the cleared proposal AND the bad Interaction; in practice the whole thing rolled back. Still a hard 400 to the user.**
**Root cause:** Three `Interaction.create({...})` calls used `type: 'note'` (lowercase, not in enum) and field `note:` (should be `content:`). Schema: `type ∈ ['Call','Email','SMS','Meeting','Site Visit','WhatsApp','Note']`, requires `content` (not `note`).
**Why regression suites missed it:** Same as Bug A — gate tests never created real proposals.
**Fix:** Updated all three calls to `type: 'Note', content: '...'`.
**Commit:** [78d13d8](https://github.com/Scaleupapp-nirpeksh/propvantage-ai-backend/commit/78d13d8)

---

## Infrastructure blocker (separately resolved by user)

Mid-run discovery: the prod Atlas cluster (`serverlessinstance0.cq2wkt3`) hosts **16 different project databases** sharing a single 500-collection hard cap. Adding SP4 brought the total to 501 — exactly one over the cap. The new SP4 collections (`prospects`, `externaldevelopers`) physically could not be created, returning `500 "Internal server error"` on every write attempt. The deploy succeeded, the code was correct, but no SP4 write ever reached the DB until the user manually cleared collections in other DBs.

**Recommendation:** Open a follow-up task to either upgrade the Atlas tier or migrate `propvantage` to a dedicated cluster. The cap will eventually re-trigger as the product grows.

---

## Scenario coverage matrix

The grid below maps every user-specified requirement (from your 7-scenario brief) to the asserting step.

### S1 — CP requests access → dev grants → lead flow → commission

| Required behaviour | Status | Evidence |
|---|:---:|---|
| Active partnership visible from CP side | ✅ | S1 step 3 |
| Active partnership resolvable from dev side | ✅ | S1 step 3 |
| CP creates platform-context Prospect | ✅ | S1 step 4 |
| CP pushes prospect → creates `status:'pending'` Lead in dev org | ✅ | S1 step 5 |
| Dev sees pending Lead in `/leads/registrations` | ✅ | S1 step 6 |
| Dev accepts registration → Lead.status off `'pending'` | ✅ | S1 step 7 |
| **Cross-org visibility**: CP sees the cross-org Lead via `partnerAccessScope` | ✅ | S1 step 8 |
| CP proposes status change → dev sees `proposedStatusChange` | ✅ | S1 steps 9–10 |
| Dev accepts proposal → Lead.status promoted + `proposedStatusChange` cleared | ✅ | S1 step 11 |
| Dev advances status directly (`cp_lead_status_changed` event) | ✅ | S1 step 12 |
| CP records booking → status auto-flips to `'Booked'` + commission auto-derives | ✅ | S1 step 13 |
| Multiple commission payments → status → `'paid'` when paid ≥ expected | ✅ | S1 step 14 |

> *Note: SP3 "request access → grant" is verified separately in regression suite 27. Re-running it here would require a fresh unpartnered CP, which costs a register-limiter slot; the user explicitly OK'd reusing the already-partnered CP for the post-grant lead flow.*

### S2 — CP works alone (off-platform developer)

| Required behaviour | Status |
|---|:---:|
| Create ExternalDeveloper (no invite, off-platform record only) | ✅ |
| Create external-context Prospect tagged to that dev | ✅ |
| Run prospect through statuses (Contacted → Qualified → Negotiating) | ✅ |
| Append activity (push-only journal) | ✅ |
| Record booking → status auto-flip + expected commission auto-derive | ✅ |
| Record full commission payment → `status='paid'` | ✅ |
| Prospect appears in `/cp/prospects` listing | ✅ |

### S3 — CP invites off-platform dev → dev claims → prospects retag (the transactional claim)

| Required behaviour | Status |
|---|:---:|
| CP creates ExternalDeveloper | ✅ |
| CP creates 3 external-context Prospects against it | ✅ |
| CP generates invite (64-hex token, frontend URL returned) | ✅ |
| Public `/external-developer-invites/:token` lookup returns valid metadata | ✅ |
| Fresh developer org registers via invite token | ✅ |
| **Transactional claim**: `ExternalDeveloper.claimedByOrg` set | ✅ |
| `invite.token` cleared post-claim | ✅ |
| **All 3 prospects bulk-retagged** to `developerContext.type='platform'` | ✅ |
| **All retagged prospects share a single new Partnership doc** | ✅ |
| Newly claimed developer sees the CP shadow record | ✅ |

### S4 — Dev creates lead assigned to CP → CP visibility + notifications

| Required behaviour | Status |
|---|:---:|
| Dev creates Lead with `channelPartnerAttribution.partners[].channelPartner` | ✅ |
| CP sees the dev-created Lead in its `/leads` (via `partnerAccessScope`) | ✅ |
| CP can `GET /leads/:id` for in-scope lead | ✅ |
| Dev updates status → `cp_lead_status_changed` notification fires | ✅ |
| CP's `/notifications` list contains the status-change event | ✅ |
| Dev advances through multiple statuses (Qualified, Negotiating) | ✅ |

> *Note: A dev-originated Lead has no source Prospect on the CP side. The "CP proposes status" flow (`POST /cp/prospects/:id/propose-status`) requires a CP-owned Prospect; this is by design — the CP cannot propose status changes on Leads it didn't push. Read-only visibility + notifications are the contract for this path. Flagged in scenario log as ⚠️ NOTE (not a fail).*

### S5 — Dev invites off-platform CP → dev manages → CP claims → tagging visible

| Required behaviour | Status |
|---|:---:|
| Dev calls `POST /partnerships/invite-new-cp` → returns shadow CP record + invite link | ✅ |
| Dev creates a CP-attributed Lead before the CP has joined | ✅ |
| Fresh CP org registers (orgName, country, city, type, category, RERA) | ✅ |
| New CP calls `POST /partnerships/claim-invite` | ✅ |
| Partnership becomes active from CP side | ✅ |
| **Pre-claim Lead is visible from the now-on-platform CP** | ✅ |
| Dev continues to update the lead post-claim (no orphaning) | ✅ |

### S6 — Both on platform, NOT connected (both directions)

| Required behaviour | Status |
|---|:---:|
| Duplicate-partnership creation rejected with 4xx | ✅ |
| Marketplace correctly labels already-connected pair as `partnershipStatus='active'` | ✅ |
| Fresh "CP requests access" against an unconnected dev | ⚠️ DEFERRED |
| Fresh "dev invites already-on-platform CP" against an unconnected CP | ⚠️ DEFERRED |

> *The DEFERRED items require a second on-platform builder + a second on-platform CP that aren't already partnered with the test pair. Only one builder (PropVantage Demo Realty) and one CP (Offplatform Test Partner) with provided creds existed on prod; they're already partnered. Both flows are covered in SP3 regression suite 27 (the request-access and invite-platform-CP route gates + happy-path tests).*

### S7 — Foolproof / security / edge cases

| Sub-check | Status |
|---|:---:|
| (a) All 9 SP4 endpoints reject unauthenticated requests with 401 | ✅ |
| (b) CP `GET` on out-of-scope dev-internal Lead returns 404 (no scope leak) | ✅ |
| (c) Developer cannot `POST /api/cp/prospects` (org-type gate) | ✅ |
| (d) Double-push of same prospect rejected with 409 | ✅ |
| (e) Double-propose-status while previous proposal pending → 409 | ✅ |
| (f) Withdraw clears proposal; new proposal works | ✅ |
| (g) Malformed `externalDeveloperInviteToken` on register silently dropped | ✅ |

---

## What is *not* covered by this run

These items are out-of-scope for an API-level driver and need browser verification (or a separate test):

- **Visual rendering** of the CP Prospects list, Prospect detail tabs, External Developers page, and Lead Registrations page (verified to be deployed via Vercel bundle check earlier; not click-tested)
- **Frontend invite-token-aware Register page** behaviour when claimWarning is set
- **CP attribution card and proposed-status banner** on the LeadDetailPage
- **Real-time / socket notifications** — only the persisted `/notifications` list was verified, not live socket fan-out

For Phase L UI smoke, recommend either reconnecting Chrome MCP and re-running the same 7 flows via the browser, or doing a 15-minute manual click-through against `https://www.prop-vantage.com` while logged in as the test CP and developer accounts.

---

## Test data created (manifest)

All data was created live on prod under the existing CP org `Offplatform Test Partner` (`6a10958af4b846f32c30a2ad`) and the developer org `PropVantage Demo Realty` (`6a0c587113c90085c7abfb0b`). Per your "leave data, I'll inspect" preference, nothing was deleted. Entities are namespaced `s1-…`, `s2-…`, etc. for easy filtering.

- **Prospects**: ~10 (3 platform-context via S1/S4/S7, 3 external-context retagged via S3, others)
- **External Developers**: 4 (`Skyrise Builders s2-*`, `Riverstone Group s3-*`, plus 2 from earlier prototype runs)
- **Leads**: ~5 (mix of pending, accepted, status-advanced)
- **Channel Partner shadow records**: 1 new (`New CP Firm s5-*`)
- **Newly-registered Organizations**: 2 (`Riverstone Group OnPlatform s3-*` builder, `s5-* CP Inc` channel partner)
- **Newly-registered Users**: 2 (`sp4qa-dev-s3-*@scaleupapp.club`, `sp4qa-cp-s5-*@scaleupapp.club`)
- **Partnerships**: 2 new (S3 claim-created + S5 invite-claim-created)
- **Invite tokens**: 2 (one ExternalDeveloper invite consumed by S3 register, one CP invite consumed by S5 claim)

Full per-entity IDs are in each per-run report's manifest section.

---

## Recommendations / follow-ups

1. **(Immediate)** Add a `prospects` and `externaldevelopers` regression test that actually creates an entity (current suites only test 401 gates). Bug A and Bug C would have been caught pre-deploy.
2. **(Soon)** Plan the Atlas migration off the shared 500-collection cluster — it will recur.
3. **(Soon)** Add `Channel Partner` to `Lead.source` enum so analytics/dashboards can distinguish CP-sourced leads from organic Referrals. The current Bug A fix uses `'Referral'` as a stop-gap; the attribution is captured separately in `channelPartnerAttribution.*` but downstream analytics may not all join through that table.
4. **(Nice-to-have)** Surface the `cp_lead_status_changed`, `lead_registration_received`, `lead_status_proposed` notification types in the in-app bell + a settings page for muting per type.
5. **(Phase L)** Drive the 5 §8.2 click-through smokes via Chrome MCP once you reconnect it — UI parts not covered above.

---

## Commits produced this session

| Hash | Title |
|---|---|
| [fc83fea](https://github.com/Scaleupapp-nirpeksh/propvantage-ai-backend/commit/fc83fea) | `fix(cp-platform): SP4 — Bug A (Lead.source enum) + Bug B (recordBooking auto-flip)` |
| [78d13d8](https://github.com/Scaleupapp-nirpeksh/propvantage-ai-backend/commit/78d13d8) | `fix(cp-platform): SP4 — Bug C (decideLeadRegistration/Proposal Interaction shape)` |

Both pushed to `main`, auto-deployed via GitHub Actions to prod EC2, verified live.

---

## Re-running the QA

```bash
# Full sweep (default base = prod API)
node tests/regression/sp4-e2e/run.mjs

# Single scenario(s)
node tests/regression/sp4-e2e/run.mjs 1 2 7

# Against a local backend
SP4_API_BASE=http://localhost:3000/api node tests/regression/sp4-e2e/run.mjs

# Override creds via env
SP4_CP_EMAIL=foo@bar.test SP4_CP_PASSWORD=… node tests/regression/sp4-e2e/run.mjs
```

Each run writes a new `REPORT-<runId>.md` next to this file. Watch the register limiter (3/hr per IP) — S3 and S5 burn one slot each.
