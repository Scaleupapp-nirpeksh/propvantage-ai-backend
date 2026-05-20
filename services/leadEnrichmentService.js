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
