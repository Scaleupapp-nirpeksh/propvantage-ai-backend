// File: services/reports/narrativeService.js
// Description: Generates a short executive narrative of a report's figures.
// Mirrors services/ai/insightNarrator.js (OpenAI). Best-effort: never throws.

import OpenAI from 'openai';

const MODEL = process.env.COPILOT_MODEL || 'gpt-4o';
const MAX_TOKENS = Number(process.env.REPORT_NARRATIVE_MAX_TOKENS) || 300;
const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

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
  if (!openai) return { text: '', error: 'AI not configured (OPENAI_API_KEY missing)' };
  try {
    const response = await openai.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: 'You are a real-estate analytics assistant. Write a concise 3–5 sentence executive summary of the report figures for senior leadership. Use ONLY the numbers provided; never invent data. Plain prose, no markdown, no headings, currency in INR context.' },
        { role: 'user', content: `${focus ? `Focus area: ${focus}\n` : ''}Report figures:\n${facts}` },
      ],
      temperature: 0.3,
      max_tokens: MAX_TOKENS,
    });
    return { text: (response.choices?.[0]?.message?.content || '').trim() };
  } catch (err) {
    return { text: '', error: err.message };
  }
};

export default { buildFacts, generateNarrative };
