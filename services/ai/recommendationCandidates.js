// File: services/ai/recommendationCandidates.js
// Description: SP5 — rule library for prescriptive insight candidates.
//   Each rule is a pure function `(factsPack) → Candidate[]`. The pipeline
//   collects candidates for a surface (per insightSurfaces[surface].candidateRules),
//   ranks them by priorityScore, and passes the top-N to the LLM. The LLM
//   may only `headlinedCandidates` from this list — it cannot invent
//   recommendations.
//
//   Candidate shape:
//     { id, type, evidence: {...}, defaultAction, evidenceCitations: [...],
//       confidence: 'high'|'medium'|'low', priorityScore: number }
//
//   Confidence is derived from sample size:
//     n ≥ 30 → high   ·   n ≥ 10 → medium   ·   else → low
//   Sample-size thresholds for trigger eligibility live in each rule.

import { insightSurfaces } from '../../config/insightSurfaces.js';

const confidenceForN = (n) => (n >= 30 ? 'high' : n >= 10 ? 'medium' : 'low');

// ─── Rules ────────────────────────────────────────────────────────────────

/** Aging prospects > 30d in non-terminal status. */
function agingProspects(pack) {
  const aging = pack.metrics?.agingOver30d || 0;
  if (aging < 1) return [];
  return [{
    id: `aging_${aging}`,
    type: 'aging',
    evidence: { agingCount: aging, totalProspects: pack.metrics?.totalProspects || 0 },
    defaultAction: `Review the ${aging} prospect${aging > 1 ? 's' : ''} that have been idle for over 30 days; either re-engage or close as lost.`,
    evidenceCitations: ['/partner/prospects'],
    confidence: confidenceForN(pack.metrics?.totalProspects || 0),
    priorityScore: Math.min(95, 40 + aging * 5),
  }];
}

/** Overdue follow-ups (followUpsDueToday > 0). */
function overdueFollowUps(pack) {
  const due = pack.metrics?.followUpsDueToday || 0;
  if (due < 1) return [];
  return [{
    id: `followups_${due}`,
    type: 'followup',
    evidence: { followUpsDueToday: due, followUpsDueThisWeek: pack.metrics?.followUpsDueThisWeek || 0 },
    defaultAction: `Complete the ${due} follow-up${due > 1 ? 's' : ''} that are due today; schedule new dates after each.`,
    evidenceCitations: ['/partner/prospects'],
    confidence: confidenceForN(pack.metrics?.totalProspects || 0),
    priorityScore: Math.min(100, 60 + due * 4),
  }];
}

/** Funnel stages where conversion < 0.5 × overall. */
function stagnantStages(pack) {
  const funnel = pack.metrics?.funnel || [];
  if (funnel.length < 3) return [];
  const total = funnel.reduce((s, f) => s + f.count, 0);
  if (total === 0) return [];
  const candidates = [];
  for (let i = 0; i < funnel.length - 1; i++) {
    const here = funnel[i].count;
    const next = funnel[i + 1].count;
    if (here >= 5 && next < here * 0.3) {
      candidates.push({
        id: `stagnant_${funnel[i].status}_to_${funnel[i + 1].status}`.replace(/\s+/g, '_'),
        type: 'diagnostic',
        evidence: { fromStage: funnel[i].status, fromCount: here, toStage: funnel[i + 1].status, toCount: next },
        defaultAction: `Investigate the drop from ${funnel[i].status} (${here}) to ${funnel[i + 1].status} (${next}) — fewer than 30% are progressing.`,
        evidenceCitations: ['/partner/prospects'],
        confidence: confidenceForN(here),
        priorityScore: 50 + Math.min(40, (here - next) * 2),
      });
    }
  }
  return candidates;
}

/** Developers where CP conversion ≥ 1.3 × overall AND n ≥ 10. */
function topDevelopers(pack) {
  const list = pack.notableRecords?.topDevelopers || [];
  const overall = pack.metrics?.overallConversion || 0;
  return list
    .filter((d) => d.prospects >= 10 && d.conversionRate >= 1.3 * overall && overall > 0)
    .slice(0, 3)
    .map((d) => ({
      id: `top_dev_${d.developerId || d.name?.replace(/\s+/g, '_')}`,
      type: 'developer_focus',
      evidence: {
        developerName: d.name || d.developerName,
        cpConversion: d.conversionRate,
        cpOverallConversion: overall,
        deltaPct: d.deltaVsOverall,
        activeProspects: d.prospects,
      },
      defaultAction: `Push more leads to ${d.name || d.developerName} — your conversion with this developer (${(d.conversionRate * 100).toFixed(0)}%) is ${((d.conversionRate / overall) * 100 - 100).toFixed(0)}% above your overall.`,
      evidenceCitations: [d.citation || '/partner/developers/performance'],
      confidence: confidenceForN(d.prospects),
      priorityScore: Math.min(90, 50 + ((d.conversionRate - overall) * 100)),
    }));
}

/** Developers where CP conversion ≤ 0.5 × overall AND n ≥ 10. */
function weakDevelopers(pack) {
  const list = pack.notableRecords?.weakDevelopers || pack.notableRecords?.topDevelopers || [];
  const overall = pack.metrics?.overallConversion || 0;
  return list
    .filter((d) => d.prospects >= 10 && d.conversionRate <= 0.5 * overall && overall > 0)
    .slice(0, 3)
    .map((d) => ({
      id: `weak_dev_${d.developerId || d.name?.replace(/\s+/g, '_')}`,
      type: 'developer_warning',
      evidence: {
        developerName: d.name || d.developerName,
        cpConversion: d.conversionRate,
        cpOverallConversion: overall,
        deltaPct: d.deltaVsOverall,
        activeProspects: d.prospects,
      },
      defaultAction: `Audit your prospect flow to ${d.name || d.developerName} — conversion is only ${(d.conversionRate * 100).toFixed(0)}% vs your overall ${(overall * 100).toFixed(0)}%.`,
      evidenceCitations: [d.citation || '/partner/developers/performance'],
      confidence: confidenceForN(d.prospects),
      priorityScore: Math.min(85, 40 + ((overall - d.conversionRate) * 100)),
    }));
}

/** Agents with conversion ≥ 1.3 × team avg AND n ≥ 10. */
function topAgents(pack) {
  const list = pack.notableRecords?.topAgents || [];
  const teamAvg = pack.metrics?.teamAvg?.conversionRate || 0;
  return list
    .filter((a) => (a.prospectsBooked + a.prospectsActive) >= 10 && a.conversionRate >= 1.3 * teamAvg && teamAvg > 0)
    .slice(0, 3)
    .map((a) => ({
      id: `top_agent_${a.userId || a.agentName?.replace(/\s+/g, '_')}`,
      type: 'agent_recognition',
      evidence: { agentName: a.agentName || a.name, conversionRate: a.conversionRate, teamAvg, prospectsBooked: a.prospectsBooked },
      defaultAction: `Recognise ${a.agentName || a.name} — converting at ${(a.conversionRate * 100).toFixed(0)}% vs team avg ${(teamAvg * 100).toFixed(0)}%.`,
      evidenceCitations: [a.citation || '/partner/team'],
      confidence: confidenceForN(a.prospectsBooked + a.prospectsActive),
      priorityScore: Math.min(85, 50 + ((a.conversionRate - teamAvg) * 100)),
    }));
}

/** Agents with conversion ≤ 0.5 × team avg AND activity volume below median. */
function weakAgents(pack) {
  const list = pack.notableRecords?.weakAgents || [];
  const teamAvg = pack.metrics?.teamAvg?.conversionRate || 0;
  const medianActivity = pack.metrics?.teamAvg?.activityVolume30d || 0;
  return list
    .filter((a) => (a.prospectsBooked + a.prospectsActive) >= 10 && a.conversionRate <= 0.5 * teamAvg && a.activityVolume30d < medianActivity)
    .slice(0, 3)
    .map((a) => ({
      id: `weak_agent_${a.userId || a.agentName?.replace(/\s+/g, '_')}`,
      type: 'agent_coaching',
      evidence: { agentName: a.agentName || a.name, conversionRate: a.conversionRate, teamAvg, activityVolume30d: a.activityVolume30d, medianActivity },
      defaultAction: `Coach ${a.agentName || a.name} — conversion at ${(a.conversionRate * 100).toFixed(0)}% and activity (${a.activityVolume30d}) is below the team median (${medianActivity}).`,
      evidenceCitations: [a.citation || '/partner/team'],
      confidence: confidenceForN(a.prospectsBooked + a.prospectsActive),
      priorityScore: Math.min(80, 30 + ((teamAvg - a.conversionRate) * 100)),
    }));
}

/** Reconciliation mismatches (cp_only + mismatched count > 0). */
function reconciliationMismatches(pack) {
  const m = pack.metrics?.reconciliation || pack.metrics || {};
  const cpOnly = m.cpOnly || 0;
  const mismatched = m.mismatched || 0;
  const total = cpOnly + mismatched;
  if (total < 1) return [];
  return [{
    id: `recon_flags_${total}`,
    type: 'reconciliation',
    evidence: { cpOnly, mismatched, totalDiscrepancy: m.totalDiscrepancy || 0 },
    defaultAction: `Review the ${total} reconciliation flag${total > 1 ? 's' : ''} (${mismatched} mismatched, ${cpOnly} cp-only) on the reconciliation dashboard.`,
    evidenceCitations: ['/partner/commission/reconciliation'],
    confidence: confidenceForN(total),
    priorityScore: Math.min(95, 50 + total * 8),
  }];
}

/** Headline metric changed > 25% week-over-week (heuristic: any monthly delta). */
function weekOverWeekChanges(pack) {
  const months = pack.metrics?.lastTwelveMonths || pack.metrics?.commission?.byCurrency || [];
  if (!Array.isArray(months) || months.length < 2) return [];
  // Use last two months as proxy when raw WoW isn't available.
  const last = months[months.length - 1]?.received || 0;
  const prev = months[months.length - 2]?.received || 0;
  if (prev === 0) return [];
  const deltaPct = (last - prev) / prev;
  if (Math.abs(deltaPct) < 0.25) return [];
  const dir = deltaPct > 0 ? 'up' : 'down';
  return [{
    id: `wow_${dir}_${Math.round(Math.abs(deltaPct) * 100)}`,
    type: 'trend',
    evidence: { lastMonth: last, previousMonth: prev, deltaPct, direction: dir },
    defaultAction: `Commission received went ${dir} by ${Math.abs(deltaPct * 100).toFixed(0)}% vs the previous period — investigate the drivers.`,
    evidenceCitations: ['/partner/commission'],
    confidence: 'medium',
    priorityScore: Math.min(75, 30 + Math.abs(deltaPct * 100)),
  }];
}

/** Forecast: next-30d bookings < trailing 30d × 0.7 (requires ≥ 8 weeks data). */
function forecastedShortfall(pack) {
  const months = pack.metrics?.lastTwelveMonths || [];
  if (!Array.isArray(months) || months.length < 2) return [];
  const series = months.map((m) => m.received).filter((x) => typeof x === 'number');
  if (series.length < 2) return []; // need at least 2 months
  // Simple EWMA forecast.
  let ewma = series[0];
  const alpha = 0.4;
  for (let i = 1; i < series.length; i++) ewma = alpha * series[i] + (1 - alpha) * ewma;
  const trailing = series[series.length - 1] || 0;
  if (trailing === 0) return [];
  const forecastNext = ewma;
  if (forecastNext >= trailing * 0.7) return [];
  return [{
    id: `forecast_shortfall_${Math.round((1 - forecastNext / trailing) * 100)}`,
    type: 'forecast',
    evidence: { forecastNext: Math.round(forecastNext), trailing30d: trailing, dropPct: (1 - forecastNext / trailing) },
    defaultAction: `Next-period commission is forecast to fall ${((1 - forecastNext / trailing) * 100).toFixed(0)}% short of the trailing month — increase pipeline activity now.`,
    evidenceCitations: ['/partner/commission'],
    confidence: series.length >= 8 ? 'medium' : 'low',
    priorityScore: Math.min(80, 30 + ((1 - forecastNext / trailing) * 100)),
  }];
}

// ─── Registry + dispatcher ────────────────────────────────────────────────

const RULES = {
  agingProspects,
  overdueFollowUps,
  stagnantStages,
  topDevelopers,
  weakDevelopers,
  topAgents,
  weakAgents,
  reconciliationMismatches,
  weekOverWeekChanges,
  forecastedShortfall,
};

/**
 * Collect candidates for a surface by invoking every rule listed in
 * insightSurfaces[surface].candidateRules. Sorts by priorityScore DESC and
 * returns the top-N (N = surface.topN, default 5).
 */
export function collect(surface, factsPack) {
  const config = insightSurfaces[surface];
  if (!config) return [];
  const ruleKeys = config.candidateRules || [];
  const topN = config.topN || 5;
  const candidates = [];
  for (const key of ruleKeys) {
    const rule = RULES[key];
    if (!rule) continue;
    try {
      candidates.push(...rule(factsPack));
    } catch (err) {
      // Don't poison the whole pipeline if a rule throws.
      console.error(`[recommendationCandidates] rule '${key}' failed:`, err.message);
    }
  }
  candidates.sort((a, b) => (b.priorityScore || 0) - (a.priorityScore || 0));
  return candidates.slice(0, topN);
}

// Export individual rules for unit testing.
export const rules = RULES;

export default { collect, rules: RULES };
