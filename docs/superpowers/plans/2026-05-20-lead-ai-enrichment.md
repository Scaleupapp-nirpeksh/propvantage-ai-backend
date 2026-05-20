# AI Lead Enrichment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a lead is created with research source URLs (LinkedIn / company website / news articles), automatically run a background AI job that produces a short brief plus structured signal chips, shown read-only on the lead detail page.

**Architecture:** Job state is persisted on the lead document (`enrichment.status`: `idle → pending → researching → completed/failed`). `createLead` saves the lead instantly, then `setImmediate` fires a fire-and-forget research function that writes results back onto the lead. The frontend polls the existing `GET /api/leads/:id` endpoint while the status is non-terminal. A `POST /api/leads/:id/enrich` endpoint re-runs research.

**Tech Stack:** Backend — Node/Express/Mongoose. AI — OpenAI `gpt-4o-search-preview` (web search) + Anthropic `claude-sonnet-4-6` (structured extraction), both env-configurable, reusing the pattern in `services/aiResearchService.js`. Frontend — React 18 + MUI v5.

**Spec:** `docs/superpowers/specs/2026-05-20-lead-ai-enrichment-design.md`

**Two repos:**
- Backend: `/Users/nirpekshnandan/My Products/propvantage-ai-backend`
- Frontend: `/Users/nirpekshnandan/My Products/propvantage-ai-frontend`

All paths below are relative to the repo named in each task's **Files** block.

---

## Task 1: Add `enrichment` sub-document to the Lead model

**Files:**
- Modify (backend): `models/leadModel.js` — insert after the `attribution` block (currently ends at line 289 `}`), before the schema-fields closing `}` at line 290.

- [ ] **Step 1: Add the `enrichment` field to the schema**

In `models/leadModel.js`, the schema fields object currently ends with the `attribution` block:

```js
    // NEW: Campaign and marketing attribution (safe to add)
    attribution: {
      campaign: { type: String },
      medium: { type: String },
      source: { type: String },
      content: { type: String },
      term: { type: String },
      firstTouchpoint: { type: String },
      lastTouchpoint: { type: String },
      touchpointCount: { type: Number, default: 1 }
    }
  },
```

Add a comma after the `attribution` block's closing `}` and insert the `enrichment` field before the `},` that closes the schema fields object:

```js
    // NEW: Campaign and marketing attribution (safe to add)
    attribution: {
      campaign: { type: String },
      medium: { type: String },
      source: { type: String },
      term: { type: String },
      content: { type: String },
      firstTouchpoint: { type: String },
      lastTouchpoint: { type: String },
      touchpointCount: { type: Number, default: 1 }
    },

    // AI lead enrichment — background research from public web sources
    enrichment: {
      // User-supplied research source URLs (from the create form / re-run dialog)
      sources: {
        linkedinUrl: { type: String, trim: true, default: '' },
        companyWebsite: { type: String, trim: true, default: '' },
        articleUrls: [{ type: String, trim: true }],
      },
      // Background job lifecycle — drives the lead detail UI
      status: {
        type: String,
        enum: ['idle', 'pending', 'researching', 'completed', 'failed'],
        default: 'idle',
      },
      // AI output
      summary: { type: String, default: '' },
      signals: [
        {
          label: { type: String },
          category: {
            type: String,
            enum: ['seniority', 'industry', 'employer_scale', 'wealth', 'other'],
          },
        },
      ],
      sourcesUsed: [{ url: String, label: String }],
      error: { type: String, default: '' },
      researchedAt: { type: Date, default: null },
      researchedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null,
      },
    }
  },
```

Note: only the `attribution` block's trailing `}` needs a comma added after it; the field order inside `attribution` is unchanged from the original (do not reorder its keys — the block above is shown verbatim from the file). Make the single change: append `,` then the `enrichment` block.

- [ ] **Step 2: Verify the file still parses**

Run (from the backend repo root):

```bash
node --check models/leadModel.js
```

Expected: no output, exit code 0.

- [ ] **Step 3: Commit**

```bash
git add models/leadModel.js
git commit -m "feat(lead): add enrichment sub-document to lead model"
```

---

## Task 2: Create the lead enrichment service

**Files:**
- Create (backend): `services/leadEnrichmentService.js`

This service mirrors the two-step pattern of `services/aiResearchService.js`: OpenAI web search, then Claude structured extraction. It exports `runLeadEnrichment(leadId, userId)` — a fire-and-forget function that never throws.

- [ ] **Step 1: Create `services/leadEnrichmentService.js`**

```js
// File: services/leadEnrichmentService.js
// Description: AI Lead Enrichment service — background research on a lead from
//   public web sources. Two-step hybrid approach:
//     Step 1 (Web Search): OpenAI gpt-4o-search-preview
//     Step 2 (Extraction): Anthropic Claude Sonnet → { summary, signals }
//   runLeadEnrichment() is fire-and-forget: it persists status onto the lead
//   document and never throws (an unhandled rejection would crash the process).

import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Web search model — built-in browsing (OpenAI). Same env var as aiResearchService.
const SEARCH_MODEL = process.env.RESEARCH_SEARCH_MODEL || 'gpt-4o-search-preview';
// Structured extraction model — Claude Sonnet.
const EXTRACTION_MODEL = process.env.RESEARCH_EXTRACTION_MODEL || 'claude-sonnet-4-6';

const VALID_CATEGORIES = ['seniority', 'industry', 'employer_scale', 'wealth', 'other'];

// ─── Prompts ──────────────────────────────────────────────────

const buildSearchPrompt = (lead) => {
  const name = `${lead.firstName} ${lead.lastName || ''}`.trim();
  const src = lead.enrichment.sources || {};
  const articles = (src.articleUrls || []).filter(Boolean);

  return `You are a B2B research analyst helping a real estate sales team understand a prospective buyer (a "lead").

Research this person and their company using ONLY publicly available information.

Lead:
- Name: ${name}
- Email: ${lead.email || 'not provided'}

Provided sources (use these as primary anchors, and search the public web around them):
- LinkedIn profile: ${src.linkedinUrl || 'not provided'}
- Company website: ${src.companyWebsite || 'not provided'}
- News article(s): ${articles.length ? articles.join(', ') : 'not provided'}

Find and report whatever is publicly available:
- Current role / job title and seniority level
- Current employer, its industry, and rough company size (employees / revenue / scale)
- Career history highlights
- Public mentions, press, achievements, or notable affiliations
- Any signals about professional standing or financial capacity useful to a real estate salesperson

Important:
- Use ONLY publicly accessible information. LinkedIn personal profiles are often behind a login wall — if you cannot access a source, say so plainly.
- If little or nothing can be found, say that clearly. Never fabricate details.
- Be concise and factual.`;
};

// Static system prompt for extraction — invariant so it can hit the prompt cache.
const EXTRACTION_SYSTEM = `You are a data extraction specialist. You always respond with valid JSON only — no markdown fences, no comments, no explanation outside the JSON.

Your task: turn the raw web research provided in the user message into a concise enrichment record for a real estate sales team.

RULES:
1. Return ONLY valid JSON — no markdown, no comments.
2. "summary" is a 2-4 sentence plain-English brief on who this person is, their role, employer, and any notable public signals. If the research found little or nothing usable, say so honestly (e.g. "Limited public information was found for this lead.").
3. "signals" is an array of 0-6 short tags. Each tag has a "label" (2-4 words, e.g. "Senior decision-maker") and a "category" — one of: seniority, industry, employer_scale, wealth, other. Only include a signal the research clearly supports.
4. Never fabricate. Base everything strictly on the provided research.

Required JSON schema:
{
  "summary": "string",
  "signals": [
    { "label": "string", "category": "seniority|industry|employer_scale|wealth|other" }
  ]
}`;

// ─── Core ─────────────────────────────────────────────────────

/**
 * Research a lead from public web sources and write the result onto the lead.
 * Fire-and-forget: never throws. Persists status (researching → completed/failed).
 *
 * @param {ObjectId|string} leadId
 * @param {ObjectId|string} userId - who triggered the enrichment
 */
const runLeadEnrichment = async (leadId, userId) => {
  const { default: Lead } = await import('../models/leadModel.js');

  let lead;
  try {
    lead = await Lead.findById(leadId);
    if (!lead) {
      console.error(`[Lead Enrichment] Lead ${leadId} not found — aborting`);
      return;
    }

    lead.enrichment.status = 'researching';
    await lead.save();
    console.log(`[Lead Enrichment] Researching lead ${leadId}...`);

    // ── Step 1: Web search ──
    const searchResponse = await openai.chat.completions.create({
      model: SEARCH_MODEL,
      messages: [{ role: 'user', content: buildSearchPrompt(lead) }],
    });
    const rawResearch = searchResponse.choices[0].message.content || '';

    // ── Step 2: Structured extraction (retry once on JSON parse failure) ──
    let parsed;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const extractionResponse = await anthropic.messages.create({
          model: EXTRACTION_MODEL,
          max_tokens: 1500,
          temperature: attempt === 1 ? 0.2 : 0.1,
          system: [
            { type: 'text', text: EXTRACTION_SYSTEM, cache_control: { type: 'ephemeral' } },
          ],
          messages: [{ role: 'user', content: `RAW RESEARCH DATA:\n${rawResearch}` }],
        });
        const textBlock = extractionResponse.content.find((b) => b.type === 'text');
        if (!textBlock) throw new Error('No text block in extraction response');
        parsed = JSON.parse(textBlock.text);
        break;
      } catch (err) {
        if (attempt === 2) throw new Error(`Extraction failed: ${err.message}`);
      }
    }

    // ── Normalise output ──
    const summary = typeof parsed.summary === 'string' ? parsed.summary.trim() : '';
    const signals = Array.isArray(parsed.signals)
      ? parsed.signals
          .filter((s) => s && typeof s.label === 'string' && s.label.trim())
          .map((s) => ({
            label: s.label.trim(),
            category: VALID_CATEGORIES.includes(s.category) ? s.category : 'other',
          }))
          .slice(0, 6)
      : [];

    const src = lead.enrichment.sources || {};
    const sourcesUsed = [];
    if (src.linkedinUrl) sourcesUsed.push({ url: src.linkedinUrl, label: 'LinkedIn profile' });
    if (src.companyWebsite) sourcesUsed.push({ url: src.companyWebsite, label: 'Company website' });
    (src.articleUrls || [])
      .filter(Boolean)
      .forEach((u) => sourcesUsed.push({ url: u, label: 'News article' }));

    lead.enrichment.summary = summary;
    lead.enrichment.signals = signals;
    lead.enrichment.sourcesUsed = sourcesUsed;
    lead.enrichment.researchedAt = new Date();
    lead.enrichment.researchedBy = userId;
    lead.enrichment.error = '';
    lead.enrichment.status = 'completed';
    await lead.save();

    console.log(
      `[Lead Enrichment] Lead ${leadId} completed — summary ${summary.length} chars, ${signals.length} signals`
    );
  } catch (err) {
    console.error(`[Lead Enrichment] Failed for lead ${leadId}:`, err.message);
    try {
      if (lead) {
        lead.enrichment.status = 'failed';
        lead.enrichment.error = err.message;
        await lead.save();
      }
    } catch (saveErr) {
      console.error(
        `[Lead Enrichment] Could not persist failure for ${leadId}:`,
        saveErr.message
      );
    }
  }
};

export { runLeadEnrichment };
```

- [ ] **Step 2: Verify the file parses**

Run (from the backend repo root):

```bash
node --check services/leadEnrichmentService.js
```

Expected: no output, exit code 0.

- [ ] **Step 3: Commit**

```bash
git add services/leadEnrichmentService.js
git commit -m "feat(lead): add AI lead enrichment service"
```

---

## Task 3: Trigger enrichment on lead creation

**Files:**
- Modify (backend): `controllers/leadController.js` — add an import near the top and modify `createLead` (the `await lead.save()` block ends at line 98).

- [ ] **Step 1: Add the service import**

In `controllers/leadController.js`, the existing static imports at the top end with:

```js
import {
  verifyProjectAccess,
  projectAccessFilter,
} from '../utils/projectAccessHelper.js';
```

Add directly below it:

```js
import { runLeadEnrichment } from '../services/leadEnrichmentService.js';
```

- [ ] **Step 2: Trigger enrichment after the lead is saved**

In `createLead`, the current code after the lead is created is:

```js
  const createdLead = await lead.save();

  // Trigger initial score calculation in background with delay
  addLeadScoreUpdateJob(createdLead._id, { delay: 2000 }); // 2 second delay

  res.status(201).json({
    success: true,
    data: createdLead,
    message: 'Lead created successfully. Score calculation in progress.'
  });
```

Replace that block with:

```js
  const createdLead = await lead.save();

  // Trigger initial score calculation in background with delay
  addLeadScoreUpdateJob(createdLead._id, { delay: 2000 }); // 2 second delay

  // Kick off AI enrichment in the background if research source URLs were provided.
  // Status is set deterministically here — never trusted from the request body.
  const src = createdLead.enrichment?.sources || {};
  const hasSources = Boolean(
    src.linkedinUrl || src.companyWebsite || (src.articleUrls && src.articleUrls.length)
  );
  createdLead.enrichment.summary = '';
  createdLead.enrichment.signals = [];
  createdLead.enrichment.sourcesUsed = [];
  createdLead.enrichment.error = '';
  createdLead.enrichment.status = hasSources ? 'pending' : 'idle';
  await createdLead.save();

  if (hasSources) {
    setImmediate(() => runLeadEnrichment(createdLead._id, req.user._id));
  }

  res.status(201).json({
    success: true,
    data: createdLead,
    message: hasSources
      ? 'Lead created successfully. AI enrichment in progress.'
      : 'Lead created successfully. Score calculation in progress.'
  });
```

- [ ] **Step 3: Verify the file parses**

Run (from the backend repo root):

```bash
node --check controllers/leadController.js
```

Expected: no output, exit code 0.

- [ ] **Step 4: Commit**

```bash
git add controllers/leadController.js
git commit -m "feat(lead): trigger AI enrichment on lead creation"
```

---

## Task 4: Add the re-run endpoint

**Files:**
- Modify (backend): `controllers/leadController.js` — add an `enrichLead` handler and add it to the export block (currently lines 660-672).
- Modify (backend): `routes/leadRoutes.js` — import `enrichLead` and register the route.

- [ ] **Step 1: Add the `enrichLead` controller handler**

In `controllers/leadController.js`, the `getLeadById` handler ends at line 242 with `});`. Immediately after it (before the `/** @desc Update a lead ... */` comment for `updateLead`), insert:

```js

/**
 * @desc    Re-run AI enrichment for a lead
 * @route   POST /api/leads/:id/enrich
 * @access  Private
 */
const enrichLead = asyncHandler(async (req, res) => {
  const lead = await Lead.findOne({
    _id: req.params.id,
    organization: req.user.organization,
  });

  if (!lead) {
    res.status(404);
    throw new Error('Lead not found');
  }

  verifyProjectAccess(req, res, lead.project);

  // Optionally update the research source URLs before re-running
  const { sources } = req.body;
  if (sources && typeof sources === 'object') {
    if (typeof sources.linkedinUrl === 'string') {
      lead.enrichment.sources.linkedinUrl = sources.linkedinUrl.trim();
    }
    if (typeof sources.companyWebsite === 'string') {
      lead.enrichment.sources.companyWebsite = sources.companyWebsite.trim();
    }
    if (Array.isArray(sources.articleUrls)) {
      lead.enrichment.sources.articleUrls = sources.articleUrls
        .filter((u) => typeof u === 'string' && u.trim())
        .map((u) => u.trim());
    }
  }

  const src = lead.enrichment.sources;
  const hasSources = Boolean(
    src.linkedinUrl || src.companyWebsite || (src.articleUrls && src.articleUrls.length)
  );
  if (!hasSources) {
    res.status(400);
    throw new Error(
      'At least one research source URL (LinkedIn, company website, or article) is required.'
    );
  }

  lead.enrichment.status = 'pending';
  lead.enrichment.error = '';
  await lead.save();

  setImmediate(() => runLeadEnrichment(lead._id, req.user._id));

  res.status(202).json({
    success: true,
    status: 'pending',
    message: 'Lead enrichment started. Poll the lead detail endpoint for results.',
  });
});
```

- [ ] **Step 2: Add `enrichLead` to the export block**

The export block at the bottom of `controllers/leadController.js` is:

```js
export {
  createLead,
  getLeads,
  getLeadById,
  updateLead,
  deleteLead,
  addInteractionToLead,      // FIXED: Now properly exported
  getLeadInteractions,       // FIXED: Now properly exported
  assignLead,
  bulkUpdateLeads,
  getLeadStats
};
```

Add `enrichLead` to it:

```js
export {
  createLead,
  getLeads,
  getLeadById,
  enrichLead,
  updateLead,
  deleteLead,
  addInteractionToLead,      // FIXED: Now properly exported
  getLeadInteractions,       // FIXED: Now properly exported
  assignLead,
  bulkUpdateLeads,
  getLeadStats
};
```

- [ ] **Step 3: Register the route**

In `routes/leadRoutes.js`, the controller import is:

```js
import {
  createLead,
  getLeads,
  getLeadById,
  updateLead,
  addInteractionToLead,
  getLeadInteractions,
  deleteLead
} from '../controllers/leadController.js';
```

Add `enrichLead`:

```js
import {
  createLead,
  getLeads,
  getLeadById,
  enrichLead,
  updateLead,
  addInteractionToLead,
  getLeadInteractions,
  deleteLead
} from '../controllers/leadController.js';
```

Then, in the `CORE LEAD MANAGEMENT` section, after the `router.route('/:id/interactions')` block:

```js
router.route('/:id/interactions')
  .post(hasPermission(PERMISSIONS.LEADS.UPDATE), addInteractionToLead)
  .get(hasPermission(PERMISSIONS.LEADS.VIEW), getLeadInteractions);
```

Add directly below it:

```js
router.post('/:id/enrich', hasPermission(PERMISSIONS.LEADS.UPDATE), enrichLead);
```

- [ ] **Step 4: Verify both files parse**

Run (from the backend repo root):

```bash
node --check controllers/leadController.js && node --check routes/leadRoutes.js
```

Expected: no output, exit code 0.

- [ ] **Step 5: Commit**

```bash
git add controllers/leadController.js routes/leadRoutes.js
git commit -m "feat(lead): add POST /api/leads/:id/enrich re-run endpoint"
```

---

## Task 5: Backend smoke test

**Files:**
- Create (backend): `tests/testLeadEnrichment.js`

Mirrors `tests/testCompetitiveAnalysis.js`: connects to the real DB, authenticates as a demo user, creates a lead with research sources, polls until enrichment completes, asserts, then cleans up.

- [ ] **Step 1: Create `tests/testLeadEnrichment.js`**

```js
// File: tests/testLeadEnrichment.js
// Description: End-to-end test for AI Lead Enrichment.
// Usage: node tests/testLeadEnrichment.js
// Requires the backend server running locally and a seeded demo org/project/user.

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import fetch from 'node-fetch';

dotenv.config();

const BASE_URL = `http://localhost:${process.env.PORT || 3000}`;
let AUTH_TOKEN = null;
let testProjectId = null;
let createdLeadId = null;

const results = { passed: 0, failed: 0, skipped: 0 };

const log = (status, name, detail = '') => {
  const icon = status === 'PASS' ? '✅' : status === 'FAIL' ? '❌' : '⏭️';
  console.log(`  ${icon} ${name}${detail ? ` — ${detail}` : ''}`);
  if (status === 'PASS') results.passed++;
  else if (status === 'FAIL') results.failed++;
  else results.skipped++;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  console.log('  AI Lead Enrichment — End-to-End Test');
  console.log('═══════════════════════════════════════════════════\n');

  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('  Connected to MongoDB');

    const { default: Project } = await import('../models/projectModel.js');
    const { default: User } = await import('../models/userModel.js');
    const { default: Lead } = await import('../models/leadModel.js');

    const project = await Project.findOne();
    if (!project) {
      console.error('  ❌ No project found — seed demo data first.');
      process.exit(1);
    }
    testProjectId = project._id.toString();

    const user = await User.findOne({ organization: project.organization });
    if (!user) {
      console.error('  ❌ No user found in the project organization.');
      process.exit(1);
    }

    AUTH_TOKEN = jwt.sign(
      { userId: user._id.toString() },
      process.env.JWT_SECRET,
      { expiresIn: '1h', algorithm: 'HS256' }
    );
    console.log(`  Authenticated as: ${user.firstName} ${user.lastName}`);
    console.log(`  Using project: "${project.name}"\n`);

    // ── Create a lead WITH research sources ──
    console.log('📋 TEST: Create lead with research sources\n');
    const createRes = await api('POST', '/api/leads', {
      project: testProjectId,
      firstName: 'Enrichment',
      lastName: 'SmokeTest',
      phone: '+919000000001',
      source: 'Website',
      enrichment: {
        sources: {
          companyWebsite: 'https://www.tcs.com',
          articleUrls: ['https://en.wikipedia.org/wiki/Tata_Consultancy_Services'],
        },
      },
    });

    if (createRes.status === 201 && createRes.data.data?._id) {
      createdLeadId = createRes.data.data._id;
      const status = createRes.data.data.enrichment?.status;
      if (status === 'pending') {
        log('PASS', 'Lead created with enrichment status=pending', `ID: ${createdLeadId}`);
      } else {
        log('FAIL', 'Lead created but enrichment status wrong', `got "${status}"`);
      }
    } else {
      log('FAIL', 'Create lead', `${createRes.status}: ${JSON.stringify(createRes.data)}`);
      throw new Error('Cannot continue without a created lead');
    }

    // ── Poll until enrichment resolves ──
    console.log('\n📋 TEST: Poll for enrichment completion\n');
    const POLL_MS = 3000;
    const MAX_POLLS = 25;
    let polls = 0;
    let enrichment = null;
    do {
      await sleep(POLL_MS);
      const res = await api('GET', `/api/leads/${createdLeadId}`);
      enrichment = res.data.data?.enrichment;
      polls++;
    } while (
      enrichment &&
      ['pending', 'researching'].includes(enrichment.status) &&
      polls < MAX_POLLS
    );

    if (enrichment?.status === 'completed' && enrichment.summary) {
      log(
        'PASS',
        'Enrichment completed',
        `${enrichment.summary.length} char summary, ${enrichment.signals?.length || 0} signals (polled ${polls}x)`
      );
    } else if (enrichment?.status === 'failed') {
      log('FAIL', 'Enrichment failed', enrichment.error);
    } else {
      log('FAIL', 'Enrichment did not complete', `status="${enrichment?.status}" after ${polls} polls`);
    }

    // ── Re-run endpoint ──
    console.log('\n📋 TEST: Re-run endpoint returns 202\n');
    const rerunRes = await api('POST', `/api/leads/${createdLeadId}/enrich`, {});
    if (rerunRes.status === 202 && rerunRes.data.status === 'pending') {
      log('PASS', 'Re-run endpoint', 'Got 202 + status=pending');
    } else {
      log('FAIL', 'Re-run endpoint', `${rerunRes.status}: ${JSON.stringify(rerunRes.data)}`);
    }
  } catch (err) {
    console.error('\n💥 FATAL ERROR:', err.message);
  } finally {
    // ── Cleanup ──
    console.log('\n🧹 CLEANUP\n');
    if (createdLeadId) {
      const { default: Lead } = await import('../models/leadModel.js');
      await Lead.deleteOne({ _id: createdLeadId });
      console.log(`  Deleted test lead ${createdLeadId}`);
    }

    console.log('\n═══════════════════════════════════════════════════');
    console.log(`  RESULTS: ✅ ${results.passed} passed  ❌ ${results.failed} failed  ⏭️ ${results.skipped} skipped`);
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
node --check tests/testLeadEnrichment.js
```

Expected: no output, exit code 0.

- [ ] **Step 3: Run the backend server, then the smoke test**

In one terminal (backend repo root):

```bash
node server.js
```

In a second terminal (backend repo root), once the server logs that it is listening:

```bash
node tests/testLeadEnrichment.js
```

Expected: all three checks PASS — lead created with `status=pending`, enrichment reaches `completed` with a non-empty summary, re-run returns 202. If the OpenAI/Anthropic keys are unavailable in the local env, the enrichment check may FAIL with an API error in `enrichment.error` — in that case verify the lifecycle still transitioned correctly (`pending → researching → failed`) and note it; the production env has the keys.

- [ ] **Step 4: Commit**

```bash
git add tests/testLeadEnrichment.js
git commit -m "test(lead): add AI enrichment end-to-end smoke test"
```

---

## Task 6: Add `enrichLead` to the frontend API client

**Files:**
- Modify (frontend): `src/services/api.js` — `leadAPI` object (starts at line 519).

- [ ] **Step 1: Add the `enrichLead` method**

In `src/services/api.js`, the start of `leadAPI` is:

```js
export const leadAPI = {

  getLeads: (params = {}) => api.get('/leads', { params }),
  getLead: (id) => api.get(`/leads/${id}`),
  createLead: (leadData) => api.post('/leads', leadData),
  updateLead: (id, leadData) => api.put(`/leads/${id}`, leadData),
  deleteLead: (id) => api.delete(`/leads/${id}`),
```

Add the `enrichLead` line directly after `deleteLead`:

```js
export const leadAPI = {

  getLeads: (params = {}) => api.get('/leads', { params }),
  getLead: (id) => api.get(`/leads/${id}`),
  createLead: (leadData) => api.post('/leads', leadData),
  updateLead: (id, leadData) => api.put(`/leads/${id}`, leadData),
  deleteLead: (id) => api.delete(`/leads/${id}`),

  // Re-run AI enrichment for a lead. `sources` is { linkedinUrl, companyWebsite, articleUrls[] }
  enrichLead: (id, sources) => api.post(`/leads/${id}/enrich`, { sources }),
```

- [ ] **Step 2: Commit**

```bash
git add src/services/api.js
git commit -m "feat(lead): add enrichLead API client method"
```

---

## Task 7: Create the `LeadEnrichmentCard` component

**Files:**
- Create (frontend): `src/components/leads/LeadEnrichmentCard.js`

A self-contained card that renders the enrichment state and hosts the re-run / add-sources dialog.

- [ ] **Step 1: Create `src/components/leads/LeadEnrichmentCard.js`**

```jsx
// File: src/components/leads/LeadEnrichmentCard.js
// Description: Read-only AI enrichment card for the lead detail page.
//   Renders the enrichment.status lifecycle (idle / pending / researching /
//   completed / failed) and hosts the re-run / add-sources dialog.

import React, { useState } from 'react';
import {
  Card, CardContent, Typography, Box, Stack, Chip, Button, CircularProgress,
  Alert, Link, Dialog, DialogTitle, DialogContent, DialogActions, TextField,
} from '@mui/material';
import { AutoAwesome, Refresh, OpenInNew } from '@mui/icons-material';
import { leadAPI } from '../../services/api';

const CATEGORY_COLORS = {
  seniority: 'primary',
  industry: 'info',
  employer_scale: 'secondary',
  wealth: 'success',
  other: 'default',
};

const emptySources = (enrichment) => ({
  linkedinUrl: enrichment.sources?.linkedinUrl || '',
  companyWebsite: enrichment.sources?.companyWebsite || '',
  articleUrls: (enrichment.sources?.articleUrls || []).length
    ? [...enrichment.sources.articleUrls]
    : [''],
});

const LeadEnrichmentCard = ({ lead, onRefresh }) => {
  const enrichment = lead?.enrichment || {};
  const status = enrichment.status || 'idle';

  const [dialogOpen, setDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [sources, setSources] = useState(emptySources(enrichment));

  const openDialog = () => {
    setSources(emptySources(enrichment));
    setError('');
    setDialogOpen(true);
  };

  const setArticle = (i, val) => {
    setSources((prev) => {
      const next = [...prev.articleUrls];
      next[i] = val;
      return { ...prev, articleUrls: next };
    });
  };

  const addArticle = () =>
    setSources((prev) => ({ ...prev, articleUrls: [...prev.articleUrls, ''] }));

  const submitEnrichment = async () => {
    const cleanArticles = sources.articleUrls.map((u) => u.trim()).filter(Boolean);
    const payload = {
      linkedinUrl: sources.linkedinUrl.trim(),
      companyWebsite: sources.companyWebsite.trim(),
      articleUrls: cleanArticles,
    };
    if (!payload.linkedinUrl && !payload.companyWebsite && !cleanArticles.length) {
      setError('Enter at least one URL.');
      return;
    }
    try {
      setSubmitting(true);
      await leadAPI.enrichLead(lead._id, payload);
      setDialogOpen(false);
      if (onRefresh) onRefresh();
    } catch (e) {
      setError(e.response?.data?.message || 'Failed to start research.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card>
      <CardContent>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
          <Typography
            variant="h6"
            sx={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 1 }}
          >
            <AutoAwesome color="primary" />
            AI Enrichment
          </Typography>
          {status === 'completed' && (
            <Button size="small" startIcon={<Refresh />} onClick={openDialog}>
              Re-run research
            </Button>
          )}
        </Box>

        {status === 'idle' && (
          <Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              No research sources provided. Add a LinkedIn profile, company website,
              or news article and the AI will build a short brief on this lead.
            </Typography>
            <Button variant="outlined" size="small" onClick={openDialog}>
              Add sources
            </Button>
          </Box>
        )}

        {(status === 'pending' || status === 'researching') && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, py: 2 }}>
            <CircularProgress size={22} />
            <Typography variant="body2" color="text.secondary">
              Researching… this usually takes about 30 seconds.
            </Typography>
          </Box>
        )}

        {status === 'failed' && (
          <Box>
            <Alert severity="error" sx={{ mb: 2 }}>
              {enrichment.error || 'Research failed.'}
            </Alert>
            <Button variant="outlined" size="small" startIcon={<Refresh />} onClick={openDialog}>
              Retry
            </Button>
          </Box>
        )}

        {status === 'completed' && (
          <Stack spacing={2}>
            <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
              {enrichment.summary || 'No summary was generated.'}
            </Typography>

            {enrichment.signals?.length > 0 && (
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                {enrichment.signals.map((sig, i) => (
                  <Chip
                    key={i}
                    label={sig.label}
                    size="small"
                    color={CATEGORY_COLORS[sig.category] || 'default'}
                  />
                ))}
              </Box>
            )}

            {enrichment.sourcesUsed?.length > 0 && (
              <Box>
                <Typography variant="caption" color="text.secondary">
                  Links used
                </Typography>
                <Stack spacing={0.5} sx={{ mt: 0.5 }}>
                  {enrichment.sourcesUsed.map((s, i) => (
                    <Link
                      key={i}
                      href={s.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      variant="body2"
                      sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}
                    >
                      <OpenInNew sx={{ fontSize: 14 }} />
                      {s.label}
                    </Link>
                  ))}
                </Stack>
              </Box>
            )}

            {enrichment.researchedAt && (
              <Typography variant="caption" color="text.secondary">
                Generated {new Date(enrichment.researchedAt).toLocaleString()}
              </Typography>
            )}
          </Stack>
        )}
      </CardContent>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>Research sources</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {error && <Alert severity="error">{error}</Alert>}
            <TextField
              label="LinkedIn profile URL"
              fullWidth
              value={sources.linkedinUrl}
              onChange={(e) => setSources((p) => ({ ...p, linkedinUrl: e.target.value }))}
              placeholder="https://www.linkedin.com/in/..."
            />
            <TextField
              label="Company website URL"
              fullWidth
              value={sources.companyWebsite}
              onChange={(e) => setSources((p) => ({ ...p, companyWebsite: e.target.value }))}
              placeholder="https://company.com"
            />
            {sources.articleUrls.map((url, i) => (
              <TextField
                key={i}
                label={`News article URL ${i + 1}`}
                fullWidth
                value={url}
                onChange={(e) => setArticle(i, e.target.value)}
                placeholder="https://..."
              />
            ))}
            <Button size="small" onClick={addArticle} sx={{ alignSelf: 'flex-start' }}>
              + Add another article
            </Button>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button variant="contained" onClick={submitEnrichment} disabled={submitting}>
            {submitting ? 'Starting…' : 'Run research'}
          </Button>
        </DialogActions>
      </Dialog>
    </Card>
  );
};

export default LeadEnrichmentCard;
```

- [ ] **Step 2: Commit**

```bash
git add src/components/leads/LeadEnrichmentCard.js
git commit -m "feat(lead): add LeadEnrichmentCard component"
```

---

## Task 8: Add the "Research sources" section to the create-lead form

**Files:**
- Modify (frontend): `src/pages/leads/CreateLeadPage.js` — `formData` state (lines 312-360), `handleSubmit` payload (the `leadData` object starting line 471), and `renderLeadDetails()` (lines 1100-1246).

- [ ] **Step 1: Add `researchSources` to `formData`**

In `CreateLeadPage.js`, the `formData` state object ends with:

```js
    // FIXED: Follow-up with correct Interaction model enum values (Capitalized)
    scheduleFollowUp: false,
    followUpDate: null,
    followUpType: 'Call', // FIXED: Changed from 'call' to 'Call' to match Interaction model
    followUpNotes: '',
  });
```

Add `researchSources` before the closing `});`:

```js
    // FIXED: Follow-up with correct Interaction model enum values (Capitalized)
    scheduleFollowUp: false,
    followUpDate: null,
    followUpType: 'Call', // FIXED: Changed from 'call' to 'Call' to match Interaction model
    followUpNotes: '',

    // AI enrichment research sources (optional)
    researchSources: {
      linkedinUrl: '',
      companyWebsite: '',
      articleUrls: [''],
    },
  });
```

- [ ] **Step 2: Add a handler for research-source fields**

In `CreateLeadPage.js`, the `handleArrayFieldChange` function ends at:

```js
  // Handle array field changes
  const handleArrayFieldChange = (field, values) => {
    setFormData(prev => ({
      ...prev,
      [field]: values,
    }));

    if (errors[field]) {
      setErrors(prev => ({
        ...prev,
        [field]: '',
      }));
    }
  };
```

Add directly after it:

```js
  // Handle research source field changes (nested under researchSources)
  const handleResearchSourceChange = (key, value) => {
    setFormData(prev => ({
      ...prev,
      researchSources: { ...prev.researchSources, [key]: value },
    }));
  };

  const handleArticleUrlChange = (index, value) => {
    setFormData(prev => {
      const next = [...prev.researchSources.articleUrls];
      next[index] = value;
      return {
        ...prev,
        researchSources: { ...prev.researchSources, articleUrls: next },
      };
    });
  };

  const addArticleUrlField = () => {
    setFormData(prev => ({
      ...prev,
      researchSources: {
        ...prev.researchSources,
        articleUrls: [...prev.researchSources.articleUrls, ''],
      },
    }));
  };
```

- [ ] **Step 3: Add the `enrichment` payload to `handleSubmit`**

In `handleSubmit`, the `leadData` object contains this line:

```js
        notes: formData.notes.trim() || undefined,
```

Add the `enrichment` block directly after that line:

```js
        notes: formData.notes.trim() || undefined,

        // AI enrichment research sources (optional)
        enrichment: {
          sources: {
            linkedinUrl: formData.researchSources.linkedinUrl.trim(),
            companyWebsite: formData.researchSources.companyWebsite.trim(),
            articleUrls: formData.researchSources.articleUrls
              .map((u) => u.trim())
              .filter(Boolean),
          },
        },
```

- [ ] **Step 4: Add the "Research sources" UI section to `renderLeadDetails()`**

In `renderLeadDetails()`, the function ends with the Notes field followed by the container close:

```js
      <Grid item xs={12}>
        <TextField
          fullWidth
          label="Notes"
          placeholder="Add any additional notes about this lead..."
          value={formData.notes}
          onChange={handleInputChange('notes')}
          disabled={isLoading}
          multiline
          rows={4}
          helperText="Include any relevant information about the lead's preferences, conversation details, etc."
        />
      </Grid>
    </Grid>
  );
```

Insert a new `<Grid item xs={12}>` block between the Notes `</Grid>` and the closing `</Grid>` of the container:

```js
      <Grid item xs={12}>
        <TextField
          fullWidth
          label="Notes"
          placeholder="Add any additional notes about this lead..."
          value={formData.notes}
          onChange={handleInputChange('notes')}
          disabled={isLoading}
          multiline
          rows={4}
          helperText="Include any relevant information about the lead's preferences, conversation details, etc."
        />
      </Grid>

      <Grid item xs={12}>
        <Accordion>
          <AccordionSummary expandIcon={<ExpandMore />}>
            <Box>
              <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                Research sources (optional)
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Add public links and the AI will build a short brief on this lead in the background.
              </Typography>
            </Box>
          </AccordionSummary>
          <AccordionDetails>
            <Grid container spacing={2}>
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  label="LinkedIn profile URL"
                  placeholder="https://www.linkedin.com/in/..."
                  value={formData.researchSources.linkedinUrl}
                  onChange={(e) => handleResearchSourceChange('linkedinUrl', e.target.value)}
                  disabled={isLoading}
                />
              </Grid>
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  label="Company website URL"
                  placeholder="https://company.com"
                  value={formData.researchSources.companyWebsite}
                  onChange={(e) => handleResearchSourceChange('companyWebsite', e.target.value)}
                  disabled={isLoading}
                />
              </Grid>
              {formData.researchSources.articleUrls.map((url, index) => (
                <Grid item xs={12} key={index}>
                  <TextField
                    fullWidth
                    label={`News article URL ${index + 1}`}
                    placeholder="https://..."
                    value={url}
                    onChange={(e) => handleArticleUrlChange(index, e.target.value)}
                    disabled={isLoading}
                  />
                </Grid>
              ))}
              <Grid item xs={12}>
                <Button size="small" onClick={addArticleUrlField} disabled={isLoading}>
                  + Add another article
                </Button>
              </Grid>
            </Grid>
          </AccordionDetails>
        </Accordion>
      </Grid>
    </Grid>
  );
```

- [ ] **Step 5: Ensure the MUI imports exist**

`renderLeadDetails()` now uses `Accordion`, `AccordionSummary`, `AccordionDetails`, and the `ExpandMore` icon. Check the import block at the top of `CreateLeadPage.js`.

Run (from the frontend repo root):

```bash
grep -nE "Accordion|ExpandMore" src/pages/leads/CreateLeadPage.js | head -20
```

If `Accordion`, `AccordionSummary`, or `AccordionDetails` are not already imported from `@mui/material`, add them to the existing `@mui/material` import. If `ExpandMore` is not already imported from `@mui/icons-material`, add it to the existing `@mui/icons-material` import. (Both `Button` and `TextField` are already used in this file, so they are already imported.)

- [ ] **Step 6: Commit**

```bash
git add src/pages/leads/CreateLeadPage.js
git commit -m "feat(lead): add research sources section to create-lead form"
```

---

## Task 9: Wire the enrichment card and polling into the lead detail page

**Files:**
- Modify (frontend): `src/pages/leads/LeadDetailPage.js` — import the card, modify `LeadOverview` (line 377), modify `fetchLead` (lines 1254-1282), add a polling effect, and update the `LeadOverview` render call (line 1386).

- [ ] **Step 1: Import the `LeadEnrichmentCard` component**

In `LeadDetailPage.js`, line 79 is:

```js
import { leadAPI, aiAPI } from '../../services/api';
```

Add directly below it:

```js
import LeadEnrichmentCard from '../../components/leads/LeadEnrichmentCard';
```

- [ ] **Step 2: Render the card inside `LeadOverview`**

The `LeadOverview` component currently starts:

```js
const LeadOverview = ({ lead }) => {
  return (
    <Grid container spacing={3}>
      {/* Contact Information */}
      <Grid item xs={12} md={6}>
```

Change the signature to accept `onRefresh`, and add the enrichment card as the first full-width grid item:

```js
const LeadOverview = ({ lead, onRefresh }) => {
  return (
    <Grid container spacing={3}>
      {/* AI Enrichment */}
      <Grid item xs={12}>
        <LeadEnrichmentCard lead={lead} onRefresh={onRefresh} />
      </Grid>

      {/* Contact Information */}
      <Grid item xs={12} md={6}>
```

- [ ] **Step 3: Make `fetchLead` support a silent (no-spinner) refetch**

The current `fetchLead` is:

```js
  const fetchLead = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      console.log('🔄 Fetching lead data for ID:', leadId);

      const response = await leadAPI.getLead(leadId);
      
      console.log('✅ Lead API response:', response.data);

      let leadData;
      if (response.data.data) {
        leadData = response.data.data;
      } else if (response.data.lead) {
        leadData = response.data.lead;
      } else {
        leadData = response.data;
      }

      setLead(leadData);

    } catch (error) {
      console.error('❌ Error fetching lead:', error);
      setError('Failed to load lead details. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [leadId]);
```

Replace it with a version that accepts an optional `{ silent }` flag — silent refetches (polling) skip the full-page spinner and error banner:

```js
  const fetchLead = useCallback(async (opts = {}) => {
    const { silent = false } = opts;
    try {
      if (!silent) {
        setLoading(true);
        setError(null);
      }

      const response = await leadAPI.getLead(leadId);

      let leadData;
      if (response.data.data) {
        leadData = response.data.data;
      } else if (response.data.lead) {
        leadData = response.data.lead;
      } else {
        leadData = response.data;
      }

      setLead(leadData);

    } catch (error) {
      console.error('❌ Error fetching lead:', error);
      if (!silent) {
        setError('Failed to load lead details. Please try again.');
      }
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }, [leadId]);
```

- [ ] **Step 4: Add the enrichment polling effect**

The current initial-load effect is:

```js
  // Initial data load
  useEffect(() => {
    if (leadId) {
      fetchLead();
    }
  }, [fetchLead, leadId]);
```

Add a second effect directly after it. Each silent refetch replaces the `lead` object reference, which re-runs this effect; it schedules the next poll only while the status is non-terminal:

```js
  // Initial data load
  useEffect(() => {
    if (leadId) {
      fetchLead();
    }
  }, [fetchLead, leadId]);

  // Poll while AI enrichment is running
  useEffect(() => {
    const status = lead?.enrichment?.status;
    if (status === 'pending' || status === 'researching') {
      const timer = setTimeout(() => fetchLead({ silent: true }), 5000);
      return () => clearTimeout(timer);
    }
  }, [lead, fetchLead]);
```

- [ ] **Step 5: Pass `onRefresh` to `LeadOverview`**

The tab content render is:

```js
      {/* Tab Content */}
      {activeTab === 0 && <LeadOverview lead={lead} />}
      {activeTab === 1 && <AIInsights lead={lead} />}
```

Change the `LeadOverview` line to pass `onRefresh`:

```js
      {/* Tab Content */}
      {activeTab === 0 && <LeadOverview lead={lead} onRefresh={fetchLead} />}
      {activeTab === 1 && <AIInsights lead={lead} />}
```

- [ ] **Step 6: Commit**

```bash
git add src/pages/leads/LeadDetailPage.js
git commit -m "feat(lead): show AI enrichment card with polling on lead detail"
```

---

## Task 10: Manual end-to-end verification

**Files:** none (verification only).

- [ ] **Step 1: Start both servers**

Backend (backend repo root):

```bash
node server.js
```

Frontend (frontend repo root):

```bash
npm start
```

- [ ] **Step 2: Create a lead WITH research sources**

In the browser, go to Create Lead. Fill the required fields (first name, phone, project). On the "Lead Details" step, expand "Research sources (optional)" and enter a company website URL (e.g. `https://www.tcs.com`) and optionally a news article URL. Submit.

Expected: the lead is created immediately (no waiting on the AI).

- [ ] **Step 3: Watch the enrichment card transition**

Open the new lead's detail page (Overview tab). The "AI Enrichment" card should show "Researching… this usually takes about 30 seconds" with a spinner, then — without a manual refresh — transition to the completed state showing a summary paragraph, signal chips, a "Links used" list, and a timestamp.

Expected: the transition happens automatically via polling within ~30-60s.

- [ ] **Step 4: Exercise Re-run**

On the completed card, click "Re-run research". The dialog should open pre-filled with the existing source URLs. Submit it; the card should return to the "Researching…" state and then resolve again.

- [ ] **Step 5: Verify the idle path**

Create another lead WITHOUT any research sources. On its detail page the "AI Enrichment" card should show "No research sources provided" with an "Add sources" button. Click it, add a URL, submit — the card should begin researching.

- [ ] **Step 6: Final commit (if any verification-driven fixes were made)**

If Steps 2-5 surfaced bugs and you fixed them, commit those fixes with a descriptive message. If everything worked, there is nothing to commit for this task.

---

## Notes for the implementer

- **Two repos.** Tasks 1-5 are in `propvantage-ai-backend`; Tasks 6-9 are in `propvantage-ai-frontend`. Run each task's git commands from the repo named in that task's **Files** block.
- **AI keys.** `OPENAI_API_KEY` and `ANTHROPIC_API_KEY` must be present in the backend `.env` for enrichment to actually complete. Without them the lifecycle still works (`pending → researching → failed` with an error message) — that is correct behavior, not a bug.
- **Deployment.** Both repos auto-deploy on push to `main` (backend via GitHub Actions → SSM; frontend via Vercel). Do not push until the user has reviewed the work.
- **No score coupling.** The enrichment output must never write to `score`, `scoreBreakdown`, `priority`, or `confidence`. It is informational only.
