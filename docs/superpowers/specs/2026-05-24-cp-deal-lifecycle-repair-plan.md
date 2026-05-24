# Channel Partner Deal Lifecycle — Repair Plan

**Date:** 2026-05-24
**Status:** Approved for planning
**Type:** Repair plan (not a new feature spec — fixes broken behavior across SP3/SP4 deliverables)
**Repos:** `propvantage-ai-backend` (Node/Express/MongoDB/Mongoose), `propvantage-ai-frontend` (React 18 + MUI v5)

---

## 1. Context

The Channel Partner platform (SP1-SP5) was built in phases. Each phase's audit verified "the files exist and the regression suite passes." But none of the suites drove a real CP-attributed deal end-to-end through the full lifecycle:

```
Lead created → Lead approved → Sale/Booking → Customer payments →
At 20% paid: Commission Invoice → Dev approves → Dev pays CP →
CommissionRecord closes → Reconciliation shows 'matched'
```

A deep code trace (2026-05-24) found that this lifecycle is **broken at multiple junctions**:

- **Lead → Sale**: attribution silently dropped (root cause).
- **20% trigger**: reads schema fields that don't exist → has likely never fired in production.
- **Invoice payment**: doesn't cascade to close the parallel CommissionRecord.
- **Edge cases**: cancellations, refunds, attribution edits, rejected leads, no-matching-rule sales all silently corrupt state.
- **Frontend**: no "Convert to Booking" CTA, no payment-progress indicator, no threshold marker; CP-side commission tab can't see dev-side state.
- **Audit trail**: no integration test exists, no `Interaction` log entries on sale/invoice creation, no notifications for major lifecycle events.

This plan repairs the lifecycle. It is **not** a new sub-project; it is the corrective work that should have been part of SP3/SP4 but was missed. Monetization (SP6) cannot proceed until this is fixed because there's nothing to bill against on the dev side and nothing to reconcile against on the CP side.

## 2. Diagnosis Summary

### 2.1 Bugs (backend) — 33 total, ranked

**CRITICAL (flow-breakers — 6)**

| ID | File:line | Bug | Effect |
|---|---|---|---|
| B1 | `controllers/salesController.js:148-159, 229-240` | `createSale` only writes `channelPartnerAttribution` from `req.body`; never inherits from the upstream Lead. | Every CP-attributed sale silently becomes "Direct" if dev forgets to re-tag in the form. |
| B2 | `services/commissionInvoiceTriggerService.js:58, 65` | Reads `sale.totalAmount`/`sale.finalAmount` — fields that don't exist. Actual field is `sale.salePrice`. | The 20% trigger early-returns on every payment. Has never fired. |
| B3 | `services/commissionInvoiceService.js:336-389` | `recordPayment` (invoice paid) doesn't update parallel `CommissionRecord.payouts[].status`. | Dev must manually mark paid in two places. CP sees "pending" forever even after dev paid. |
| B4 | `services/commissionService.js:36-72, 117` | When no `CommissionRule` matches `(org, project)`, creates a `CommissionRecord` at ₹0 silently. | Reconciliation will show "mismatched" against the CP's expected amount. No alert. |
| B5 | `services/commissionInvoiceService.recordPayment` vs `channelPartnerController.markPayoutPaid` | Two parallel "mark paid" paths that don't communicate. `CommissionInvoice` never references which `CommissionRecord.payouts[i]` it represents. | Data integrity time-bomb. |
| B6 | `models/commissionInvoiceModel.js:65` vs `commissionInvoiceService.createDraft:143-166` | `CommissionInvoice.commissionRecord` FK declared but never populated. | Reconciliation can't fast-join invoice ↔ record. |

**HIGH (silent data corruption — 7)**

| ID | File:line | Bug |
|---|---|---|
| B7 | `controllers/salesController.js:148-160, 229-240` | `partners[].sharePct` sum not validated to equal 100% in `createSale` (only in `editSaleAttribution`). |
| B8 | `services/commissionService.js:99-114` | Removing CP from attribution leaves paid-out payouts intact but unpaid portion is not cancelled — silent partial state. |
| B9 | `controllers/salesController.js:712-723` (`cancelSale`) | Cancellation does nothing to `CommissionRecord` or open `CommissionInvoice`. Records stay live, invoices stay payable. |
| B10 | `services/prospectService.js:510` | Lead `source` hard-coded to `'Referral'` because `Lead.source` enum lacks `'Channel Partner'`. Every CP-attributed lead pollutes referral analytics. |
| B11 | `controllers/salesController.js:626-635` | `updateSale` strips `channelPartnerAttribution` from body but still calls `syncCommissionForSale` — user-facing illusion that edit-sale can touch attribution when it can't. |
| B12 | `services/commissionInvoiceTriggerService.js:86-88` | Reads `partners[0]` only — multi-CP splits drop all but first partner from notifications and trigger snapshot. |
| B13 | `services/commissionInvoiceService.js:50` | Same `partners[0]`-only assumption in `resolveCpUsers`. |

**MEDIUM (UX / audit gaps — 11)**

| ID | File:line | Bug |
|---|---|---|
| B14 | `controllers/salesController.js:728` | Cancellation sets `Lead.status='Active'` — not in enum. Uses `findByIdAndUpdate` which bypasses validators → DB corruption. |
| B15 | `controllers/salesController.js:147-160, 228-241` | Two near-identical copies of attribution-write code in `Pending Approval` and `Booked` branches. Sync drift inevitable. |
| B16 | `controllers/salesController.js:194-203` | Pending-Approval save sequence happens partially outside the transaction session → orphan risk. |
| B17 | `controllers/salesController.js:203` | `syncCommissionForSale` called for `Pending Approval` sales → CommissionRecord exists even if approval later rejected; no cleanup. |
| B18 | `services/commissionInvoiceService.js:399` | Populate selects non-existent `totalAmount finalAmount bookingDate` — frontend can't show sale value on invoice detail. |
| B19 | `services/commissionInvoiceService.js:116` | Same field bug in `Sale.findOne(...).select(...)`. Read but not used, so doesn't break creation; leaks the confusion. |
| B20 | `services/commissionInvoiceTriggerService.js:142-156` | Notifies dev with type `'commission_invoice_due'` — not in `NOTIFICATION_TYPES` enum. Swallowed silently by try/catch. |
| B21 | `controllers/leadController.js:992-994` | Lead accept auto-assigns to clicker, overriding any project-default routing without notification. |
| B22 | `controllers/salesController.js:281-285` | If payment plan creation throws, error is swallowed with `console.error`. Sale commits without a payment plan; trigger can never fire — zombie sale. |
| B23 | `controllers/channelPartnerController.js:347-374` (`markPayoutPaid`) | No audit trail on the linked `CommissionInvoice`. Two systems can't reconcile to each other. |
| B24 | `controllers/leadController.js:992-994` | Accept path doesn't create a `CommissionRecord` skeleton at lead-approval time → if deal lost before sale, no audit of agreed commission. |

**LOW (cosmetic / cleanup — 9)**

| ID | File:line | Bug |
|---|---|---|
| B25 | `controllers/salesController.js:251-254` | Writes `Lead.lastContactDate` — field not in schema. Silently dropped by strictMode. |
| B26 | `services/paymentService.js:107` | Per-installment `Math.round` creates cumulative drift; affects 20% threshold edge cases. |
| B27 | `controllers/salesController.js:728` | Cancellation doesn't roll back `Prospect.status` on CP side. |
| B28 | `services/commissionInvoiceTriggerService.js:75` | Hard-codes `devOrg.type !== 'builder'` early-return — brittle if org types diversify. |
| B29 | `controllers/leadController.js:251` | Populates `partners.agent` (always null on pushed leads — only `agentUser` is set) — wasted I/O. |
| B30 | `models/leadModel.js:391-399` | `indexes:[]` block declared inside schema options — dead code; none of those indexes exist in MongoDB. |
| B31 | `data/mumbaiLuxuryDemoSeeder.js` | Seeder for "PropVantage Demo Realty" doesn't create any `CommissionRule` → demo CP sales hit B4 silent-zero path. |
| B32 | `models/salesModel.js:120-124` | `commissionInvoiceTriggered.cpOrg` single-valued — incompatible with multi-CP. |
| B33 | `services/commissionInvoiceService.js:228` | Re-submit after rejection carries stale `decidedAt`/`decidedBy` until next decision. |

### 2.2 Gaps (frontend) — 24 total, ranked

**P0 (mandatory — 8)**

| ID | File:line | Gap |
|---|---|---|
| F1 | `pages/leads/LeadDetailPage.js:174-379, 1580-1620` | No "Convert to Booking" CTA on LeadDetail. Dev must navigate manually. |
| F2 | `pages/sales/CreateSalePage.js:3142-3175` | Doesn't read `leadId` URL param; no pre-population of customer. |
| F3 | `pages/sales/CreateSalePage.js:3152-3155, 3452-3464` | `channelPartnerAttribution` state begins blank; no hydration from upstream lead. Submit silently omits attribution if dev forgets. |
| F4 | `pages/sales/SaleDetailPage.js:1234-1294` | No "Generate Commission Invoice" CTA. No "Record Customer Payment" CTA. Only Print/Email/View Payment Plan. |
| F5 | `pages/sales/SaleDetailPage.js:717-815` | `PaymentBreakdownCard` shows only cost-sheet snapshot. No running paid total, % paid, next installment, or 20% threshold marker. |
| F6 | (no file) | No dev-side commission-invoice list route or queue page. Dev can only see invoices via LeadDetail's embedded card. |
| F7 | `pages/cp-portal/ProspectDetailPage.js:383-396, 833-861` | CP Commission tab reads only local CP ledger; never calls `cpAnalyticsAPI.getReconciliationDetail`. CP can't see dev-side state per-prospect. |
| F8 | `pages/channel-partners/CommissionRecordListPage.js:69-79` vs `components/leads/DevCommissionInvoiceCard.jsx:92-109` | Two places to mark commission paid, hitting two different endpoints. UI doesn't sync. |

**P1 (high-value — 8)**

| ID | File:line | Gap |
|---|---|---|
| F9 | `pages/payments/RecordPaymentPage.js` (zero CP refs) | No commission/threshold awareness in payment recording UI. No snackbar on threshold crossing. |
| F10 | `pages/payments/PaymentPlanPage.js` (zero CP refs) | No 20%-trigger marker on installment schedule. |
| F11 | `pages/sales/EditSalePage.js` (zero CP refs) | Cannot edit `channelPartnerAttribution` from EditSale — only via a buried dialog on `CommissionRecordListPage` and only post-CommissionRecord-creation. |
| F12 | `pages/leads/EditLeadPage.js` (no `ChannelPartnerAttributionFields`) | EditLead cannot edit CP attribution; asymmetric with CreateLead. |
| F13 | `constants/notificationConfig.js:10-71` | Zero commission-lifecycle notifications: no `commission_invoice_submitted/_approved/_rejected/_paid`, no `cp_sale_booked`. |
| F14 | `pages/cp-portal/ProspectDetailPage.js:120-170` | No "Sale booked on YYYY-MM-DD — commission accruing" banner on CP Prospect view when `pushedLead.status='Booked'`. |
| F15 | `pages/cp-portal/CommissionDashboardPage.js` | No invoice list on CP CommissionDashboard — CP must drill into each Prospect to see invoice status. |
| F16 | `pages/cp-portal/ReconciliationDashboardPage.js` (no `?prospectId=` deep-link) | No way to jump from Prospect Commission tab to its reconciliation row. |

**P2 (recommended polish — 8)**

| ID | File:line | Gap |
|---|---|---|
| F17 | `pages/sales/SaleDetailPage.js:1227-1232` | SaleDetail's CP card has no backlink to source Prospect or source Lead. |
| F18 | `pages/leads/LeadDetailPage.js:1529-1577` | LeadDetail shows `sourceProspect.notes` as text — no clickable backlink to `/partner/prospects/:id`. |
| F19 | `pages/sales/SalesListPage.js:390-405` | Sales list has CP column but no "% paid", "commission status", "trigger fired" columns. |
| F20 | `pages/leads/LeadsListPage.js:314-320` | Leads list has CP column but no filter "CP-submitted" vs "CP-attributed-by-dev". |
| F21 | `components/channel-partners/ChannelPartnerAttributionFields.js:65-91` | No Autocomplete for agent — `row.agent` is set on payload but UI never picks an agent. Defaults to `null`. |
| F22 | `pages/sales/InvoiceDetailPage.js` (zero CP refs) | Customer invoice detail page shows nothing about CP for CP-attributed sales. |
| F23 | `App.js` (no `/commission-invoices` route) | Citation URLs pointing to `/commission-invoices/:id` would 404. |
| F24 | `pages/cp-portal/ProspectDetailPage.js:165-175` | CP can edit `commissionAgreement` freely after push/booking, potentially misaligning with dev-side rule. No warning. |

### 2.3 Inconsistencies (not "bugs" per se but anti-patterns)

- `agent` vs `agentUser` — three different keys for the same field across pages (LeadDetail uses `agentUser`, populate uses `agent`, payload mappers vary).
- Two state machines for "commission paid" (`CommissionInvoice.status` vs `CommissionRecord.payouts[].status`).
- Two CP-card components (`ChannelPartnerAttributionSummary` for spare info, bespoke renderer for rich info) — same data, two displays.
- Create-vs-edit asymmetry on both Lead and Sale (Create has CP fields; Edit doesn't).

## 3. Goals & Non-Goals

### Goals
- **Lead → Sale**: CP attribution auto-inherits from Lead; manual re-tagging never required.
- **20% trigger**: fires correctly on every CP-attributed sale; auto-creates a `CommissionInvoice` in draft state.
- **Invoice payment**: cascades to close the linked `CommissionRecord.payouts[]`. Single mark-paid path.
- **CP visibility**: CP sees dev-side commission state from the Prospect Commission tab.
- **Audit trail**: every lifecycle event creates an `Interaction` log entry and fires a notification to the right party.
- **Integration test**: one end-to-end test that drives a full deal Lead→paid Commission.
- **Edge cases**: cancellation, attribution edit, no-matching-rule, refund all handled gracefully (or at minimum produce notifications instead of silent corruption).

### Non-Goals
- **Monetization / billing** (SP6 work) — explicitly deferred per user.
- **Multi-CP shared-attribution support** — keep `partners[0]`-only behavior for now; track as known limitation. Adding proper multi-CP support is a separate change. We will fix `partners[].sharePct` validation (so single-CP cases work cleanly) but the trigger and notifications will still operate on the primary partner.
- **AI/insight layer changes** (SP5 work) — leave it alone; it'll naturally start working once underlying data flows correctly.
- **Performance optimization** — out of scope; we accept current performance characteristics.
- **Schema migration tooling** — backfills are added only where needed for correctness.

## 4. Phased Fix Plan

The fix is sequenced in **8 phases**. Each phase is independently testable and produces working software. Phases 1-4 are mandatory; Phase 5-8 restore the rest of the contract.

### Phase 1 — Schema & contract corrections (foundation)

Fix the field-name confusion and missing enum values that everything else depends on.

| Task | Files | Notes |
|---|---|---|
| 1.1 Add `'Channel Partner'` to `Lead.source` enum | `models/leadModel.js` (source enum) | Required for B10. |
| 1.2 Add missing notification types | `models/notificationModel.js` (`NOTIFICATION_TYPES`) | Add: `commission_invoice_due`, `sale_booked`, `sale_cancelled`, `commission_record_created`, `commission_invoice_submitted`, `commission_invoice_approved`, `commission_invoice_rejected`, `commission_invoice_paid`, `cp_sale_booked`. (Some may already exist — verify; only add the missing.) |
| 1.3 Replace `totalAmount`/`finalAmount` reads of Sale with `salePrice` everywhere | `services/commissionInvoiceTriggerService.js:58, 65`, `services/commissionInvoiceService.js:116, 399` | Fixes B2 / B18 / B19. |
| 1.4 Convert dead `indexes:[]` block to `schema.index()` calls | `models/leadModel.js:391-399` | Fixes B30. |
| 1.5 Drop `Lead.lastContactDate` write OR add field to schema | `controllers/salesController.js:251-254`, optionally `models/leadModel.js` | Fixes B25. Recommendation: drop the write; introduce only if a UI uses it. |
| 1.6 Decide cancellation Lead status | `controllers/salesController.js:728`, `models/leadModel.js` | Fixes B14. Recommendation: revert to `'Negotiating'` (already in enum). Use `.save()` so validation fires, not `findByIdAndUpdate`. |
| 1.7 Declare `CommissionInvoice.commissionRecord` FK to be populated (already declared at `models/commissionInvoiceModel.js:65`) | (no schema change needed — wiring fix is in Phase 3) | Sets up B6 fix. |

**Acceptance:** schema valid; existing regression suites still pass; no new feature exposed yet.

### Phase 2 — Lead → Sale auto-inheritance (the root cause)

| Task | Files | Notes |
|---|---|---|
| 2.1 Extract a helper `buildSaleAttributionFromLead(lead)` | `services/salesAttributionHelper.js` (new) or inline in `salesController.js` | Returns `{viaChannelPartner, partners[], status:'tagged', history:[{event:'inherited_from_lead', at, by}]}`. |
| 2.2 Modify `createSale` to call helper when `req.body.channelPartnerAttribution` absent AND `lead.channelPartnerAttribution.viaChannelPartner === true` | `controllers/salesController.js:147-160, 228-241` | Fixes B1. Apply in BOTH Pending Approval branch AND Booked branch. |
| 2.3 Deduplicate the two attribution-write code paths into one helper | `controllers/salesController.js` | Fixes B15. |
| 2.4 Validate `sum(partners[].sharePct) === 100` in `createSale` | `controllers/salesController.js` | Fixes B7. Reject with 400 if sum ≠ 100 (within ±0.01 tolerance). |
| 2.5 Validate `Partnership.status === 'active'` for each partner at sale time | `controllers/salesController.js` | New safety net. 400 if any partner's partnership is not active. |
| 2.6 Make payment plan creation failure abort the transaction | `controllers/salesController.js:281-285` | Fixes B22. Wrap in transaction session, throw instead of console.error. |
| 2.7 Don't auto-create CommissionRecord for `Pending Approval` sales OR add cleanup on rejection | `controllers/salesController.js:203`, `services/commissionService.js` | Fixes B17. Recommendation: skip `syncCommissionForSale` for Pending Approval; run it when approval flips to Booked. |
| 2.8 Fire `sale_booked` notification on CP-attributed sale creation | `controllers/salesController.js` (post-save) | Fix for missing notification (Notification Gap from §2.2 of audit). To CP agent (`partners[0].agentUser`) + CP managers + dev sales team. |
| 2.9 Append `Interaction` log entry `'Sale created from Lead X (CP: <firm>)'` | `controllers/salesController.js` | Fixes audit gap. |

**Acceptance:** creating a Sale from a CP-attributed Lead via the dev UI (with or without the form's CP fields filled) results in a Sale that has the correct `channelPartnerAttribution` from the Lead, with no manual re-tagging. Existing dev-direct (non-CP) sales still work unchanged.

### Phase 3 — The 20% trigger working correctly

| Task | Files | Notes |
|---|---|---|
| 3.1 Trigger uses `sale.salePrice` (already fixed in Phase 1) | `services/commissionInvoiceTriggerService.js:58, 65` | Done in 1.3. |
| 3.2 In `createDraft`, look up `CommissionRecord` for `(sale._id, shadowCP._id)` and set `doc.commissionRecord = record._id` | `services/commissionInvoiceService.js:143-166` | Fixes B6. |
| 3.3 Auto-create the `CommissionInvoice` draft on threshold crossing (don't just notify) | `services/commissionInvoiceTriggerService.js:120-156` | Per user expectation §2 of complaint. After the trigger sets `Sale.commissionInvoiceTriggered=true`, call `commissionInvoiceService.createDraft` with `system` user, then notify the CP that a draft is ready for them to submit. |
| 3.4 Add notification type `commission_invoice_due` to enum (done in 1.2) AND fire it properly | `services/commissionInvoiceTriggerService.js:142-156` | Fixes B20. |
| 3.5 Re-fire trigger when `editSaleAttribution` adds attribution post-trigger | `controllers/channelPartnerController.js` (editSaleAttribution) | Edge case: a sale that was direct-then-tagged should still trigger. Reset `Sale.commissionInvoiceTriggered.at = null` on attribution change and call `checkAndFireTrigger` afresh. |

**Acceptance:** when a customer's cumulative payments cross 20% of `sale.salePrice` on a CP-attributed Sale, a `CommissionInvoice` is auto-created in `draft` status linked to the correct `CommissionRecord`. A notification fires to the CP agent + CP managers. The Sale is marked triggered atomically.

### Phase 4 — Invoice payment cascades to CommissionRecord

| Task | Files | Notes |
|---|---|---|
| 4.1 In `commissionInvoiceService.recordPayment`, after setting `inv.status='paid'`, find the linked `CommissionRecord` (via `inv.commissionRecord` FK, now populated) and mark its matching `payouts[]` entry paid | `services/commissionInvoiceService.js:336-389` | Fixes B3. Helper: `markCommissionRecordPayoutPaid(commissionRecord, paidAmount, paymentReference, paymentMethod, paidBy)`. |
| 4.2 After marking payout paid, call `record.recomputeStatus()` to flip record to `paid` / `partially_paid` | same | Reuses existing helper from `commissionRecordModel.js`. |
| 4.3 Deprecate or merge `markPayoutPaid` endpoint | `controllers/channelPartnerController.js:347-374` | Decision: keep the endpoint but make it idempotent/cross-reference the CommissionInvoice. If a paid CommissionInvoice already exists, the endpoint is a no-op with a "paid via invoice" message. Future cleanup: remove if no UI calls it. |
| 4.4 Add `cross-org commission audit log entry` on both invoice paid AND payout closed | `services/commissionInvoiceService.js`, `controllers/channelPartnerController.js` | Both write Interaction entries on the linked Lead or Sale. |

**Acceptance:** when the dev records payment on a `CommissionInvoice`, the linked `CommissionRecord.payouts[]` is automatically marked paid and the record status recomputes. No second manual click required. CP sees commission status update on the next page load.

### Phase 5 — Cancellation, attribution edits, edge cases

| Task | Files | Notes |
|---|---|---|
| 5.1 `cancelSale`: cancel open `CommissionInvoice` for that sale; cancel `CommissionRecord` if no payouts paid; mark partial-paid record's unpaid portion as cancelled | `controllers/salesController.js:712-723`, `services/commissionService.js`, `services/commissionInvoiceService.js` | Fixes B9. Add notification `sale_cancelled` to CP. |
| 5.2 `cancelSale`: use `.save()` so validators fire, revert Lead status to `'Negotiating'` (per 1.6) | `controllers/salesController.js:728` | Fixes B14. |
| 5.3 `cancelSale`: roll back `Prospect.status` on CP side via existing `syncProspectStatusFromLead` | `services/prospectService.js` | Fixes B27. |
| 5.4 `editSaleAttribution`: reset `Sale.commissionInvoiceTriggered` so trigger can re-fire for new CP | `controllers/channelPartnerController.js` | Fixes edge case from §2.3. |
| 5.5 Removing CP from attribution: cancel `CommissionRecord` and open `CommissionInvoice` | `services/commissionService.js:99-114` | Fixes B8. |
| 5.6 Re-push of rejected lead: allow CP to clear `pushedToLead` after rejection and re-push | `services/prospectService.js`, `controllers/prospectController.js` | Edge case from §2.3. Recommendation: when `leadController.decideLeadRegistration` rejects, clear `Prospect.pushedToLead` so CP can edit + re-push. Add audit entry. |
| 5.7 No-matching-CommissionRule fallback | `services/commissionService.js:36-72` | Fixes B4. When no rule matches: if Prospect's `commissionAgreement` exists on the upstream sourceProspect, use it as fallback. Otherwise fire a notification to dev `commission_rule_missing` and create the record at ₹0 with status `pending_review`. Never silently create ₹0 record. |

**Acceptance:** cancelling a Sale doesn't leave orphan commission state. Editing attribution after the trigger fires re-triggers. Removing CP attribution cancels commission. CP can re-push a rejected lead.

### Phase 6 — Frontend Lead → Sale handoff (mandatory)

| Task | Files | Notes |
|---|---|---|
| 6.1 Add "Convert to Booking" CTA on LeadDetailPage header actions | `src/pages/leads/LeadDetailPage.js` (`LeadHeader` around 332-340) | Fixes F1. Primary button; routes to `/sales/create?leadId=:id`. Visible when `lead.status` is convertible (e.g., not Lost/Junk). |
| 6.2 `CreateSalePage` reads `leadId` query param; pre-populates customer + advances wizard | `src/pages/sales/CreateSalePage.js:3142-3175` | Fixes F2. `useEffect` on mount reads `searchParams.get('leadId')`, fetches Lead via `leadAPI.getLead`, sets `selectedCustomer`. |
| 6.3 `CreateSalePage` hydrates `channelPartnerAttribution` state from upstream lead | `src/pages/sales/CreateSalePage.js:3152-3155` | Fixes F3. When `selectedCustomer.channelPartnerAttribution.viaChannelPartner === true`, copy `partners[]` into form state on lead-load. |
| 6.4 Lock the CP toggle when source lead was CP-attributed (prevent silent drop) | `src/pages/sales/CreateSalePage.js` step 1 | When `lead.channelPartnerAttribution.viaChannelPartner === true`, the `viaChannelPartner` switch is disabled (locked-on) and a help text reads "This lead was submitted via [CP firm]. Attribution is locked." |
| 6.5 Add agent Autocomplete to `ChannelPartnerAttributionFields` | `src/components/channel-partners/ChannelPartnerAttributionFields.js:65-91` | Fixes F21. Picks `agent` (or `agentUser`) from the selected CP firm's agents. Required when `viaChannelPartner=true`. |
| 6.6 Unify `agent` vs `agentUser` naming across forms and payloads | (multiple files) | Fixes inconsistency from §2.3. Recommendation: use `agentUser` (User ref) as canonical; legacy `agent` (ChannelPartnerAgent ref) stays read-only on payloads where it exists. |

**Acceptance:** dev clicks "Convert to Booking" on a CP-attributed LeadDetail → CreateSalePage opens with customer pre-filled and CP attribution locked-on with the correct firm + agent. Submitting creates a Sale with intact attribution.

### Phase 7 — Frontend Sale Detail + Payment visibility

| Task | Files | Notes |
|---|---|---|
| 7.1 Add running payment progress to SaleDetail | `src/pages/sales/SaleDetailPage.js:717-815` (extend `PaymentBreakdownCard`) | Fixes F5. Call `paymentAPI.getPaymentPlanDetails(saleId)`. Show: total received, % paid, next installment due date+amount, **a marker at the 20% line** with status "Commission invoice triggered: yes / pending / N/A". |
| 7.2 Add "Generate Commission Invoice" CTA | `src/pages/sales/SaleDetailPage.js:1234-1294` (Quick Actions) | Fixes F4. Conditional: visible only when `sale.channelPartnerAttribution.viaChannelPartner` AND `sale.commissionInvoiceTriggered.at`. Routes to the dev-initiated draft flow or opens the existing `DevCommissionInvoiceCard` if one exists. (Backend per Phase 3.3 auto-creates the draft; this button is the manual override.) |
| 7.3 Add "Record Customer Payment" CTA | `src/pages/sales/SaleDetailPage.js:1234-1294` | Fixes F4. Routes to `/payments/record?saleId=...`. |
| 7.4 Add upstream Lead + Prospect backlinks on SaleDetail CP card | `src/pages/sales/SaleDetailPage.js:1227-1232` | Fixes F17. Clickable chips: "From Lead: [name]" → `/leads/:id`; "From Prospect: [name]" → `/partner/prospects/:id`. |
| 7.5 Add upstream Prospect backlink on LeadDetail | `src/pages/leads/LeadDetailPage.js:1529-1577` | Fixes F18. Clickable chip in CP card. |
| 7.6 Snackbar feedback on RecordPaymentPage when trigger crosses | `src/pages/payments/RecordPaymentPage.js` | Fixes F9. Inspect API response for `commissionTriggered=true` (backend per Phase 3.3 sets this in the payment response payload). Show snackbar: "Customer crossed 20% — commission invoice draft created." + CTA "View invoice." |
| 7.7 PaymentPlan: mark the 20%-cumulative installment row | `src/pages/payments/PaymentPlanPage.js` | Fixes F10. Compute the installment at which cumulative paid would cross 20%; render a special row badge "🔔 Commission trigger". |

**Acceptance:** dev opens SaleDetail and sees at a glance: how much customer has paid, how close to 20%, whether invoice triggered. After recording a payment that crosses 20%, dev sees the trigger fire in real-time.

### Phase 8 — CP-side visibility + audit trail completeness

| Task | Files | Notes |
|---|---|---|
| 8.1 ProspectDetail Commission tab calls reconciliation API | `src/pages/cp-portal/ProspectDetailPage.js:383-396, 833-861` | Fixes F7. Call `cpAnalyticsAPI.getReconciliationDetail(prospect._id)`. Render dev-side received total + delta vs CP ledger inline. |
| 8.2 "Sale booked" banner on Prospect when `pushedLead.status='Booked'` | `src/pages/cp-portal/ProspectDetailPage.js:120-170` | Fixes F14. When `pushedLead` exists and is Booked, show banner: "🎉 Sale booked on YYYY-MM-DD by [Dev firm]. Commission accruing." |
| 8.3 Link from Prospect Commission tab → Reconciliation Dashboard with deep-link | `src/pages/cp-portal/ProspectDetailPage.js` Commission tab + `ReconciliationDashboardPage.js` | Fixes F16. Add "View full reconciliation →" link; ReconciliationDashboardPage accepts `?prospectId=` and auto-opens that drawer. |
| 8.4 Wire commission-lifecycle notification types in CP notification config | `src/constants/notificationConfig.js:10-71` | Fixes F13. Add display config (icon, color, route) for: `sale_booked`, `commission_invoice_submitted/_approved/_rejected/_paid`, `cp_sale_booked`. |
| 8.5 "My Commission Invoices" tab on CP CommissionDashboard | `src/pages/cp-portal/CommissionDashboardPage.js` | Fixes F15. Calls `cpCommissionInvoicesAPI.list({})` (no prospectId) for full invoice book. |
| 8.6 Dev-side commission-invoice queue page | New `src/pages/commission-invoices/DevCommissionInvoiceQueuePage.js` + route `/commission-invoices` | Fixes F6. Lists all submitted invoices across all sales/leads. Bulk approve/reject actions. |
| 8.7 EditSalePage: add CP attribution editing | `src/pages/sales/EditSalePage.js` | Fixes F11. Reuses `ChannelPartnerAttributionFields`. Calls `channelPartnerAPI.editSaleAttribution` on save. |
| 8.8 EditLeadPage: add CP attribution editing | `src/pages/leads/EditLeadPage.js` | Fixes F12. Parity with CreateLeadPage. |
| 8.9 Consolidate "mark paid" UIs | `src/pages/channel-partners/CommissionRecordListPage.js` + `src/components/leads/DevCommissionInvoiceCard.jsx` | Fixes F8. Decision (with user input): keep mark-paid on `DevCommissionInvoiceCard` (invoice-driven), make `CommissionRecordListPage` per-payout button a "view linked invoice" link instead. |

**Acceptance:** CP agent opening a Prospect sees dev-side reconciliation state inline, sees a "Sale booked" banner if applicable, and can drill straight to the reconciliation row. Dev can edit attribution post-creation from the standard Edit pages without buried dialogs.

## 5. Test Additions

### 5.1 New backend regression suite — `tests/regression/suites/lifecycle-repair-e2e.js`

This is the missing safety net. Drives a full deal Lead → paid commission.

**Scenario:**
1. Set up: CP org, dev org, active Partnership, CommissionRule on dev project (5% on salePrice, on_first_payment), a CP Prospect with `commissionAgreement`.
2. CP pushes prospect → Lead in dev org `status:'pending'`.
3. Dev accepts → Lead `status:'New'`, attribution `approved`. Assert: notification fires to CP agent.
4. Dev creates Sale via `POST /api/sales` **without** sending `channelPartnerAttribution` in body. Assert: Sale's attribution is auto-inherited from Lead.
5. Assert: `CommissionRecord` exists with `(sale, channelPartner)` unique key, non-zero `grossAmount`.
6. Assert: `sale_booked` notification fired to CP agent.
7. Record customer payments via `POST /api/payments/transactions` totaling 25% of `salePrice`.
8. Assert: `Sale.commissionInvoiceTriggered.at` set; `commission_invoice_ready` notification fired.
9. Assert: `CommissionInvoice` auto-created in `draft` with `commissionRecord` FK populated.
10. CP submits invoice via `POST /api/cp/commission-invoices/:id/submit`. Assert: notification to dev with `commission_invoices:approve`.
11. Dev approves via `POST /api/commission-invoices/:id/approve`. Assert: notification to CP.
12. Dev records payment via `POST /api/commission-invoices/:id/payment`. Assert: invoice `status='paid'`, `CommissionRecord.payouts[i].status='paid'`, `CommissionRecord.status='paid'`.
13. Call SP5 reconciliation endpoint. Assert: this prospect's row is `matched` (within ±1%).

This single test catches every bug B1–B6 plus several edge cases. **It is the highest-value addition in this entire plan.**

### 5.2 Additional backend tests

| Suite | Coverage |
|---|---|
| `tests/regression/suites/lifecycle-cancellation.js` | Sale cancellation cancels invoice + record + reverts Lead status. |
| `tests/regression/suites/lifecycle-edit-attribution.js` | Editing attribution post-trigger re-triggers; removing CP cancels commission. |
| `tests/regression/suites/lifecycle-no-rule-fallback.js` | No-matching CommissionRule falls back to Prospect.commissionAgreement; if neither, fires notification + record at ₹0 status `pending_review`. |
| `tests/regression/suites/lifecycle-share-validation.js` | createSale rejects when `partners[].sharePct` sum ≠ 100. |
| `tests/regression/suites/lifecycle-partnership-active.js` | createSale rejects when any partner's Partnership is not active. |
| `tests/regression/suites/lifecycle-rejected-repush.js` | After lead rejection, CP can clear `pushedToLead` and re-push. |

### 5.3 Frontend smoke scenarios

`CI=true npm run build` must compile clean. Manual scenarios:

1. **Convert to Booking happy path** — open CP-attributed Lead → click Convert → CreateSale opens with customer + CP pre-filled and toggle locked → submit → SaleDetail shows full attribution + backlinks to Lead + Prospect.
2. **Customer payment progress** — open SaleDetail → see 0% paid → record payment for 25% via Record CTA → snackbar fires "20% threshold crossed" → SaleDetail shows running %, threshold marker passed, "Generate Commission Invoice" CTA visible.
3. **CP-side reconciliation visibility** — open Prospect Commission tab → see dev-side received total inline → click "View full reconciliation" → ReconciliationDashboard opens with that prospect's drawer pre-opened.
4. **Sale booked notification on CP side** — CP agent has bell notification "Your prospect was booked"; click → ProspectDetail with "🎉 Sale booked" banner.
5. **Invoice paid cascades** — Dev approves + records payment on invoice → check `CommissionRecord` shows `paid` automatically (no second click needed).
6. **EditSale attribution** — dev opens existing Sale's EditSale → adjust attribution → save → CommissionRecord re-syncs (verify via `CommissionRecordListPage`).
7. **Sale cancellation** — cancel a CP-attributed Sale → CP gets `sale_cancelled` notification → ProspectDetail shows cancelled state → commission invoice (if existed) shows `cancelled`.

## 6. Risk Register

| Risk | Mitigation |
|---|---|
| **Data already in production has orphan CommissionRecords at ₹0** (B4) or sales without attribution that should have it (B1). | Write a one-time **reconciliation script** `data/reconcileLifecycleData.js` that: (a) finds Sales where `lead.channelPartnerAttribution.viaChannelPartner=true` but `sale.channelPartnerAttribution.viaChannelPartner=false`, and surfaces them for manual review (do NOT auto-fix — dev finance must verify); (b) finds CommissionRecords with `grossAmount=0` and surfaces them for manual rule-assignment. Output is a report, not a destructive change. |
| **The Phase 3.3 auto-create-draft change is a behavioral shift** — CPs who relied on getting only a notification may suddenly find drafts appearing. | Notify in the change log + release notes. The draft is non-destructive (CP can edit/delete before submit). |
| **Tests will reveal more bugs.** The end-to-end suite is likely to surface 5-10 more issues we haven't seen yet. | Budget 2 days for fix iterations after the suite is first written. Treat the integration test failure as the canonical "definition of done." |
| **Phase 4 cascade could double-process** if both `recordPayment` and `markPayoutPaid` are called for the same invoice. | Make `markPayoutPaid` idempotent: if the corresponding invoice is already paid, return 200 with `{alreadyPaidViaInvoice: true}` and no-op. |
| **Multi-CP cases (out of scope) may regress.** | The integration test uses single-CP only. Multi-CP behavior is documented as "primary partner only" and tracked as known limitation. Adding a follow-up sub-project to support multi-CP fully is a separate plan. |
| **The frontend Convert-to-Booking change requires a Lead → Customer fetch.** If the Lead lacks the data CreateSale needs (e.g., a customer record), the form must gracefully fall back. | Defensive: if hydration fails, show the form blank with a warning toast "Could not pre-fill from lead — please fill manually." Never silently break. |

## 7. Implementation Order

Sequenced for risk: each phase is independently shippable. Phases 1-4 are the load-bearing backend repairs; Phases 5-8 follow.

1. **Phase 1 — schema corrections** (1 day)
2. **Phase 2 — Lead→Sale auto-inheritance** (2 days, including helper + tests)
3. **Phase 3 — 20% trigger working + auto-draft** (1.5 days)
4. **Phase 4 — invoice payment cascade** (1 day)
5. **Phase 5 — cancellation + edits + edge cases** (2 days)
6. **Test suite — lifecycle-repair-e2e + supporting suites** (2 days — write incrementally as Phases 1-5 ship)
7. **Phase 6 — frontend Lead→Sale handoff** (1.5 days)
8. **Phase 7 — frontend SaleDetail + Payment visibility** (2 days)
9. **Phase 8 — CP-side visibility + audit trail** (2 days)
10. **Reconciliation script for production data + run report** (0.5 days)
11. **Manual smoke through all 7 scenarios + bug-fix iterations** (1 day)

**Total: ~16 working days for a single engineer; ~10 days with parallelization (frontend + backend in parallel after Phase 4).**

Phases 1-4 (the backend lifecycle repair) should ship as one cohesive commit set with the integration test included. Phases 6-8 (frontend) can ship in parallel slices.

## 8. File Summary

### Backend — modify
- `models/leadModel.js` — add `'Channel Partner'` to source enum; convert dead index block; revisit cancellation status.
- `models/notificationModel.js` — add missing notification types.
- `models/commissionInvoiceModel.js` — no schema change; verify FK declaration is correct.
- `controllers/salesController.js` — `createSale` (auto-inherit), `updateSale`, `cancelSale`, attribution helper extraction.
- `controllers/leadController.js` — `decideLeadRegistration` notification audit (verify CP-side notification on accept).
- `controllers/channelPartnerController.js` — `markPayoutPaid` idempotency + cross-reference; `editSaleAttribution` reset trigger.
- `services/commissionService.js` — no-matching-rule fallback; cancellation cleanup; multi-partner partial.
- `services/commissionInvoiceService.js` — `createDraft` populates `commissionRecord` FK; `recordPayment` cascades to record; field-name corrections.
- `services/commissionInvoiceTriggerService.js` — `salePrice` field; auto-create draft on threshold; multi-CP partial; correct notification types.
- `services/prospectService.js` — `'Channel Partner'` source; allow re-push after rejection.
- `services/paymentService.js` — surface `commissionTriggered` flag in payment response payload (for frontend snackbar).

### Backend — create
- `services/salesAttributionHelper.js` — `buildSaleAttributionFromLead(lead)` helper.
- `data/reconcileLifecycleData.js` — one-time report script.
- 7 regression suites under `tests/regression/suites/lifecycle-*.js`.

### Frontend — modify
- `src/pages/leads/LeadDetailPage.js` — Convert to Booking CTA + Prospect backlink.
- `src/pages/leads/EditLeadPage.js` — add CP attribution fields.
- `src/pages/sales/CreateSalePage.js` — `leadId` query param, customer pre-fill, CP attribution hydration, toggle lock.
- `src/pages/sales/SaleDetailPage.js` — payment progress, threshold marker, Generate Invoice + Record Payment CTAs, Lead+Prospect backlinks.
- `src/pages/sales/EditSalePage.js` — add CP attribution fields.
- `src/pages/payments/RecordPaymentPage.js` — threshold snackbar.
- `src/pages/payments/PaymentPlanPage.js` — 20%-cumulative marker.
- `src/pages/cp-portal/ProspectDetailPage.js` — reconciliation API call on Commission tab; Sale-booked banner; reconciliation deep-link.
- `src/pages/cp-portal/CommissionDashboardPage.js` — My Commission Invoices tab.
- `src/pages/cp-portal/ReconciliationDashboardPage.js` — accept `?prospectId=` deep-link.
- `src/pages/channel-partners/CommissionRecordListPage.js` — consolidate mark-paid UI.
- `src/components/leads/DevCommissionInvoiceCard.jsx` — confirm canonical mark-paid path.
- `src/components/channel-partners/ChannelPartnerAttributionFields.js` — add agent Autocomplete; unify `agent`/`agentUser`.
- `src/constants/notificationConfig.js` — wire commission-lifecycle notification types.

### Frontend — create
- `src/pages/commission-invoices/DevCommissionInvoiceQueuePage.js` + route in `src/App.js`.

## 9. Open Decisions for the Implementer

These choices are minor and can be resolved at task time without re-planning:

- **Cancellation Lead status**: revert to `'Negotiating'` vs `'Active'` (after adding `'Active'` to enum) vs keep `'Booked'` with a `cancelledFromBooked` flag. Recommend `'Negotiating'`.
- **Auto-draft creation by**: which user is the `createdBy` on the auto-generated CommissionInvoice draft? Recommendation: `Prospect.assignedAgent` (the CP agent who owns the prospect), with `Interaction` entry "Draft auto-created by system on trigger."
- **`markPayoutPaid` future**: deprecate vs keep as escape hatch. Recommendation: keep as escape hatch (some commissions are paid outside the platform) but make it cross-reference any CommissionInvoice.
- **Reconciliation script output format**: CSV vs structured JSON vs admin UI. Recommendation: CSV file written to `/tmp/lifecycle-reconciliation-report-YYYY-MM-DD.csv` for the data team to review.
- **`agent` vs `agentUser`**: which is canonical going forward? Recommendation: `agentUser` (User ref) is canonical for new code; `agent` (ChannelPartnerAgent ref) stays read-only on legacy data. Document in `models/leadModel.js`.
- **EditSale attribution permission**: do all `sales:update` users get attribution-edit, or keep behind `channel_partners:edit_booking_attribution`? Recommendation: keep separate — finance team usually owns attribution corrections.

---

**End of repair plan.** Next step: hand to an implementation session via `superpowers:writing-plans` → `superpowers:subagent-driven-development`. The end-to-end regression suite (§5.1) is the canonical "definition of done" for the entire plan.
