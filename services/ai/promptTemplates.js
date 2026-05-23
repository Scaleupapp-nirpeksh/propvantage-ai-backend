// File: services/ai/promptTemplates.js
// Description: SP5 — per-surface prompt builders + deterministic fallback
//   templates. Co-located so prompt and fallback stay in lockstep when a
//   surface's facts pack shape evolves (resolved Open Item §13(7)).
//
//   Each surface exports two functions:
//     • <surface>PromptTemplate(factsPack) → string (LLM user-message content)
//     • <surface>FallbackTemplate(factsPack) → { narrative, headlinedCandidates,
//                                                 confidence, citations }
//
//   The fallback template is invoked by the pipeline when the validator
//   exhausts retries — it reads metrics directly from the pack and writes
//   one or two plain sentences. Confidence on a fallback is always
//   'fallback' so the UI can render it with an amber chip + tooltip.

// ─── System prompt (verbatim per spec §6.4) ────────────────────────────────

export const SYSTEM_PROMPT = `You are a real-estate channel partner business analyst. You will be given a strictly-bounded JSON facts pack. You MUST follow these rules:
1. Every number you mention must appear in the facts pack. Do not compute new numbers — not even averages or percentages.
2. Every person/developer/project name you mention must appear in the facts pack.
3. To make a recommendation, you must select from candidates.recommendations[]. You may not invent recommendations.
4. If you cannot make a confident claim from the facts pack, say so explicitly — do not fill in plausible-sounding detail.
5. Output strict JSON with shape { narrative: string, headlinedCandidates: string[], confidence: 'high'|'medium'|'low', citations: string[] }. The citations array must list every citation URL referenced.
6. Keep the narrative under 120 words for dashboard cards, under 400 words for digests. Plain prose, no headings.`;

// ─── Shared formatting helpers ────────────────────────────────────────────

const fmtMoney = (amount, currency = 'INR') => {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) return '—';
  if (currency === 'INR') {
    if (amount >= 1e7) return `₹${(amount / 1e7).toFixed(2)} Cr`;
    if (amount >= 1e5) return `₹${(amount / 1e5).toFixed(2)} L`;
    return `₹${Math.round(amount).toLocaleString('en-IN')}`;
  }
  return `${currency} ${Math.round(amount).toLocaleString('en-US')}`;
};
const fmtPct = (frac) => (typeof frac === 'number' ? `${Math.round(frac * 100)}%` : '—');
const wordWrap = (s, width = 80) => s.replace(new RegExp(`(?![^\\n]{1,${width}}$)([^\\n]{1,${width}})\\s`, 'g'), '$1\n');

// ─── Pipeline Health ───────────────────────────────────────────────────────

export function pipelineHealthPromptTemplate(factsPack) {
  return [
    `Surface: ${factsPack.surface}`,
    `Period: ${factsPack.period?.range || 'unknown'}`,
    '',
    'Write a 2-3 sentence analysis of this channel partner\'s pipeline health.',
    'Highlight the most pressing items: aging prospects, overdue follow-ups, or stagnant funnel stages.',
    'You may headline 1-2 candidates from candidates.recommendations[].',
    '',
    'Facts pack:',
    '```json',
    JSON.stringify(factsPack, null, 2),
    '```',
  ].join('\n');
}

export function pipelineHealthFallbackTemplate(factsPack) {
  const m = factsPack.metrics || {};
  const sentences = [
    `Your pipeline has ${m.totalProspects ?? 0} prospects, ${m.activeProspects ?? 0} active.`,
  ];
  if (m.followUpsDueToday > 0) sentences.push(`${m.followUpsDueToday} follow-ups are due today.`);
  if (m.agingOver30d > 0) sentences.push(`${m.agingOver30d} prospects have been idle for over 30 days.`);
  return {
    narrative: sentences.join(' '),
    headlinedCandidates: [],
    confidence: 'fallback',
    citations: [],
  };
}

// ─── Commission Overview ───────────────────────────────────────────────────

export function commissionOverviewPromptTemplate(factsPack) {
  return [
    `Surface: ${factsPack.surface}`,
    `Period: ${factsPack.period?.range || 'unknown'}`,
    '',
    'Summarise the channel partner\'s commission performance in 2-4 sentences.',
    'Call out per-currency figures, the top developer by received commission, and any week-over-week change you find in candidates.',
    'You may headline 1-2 candidates.',
    '',
    'Facts pack:',
    '```json',
    JSON.stringify(factsPack, null, 2),
    '```',
  ].join('\n');
}

export function commissionOverviewFallbackTemplate(factsPack) {
  const byCcy = factsPack.metrics?.byCurrency || [];
  if (byCcy.length === 0) {
    return { narrative: 'No commission activity in this period.', headlinedCandidates: [], confidence: 'fallback', citations: [] };
  }
  const inr = byCcy.find((c) => c.currency === 'INR') || byCcy[0];
  const narrative =
    `Expected commission is ${fmtMoney(inr.expected, inr.currency)}, of which ${fmtMoney(inr.received, inr.currency)} has been received ` +
    `(${fmtPct(inr.realisationRate)} realisation). ${fmtMoney(inr.outstanding, inr.currency)} remains outstanding.`;
  return { narrative, headlinedCandidates: [], confidence: 'fallback', citations: [] };
}

// ─── Agent Performance ─────────────────────────────────────────────────────

export function agentPerformancePromptTemplate(factsPack) {
  return [
    `Surface: ${factsPack.surface}`,
    `Period: ${factsPack.period?.range || 'unknown'}`,
    '',
    'Analyse this channel partner\'s agent performance in 2-3 sentences.',
    'Recognise the top agent (notableRecords.topAgents[0]) and flag any weak agent that needs coaching.',
    'Headline 1-2 candidates.',
    '',
    'Facts pack:',
    '```json',
    JSON.stringify(factsPack, null, 2),
    '```',
  ].join('\n');
}

export function agentPerformanceFallbackTemplate(factsPack) {
  const top = factsPack.notableRecords?.topAgents?.[0];
  if (!top) return { narrative: 'No agent data available for this period.', headlinedCandidates: [], confidence: 'fallback', citations: [] };
  return {
    narrative: `${top.agentName || top.name} leads the team with ${top.prospectsBooked || 0} bookings (composite score ${top.compositeScore ?? 0}).`,
    headlinedCandidates: [],
    confidence: 'fallback',
    citations: top.citation ? [top.citation] : [],
  };
}

// ─── Developer Performance ─────────────────────────────────────────────────

export function developerPerformancePromptTemplate(factsPack) {
  return [
    `Surface: ${factsPack.surface}`,
    `Period: ${factsPack.period?.range || 'unknown'}`,
    '',
    'Analyse this channel partner\'s developer performance in 2-3 sentences.',
    'Compare each developer\'s conversion to the overall (metrics.overallConversion).',
    'Recommend which developer to lean into and which to audit.',
    'Headline 1-2 candidates.',
    '',
    'Facts pack:',
    '```json',
    JSON.stringify(factsPack, null, 2),
    '```',
  ].join('\n');
}

export function developerPerformanceFallbackTemplate(factsPack) {
  const top = factsPack.notableRecords?.topDevelopers?.[0];
  if (!top) return { narrative: 'No developer data available for this period.', headlinedCandidates: [], confidence: 'fallback', citations: [] };
  return {
    narrative: `${top.developerName || top.name} is your strongest developer this period (${fmtPct(top.conversionRate)} conversion across ${top.prospects} prospects, ${fmtMoney(top.commissionRealised)} realised).`,
    headlinedCandidates: [],
    confidence: 'fallback',
    citations: top.citation ? [top.citation] : [],
  };
}

// ─── Commission Reconciliation ─────────────────────────────────────────────

export function reconciliationPromptTemplate(factsPack) {
  return [
    `Surface: ${factsPack.surface}`,
    `Period: ${factsPack.period?.range || 'unknown'}`,
    '',
    'Summarise the reconciliation state in 2-3 sentences.',
    'Call out the count of matched / cp_only / dev_only / mismatched rows.',
    'If there are mismatches, name 1-2 specific prospects from notableRecords.mismatched[].',
    '',
    'Facts pack:',
    '```json',
    JSON.stringify(factsPack, null, 2),
    '```',
  ].join('\n');
}

export function reconciliationFallbackTemplate(factsPack) {
  const m = factsPack.metrics || {};
  const total = (m.matched || 0) + (m.cpOnly || 0) + (m.devOnly || 0) + (m.mismatched || 0);
  if (total === 0) return { narrative: 'No reconciliation activity in this period.', headlinedCandidates: [], confidence: 'fallback', citations: [] };
  const flagged = (m.cpOnly || 0) + (m.mismatched || 0);
  return {
    narrative: `${m.matched || 0} of ${total} commission rows reconcile cleanly. ${flagged} flag${flagged === 1 ? '' : 's'} need review (${m.mismatched || 0} mismatched, ${m.cpOnly || 0} cp-only).`,
    headlinedCandidates: [],
    confidence: 'fallback',
    citations: ['/partner/commission/reconciliation'],
  };
}

// ─── Weekly Digest ─────────────────────────────────────────────────────────

export function weeklyDigestPromptTemplate(factsPack) {
  return [
    `Surface: ${factsPack.surface}`,
    'Period: this week',
    '',
    'Write a weekly digest (under 400 words) covering pipeline, commission, and reconciliation for the past 7 days.',
    'Lead with the headline (a single most important point), then 2-3 supporting paragraphs.',
    'Cite specific developers / agents / prospects only when they appear in the facts pack.',
    'Headline 3-5 candidates that the CP should act on this week.',
    '',
    'Facts pack:',
    '```json',
    JSON.stringify(factsPack, null, 2),
    '```',
  ].join('\n');
}

export function weeklyDigestFallbackTemplate(factsPack) {
  const p = factsPack.metrics?.pipeline || {};
  const c = factsPack.metrics?.commission?.byCurrency?.[0] || {};
  const r = factsPack.metrics?.reconciliation || {};
  const sentences = [
    `This week: ${p.totalProspects ?? 0} prospects, ${p.activeProspects ?? 0} active.`,
    `Commission received: ${fmtMoney(c.received, c.currency)} of ${fmtMoney(c.expected, c.currency)} expected (${fmtPct(c.realisationRate)} realisation).`,
  ];
  const flagged = (r.cpOnly || 0) + (r.mismatched || 0);
  if (flagged > 0) sentences.push(`${flagged} reconciliation flag${flagged === 1 ? '' : 's'} pending review.`);
  return { narrative: sentences.join(' '), headlinedCandidates: [], confidence: 'fallback', citations: [] };
}

// ─── Monthly Digest ────────────────────────────────────────────────────────

export function monthlyDigestPromptTemplate(factsPack) {
  return [
    `Surface: ${factsPack.surface}`,
    'Period: this month',
    '',
    'Write a monthly digest (under 400 words) covering pipeline, commission, reconciliation, agent performance, and developer performance.',
    'Open with one sentence headline. Then 3-4 supporting paragraphs.',
    'Cite specific entities (developers, agents, prospects) only when they appear in the facts pack.',
    'Headline 4-8 candidates the CP should act on this month.',
    '',
    'Facts pack:',
    '```json',
    JSON.stringify(factsPack, null, 2),
    '```',
  ].join('\n');
}

export function monthlyDigestFallbackTemplate(factsPack) {
  const p = factsPack.metrics?.pipeline || {};
  const c = factsPack.metrics?.commission?.byCurrency?.[0] || {};
  const r = factsPack.metrics?.reconciliation || {};
  const sentences = [
    `This month: ${p.totalProspects ?? 0} prospects, ${p.activeProspects ?? 0} active, overall conversion ${fmtPct(factsPack.metrics?.overallConversion)}.`,
    `Commission: ${fmtMoney(c.received, c.currency)} received of ${fmtMoney(c.expected, c.currency)} expected.`,
  ];
  const flagged = (r.cpOnly || 0) + (r.mismatched || 0);
  if (flagged > 0) sentences.push(`${flagged} reconciliation flag${flagged === 1 ? '' : 's'} need attention.`);
  const top = factsPack.notableRecords?.topDevelopers?.[0];
  if (top) sentences.push(`Top developer: ${top.developerName || top.name} at ${fmtPct(top.conversionRate)} conversion.`);
  return { narrative: sentences.join(' '), headlinedCandidates: [], confidence: 'fallback', citations: [] };
}

// ─── Dispatcher (called by the pipeline) ──────────────────────────────────

const PROMPT_TEMPLATES = {
  pipelineHealthPromptTemplate,
  commissionOverviewPromptTemplate,
  agentPerformancePromptTemplate,
  developerPerformancePromptTemplate,
  reconciliationPromptTemplate,
  weeklyDigestPromptTemplate,
  monthlyDigestPromptTemplate,
};
const FALLBACK_TEMPLATES = {
  pipelineHealthFallbackTemplate,
  commissionOverviewFallbackTemplate,
  agentPerformanceFallbackTemplate,
  developerPerformanceFallbackTemplate,
  reconciliationFallbackTemplate,
  weeklyDigestFallbackTemplate,
  monthlyDigestFallbackTemplate,
};

export function buildUserPrompt(templateName, factsPack) {
  const fn = PROMPT_TEMPLATES[templateName];
  if (!fn) throw new Error(`Unknown prompt template: ${templateName}`);
  return fn(factsPack);
}

export function deterministicTemplate(fallbackName, factsPack) {
  const fn = FALLBACK_TEMPLATES[fallbackName];
  if (!fn) throw new Error(`Unknown fallback template: ${fallbackName}`);
  return fn(factsPack);
}

export default {
  SYSTEM_PROMPT,
  buildUserPrompt,
  deterministicTemplate,
};
