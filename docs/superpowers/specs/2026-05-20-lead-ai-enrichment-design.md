# AI Lead Enrichment — Design Spec

**Date:** 2026-05-20
**Status:** Approved (design phase)
**Repos affected:** `propvantage-ai-backend`, `propvantage-ai-frontend`

## Problem

When a sales user creates a lead, they often have public links about that
person or their company (LinkedIn, company website, news articles) but no
quick way to turn them into usable context. We want the AI to read whatever
is publicly available from those links and produce a short brief plus a few
structured signals, captured on the lead and shown to anyone who views the
lead's detail page.

## Goals

- Let the user attach research source URLs while creating a lead.
- Automatically run AI research in the background on lead creation — the lead
  saves instantly and is never blocked on the AI.
- Produce a short paragraph brief plus structured signal chips.
- Show a "Researching…" state on the lead detail page that resolves to the
  populated summary (~30s).
- Allow the user to re-run research (e.g. after adding more URLs).

## Non-goals

- The enrichment output does **not** feed into or change the lead score.
  Score fields are untouched; enrichment is informational only.
- The summary and signals are **read-only** — not user-editable.
- No job-queue infrastructure (Bull/Agenda/Redis). Job state lives on the
  lead document.

## Approved approach

**Status persisted on the lead document.** On creation the lead saves with
`enrichment.status = 'pending'`, then a fire-and-forget function (`setImmediate`)
performs the web research and writes the result straight back onto the lead.
The frontend polls the existing `GET /api/leads/:id` endpoint — no in-memory
job map, no separate status endpoint. Because state is in MongoDB it survives
a `pm2 restart`, and a re-run is just flipping status back to `pending` and
re-triggering.

Rejected alternatives:

- *In-memory `activeJobs` Map* (the competitive-analysis pattern): a restart
  mid-research orphans the job, leaving the lead stuck "Researching…" forever.
  Also needs a redundant status endpoint.
- *Real job queue (Bull/Agenda + Redis)*: new infra for one lightweight job
  type. YAGNI.

## Design

### 1. Data model — `models/leadModel.js`

Add a new `enrichment` sub-document to the lead schema:

```js
enrichment: {
  sources: {                          // user-supplied, from the create form
    linkedinUrl:    { type: String, trim: true, default: '' },
    companyWebsite: { type: String, trim: true, default: '' },
    articleUrls:    [{ type: String, trim: true }],
  },
  status: {                           // job state — drives the UI
    type: String,
    enum: ['idle', 'pending', 'researching', 'completed', 'failed'],
    default: 'idle',
  },
  summary:      { type: String, default: '' },     // the 2-4 sentence brief
  signals: [{                                       // the chips
    label:    { type: String },                     // e.g. "Senior decision-maker"
    category: {
      type: String,
      enum: ['seniority', 'industry', 'employer_scale', 'wealth', 'other'],
    },
  }],
  sourcesUsed:  [{ url: String, label: String }],   // links the AI actually reached
  error:        { type: String, default: '' },      // failure reason if status=failed
  researchedAt: { type: Date, default: null },
  researchedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}
```

Status lifecycle:

- `idle` — no source URLs provided; research skipped entirely.
- `pending` — URLs provided, job queued, not yet started.
- `researching` — AI job in progress.
- `completed` — terminal success (includes the "no usable public data" case).
- `failed` — terminal; an actual API/runtime error occurred. `error` is set.

The score fields (`score`, `scoreBreakdown`, `priority`, etc.) are not
touched by this feature.

### 2. Backend flow

**On lead creation — `controllers/leadController.js`, `createLead`**

`createLead` already spreads `...req.body` into `new Lead(...)`, so a nested
`enrichment.sources` object from the frontend is persisted automatically.
After `await lead.save()`:

1. Check whether any source URL is present (`linkedinUrl`, `companyWebsite`,
   or a non-empty `articleUrls`).
2. If yes: set `lead.enrichment.status = 'pending'`, `save()`, then
   `setImmediate(() => runLeadEnrichment(lead._id, req.user._id))`.
3. If no: leave `status = 'idle'`.
4. Return the lead in the HTTP response immediately — the response is never
   blocked on the AI job.

**New service — `services/leadEnrichmentService.js`**

Exports `runLeadEnrichment(leadId, userId)`:

1. Load the lead. Set `enrichment.status = 'researching'`, `save()`.
2. **Step 1 — Web search (OpenAI `gpt-4o-search-preview`).** Build a prompt
   that asks the model to research the person and their company using the
   supplied URLs (LinkedIn, company website, article URLs) plus the lead's
   name and email. The prompt instructs the model to use only publicly
   reachable information and to state gaps honestly.
3. **Step 2 — Structured extraction (Claude `claude-sonnet-4-6`).** Extract a
   JSON object `{ summary, signals: [{ label, category }] }` from the raw
   research. `summary` is a 2-4 sentence plain-English brief; `signals` is a
   small set of tags (seniority / industry / employer_scale / wealth / other).
4. Write `summary`, `signals`, `sourcesUsed`, `researchedAt = now`,
   `researchedBy = userId`, `status = 'completed'`. `save()`.
5. The entire function body is wrapped in `try/catch`. On any error: set
   `status = 'failed'`, `error = err.message`, `save()`. The catch must never
   re-throw — an unhandled rejection out of `setImmediate` would crash the
   process.

Model IDs reuse the existing env-configurable constants from
`aiResearchService.js`: `RESEARCH_SEARCH_MODEL` (default `gpt-4o-search-preview`)
and `RESEARCH_EXTRACTION_MODEL` (default `claude-sonnet-4-6`).

**Re-run endpoint — `POST /api/leads/:id/enrich`**

New route + controller handler. Accepts an optional `sources` object in the
body (so the user can add/correct URLs before re-running). It merges any
supplied `sources` onto the lead, sets `enrichment.status = 'pending'`,
saves, triggers `setImmediate(() => runLeadEnrichment(id, req.user._id))`,
and returns HTTP 202. Org-scoped: the handler must confirm the lead belongs
to the requester's organization before acting.

### 3. Polling — no new GET endpoint

The lead detail page already calls `GET /api/leads/:id`, whose response
includes the full lead document and therefore the `enrichment` sub-document.
The frontend polls that same endpoint every ~5 seconds while
`enrichment.status` is `pending` or `researching`, and stops polling on any
terminal state (`completed`, `failed`, `idle`).

### 4. Frontend

**Create lead form** (`propvantage-ai-frontend`, lead create page under
`src/pages/leads/`)

Add a collapsible, optional "Research sources" section with three labeled
inputs:

- *LinkedIn profile URL* — single text field.
- *Company website URL* — single text field.
- *News article URL(s)* — one text field plus an "Add another" control for
  additional article URLs.

On submit these are nested into `enrichment.sources` in the create payload.
Basic client-side check that entered values look like `http(s)` URLs; the
backend trims. No heavy validation.

**Lead detail page** — a new "AI Enrichment" card:

- `status === 'idle'` — "No research sources provided" with an "Add sources"
  action that opens the re-run dialog (URL inputs + submit → `POST /enrich`).
- `status === 'pending'` or `'researching'` — spinner with
  "Researching… this usually takes ~30s"; the page polls.
- `status === 'completed'` — the summary paragraph, signal chips, a "Links
  used" list (`sourcesUsed`), the `researchedAt` timestamp, and a
  **Re-run research** button.
- `status === 'failed'` — the `error` message and a **Retry** button.

The card content is read-only; the only user actions are Re-run / Retry /
Add sources.

### 5. Error handling

- The `setImmediate` callback in `runLeadEnrichment` is fully wrapped in
  `try/catch`; failures set `status = 'failed'` and never crash the process.
- **LinkedIn caveat:** LinkedIn personal profiles sit behind an auth wall and
  are not reliably scrapable. Company websites, news articles, and the public
  web work well. The search prompt instructs the model to use whatever is
  publicly reachable and to state gaps honestly. A "no usable public data
  found" outcome still resolves as `completed` with a summary that says so —
  `failed` is reserved for genuine API/runtime errors.
- A lead stuck in `researching` (e.g. process killed mid-job) is always
  recoverable: the Re-run / Retry path works from any status.
- The re-run endpoint is organization-scoped to prevent cross-tenant access.

### 6. Testing

- Smoke script `scripts/testLeadEnrichment.js`, mirroring the structure of
  `scripts/testCompetitiveAnalysis.js`: create a lead with sample source
  URLs, poll `GET /api/leads/:id` until `enrichment.status` is `completed`,
  then assert `summary` is non-empty and `signals` is a populated array.
- Manual UI pass: create a lead with sources in the UI and watch the
  enrichment card transition `pending → researching → completed`; also
  exercise the Re-run button and the no-sources (`idle`) path.

## Cost

One OpenAI web-search call plus one Claude extraction call per lead, and the
same again per re-run. This is the same order as competitive analysis,
roughly $0.15–0.25 per run. Research only runs when the user provides at
least one source URL.

## Out of scope / future

- Editable summaries (explicitly rejected — output is AI-owned and read-only).
- Feeding signals into the lead score (explicitly rejected for this iteration).
- Bulk enrichment of existing leads.
- A background sweeper to auto-retry stale `researching` documents.
