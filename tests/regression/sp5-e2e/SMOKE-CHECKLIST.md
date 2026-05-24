# SP5 — Manual Smoke Checklist

**Date written:** 2026-05-24
**Source spec:** [`docs/superpowers/specs/2026-05-23-channel-partner-platform-sp5-design.md`](../../../docs/superpowers/specs/2026-05-23-channel-partner-platform-sp5-design.md) §10.2

Run this after every SP5-touching deploy. The 107 regression tests under
[`tests/regression/suites/*-sp5-*.test.js`](../suites) cover backend behaviour;
this checklist covers the visual + multi-step flows that don't fit a single
assertion.

## Prerequisites

- **Live prod URL:** `https://www.prop-vantage.com`
- **API base:** `https://api.prop-vantage.com/api`
- **Test CP credentials:** `nirpeksh+offcp@scaleupapp.club` / `Demo@1234` → CP Owner of "Offplatform Test Partner"
- **Test Dev credentials:** `rohan.marwah@propvantage-demo.com` / `Demo@1234` → Builder Owner of "PropVantage Demo Realty"
- Hard-refresh (Cmd+Shift+R) to bust the previous Vercel bundle.

## 12 scenarios (spec §10.2)

| # | Scenario | How to verify | Pass criteria |
|---|---|---|---|
| 1 | **New CP org with no data** — empty states, no LLM calls | Log in as a CP whose org has 0 prospects (or watch the live PM2 logs for `[insightPipeline]` lines while on the dashboard) | Cards render `insufficient_data` empty state; no entries in `AIInsight` collection for that org; server log shows no OpenAI traffic |
| 2 | **Full-data CP** — all 5 cards render with narratives + citations | Log in as `nirpeksh+offcp@scaleupapp.club`; load `/partner/dashboard` | All 5 cards render. Each shows a real narrative (not the fallback amber chip). Citation count > 0 on at least 2 cards. Clicking a citation drills into the linked record. |
| 3 | **Generate Now on each surface; meter decrements** | Click "Generate now" inside any card. Note `onDemandGenerations` in `GET /api/cp/ai/usage` before and after. | Counter increments by 1. `scheduledGenerations` does NOT change. `totalCostUsd` rises. |
| 4 | **Exhaust quota → 429 toast + buttons disabled** | Repeatedly call `POST /api/cp/insights/pipeline_health/generate` from a script until `onDemandGenerations + scheduledGenerations + copilotMessages >= 200` | Eventually `POST` returns 429 with `{ error: 'ai_quota_exceeded', resetsAt, meter }`. Frontend shows orange toast. AIGenerateNowButton label flips to "Quota reached" and is disabled. |
| 5 | **Insights page pre-cron (Saturday)** | Visit `/partner/insights` between Mon morning and Sun 22:00 IST | "This week" tab renders `<AIScheduledPlaceholder />` with the next-Sunday-22:00-IST date readable in the user's locale. |
| 6 | **Insights page post-cron** | Visit `/partner/insights` on Monday morning IST (cron fired the previous evening) | "This week" tab renders the actual digest narrative; not the placeholder. |
| 7 | **Custom-range digest** | Open `/partner/insights` → Custom tab → pick `90d` → wait | A monthly_digest insight is generated for the chosen range. Repeating the same range within 24h returns the cached doc (no second LLM call; meter unchanged). |
| 8 | **CP Copilot — "which developer should I push more leads to?"** | Click the FAB (bottom-right) or hit ⌘J. Type the question. | Response includes a developer name from the live data set (e.g. "PropVantage Demo Realty"). Citations panel lists `/partner/developers/performance` etc. as clickable links. |
| 9 | **Dev Copilot — "which channel partner is best this quarter?"** | Log in as Rohan. Open the existing dev Copilot (`Cmd+J`). Type the question. | Response cites a real CP name (e.g. "Offplatform Test Partner"). Tool calls log includes `get_channel_partner_scorecard`. |
| 10 | **Reconciliation drill-through** | `/partner/commission/reconciliation` → click a row | Drawer opens with side-by-side CP ledger vs developer record. "Mark as reviewed" button persists; row gets a green tick when re-loaded. |
| 11 | **Sparse-data CP → confidence falls to Auto-summary** | Find / create a CP with < 3 prospects | Cards show fallback narrative (deterministic template). Badge reads "Auto-summary" amber. Tooltip explains "AI couldn't ground its answer". |
| 12 | **Cross-CP isolation** | Log in as CP A (Offplatform Test Partner). Read every narrative on dashboard + insights page + Copilot. | NO mention of any entity unique to CP B (e.g. "QA Channel Partner Demo" agents or prospects). Curl `GET /api/cp/insights/pipeline_health` as CP A and inspect — no other-org IDs in the JSON. |

## Quick regression command

```bash
# All 12 SP5 suites (no LLM cost, uses prod API for read-only assertions)
API_BASE_URL=https://api.prop-vantage.com \
  NODE_OPTIONS="--experimental-vm-modules" \
  npx jest --config=jest.regression.config.mjs tests/regression/suites/[34][0-9]-sp5*

# Expected: 12 suites passed, 107 tests passed, ~52s
```

## Cost note

The only step that incurs OpenAI cost is **step 8** (CP Copilot — 1 message ≈ $0.002) and any insights generation triggered by **steps 2, 3, 6, 7, 11** (~$0.003 per generation). Stay under the 200/day quota by default.
