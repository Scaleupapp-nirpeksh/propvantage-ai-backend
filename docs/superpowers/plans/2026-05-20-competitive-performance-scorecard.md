# Competitive Performance Scorecard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A project-centric Competitive Performance Scorecard — pick a project, see how it benchmarks against the market and competitors across pricing, velocity, inventory, positioning, and demand.

**Architecture:** One synchronous endpoint computes five verified pillars + a competitor leaderboard via DB aggregation. A second endpoint runs an async AI job (web search → Claude synthesis) producing a verdict, recommendations, and a confidence-scored market-demand read; it reuses the controller's existing `activeJobs` Map and 202-polling contract. The frontend renders verified charts instantly and polls for the AI block.

**Tech Stack:** Backend — Node/Express/Mongoose. AI — OpenAI `gpt-4o-search-preview` (web search) + Anthropic `claude-sonnet-4-6` (synthesis), env-configurable, mirroring `services/aiResearchService.js`. Frontend — React 18 + MUI v5.

**Spec:** `docs/superpowers/specs/2026-05-20-competitive-performance-scorecard-design.md`

**Refinement vs spec:** The spec said the AI block reuses `getAnalysis` with a new `analysisType`. In practice `generateAnalysis` is a competitor-data analysis service with no web-search step, and threading a new type through it (plus the `CompetitiveAnalysis` cache schema) is more coupling than it's worth. This plan instead adds a **dedicated** `getScorecardAnalysis` handler that reuses the *same* `activeJobs` Map and 202-polling contract, backed by a new `scorecardAIService.js`. Completed AI jobs are retained 30 minutes in-memory (cost control) rather than DB-cached. User-visible behaviour is identical.

**Two repos:**
- Backend: `/Users/nirpekshnandan/My Products/propvantage-ai-backend`
- Frontend: `/Users/nirpekshnandan/My Products/propvantage-ai-frontend`

All paths in each task are relative to the repo named in that task's **Files** block. Work on `main`; commit per task with the given messages; do **not** push.

---

## Task 1: Scorecard data-aggregation service

**Files:**
- Create (backend): `services/scorecardService.js`

This service computes the five verified pillars + leaderboard from the org's own data and tracked competitors. Pure DB aggregation — no AI.

- [ ] **Step 1: Create `services/scorecardService.js`**

```js
// File: services/scorecardService.js
// Description: Builds the Competitive Performance Scorecard for a project —
//   five verified pillars (pricing, velocity, inventory, positioning, demand)
//   plus a competitor leaderboard, computed from the org's own data and the
//   competitors tracked in the project's locality. No AI; pure aggregation.

// ─── Math helpers ─────────────────────────────────────────────

const round = (n, dp = 2) => {
  if (n === null || n === undefined || Number.isNaN(n)) return null;
  const f = 10 ** dp;
  return Math.round(n * f) / f;
};

const mean = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);

const percentileOf = (sortedAsc, value) => {
  if (!sortedAsc.length) return null;
  const below = sortedAsc.filter((v) => v < value).length;
  return round((below / sortedAsc.length) * 100, 0);
};

const quantile = (sortedAsc, q) => {
  if (!sortedAsc.length) return null;
  const pos = (sortedAsc.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  const next = sortedAsc[base + 1] !== undefined ? sortedAsc[base + 1] : sortedAsc[base];
  return round(sortedAsc[base] + rest * (next - sortedAsc[base]));
};

const monthsBetween = (from, to) => {
  const ms = to.getTime() - from.getTime();
  return Math.max(1, ms / (1000 * 60 * 60 * 24 * 30.44));
};

// ─── Core ─────────────────────────────────────────────────────

/**
 * Build the competitive performance scorecard for a project.
 * Throws Error('Project not found') if the project is missing or not in the org.
 *
 * @param {ObjectId|string} organizationId
 * @param {ObjectId|string} projectId
 * @returns {Object} the scorecard payload
 */
const buildScorecard = async (organizationId, projectId) => {
  const { default: Project } = await import('../models/projectModel.js');
  const { default: Unit } = await import('../models/unitModel.js');
  const { default: Sale } = await import('../models/salesModel.js');
  const { default: Lead } = await import('../models/leadModel.js');
  const { default: CompetitorProject } = await import('../models/competitorProjectModel.js');

  const project = await Project.findOne({ _id: projectId, organization: organizationId });
  if (!project) throw new Error('Project not found');

  const city = project.location?.city || '';
  const area = project.location?.area || '';

  const [units, sales, leads, competitors] = await Promise.all([
    Unit.find({ project: projectId, organization: organizationId }),
    Sale.find({ project: projectId }),
    Lead.find({ project: projectId, organization: organizationId }),
    CompetitorProject.find({
      organization: organizationId,
      isActive: true,
      'location.city': new RegExp(`^${city.trim()}$`, 'i'),
      'location.area': new RegExp(`^${area.trim()}$`, 'i'),
    }),
  ]);

  const now = new Date();

  // ── Pricing ──────────────────────────────────────────────
  const unitPsf = (u) =>
    u.areaSqft && u.areaSqft > 0 && u.currentPrice ? u.currentPrice / u.areaSqft : null;

  const yourPsfValues = units.map(unitPsf).filter((v) => v !== null);
  const yourAvgPsf = round(mean(yourPsfValues));

  const marketPsfValues = competitors
    .map((c) => c.pricing?.pricePerSqft?.avg)
    .filter((v) => typeof v === 'number' && v > 0)
    .sort((a, b) => a - b);

  const market = {
    min: marketPsfValues[0] ?? null,
    p25: quantile(marketPsfValues, 0.25),
    median: quantile(marketPsfValues, 0.5),
    p75: quantile(marketPsfValues, 0.75),
    max: marketPsfValues[marketPsfValues.length - 1] ?? null,
    avg: round(mean(marketPsfValues)),
  };

  // Per-unit-type pricing: your psf vs competitor unitMix psf for the same type
  const unitTypes = [...new Set(units.map((u) => u.type).filter(Boolean))];
  const byUnitType = unitTypes.map((ut) => {
    const yourTypePsf = round(
      mean(units.filter((u) => u.type === ut).map(unitPsf).filter((v) => v !== null))
    );
    const mktRanges = competitors
      .flatMap((c) => c.unitMix || [])
      .filter((m) => m.unitType === ut && m.pricePerSqftRange)
      .map((m) => m.pricePerSqftRange);
    const mins = mktRanges.map((r) => r.min).filter((v) => typeof v === 'number' && v > 0);
    const maxs = mktRanges.map((r) => r.max).filter((v) => typeof v === 'number' && v > 0);
    const marketPsf = {
      min: mins.length ? Math.min(...mins) : null,
      avg: round(mean([...mins, ...maxs])),
      max: maxs.length ? Math.max(...maxs) : null,
    };
    const deltaPct =
      yourTypePsf && marketPsf.avg
        ? round(((yourTypePsf - marketPsf.avg) / marketPsf.avg) * 100)
        : null;
    return { unitType: ut, yourPsf: yourTypePsf, marketPsf, deltaPct };
  });

  const pricing = {
    yourAvgPsf,
    market,
    yourPercentile:
      yourAvgPsf !== null ? percentileOf(marketPsfValues, yourAvgPsf) : null,
    premiumDiscountPct:
      yourAvgPsf !== null && market.avg
        ? round(((yourAvgPsf - market.avg) / market.avg) * 100)
        : null,
    byUnitType,
    competitorCount: competitors.length,
  };

  // ── Velocity ─────────────────────────────────────────────
  const totalUnits = units.length;
  const soldUnits = units.filter((u) => ['sold', 'booked'].includes(u.status)).length;
  const availableUnits = units.filter((u) => u.status === 'available').length;

  const liveSales = sales.filter((s) => s.status !== 'Cancelled');
  const revenueAchieved = round(
    liveSales.reduce((sum, s) => sum + (s.salePrice || 0), 0),
    0
  );
  const saleDates = liveSales
    .map((s) => s.bookingDate || s.createdAt)
    .filter(Boolean)
    .map((d) => new Date(d));
  const earliestSale = saleDates.length
    ? new Date(Math.min(...saleDates.map((d) => d.getTime())))
    : null;
  const monthsActive = earliestSale ? round(monthsBetween(earliestSale, now), 1) : null;
  const unitsPerMonth =
    monthsActive && liveSales.length ? round(liveSales.length / monthsActive, 2) : null;

  let projectedSelloutDate = null;
  if (unitsPerMonth && unitsPerMonth > 0 && availableUnits > 0) {
    const d = new Date(now);
    d.setMonth(d.getMonth() + Math.ceil(availableUnits / unitsPerMonth));
    projectedSelloutDate = d.toISOString().slice(0, 10);
  }

  const velocity = {
    totalUnits,
    soldUnits,
    availableUnits,
    percentSold: totalUnits ? round((soldUnits / totalUnits) * 100, 1) : null,
    monthsActive,
    unitsPerMonth,
    revenueAchieved,
    targetRevenue: project.targetRevenue || null,
    revenuePercent: project.targetRevenue
      ? round((revenueAchieved / project.targetRevenue) * 100, 1)
      : null,
    projectedSelloutDate,
  };

  // ── Inventory ────────────────────────────────────────────
  const unsoldByType = {};
  units
    .filter((u) => u.status === 'available')
    .forEach((u) => {
      const t = u.type || 'Unspecified';
      unsoldByType[t] = (unsoldByType[t] || 0) + 1;
    });

  const competingByType = {};
  competitors
    .flatMap((c) => c.unitMix || [])
    .forEach((m) => {
      const t = m.unitType || 'Unspecified';
      if (!competingByType[t]) competingByType[t] = { totalCount: 0, availableCount: 0 };
      competingByType[t].totalCount += m.totalCount || 0;
      competingByType[t].availableCount += m.availableCount || 0;
    });

  const inventory = {
    yourUnsoldByType: Object.entries(unsoldByType).map(([unitType, count]) => ({
      unitType,
      count,
    })),
    competingSupplyByType: Object.entries(competingByType).map(([unitType, v]) => ({
      unitType,
      totalCount: v.totalCount,
      availableCount: v.availableCount,
    })),
    monthsOfInventory:
      unitsPerMonth && unitsPerMonth > 0 ? round(availableUnits / unitsPerMonth, 1) : null,
  };

  // ── Positioning ──────────────────────────────────────────
  const positioning = {
    your: { status: project.status || null, totalUnits: project.totalUnits || null },
    competitors: competitors.map((c) => ({
      name: c.projectName,
      projectStatus: c.projectStatus || null,
      possession:
        c.possessionTimeline?.description ||
        (c.possessionTimeline?.expectedDate
          ? new Date(c.possessionTimeline.expectedDate).toISOString().slice(0, 10)
          : null),
      totalUnits: c.totalUnits || null,
    })),
  };

  // ── Demand (own leads) ───────────────────────────────────
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const trendMonths = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    trendMonths.push({ key: d.toISOString().slice(0, 7), count: 0 });
  }
  leads.forEach((l) => {
    const key = new Date(l.createdAt).toISOString().slice(0, 7);
    const bucket = trendMonths.find((m) => m.key === key);
    if (bucket) bucket.count += 1;
  });
  const qualityMix = {};
  leads.forEach((l) => {
    const g = l.scoreGrade || 'D';
    qualityMix[g] = (qualityMix[g] || 0) + 1;
  });

  const demand = {
    yourLeads: {
      total: leads.length,
      last30d: leads.filter((l) => new Date(l.createdAt) >= thirtyDaysAgo).length,
      trend: trendMonths.map((m) => ({ month: m.key, count: m.count })),
      qualityMix: Object.entries(qualityMix).map(([grade, count]) => ({ grade, count })),
    },
  };

  // ── Leaderboard ──────────────────────────────────────────
  const leaderboard = competitors
    .map((c) => {
      const avgPsf = c.pricing?.pricePerSqft?.avg || null;
      const deltaPsfPct =
        avgPsf && yourAvgPsf ? round(((avgPsf - yourAvgPsf) / yourAvgPsf) * 100) : null;
      return {
        competitorId: c._id,
        name: c.projectName,
        developer: c.developerName,
        avgPsf,
        deltaPsfPct,
        projectStatus: c.projectStatus || null,
        _distance: avgPsf && yourAvgPsf ? Math.abs(avgPsf - yourAvgPsf) : Number.MAX_SAFE_INTEGER,
      };
    })
    .sort((a, b) => a._distance - b._distance)
    .map((row, i) => {
      const { _distance, ...rest } = row;
      return { ...rest, threatRank: i + 1 };
    });

  return {
    project: {
      id: project._id,
      name: project.name,
      city,
      area,
      status: project.status || null,
      totalUnits: project.totalUnits || null,
      targetRevenue: project.targetRevenue || null,
    },
    pricing,
    velocity,
    inventory,
    positioning,
    demand,
    leaderboard,
    meta: {
      hasCompetitorData: competitors.length > 0,
      locality: [area, city].filter(Boolean).join(', '),
      generatedAt: now.toISOString(),
    },
  };
};

export { buildScorecard };
```

- [ ] **Step 2: Verify the file parses**

Run (from the backend repo root):

```bash
node --check services/scorecardService.js
```

Expected: no output, exit code 0.

- [ ] **Step 3: Commit**

```bash
git add services/scorecardService.js
git commit -m "feat(scorecard): add competitive performance data-aggregation service"
```

---

## Task 2: Scorecard AI service

**Files:**
- Create (backend): `services/scorecardAIService.js`

Web search for micro-market demand, then Claude synthesis into a verdict + recommendations + confidence-scored market-demand read. Mirrors `services/aiResearchService.js`.

- [ ] **Step 1: Create `services/scorecardAIService.js`**

```js
// File: services/scorecardAIService.js
// Description: AI layer for the Competitive Performance Scorecard.
//   Step 1 (web search): OpenAI gpt-4o-search-preview researches micro-market
//     demand/absorption (consultancy reports, RERA, credible news).
//   Step 2 (synthesis): Claude turns the scorecard data + raw research into
//     { verdict, recommendations, marketDemand } with a conservative
//     confidence score on the market-demand read.

import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { buildScorecard } from './scorecardService.js';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SEARCH_MODEL = process.env.RESEARCH_SEARCH_MODEL || 'gpt-4o-search-preview';
const EXTRACTION_MODEL = process.env.RESEARCH_EXTRACTION_MODEL || 'claude-sonnet-4-6';

const VALID_SIGNALS = ['strong', 'moderate', 'soft', 'unclear'];

const confidenceLabel = (score) => {
  if (score >= 70) return 'High';
  if (score >= 40) return 'Medium';
  return 'Low';
};

const buildSearchPrompt = (city, area) =>
  `You are a real estate market research analyst specialising in Indian property markets.

Research current BUYER DEMAND and ABSORPTION for residential real estate in ${area}, ${city}, India.

Look specifically for:
- Quarterly absorption / sales-velocity data from named consultancies (Anarock, Knight Frank, JLL, CBRE, PropEquity, Liases Foras).
- RERA registration trends for this city / micro-market.
- Credible news on demand, unsold inventory, or launches in this locality.

Report what you find with explicit attribution (name the source and its date for every figure). If you cannot find hard data for this specific micro-market, say so plainly — do not substitute city-wide or estimated numbers without flagging them as such. Never fabricate figures.`;

const SYNTHESIS_SYSTEM = `You are an expert Indian real estate market analyst advising a project's promoter. You always respond with valid JSON only — no markdown, no comments, no text outside the JSON.

You receive (a) a structured performance scorecard for the promoter's project and (b) raw web research on the micro-market's demand. Produce:

1. "verdict": one factual sentence on where this project stands vs its market (reference its pricing percentile and sales velocity).
2. "recommendations": exactly 3 short, specific, actionable strings for the promoter.
3. "marketDemand": a read of the micro-market's buyer demand:
   - "signal": one of strong | moderate | soft | unclear
   - "confidence": integer 0-100, scored CONSERVATIVELY:
       70-100 only if backed by named consultancy absorption data or RERA figures specific to this city/micro-market;
       40-69 if backed by credible but indirect data (city-level, dated, or adjacent locality);
       0-39 if only general commentary, or little was found.
   - "summary": 2-3 sentences on the demand picture.
   - "sources": array of { "url", "title" } actually cited in the research (may be empty).

Base everything strictly on the inputs. Never fabricate. Respond ONLY with:
{
  "verdict": "string",
  "recommendations": ["string","string","string"],
  "marketDemand": {
    "signal": "strong|moderate|soft|unclear",
    "confidence": 0,
    "summary": "string",
    "sources": [{ "url": "string", "title": "string" }]
  }
}`;

/**
 * Generate the AI block for a project's scorecard.
 * @param {Object} params
 * @param {ObjectId|string} params.organizationId
 * @param {ObjectId|string} params.projectId
 * @returns {Object} { verdict, recommendations, marketDemand }
 */
const generateScorecardAnalysis = async ({ organizationId, projectId }) => {
  const scorecard = await buildScorecard(organizationId, projectId);
  const { project, pricing, velocity } = scorecard;

  console.log(
    `[Scorecard AI] Generating analysis for "${project.name}" (${project.area}, ${project.city})...`
  );

  // ── Step 1: Web search ──
  let rawResearch = '';
  try {
    const searchResponse = await openai.chat.completions.create({
      model: SEARCH_MODEL,
      messages: [{ role: 'user', content: buildSearchPrompt(project.city, project.area) }],
    });
    rawResearch = searchResponse.choices[0].message.content || '';
  } catch (err) {
    console.error('[Scorecard AI] Web search failed:', err.message);
    rawResearch = 'Web search unavailable.';
  }

  // ── Step 2: Synthesis ──
  const scorecardSummary = JSON.stringify(
    {
      project: project.name,
      locality: scorecard.meta.locality,
      yourAvgPsf: pricing.yourAvgPsf,
      marketAvgPsf: pricing.market.avg,
      yourPricePercentile: pricing.yourPercentile,
      premiumDiscountPct: pricing.premiumDiscountPct,
      percentSold: velocity.percentSold,
      unitsPerMonth: velocity.unitsPerMonth,
      revenuePercent: velocity.revenuePercent,
      competitorCount: pricing.competitorCount,
    },
    null,
    2
  );

  let parsed;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = await anthropic.messages.create({
        model: EXTRACTION_MODEL,
        max_tokens: 1500,
        temperature: attempt === 1 ? 0.2 : 0.1,
        system: [
          { type: 'text', text: SYNTHESIS_SYSTEM, cache_control: { type: 'ephemeral' } },
        ],
        messages: [
          {
            role: 'user',
            content: `PROJECT SCORECARD:\n${scorecardSummary}\n\nRAW MARKET RESEARCH:\n${rawResearch}`,
          },
        ],
      });
      const textBlock = response.content.find((b) => b.type === 'text');
      if (!textBlock) throw new Error('No text block in synthesis response');
      parsed = JSON.parse(textBlock.text);
      break;
    } catch (err) {
      if (attempt === 2) throw new Error(`Scorecard synthesis failed: ${err.message}`);
    }
  }

  // ── Normalise ──
  const md = parsed.marketDemand || {};
  const confidence = Math.max(0, Math.min(100, Math.round(Number(md.confidence) || 0)));
  const marketDemand = {
    signal: VALID_SIGNALS.includes(md.signal) ? md.signal : 'unclear',
    confidence,
    confidenceLabel: confidenceLabel(confidence),
    summary: typeof md.summary === 'string' ? md.summary.trim() : '',
    sources: Array.isArray(md.sources)
      ? md.sources
          .filter((s) => s && typeof s.url === 'string')
          .map((s) => ({ url: s.url, title: s.title || s.url }))
          .slice(0, 8)
      : [],
  };

  return {
    verdict: typeof parsed.verdict === 'string' ? parsed.verdict.trim() : '',
    recommendations: Array.isArray(parsed.recommendations)
      ? parsed.recommendations.filter((r) => typeof r === 'string' && r.trim()).slice(0, 3)
      : [],
    marketDemand,
    generatedAt: new Date().toISOString(),
  };
};

export { generateScorecardAnalysis };
```

- [ ] **Step 2: Verify the file parses**

Run (from the backend repo root):

```bash
node --check services/scorecardAIService.js
```

Expected: no output, exit code 0.

- [ ] **Step 3: Commit**

```bash
git add services/scorecardAIService.js
git commit -m "feat(scorecard): add AI verdict + market-demand service"
```

---

## Task 3: Controller handlers

**Files:**
- Modify (backend): `controllers/competitiveAnalysisController.js`

Add `getScorecard` (synchronous) and `getScorecardAnalysis` (async, reusing the existing module-level `activeJobs` Map).

- [ ] **Step 1: Add the service imports**

In `controllers/competitiveAnalysisController.js`, the existing service import at the top is:

```js
import { generateAnalysis } from '../services/competitiveAIService.js';
```

Add directly below it:

```js
import { buildScorecard } from '../services/scorecardService.js';
import { generateScorecardAnalysis } from '../services/scorecardAIService.js';
```

- [ ] **Step 2: Add the two handlers**

In `controllers/competitiveAnalysisController.js`, `refreshAnalysis` is the last handler before the `export {` block. Find the end of `refreshAnalysis` (its closing `});`) and insert the following directly after it, before `export {`:

```js

// ─── Competitive Performance Scorecard ───────────────────────

/**
 * @desc    Project-centric competitive performance scorecard (verified data)
 * @route   GET /api/competitive-analysis/scorecard/:projectId
 * @access  Private (competitive_analysis:view)
 */
const getScorecard = asyncHandler(async (req, res) => {
  const orgId = req.user.organization;
  const { projectId } = req.params;

  let scorecard;
  try {
    scorecard = await buildScorecard(orgId, projectId);
  } catch (err) {
    if (err.message && err.message.includes('not found')) {
      res.status(404);
      throw new Error('Project not found');
    }
    throw err;
  }

  res.json({ success: true, data: scorecard });
});

/**
 * @desc    AI verdict + confidence-scored market demand for a project (async)
 * @route   GET /api/competitive-analysis/scorecard/:projectId/analysis
 * @access  Private (competitive_analysis:ai_recommendations)
 *
 * Reuses the activeJobs Map + 202-polling contract. Completed jobs are kept
 * 30 minutes in-memory as a cost-control cache.
 */
const getScorecardAnalysis = asyncHandler(async (req, res) => {
  const orgId = req.user.organization;
  const { projectId } = req.params;
  const jobKey = `scorecard_${orgId}_${projectId}`;

  if (activeJobs.has(jobKey)) {
    const job = activeJobs.get(jobKey);

    if (job.status === 'completed') {
      return res.json({
        success: true,
        status: 'completed',
        data: job.result,
        message: 'Scorecard analysis ready.',
      });
    }

    if (job.status === 'failed') {
      const errMsg = job.error;
      activeJobs.delete(jobKey);
      if (errMsg && errMsg.includes('not found')) res.status(404);
      throw new Error(errMsg);
    }

    return res.status(202).json({
      success: true,
      status: 'processing',
      message: 'Scorecard analysis is being generated. Please poll this endpoint.',
      startedAt: job.startedAt,
      elapsedMs: Date.now() - job.startedAt,
    });
  }

  const startedAt = Date.now();
  activeJobs.set(jobKey, { startedAt, status: 'processing' });

  generateScorecardAnalysis({ organizationId: orgId, projectId })
    .then((result) => {
      activeJobs.set(jobKey, { startedAt, status: 'completed', result });
      console.log(`[Scorecard AI] Background job completed: ${jobKey}`);
      setTimeout(() => activeJobs.delete(jobKey), 30 * 60 * 1000);
    })
    .catch((err) => {
      activeJobs.set(jobKey, { startedAt, status: 'failed', error: err.message });
      console.error(`[Scorecard AI] Background job failed: ${jobKey}:`, err.message);
      setTimeout(() => activeJobs.delete(jobKey), 5 * 60 * 1000);
    });

  res.status(202).json({
    success: true,
    status: 'processing',
    message: 'Scorecard analysis started. Poll this endpoint every 3-5 seconds for results.',
    startedAt,
  });
});
```

- [ ] **Step 3: Add both handlers to the export block**

The export block at the bottom of `controllers/competitiveAnalysisController.js` ends with:

```js
  getAnalysis,
  refreshAnalysis,
};
```

Change it to:

```js
  getAnalysis,
  refreshAnalysis,
  getScorecard,
  getScorecardAnalysis,
};
```

- [ ] **Step 4: Verify the file parses**

Run (from the backend repo root):

```bash
node --check controllers/competitiveAnalysisController.js
```

Expected: no output, exit code 0.

- [ ] **Step 5: Commit**

```bash
git add controllers/competitiveAnalysisController.js
git commit -m "feat(scorecard): add scorecard + scorecard-analysis controller handlers"
```

---

## Task 4: Routes

**Files:**
- Modify (backend): `routes/competitiveAnalysisRoutes.js`

- [ ] **Step 1: Import the two handlers**

In `routes/competitiveAnalysisRoutes.js`, the controller import block ends with:

```js
  getAnalysis,
  refreshAnalysis,
} from '../controllers/competitiveAnalysisController.js';
```

Change it to:

```js
  getAnalysis,
  refreshAnalysis,
  getScorecard,
  getScorecardAnalysis,
} from '../controllers/competitiveAnalysisController.js';
```

- [ ] **Step 2: Register the two routes**

In `routes/competitiveAnalysisRoutes.js`, find the `// ─── AI Analysis & Recommendations ───` section, which ends with the `refreshAnalysis` route block:

```js
router.post(
  '/analysis/:projectId/refresh',
  hasPermission(PERMISSIONS.COMPETITIVE_ANALYSIS.AI_RECOMMENDATIONS),
  refreshAnalysis
);
```

Insert directly after it:

```js

// ─── Competitive Performance Scorecard ───────────────────────

router.get(
  '/scorecard/:projectId/analysis',
  hasPermission(PERMISSIONS.COMPETITIVE_ANALYSIS.AI_RECOMMENDATIONS),
  getScorecardAnalysis
);

router.get(
  '/scorecard/:projectId',
  hasPermission(PERMISSIONS.COMPETITIVE_ANALYSIS.VIEW),
  getScorecard
);
```

Note: the `/scorecard/:projectId/analysis` route is registered **before** `/scorecard/:projectId` so Express matches the more specific path first.

- [ ] **Step 3: Verify the file parses**

Run (from the backend repo root):

```bash
node --check routes/competitiveAnalysisRoutes.js
```

Expected: no output, exit code 0.

- [ ] **Step 4: Commit**

```bash
git add routes/competitiveAnalysisRoutes.js
git commit -m "feat(scorecard): register scorecard routes"
```

---

## Task 5: Backend smoke test

**Files:**
- Create (backend): `tests/testCompetitiveScorecard.js`

- [ ] **Step 1: Create `tests/testCompetitiveScorecard.js`**

```js
// File: tests/testCompetitiveScorecard.js
// Description: End-to-end test for the Competitive Performance Scorecard.
// Usage: node tests/testCompetitiveScorecard.js
// Requires the backend server running locally and a seeded org/project.

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import fetch from 'node-fetch';

dotenv.config();

const BASE_URL = `http://localhost:${process.env.PORT || 3000}`;
let AUTH_TOKEN = null;
let testProjectId = null;

const results = { passed: 0, failed: 0 };

const log = (status, name, detail = '') => {
  const icon = status === 'PASS' ? '✅' : '❌';
  console.log(`  ${icon} ${name}${detail ? ` — ${detail}` : ''}`);
  if (status === 'PASS') results.passed++;
  else results.failed++;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  console.log('  Competitive Performance Scorecard — End-to-End Test');
  console.log('═══════════════════════════════════════════════════\n');

  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('  Connected to MongoDB');

    const { default: Project } = await import('../models/projectModel.js');
    const { default: User } = await import('../models/userModel.js');

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
    console.log(`  Project: "${project.name}"  ·  User: ${user.firstName} ${user.lastName}\n`);

    // ── Scorecard endpoint ──
    console.log('📋 TEST: Scorecard endpoint\n');
    const sc = await api('GET', `/api/competitive-analysis/scorecard/${testProjectId}`);
    if (sc.ok && sc.data.data) {
      const d = sc.data.data;
      const pillarsPresent =
        d.pricing && d.velocity && d.inventory && d.positioning && d.demand &&
        Array.isArray(d.leaderboard);
      if (pillarsPresent) {
        log('PASS', 'Scorecard returns all five pillars + leaderboard',
          `${d.velocity.totalUnits} units, ${d.pricing.competitorCount} competitors`);
      } else {
        log('FAIL', 'Scorecard missing pillars', JSON.stringify(Object.keys(d)));
      }
    } else {
      log('FAIL', 'Scorecard endpoint', `${sc.status}: ${JSON.stringify(sc.data)}`);
    }

    // ── Scorecard endpoint — bad project id ──
    const bad = await api('GET', '/api/competitive-analysis/scorecard/000000000000000000000000');
    if (bad.status === 404) {
      log('PASS', 'Scorecard 404s on unknown project');
    } else {
      log('FAIL', 'Scorecard bad-id handling', `expected 404, got ${bad.status}`);
    }

    // ── AI analysis endpoint (async poll) ──
    console.log('\n📋 TEST: Scorecard AI analysis (async)\n');
    const url = `/api/competitive-analysis/scorecard/${testProjectId}/analysis`;
    let res = await api('GET', url);
    let polls = 0;
    while (res.status === 202 && res.data?.status === 'processing' && polls < 25) {
      await sleep(3000);
      res = await api('GET', url);
      polls++;
    }
    if (res.ok && res.data?.status === 'completed' && res.data.data) {
      const md = res.data.data.marketDemand;
      if (res.data.data.verdict && md && typeof md.confidence === 'number') {
        log('PASS', 'Scorecard AI analysis completed',
          `confidence ${md.confidence} (${md.confidenceLabel}), polled ${polls}x`);
      } else {
        log('FAIL', 'AI analysis shape', JSON.stringify(res.data.data).slice(0, 200));
      }
    } else {
      log('FAIL', 'Scorecard AI analysis', `${res.status}: ${JSON.stringify(res.data).slice(0, 200)}`);
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
node --check tests/testCompetitiveScorecard.js
```

Expected: no output, exit code 0.

- [ ] **Step 3: Run the smoke test (server must be running)**

Start the backend in one terminal (`node server.js`), then in another (backend repo root):

```bash
node tests/testCompetitiveScorecard.js
```

Expected: scorecard checks PASS; the AI check PASSes if `OPENAI_API_KEY`/`ANTHROPIC_API_KEY` are set locally — if not, it may FAIL with an API error, which is acceptable for the local run (production has the keys). Note any deferral in the report.

- [ ] **Step 4: Commit**

```bash
git add tests/testCompetitiveScorecard.js
git commit -m "test(scorecard): add competitive performance scorecard smoke test"
```

---

## Task 6: Frontend API client methods

**Files:**
- Modify (frontend): `src/services/api.js`

- [ ] **Step 1: Add two methods to `competitiveAnalysisAPI`**

In `src/services/api.js`, the `competitiveAnalysisAPI` object contains this line:

```js
  refreshAnalysis: (projectId, data = {}) => api.post(`/competitive-analysis/analysis/${projectId}/refresh`, data),
```

Add the two scorecard methods directly after it:

```js
  refreshAnalysis: (projectId, data = {}) => api.post(`/competitive-analysis/analysis/${projectId}/refresh`, data),
  // Competitive Performance Scorecard
  getScorecard: (projectId) => api.get(`/competitive-analysis/scorecard/${projectId}`),
  getScorecardAnalysis: (projectId) => api.get(`/competitive-analysis/scorecard/${projectId}/analysis`),
```

- [ ] **Step 2: Commit**

```bash
git add src/services/api.js
git commit -m "feat(scorecard): add scorecard API client methods"
```

---

## Task 7: Competitive Performance page

**Files:**
- Create (frontend): `src/pages/competitive-analysis/CompetitivePerformancePage.js`

A project picker, the five pillar cards, the competitor leaderboard, and the AI verdict + market-demand block (polled).

- [ ] **Step 1: Create `src/pages/competitive-analysis/CompetitivePerformancePage.js`**

```jsx
// File: src/pages/competitive-analysis/CompetitivePerformancePage.js
// Description: Competitive Performance Scorecard — pick a project, see how it
//   benchmarks against the market and competitors. Verified pillars render
//   instantly; the AI verdict + market-demand block is polled in.

import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box, Grid, Card, CardContent, Typography, Autocomplete, TextField, Chip,
  LinearProgress, CircularProgress, Alert, Table, TableBody, TableCell,
  TableHead, TableRow, Link, Stack, Divider,
} from '@mui/material';
import { TrendingUp, Speed, Inventory2, Place, Insights, EmojiObjects } from '@mui/icons-material';
import { projectAPI, competitiveAnalysisAPI } from '../../services/api';

const inr = (n) =>
  n === null || n === undefined
    ? '—'
    : n >= 1e7
    ? `₹${(n / 1e7).toFixed(2)} Cr`
    : n >= 1e5
    ? `₹${(n / 1e5).toFixed(1)} L`
    : `₹${Math.round(n).toLocaleString('en-IN')}`;

const pct = (n) => (n === null || n === undefined ? '—' : `${n}%`);

const CONFIDENCE_COLOR = { High: 'success', Medium: 'warning', Low: 'error' };

const SectionCard = ({ icon, title, children }) => (
  <Card sx={{ height: '100%' }}>
    <CardContent>
      <Typography
        variant="h6"
        sx={{ fontWeight: 600, mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}
      >
        {icon}
        {title}
      </Typography>
      {children}
    </CardContent>
  </Card>
);

const CompetitivePerformancePage = () => {
  const { projectId } = useParams();
  const navigate = useNavigate();

  const [projects, setProjects] = useState([]);
  const [scorecard, setScorecard] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [ai, setAi] = useState(null);
  const [aiState, setAiState] = useState('idle'); // idle | loading | done | failed

  useEffect(() => {
    projectAPI
      .getProjects()
      .then((res) => setProjects(res.data?.data || res.data || []))
      .catch(() => setProjects([]));
  }, []);

  const fetchScorecard = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError('');
    setScorecard(null);
    setAi(null);
    setAiState('idle');
    try {
      const res = await competitiveAnalysisAPI.getScorecard(projectId);
      setScorecard(res.data.data);
    } catch (e) {
      setError(e.response?.data?.message || 'Failed to load the scorecard.');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchScorecard();
  }, [fetchScorecard]);

  // Poll the AI block once the scorecard is loaded
  useEffect(() => {
    if (!projectId || !scorecard) return;
    let cancelled = false;
    let timer;

    const poll = async () => {
      try {
        const res = await competitiveAnalysisAPI.getScorecardAnalysis(projectId);
        if (cancelled) return;
        if (res.data.status === 'completed') {
          setAi(res.data.data);
          setAiState('done');
        } else {
          setAiState('loading');
          timer = setTimeout(poll, 4000);
        }
      } catch (e) {
        if (!cancelled) setAiState('failed');
      }
    };

    setAiState('loading');
    poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [projectId, scorecard]);

  const selectedProject = projects.find((p) => p._id === projectId) || null;

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h4" sx={{ fontWeight: 700, mb: 1 }}>
        Competitive Performance
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        How your project benchmarks against the market and competitors.
      </Typography>

      <Autocomplete
        sx={{ maxWidth: 420, mb: 3 }}
        options={projects}
        value={selectedProject}
        getOptionLabel={(o) => o.name || ''}
        isOptionEqualToValue={(o, v) => o._id === v._id}
        onChange={(e, val) =>
          navigate(val ? `/competitive-analysis/scorecard/${val._id}` : '/competitive-analysis/scorecard')
        }
        renderInput={(params) => <TextField {...params} label="Select a project" />}
      />

      {!projectId && (
        <Alert severity="info">Pick a project to see its competitive performance scorecard.</Alert>
      )}

      {loading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      )}

      {error && <Alert severity="error">{error}</Alert>}

      {scorecard && (
        <>
          {/* AI verdict banner */}
          <Card sx={{ mb: 3, bgcolor: 'primary.main', color: 'primary.contrastText' }}>
            <CardContent>
              <Typography variant="overline">AI Verdict</Typography>
              {aiState === 'loading' && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                  <CircularProgress size={18} color="inherit" />
                  <Typography variant="body1">Analysing your position…</Typography>
                </Box>
              )}
              {aiState === 'failed' && (
                <Typography variant="body2">
                  AI analysis is unavailable right now — the verified scorecard below is unaffected.
                </Typography>
              )}
              {aiState === 'done' && ai && (
                <>
                  <Typography variant="h6" sx={{ fontWeight: 600 }}>
                    {ai.verdict}
                  </Typography>
                  {ai.recommendations?.length > 0 && (
                    <Stack spacing={0.5} sx={{ mt: 1 }}>
                      {ai.recommendations.map((r, i) => (
                        <Typography key={i} variant="body2" sx={{ display: 'flex', gap: 1 }}>
                          <EmojiObjects sx={{ fontSize: 18 }} />
                          {r}
                        </Typography>
                      ))}
                    </Stack>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          {!scorecard.meta.hasCompetitorData && (
            <Alert severity="warning" sx={{ mb: 3 }}>
              No competitors are tracked in {scorecard.meta.locality}. Pricing, inventory and
              positioning comparisons will be limited — add competitors or run AI research.
            </Alert>
          )}

          <Grid container spacing={3}>
            {/* Pricing */}
            <Grid item xs={12} md={6}>
              <SectionCard icon={<TrendingUp color="primary" />} title="Pricing">
                <Typography variant="body2" color="text.secondary">
                  Your ₹/sqft
                </Typography>
                <Typography variant="h4" sx={{ fontWeight: 700 }}>
                  {scorecard.pricing.yourAvgPsf
                    ? `₹${Math.round(scorecard.pricing.yourAvgPsf).toLocaleString('en-IN')}`
                    : '—'}
                </Typography>
                {scorecard.pricing.yourPercentile !== null && (
                  <Box sx={{ mt: 1 }}>
                    <Typography variant="body2">
                      {scorecard.pricing.yourPercentile}th percentile of the micro-market
                      {scorecard.pricing.premiumDiscountPct !== null &&
                        ` · ${scorecard.pricing.premiumDiscountPct >= 0 ? '+' : ''}${scorecard.pricing.premiumDiscountPct}% vs market avg`}
                    </Typography>
                    <LinearProgress
                      variant="determinate"
                      value={Math.min(100, scorecard.pricing.yourPercentile)}
                      sx={{ mt: 0.5, height: 8, borderRadius: 4 }}
                    />
                  </Box>
                )}
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                  Market ₹/sqft — min {scorecard.pricing.market.min ?? '—'} · median{' '}
                  {scorecard.pricing.market.median ?? '—'} · max {scorecard.pricing.market.max ?? '—'}
                  {' '}({scorecard.pricing.competitorCount} competitors)
                </Typography>
                {scorecard.pricing.byUnitType.length > 0 && (
                  <Table size="small" sx={{ mt: 1 }}>
                    <TableHead>
                      <TableRow>
                        <TableCell>Unit type</TableCell>
                        <TableCell align="right">You</TableCell>
                        <TableCell align="right">Market avg</TableCell>
                        <TableCell align="right">Δ</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {scorecard.pricing.byUnitType.map((r) => (
                        <TableRow key={r.unitType}>
                          <TableCell>{r.unitType}</TableCell>
                          <TableCell align="right">{r.yourPsf ?? '—'}</TableCell>
                          <TableCell align="right">{r.marketPsf.avg ?? '—'}</TableCell>
                          <TableCell align="right">{r.deltaPct !== null ? pct(r.deltaPct) : '—'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </SectionCard>
            </Grid>

            {/* Velocity */}
            <Grid item xs={12} md={6}>
              <SectionCard icon={<Speed color="primary" />} title="Sales Velocity">
                {scorecard.velocity.totalUnits === 0 ? (
                  <Typography variant="body2" color="text.secondary">
                    No units recorded for this project.
                  </Typography>
                ) : (
                  <Stack spacing={1}>
                    <Typography variant="body2">
                      <b>{scorecard.velocity.soldUnits}</b> of {scorecard.velocity.totalUnits} units
                      sold ({pct(scorecard.velocity.percentSold)})
                    </Typography>
                    <LinearProgress
                      variant="determinate"
                      value={Math.min(100, scorecard.velocity.percentSold || 0)}
                      sx={{ height: 8, borderRadius: 4 }}
                    />
                    <Typography variant="body2">
                      Pace: {scorecard.velocity.unitsPerMonth ?? '—'} units/month
                      {scorecard.velocity.projectedSelloutDate &&
                        ` · projected sell-out ${scorecard.velocity.projectedSelloutDate}`}
                    </Typography>
                    <Typography variant="body2">
                      Revenue: {inr(scorecard.velocity.revenueAchieved)} of{' '}
                      {inr(scorecard.velocity.targetRevenue)} ({pct(scorecard.velocity.revenuePercent)})
                    </Typography>
                    {scorecard.velocity.unitsPerMonth === null && (
                      <Typography variant="caption" color="text.secondary">
                        No sales recorded yet — pace and sell-out projection unavailable.
                      </Typography>
                    )}
                  </Stack>
                )}
              </SectionCard>
            </Grid>

            {/* Inventory */}
            <Grid item xs={12} md={6}>
              <SectionCard icon={<Inventory2 color="primary" />} title="Inventory Mix">
                <Typography variant="body2" sx={{ mb: 1 }}>
                  Months of inventory: <b>{scorecard.inventory.monthsOfInventory ?? '—'}</b>
                </Typography>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Unit type</TableCell>
                      <TableCell align="right">Your unsold</TableCell>
                      <TableCell align="right">Competing supply</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {(() => {
                      const types = [
                        ...new Set([
                          ...scorecard.inventory.yourUnsoldByType.map((r) => r.unitType),
                          ...scorecard.inventory.competingSupplyByType.map((r) => r.unitType),
                        ]),
                      ];
                      return types.map((t) => {
                        const yours = scorecard.inventory.yourUnsoldByType.find((r) => r.unitType === t);
                        const mkt = scorecard.inventory.competingSupplyByType.find((r) => r.unitType === t);
                        return (
                          <TableRow key={t}>
                            <TableCell>{t}</TableCell>
                            <TableCell align="right">{yours?.count ?? 0}</TableCell>
                            <TableCell align="right">{mkt?.availableCount ?? '—'}</TableCell>
                          </TableRow>
                        );
                      });
                    })()}
                  </TableBody>
                </Table>
              </SectionCard>
            </Grid>

            {/* Positioning */}
            <Grid item xs={12} md={6}>
              <SectionCard icon={<Place color="primary" />} title="Positioning">
                <Typography variant="body2">
                  Your project — status <b>{scorecard.positioning.your.status || '—'}</b>,{' '}
                  {scorecard.positioning.your.totalUnits || '—'} units
                </Typography>
                <Divider sx={{ my: 1 }} />
                {scorecard.positioning.competitors.length === 0 ? (
                  <Typography variant="body2" color="text.secondary">
                    No competitors tracked in this locality.
                  </Typography>
                ) : (
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Competitor</TableCell>
                        <TableCell>Status</TableCell>
                        <TableCell>Possession</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {scorecard.positioning.competitors.map((c, i) => (
                        <TableRow key={i}>
                          <TableCell>{c.name}</TableCell>
                          <TableCell>{c.projectStatus || '—'}</TableCell>
                          <TableCell>{c.possession || '—'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </SectionCard>
            </Grid>

            {/* Demand */}
            <Grid item xs={12}>
              <SectionCard icon={<Insights color="primary" />} title="Demand — supply vs interest">
                <Grid container spacing={2}>
                  <Grid item xs={12} md={6}>
                    <Typography variant="subtitle2">Your demand (leads)</Typography>
                    <Typography variant="body2">
                      {scorecard.demand.yourLeads.total} total leads ·{' '}
                      {scorecard.demand.yourLeads.last30d} in the last 30 days
                    </Typography>
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 1 }}>
                      {scorecard.demand.yourLeads.qualityMix.map((q) => (
                        <Chip key={q.grade} size="small" label={`${q.grade}: ${q.count}`} />
                      ))}
                    </Box>
                  </Grid>
                  <Grid item xs={12} md={6}>
                    <Typography variant="subtitle2">Market demand (AI web research)</Typography>
                    {aiState === 'loading' && (
                      <Typography variant="body2" color="text.secondary">
                        Researching micro-market demand…
                      </Typography>
                    )}
                    {aiState === 'failed' && (
                      <Typography variant="body2" color="text.secondary">
                        Market-demand research unavailable.
                      </Typography>
                    )}
                    {aiState === 'done' && ai && (
                      <>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                          <Chip
                            size="small"
                            label={`Signal: ${ai.marketDemand.signal}`}
                            color="primary"
                          />
                          <Chip
                            size="small"
                            label={`Confidence: ${ai.marketDemand.confidenceLabel} (${ai.marketDemand.confidence})`}
                            color={CONFIDENCE_COLOR[ai.marketDemand.confidenceLabel] || 'default'}
                          />
                        </Box>
                        <Typography variant="body2">{ai.marketDemand.summary}</Typography>
                        {ai.marketDemand.sources?.length > 0 && (
                          <Stack spacing={0.25} sx={{ mt: 1 }}>
                            <Typography variant="caption" color="text.secondary">
                              Sources
                            </Typography>
                            {ai.marketDemand.sources.map((s, i) => (
                              <Link
                                key={i}
                                href={s.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                variant="caption"
                              >
                                {s.title}
                              </Link>
                            ))}
                          </Stack>
                        )}
                      </>
                    )}
                  </Grid>
                </Grid>
              </SectionCard>
            </Grid>

            {/* Leaderboard */}
            <Grid item xs={12}>
              <SectionCard icon={<TrendingUp color="primary" />} title="Competitor Leaderboard">
                {scorecard.leaderboard.length === 0 ? (
                  <Typography variant="body2" color="text.secondary">
                    No competitors tracked in this locality.
                  </Typography>
                ) : (
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>#</TableCell>
                        <TableCell>Project</TableCell>
                        <TableCell>Developer</TableCell>
                        <TableCell align="right">₹/sqft</TableCell>
                        <TableCell align="right">Δ vs you</TableCell>
                        <TableCell>Status</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {scorecard.leaderboard.map((c) => (
                        <TableRow key={c.competitorId} hover>
                          <TableCell>{c.threatRank}</TableCell>
                          <TableCell>
                            <Link
                              component="button"
                              variant="body2"
                              onClick={() =>
                                navigate(`/competitive-analysis/competitors/${c.competitorId}`)
                              }
                            >
                              {c.name}
                            </Link>
                          </TableCell>
                          <TableCell>{c.developer}</TableCell>
                          <TableCell align="right">{c.avgPsf ?? '—'}</TableCell>
                          <TableCell align="right">
                            {c.deltaPsfPct !== null ? pct(c.deltaPsfPct) : '—'}
                          </TableCell>
                          <TableCell>{c.projectStatus || '—'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </SectionCard>
            </Grid>
          </Grid>
        </>
      )}
    </Box>
  );
};

export default CompetitivePerformancePage;
```

- [ ] **Step 2: Commit**

```bash
git add src/pages/competitive-analysis/CompetitivePerformancePage.js
git commit -m "feat(scorecard): add Competitive Performance page"
```

---

## Task 8: Wire the page into routing

**Files:**
- Modify (frontend): `src/App.js`

- [ ] **Step 1: Add the lazy import**

In `src/App.js`, the competitive-analysis lazy imports end with:

```js
const DataProvidersPage = React.lazy(() => import('./pages/competitive-analysis/DataProvidersPage'));
```

Add directly below it:

```js
const CompetitivePerformancePage = React.lazy(() => import('./pages/competitive-analysis/CompetitivePerformancePage'));
```

- [ ] **Step 2: Register the two routes**

In `src/App.js`, the first competitive-analysis route is the `/competitive-analysis` dashboard route block:

```jsx
      <Route path="/competitive-analysis" element={
        <ProtectedRoute requiredPermission={(canAccess) => canAccess.compAnalysisView()}>
          <DashboardLayout>
            <Suspense fallback={<LoadingFallback message="Loading competitive analysis..." />}>
              <CADashboardPage />
            </Suspense>
          </DashboardLayout>
        </ProtectedRoute>
      } />
```

Insert directly after that closing `} />` the two scorecard routes (the `/scorecard/:projectId` route before the bare `/scorecard` route does not matter here — React Router v6 ranks routes by specificity — but list them as below):

```jsx
      <Route path="/competitive-analysis/scorecard" element={
        <ProtectedRoute requiredPermission={(canAccess) => canAccess.compAnalysisView()}>
          <DashboardLayout>
            <Suspense fallback={<LoadingFallback message="Loading competitive performance..." />}>
              <CompetitivePerformancePage />
            </Suspense>
          </DashboardLayout>
        </ProtectedRoute>
      } />
      <Route path="/competitive-analysis/scorecard/:projectId" element={
        <ProtectedRoute requiredPermission={(canAccess) => canAccess.compAnalysisView()}>
          <DashboardLayout>
            <Suspense fallback={<LoadingFallback message="Loading competitive performance..." />}>
              <CompetitivePerformancePage />
            </Suspense>
          </DashboardLayout>
        </ProtectedRoute>
      } />
```

- [ ] **Step 3: Add a link from the Competitive Analysis dashboard**

Open `src/pages/competitive-analysis/CADashboardPage.js` and locate where it renders navigation buttons / cards to other competitive-analysis sub-pages (search the file for `navigate('/competitive-analysis` or button labels like "Market Overview"). Add one more navigation entry, consistent with the existing ones in that file, labelled **"Competitive Performance"** that calls `navigate('/competitive-analysis/scorecard')`.

Because the exact structure of the nav block varies, match the pattern already in the file. For example, if the file has a list/array of nav items, add:

```js
{ label: 'Competitive Performance', description: 'Benchmark a project vs the market', path: '/competitive-analysis/scorecard' }
```

— adapting the object keys to whatever shape the existing entries use. If the file instead has explicit `<Button>` / `<Card>` JSX per destination, copy one such block and change its label, description and `navigate(...)` target to `/competitive-analysis/scorecard`.

- [ ] **Step 4: Verify the build compiles**

Run (from the frontend repo root):

```bash
CI=true npm run build
```

Expected: `Compiled successfully.` Fix any compile errors your changes introduced before continuing.

- [ ] **Step 5: Commit**

```bash
git add src/App.js src/pages/competitive-analysis/CADashboardPage.js
git commit -m "feat(scorecard): route the Competitive Performance page and link it from the CA dashboard"
```

---

## Task 9: Manual end-to-end verification

**Files:** none (verification only).

- [ ] **Step 1: Start both servers**

Backend (backend repo root): `node server.js`. Frontend (frontend repo root): `npm start`.

- [ ] **Step 2: Open the scorecard**

Go to the Competitive Analysis dashboard, click "Competitive Performance", pick a project. Expected: the five pillar cards + leaderboard render immediately from real data; the AI verdict banner shows "Analysing…" then resolves to a verdict + 3 recommendations within ~30–60s; the Demand card's market-demand half shows a signal chip, a confidence chip (colour-coded), a summary, and source links.

- [ ] **Step 3: Check graceful degradation**

Pick a project in a locality with **no** tracked competitors. Expected: the "no competitors tracked" warning shows; Pricing/Inventory/Positioning/Leaderboard degrade gracefully; Velocity and your-leads Demand still render. Pick a project with **no sales**. Expected: the Velocity card shows "No sales recorded yet" and no divide-by-zero values.

- [ ] **Step 4: Check the leaderboard drill-in**

Click a competitor name in the leaderboard. Expected: navigates to that competitor's existing detail page.

- [ ] **Step 5: Commit any verification-driven fixes**

If Steps 2–4 surfaced bugs and you fixed them, commit with a descriptive message. If everything worked, nothing to commit.

---

## Notes for the implementer

- **Two repos.** Tasks 1–5 are in `propvantage-ai-backend`; Tasks 6–8 are in `propvantage-ai-frontend`. Run each task's git commands from the repo named in that task's **Files** block.
- **AI keys.** `OPENAI_API_KEY` and `ANTHROPIC_API_KEY` must be in the backend `.env` for the AI block to complete. Without them the scorecard's verified pillars still work fully — only the AI verdict/market-demand block fails, which the UI handles.
- **No pushing.** Both repos auto-deploy on push to `main`. Commit locally; do not push.
- **Verifiable facts only.** The scorecard must never display an invented competitor sales/absorption figure. Competitor data is limited to pricing, unit mix, status, possession, and scale.
