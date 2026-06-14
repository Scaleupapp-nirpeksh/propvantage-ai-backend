// File: services/reports/narrativeService.js
// Description: Generates a short executive narrative of a report's figures using
// Claude (Anthropic). Best-effort: never throws — returns { text, error? }.

import Anthropic from '@anthropic-ai/sdk';

const MODEL = process.env.REPORT_NARRATIVE_MODEL || 'claude-sonnet-4-6';
const MAX_TOKENS = Number(process.env.REPORT_NARRATIVE_MAX_TOKENS) || 400;
const anthropic = process.env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) : null;

const SYSTEM_PROMPT =
  'You are a real-estate analytics assistant. Write a concise 3–5 sentence executive '
  + 'summary of the report figures for senior leadership. Use ONLY the numbers provided; '
  + 'never invent data. Plain prose, no markdown, no headings, currency in INR context.';

const pct = (n) => `${Math.round((Number(n) || 0) * 1000) / 10}%`;
const num = (n) => (Number.isFinite(Number(n)) ? Number(n) : 0);

/** Build a compact, factual summary string from the leadership overview. Pure. */
export const buildFacts = (overview = {}) => {
  const o = overview || {};
  const r = o.revenue || {};
  const s = o.salesPipeline || {};
  const p = o.portfolio || {};
  const lines = [
    `Total sales value: ${num(r.totalSalesValue)}`,
    `Collected: ${num(r.totalCollected)}; Outstanding: ${num(r.totalOutstanding)}; Collection rate: ${pct(r.collectionRate)}`,
    `Total leads: ${num(s.totalLeads)}; Conversion rate: ${pct(s.conversionRate)}; Avg booking value: ${num(s.avgBookingValue)}`,
    `Projects: ${num(p.totalProjects)}; Units: ${num(p.totalUnits)}`,
  ];
  return lines.join('\n');
};

/**
 * Generate a 3–5 sentence narrative. Best-effort: returns { text, error? }.
 * @param {string} facts - output of buildFacts
 * @param {string} [focus] - optional creator hint
 */
export const generateNarrative = async (facts, focus) => {
  if (!anthropic) return { text: '', error: 'AI not configured (ANTHROPIC_API_KEY missing)' };
  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      temperature: 0.3,
      system: SYSTEM_PROMPT,
      messages: [
        { role: 'user', content: `${focus ? `Focus area: ${focus}\n` : ''}Report figures:\n${facts}` },
      ],
    });
    const text = (response.content || [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();
    return { text };
  } catch (err) {
    return { text: '', error: err.message };
  }
};

export default { buildFacts, generateNarrative };
