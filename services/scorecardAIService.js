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
      // Strip a ```json ... ``` fence if the model wrapped its output despite
      // being told not to — Claude does this intermittently.
      let jsonText = textBlock.text.trim();
      const fence = jsonText.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
      if (fence) jsonText = fence[1].trim();
      parsed = JSON.parse(jsonText);
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
