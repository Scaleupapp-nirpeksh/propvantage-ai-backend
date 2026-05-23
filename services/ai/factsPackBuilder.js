// File: services/ai/factsPackBuilder.js
// Description: SP5 — pure functions that assemble a strictly-bounded JSON
//   "facts pack" per insight surface. Every number/entity the narrator may
//   cite MUST live in the pack the builder returns; the validator enforces
//   this at the boundary. Builders never call the LLM, never derive new
//   numbers — they re-shape what the analytics services return.
//
//   Hard rules per spec §6.2 enforced by enforceLimits():
//     • Total pack ≤ INSIGHT_FACTS_PACK_MAX_TOKENS (default 4000 → ~16 KB JSON).
//       Truncate `notableRecords` lists first; never touch `metrics`. Throw if
//       metrics alone exceed (analytics-service bug → fail loud).
//     • Every named-entity object carries a `citation` URL.
//     • hasInsufficientData: true when surface-specific min-N not met; in that
//       case the pipeline skips the LLM call entirely.
//
//   Each builder is registered in config/insightSurfaces.js by name; the
//   `build(surface, ...)` dispatcher looks it up by string.

import crypto from 'crypto';
import * as cpAnalytics from '../analytics/cpAnalyticsService.js';
import * as reconciliation from '../analytics/commissionReconciliationService.js';
import { insightSurfaces } from '../../config/insightSurfaces.js';

const MAX_TOKENS = Number(process.env.INSIGHT_FACTS_PACK_MAX_TOKENS) || 4000;
// Rough rule-of-thumb: ~4 chars per token for English JSON.
const MAX_CHARS = MAX_TOKENS * 4;

// Per-surface minimum-data thresholds. Below the threshold,
// hasInsufficientData=true and the pipeline returns a friendly empty card
// without invoking the LLM.
const MIN_THRESHOLDS = {
  pipeline_health:          { totalProspects: 3 },
  commission_overview:      { totalProspects: 3 },
  agent_performance:        { totalAgents: 1 },
  developer_performance:    { totalDevelopers: 1 },
  commission_reconciliation:{ totalRows: 1 },
  weekly_digest:            { totalProspects: 1 },
  monthly_digest:           { totalProspects: 1 },
};

// ─── Citation helpers ──────────────────────────────────────────────────────
//
// Match the frontend router conventions (resolved Open Item §13(4)). Every
// fact-pack entity uses one of these to populate its `citation` field.

const cite = {
  prospect:        (id) => `/partner/prospects/${id}`,
  lead:            (id) => `/leads/${id}`,
  externalDev:     ()   => '/partner/external-developers',
  partnership:     ()   => '/partner/partnerships',
  marketplace:     ()   => '/partner/marketplace',
  reconciliation:  ()   => '/partner/commission/reconciliation',
  commission:      ()   => '/partner/commission',
  agentTeam:       ()   => '/partner/team',
  developerDetail: ()   => '/partner/developers/performance',
};

// ─── Limits enforcement ────────────────────────────────────────────────────

function enforceLimits(pack) {
  let json = JSON.stringify(pack);
  if (json.length <= MAX_CHARS) return pack;

  // First, try truncating notableRecords lists from the tail.
  if (pack.notableRecords && typeof pack.notableRecords === 'object') {
    for (const key of Object.keys(pack.notableRecords)) {
      while (
        Array.isArray(pack.notableRecords[key]) &&
        pack.notableRecords[key].length > 0 &&
        JSON.stringify(pack).length > MAX_CHARS
      ) {
        pack.notableRecords[key].pop();
      }
    }
  }
  json = JSON.stringify(pack);
  if (json.length > MAX_CHARS) {
    const metricsLen = JSON.stringify(pack.metrics || {}).length;
    if (metricsLen > MAX_CHARS) {
      throw new Error(
        `[factsPackBuilder] surface=${pack.surface}: metrics alone (${metricsLen} chars) ` +
        `exceed cap (${MAX_CHARS}). Analytics service likely emitting bloated payload.`
      );
    }
    // Fallback: trim notableRecords entirely.
    pack.notableRecords = {};
  }
  return pack;
}

// ─── Hash helper for cache drift detection ────────────────────────────────

export function hashFactsPack(pack) {
  const stable = JSON.stringify(pack, (key, value) =>
    key === 'generatedAt' ? null : value
  );
  return crypto.createHash('sha256').update(stable).digest('hex');
}

// ─── Per-surface builders ─────────────────────────────────────────────────

export async function buildPipelineHealthPack(cpOrgId, user, range = '30d') {
  const data = await cpAnalytics.getPipelineHealth(cpOrgId, { range }, user);
  const m = data.summary;
  const insufficient = m.totalProspects < MIN_THRESHOLDS.pipeline_health.totalProspects;

  return enforceLimits({
    surface: 'pipeline_health',
    generatedAt: data.generatedAt,
    period: { range: data.range },
    scope: { cpOrgId: String(cpOrgId), userScope: user?.roleRef?.slug === 'cp-agent' ? 'agent' : 'org' },
    hasInsufficientData: insufficient,
    metrics: {
      totalProspects: m.totalProspects,
      activeProspects: m.activeProspects,
      followUpsDueToday: m.followUpsDueToday,
      followUpsDueThisWeek: m.followUpsDueThisWeek,
      agingOver30d: m.agingOver30d,
      activityVolume7d: m.activityVolume7d,
      activityVolume30d: m.activityVolume30d,
      byStatus: data.breakdowns.byStatus,
      funnel: data.breakdowns.funnel,
    },
    notableRecords: {
      agingByBucket: (data.breakdowns.aging || []).slice(0, 5),
      activityHeatTail: (data.series.activityHeat || []).slice(-5),
    },
    candidates: { recommendations: [] },
  });
}

export async function buildCommissionOverviewPack(cpOrgId, user, range = '30d') {
  const data = await cpAnalytics.getCommissionOverview(cpOrgId, { range }, user);
  const totalProspects = (data.breakdowns.byStatus || []).reduce((s, x) => s + (x.count || 0), 0);
  const insufficient = totalProspects < MIN_THRESHOLDS.commission_overview.totalProspects;

  return enforceLimits({
    surface: 'commission_overview',
    generatedAt: data.generatedAt,
    period: { range: data.range },
    scope: { cpOrgId: String(cpOrgId), userScope: user?.roleRef?.slug === 'cp-agent' ? 'agent' : 'org' },
    hasInsufficientData: insufficient,
    metrics: {
      byCurrency: data.summary.byCurrency,
      byStatus: data.breakdowns.byStatus,
      lastTwelveMonths: data.series.byMonth,
    },
    notableRecords: {
      topDevelopers: (data.breakdowns.byDeveloper || []).slice(0, 5).map((d) => ({
        ...d,
        name: d.developerName,
        citation: cite.developerDetail(),
      })),
      topAgents: (data.breakdowns.byAgent || []).slice(0, 5).map((a) => ({
        ...a,
        name: a.agentName,
        citation: cite.agentTeam(),
      })),
    },
    candidates: { recommendations: [] },
  });
}

export async function buildAgentPerformancePack(cpOrgId, user, range = '30d') {
  const data = await cpAnalytics.getAgentPerformance(cpOrgId, { range }, user);
  const totalAgents = (data.agents || []).length;
  const insufficient = totalAgents < MIN_THRESHOLDS.agent_performance.totalAgents;

  return enforceLimits({
    surface: 'agent_performance',
    generatedAt: data.generatedAt,
    period: { range: data.range },
    scope: { cpOrgId: String(cpOrgId), userScope: user?.roleRef?.slug === 'cp-agent' ? 'agent' : 'org' },
    hasInsufficientData: insufficient,
    metrics: {
      totalAgents,
      teamAvg: {
        conversionRate: avg(data.agents.map((a) => a.conversionRate)),
        activityVolume30d: avg(data.agents.map((a) => a.activityVolume30d)),
        commissionGenerated: avg(data.agents.map((a) => a.commissionGenerated)),
      },
    },
    notableRecords: {
      topAgents: (data.agents || []).slice(0, 5).map((a) => ({
        agentName: a.name,
        name: a.name,
        userId: a.userId,
        conversionRate: a.conversionRate,
        prospectsBooked: a.prospectsBooked,
        prospectsActive: a.prospectsActive,
        activityVolume30d: a.activityVolume30d,
        commissionGenerated: a.commissionGenerated,
        compositeScore: a.compositeScore,
        citation: cite.agentTeam(),
      })),
      weakAgents: (data.agents || []).slice(-3).reverse().map((a) => ({
        agentName: a.name,
        name: a.name,
        userId: a.userId,
        conversionRate: a.conversionRate,
        prospectsActive: a.prospectsActive,
        activityVolume30d: a.activityVolume30d,
        compositeScore: a.compositeScore,
        citation: cite.agentTeam(),
      })),
    },
    candidates: { recommendations: [] },
  });
}

export async function buildDeveloperPerformancePack(cpOrgId, user, range = '30d') {
  const data = await cpAnalytics.getDeveloperPerformance(cpOrgId, { range }, user);
  const totalDevelopers = (data.developers || []).length;
  const insufficient = totalDevelopers < MIN_THRESHOLDS.developer_performance.totalDevelopers;

  return enforceLimits({
    surface: 'developer_performance',
    generatedAt: data.generatedAt,
    period: { range: data.range },
    scope: { cpOrgId: String(cpOrgId), userScope: user?.roleRef?.slug === 'cp-agent' ? 'agent' : 'org' },
    hasInsufficientData: insufficient,
    metrics: {
      totalDevelopers,
      overallConversion: data.overallConversion,
    },
    notableRecords: {
      topDevelopers: (data.developers || []).slice(0, 5).map((d) => ({
        developerName: d.name,
        name: d.name,
        developerId: d.id,
        context: d.context,
        prospects: d.prospects,
        conversionRate: d.conversionRate,
        deltaVsOverall: d.deltaVsOverall,
        commissionRealised: d.commissionRealised,
        leadAcceptanceRate: d.leadAcceptanceRate,
        citation: cite.developerDetail(),
      })),
      weakDevelopers: (data.developers || []).slice(-3).reverse().map((d) => ({
        developerName: d.name,
        name: d.name,
        developerId: d.id,
        context: d.context,
        prospects: d.prospects,
        conversionRate: d.conversionRate,
        deltaVsOverall: d.deltaVsOverall,
        citation: cite.developerDetail(),
      })),
    },
    candidates: { recommendations: [] },
  });
}

export async function buildReconciliationPack(cpOrgId, user, range = '30d') {
  const data = await reconciliation.getReconciliationOverview(cpOrgId, { range }, user);
  const totalRows = (data.rows || []).length;
  const insufficient = totalRows < MIN_THRESHOLDS.commission_reconciliation.totalRows;

  return enforceLimits({
    surface: 'commission_reconciliation',
    generatedAt: data.generatedAt,
    period: { range: data.range },
    scope: { cpOrgId: String(cpOrgId), userScope: user?.roleRef?.slug === 'cp-agent' ? 'agent' : 'org' },
    hasInsufficientData: insufficient,
    metrics: data.summary,
    notableRecords: {
      mismatched: (data.rows || []).filter((r) => r.status === 'mismatched').slice(0, 5).map((r) => ({
        prospectName: r.prospectName,
        name: r.prospectName,
        prospectId: r.prospectId,
        cpExpected: r.cpExpected,
        cpReceived: r.cpReceived,
        devExpected: r.devExpected,
        devPaid: r.devPaid,
        leadStatus: r.leadStatus,
        citation: cite.prospect(r.prospectId),
      })),
      cpOnly: (data.rows || []).filter((r) => r.status === 'cp_only').slice(0, 5).map((r) => ({
        prospectName: r.prospectName,
        name: r.prospectName,
        prospectId: r.prospectId,
        cpExpected: r.cpExpected,
        leadStatus: r.leadStatus,
        citation: cite.prospect(r.prospectId),
      })),
      devOnly: (data.rows || []).filter((r) => r.status === 'dev_only').slice(0, 5).map((r) => ({
        prospectName: r.prospectName,
        name: r.prospectName,
        prospectId: r.prospectId,
        devExpected: r.devExpected,
        devPaid: r.devPaid,
        citation: cite.prospect(r.prospectId),
      })),
    },
    candidates: { recommendations: [] },
  });
}

export async function buildWeeklyDigestPack(cpOrgId, user) {
  // Digest = pipeline (7d) + commission (7d) + reconciliation snapshot.
  const [pipeline, commission, recon] = await Promise.all([
    cpAnalytics.getPipelineHealth(cpOrgId, { range: '7d' }, user),
    cpAnalytics.getCommissionOverview(cpOrgId, { range: '7d' }, user),
    reconciliation.getReconciliationOverview(cpOrgId, { range: '7d' }, user),
  ]);
  const insufficient = pipeline.summary.totalProspects < MIN_THRESHOLDS.weekly_digest.totalProspects;

  return enforceLimits({
    surface: 'weekly_digest',
    generatedAt: new Date().toISOString(),
    period: { range: '7d' },
    scope: { cpOrgId: String(cpOrgId), userScope: 'org' },
    hasInsufficientData: insufficient,
    metrics: {
      pipeline: pipeline.summary,
      commission: commission.summary,
      reconciliation: recon.summary,
    },
    notableRecords: {
      topDevelopers: (commission.breakdowns.byDeveloper || []).slice(0, 5).map((d) => ({
        name: d.developerName,
        developerName: d.developerName,
        received: d.received,
        prospects: d.prospects,
        citation: cite.developerDetail(),
      })),
      reconciliationFlags: (recon.rows || []).filter((r) => ['mismatched', 'cp_only'].includes(r.status)).slice(0, 5).map((r) => ({
        name: r.prospectName,
        prospectName: r.prospectName,
        prospectId: r.prospectId,
        status: r.status,
        citation: cite.prospect(r.prospectId),
      })),
    },
    candidates: { recommendations: [] },
  });
}

export async function buildMonthlyDigestPack(cpOrgId, user) {
  const [pipeline, commission, recon, agents, developers] = await Promise.all([
    cpAnalytics.getPipelineHealth(cpOrgId, { range: '30d' }, user),
    cpAnalytics.getCommissionOverview(cpOrgId, { range: '30d' }, user),
    reconciliation.getReconciliationOverview(cpOrgId, { range: '30d' }, user),
    cpAnalytics.getAgentPerformance(cpOrgId, { range: '30d' }, user).catch(() => ({ agents: [] })),
    cpAnalytics.getDeveloperPerformance(cpOrgId, { range: '30d' }, user),
  ]);
  const insufficient = pipeline.summary.totalProspects < MIN_THRESHOLDS.monthly_digest.totalProspects;

  return enforceLimits({
    surface: 'monthly_digest',
    generatedAt: new Date().toISOString(),
    period: { range: '30d' },
    scope: { cpOrgId: String(cpOrgId), userScope: 'org' },
    hasInsufficientData: insufficient,
    metrics: {
      pipeline: pipeline.summary,
      commission: commission.summary,
      reconciliation: recon.summary,
      overallConversion: developers.overallConversion,
    },
    notableRecords: {
      topDevelopers: (developers.developers || []).slice(0, 5).map((d) => ({
        name: d.name,
        developerName: d.name,
        conversionRate: d.conversionRate,
        commissionRealised: d.commissionRealised,
        citation: cite.developerDetail(),
      })),
      weakDevelopers: (developers.developers || []).slice(-3).reverse().map((d) => ({
        name: d.name,
        developerName: d.name,
        conversionRate: d.conversionRate,
        citation: cite.developerDetail(),
      })),
      topAgents: (agents.agents || []).slice(0, 5).map((a) => ({
        name: a.name,
        agentName: a.name,
        conversionRate: a.conversionRate,
        compositeScore: a.compositeScore,
        citation: cite.agentTeam(),
      })),
      reconciliationFlags: (recon.rows || []).filter((r) => ['mismatched', 'cp_only'].includes(r.status)).slice(0, 5).map((r) => ({
        name: r.prospectName,
        prospectName: r.prospectName,
        prospectId: r.prospectId,
        status: r.status,
        citation: cite.prospect(r.prospectId),
      })),
    },
    candidates: { recommendations: [] },
  });
}

// ─── Dispatcher ────────────────────────────────────────────────────────────

const BUILDERS = {
  buildPipelineHealthPack,
  buildCommissionOverviewPack,
  buildAgentPerformancePack,
  buildDeveloperPerformancePack,
  buildReconciliationPack,
  buildWeeklyDigestPack,
  buildMonthlyDigestPack,
};

/**
 * Look up the builder for `surface` and invoke it.
 * @param {string} surface — key from config/insightSurfaces.js
 */
export async function build(surface, cpOrgId, user, range) {
  const config = insightSurfaces[surface];
  if (!config) throw new Error(`Unknown insight surface: ${surface}`);
  const builderFn = BUILDERS[config.factsPackBuilder];
  if (!builderFn) {
    throw new Error(`No facts-pack builder registered for ${surface} (expected ${config.factsPackBuilder})`);
  }
  return builderFn(cpOrgId, user, range);
}

// ─── Tiny stats helper ────────────────────────────────────────────────────
function avg(values) {
  const v = (values || []).filter((x) => typeof x === 'number' && Number.isFinite(x));
  if (v.length === 0) return 0;
  return Math.round((v.reduce((s, x) => s + x, 0) / v.length) * 100) / 100;
}

export default {
  build,
  hashFactsPack,
  buildPipelineHealthPack,
  buildCommissionOverviewPack,
  buildAgentPerformancePack,
  buildDeveloperPerformancePack,
  buildReconciliationPack,
  buildWeeklyDigestPack,
  buildMonthlyDigestPack,
};
