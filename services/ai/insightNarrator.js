// File: services/ai/insightNarrator.js
// Description: SP5 — wraps OpenAI gpt-4o with JSON-mode output. Called by
//   the insight pipeline (services/ai/insightPipeline.js). Never inspects
//   the facts pack itself — just passes the prompt and parses the response.
//   Validation happens in services/ai/insightValidator.js.
//
//   Token-cost lookup (gpt-4o as of 2026-05): $2.50/M input, $10.00/M output.

import OpenAI from 'openai';
import { SYSTEM_PROMPT, buildUserPrompt } from './promptTemplates.js';
import { insightSurfaces } from '../../config/insightSurfaces.js';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = process.env.COPILOT_MODEL || 'gpt-4o';
const MAX_TOKENS = Number(process.env.INSIGHT_NARRATIVE_MAX_TOKENS) || 800;

// gpt-4o pricing (USD per 1M tokens) — last verified 2026-05.
// Update when OpenAI ships a new price card.
const TOKEN_COSTS = {
  'gpt-4o':      { input: 2.50, output: 10.00 },
  'gpt-4o-mini': { input: 0.15, output: 0.60 },
};

function computeCostUsd(model, usage) {
  const rate = TOKEN_COSTS[model] || TOKEN_COSTS['gpt-4o'];
  const prompt = (usage?.prompt_tokens || 0) / 1e6 * rate.input;
  const completion = (usage?.completion_tokens || 0) / 1e6 * rate.output;
  return prompt + completion;
}

/**
 * Generate a narration for a surface.
 *
 * @param {string} surface       — config/insightSurfaces.js key
 * @param {Object} factsPack     — output of factsPackBuilder.build(...)
 * @param {string} [retryHint]   — feedback string from a prior validation
 *                                  failure; appended to the user message so
 *                                  the LLM knows what to fix on retry.
 * @returns {Promise<{narration, tokenUsage, raw}>}
 *   - narration  : { narrative, headlinedCandidates: [], confidence, citations: [] }
 *   - tokenUsage : { prompt, completion, total, costUsd }
 *   - raw        : the OpenAI response object (for debugging)
 */
export async function narrate(surface, factsPack, retryHint) {
  const config = insightSurfaces[surface];
  if (!config) throw new Error(`Unknown surface: ${surface}`);

  let userContent = buildUserPrompt(config.promptTemplate, factsPack);
  if (retryHint) {
    userContent += `\n\nIMPORTANT — previous attempt failed validation: ${retryHint}\nRegenerate your response, correcting this issue. Do not invent new numbers or names.`;
  }

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user',   content: userContent },
  ];

  const response = await openai.chat.completions.create({
    model: MODEL,
    messages,
    response_format: { type: 'json_object' },
    temperature: 0.3,
    max_tokens: MAX_TOKENS,
  });

  const content = response.choices?.[0]?.message?.content || '{}';
  let narration;
  try {
    narration = JSON.parse(content);
  } catch (err) {
    // Surface as a "malformed" narration; the validator will reject and the
    // pipeline will retry (or fall back to the deterministic template).
    return {
      narration: { narrative: '', headlinedCandidates: [], confidence: 'low', citations: [], _parseError: err.message },
      tokenUsage: { prompt: 0, completion: 0, total: 0, costUsd: 0 },
      raw: response,
    };
  }

  // Normalise citation shape — accept both string[] and {url}[].
  if (Array.isArray(narration.citations)) {
    narration.citations = narration.citations.map((c) => (typeof c === 'string' ? c : c?.url || c?.label || '')).filter(Boolean);
  } else {
    narration.citations = [];
  }
  if (!Array.isArray(narration.headlinedCandidates)) narration.headlinedCandidates = [];

  const usage = response.usage || {};
  return {
    narration,
    tokenUsage: {
      prompt: usage.prompt_tokens || 0,
      completion: usage.completion_tokens || 0,
      total: usage.total_tokens || 0,
      costUsd: computeCostUsd(MODEL, usage),
    },
    raw: response,
  };
}

export default { narrate };
