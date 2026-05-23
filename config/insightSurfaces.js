// File: config/insightSurfaces.js
// Description: SP5 — central configuration for every AI insight surface.
//   Each surface declares:
//     • factsPackBuilder   — function name in services/ai/factsPackBuilder.js
//     • candidateRules     — rule keys from services/ai/recommendationCandidates.js
//     • promptTemplate     — function name in services/ai/promptTemplates.js
//     • validator          — function name in services/ai/insightValidator.js
//     • cacheTtl           — ms; how long a successful insight is served from cache
//     • scheduledFor       — name of cron env var when this surface runs on a schedule
//     • minConfidence      — gate below which the deterministic template is used
//     • topN               — how many candidate recommendations to pass to the LLM
//
//   Adding a new surface = adding an entry here + a builder + (optionally) new
//   candidate rules + a prompt template. No code changes anywhere else.

export const insightSurfaces = {
  pipeline_health: {
    factsPackBuilder: 'buildPipelineHealthPack',
    candidateRules: ['agingProspects', 'overdueFollowUps', 'stagnantStages'],
    promptTemplate: 'pipelineHealthPromptTemplate',
    fallbackTemplate: 'pipelineHealthFallbackTemplate',
    validator: 'standardNumericValidator',
    cacheTtl: 24 * 60 * 60 * 1000,
    scheduledFor: null,
    minConfidence: 'medium',
    topN: 5,
  },
  commission_overview: {
    factsPackBuilder: 'buildCommissionOverviewPack',
    candidateRules: ['forecastedShortfall', 'reconciliationMismatches', 'weekOverWeekChanges'],
    promptTemplate: 'commissionOverviewPromptTemplate',
    fallbackTemplate: 'commissionOverviewFallbackTemplate',
    validator: 'standardNumericValidator',
    cacheTtl: 24 * 60 * 60 * 1000,
    scheduledFor: null,
    minConfidence: 'medium',
    topN: 5,
  },
  agent_performance: {
    factsPackBuilder: 'buildAgentPerformancePack',
    candidateRules: ['topAgents', 'weakAgents'],
    promptTemplate: 'agentPerformancePromptTemplate',
    fallbackTemplate: 'agentPerformanceFallbackTemplate',
    validator: 'standardNumericValidator',
    cacheTtl: 24 * 60 * 60 * 1000,
    scheduledFor: null,
    minConfidence: 'medium',
    topN: 5,
  },
  developer_performance: {
    factsPackBuilder: 'buildDeveloperPerformancePack',
    candidateRules: ['topDevelopers', 'weakDevelopers'],
    promptTemplate: 'developerPerformancePromptTemplate',
    fallbackTemplate: 'developerPerformanceFallbackTemplate',
    validator: 'standardNumericValidator',
    cacheTtl: 24 * 60 * 60 * 1000,
    scheduledFor: null,
    minConfidence: 'medium',
    topN: 5,
  },
  commission_reconciliation: {
    factsPackBuilder: 'buildReconciliationPack',
    candidateRules: ['reconciliationMismatches'],
    promptTemplate: 'reconciliationPromptTemplate',
    fallbackTemplate: 'reconciliationFallbackTemplate',
    validator: 'standardNumericValidator',
    cacheTtl: 24 * 60 * 60 * 1000,
    scheduledFor: null,
    minConfidence: 'medium',
    topN: 5,
  },
  weekly_digest: {
    factsPackBuilder: 'buildWeeklyDigestPack',
    candidateRules: [
      'topDevelopers', 'topAgents', 'agingProspects',
      'reconciliationMismatches', 'weekOverWeekChanges',
    ],
    promptTemplate: 'weeklyDigestPromptTemplate',
    fallbackTemplate: 'weeklyDigestFallbackTemplate',
    validator: 'standardNumericValidator',
    cacheTtl: 7 * 24 * 60 * 60 * 1000,
    scheduledFor: 'INSIGHT_DIGEST_CRON_WEEKLY',
    minConfidence: 'low',
    topN: 12,
  },
  monthly_digest: {
    factsPackBuilder: 'buildMonthlyDigestPack',
    candidateRules: [
      'topDevelopers', 'topAgents', 'weakDevelopers', 'weakAgents',
      'forecastedShortfall', 'reconciliationMismatches',
    ],
    promptTemplate: 'monthlyDigestPromptTemplate',
    fallbackTemplate: 'monthlyDigestFallbackTemplate',
    validator: 'standardNumericValidator',
    cacheTtl: 30 * 24 * 60 * 60 * 1000,
    scheduledFor: 'INSIGHT_DIGEST_CRON_MONTHLY',
    minConfidence: 'low',
    topN: 12,
  },
};

// Lead statuses at which a developer-side CommissionRecord is *expected* to
// exist. Used by the reconciliation service to differentiate cp_only (a real
// mismatch) from pending_trigger (the lead simply hasn't reached the booking
// stage yet). Override per-deployment with env var if SP5+ needs to vary it.
export const RECONCILIATION_TRIGGER_STATUSES = (
  process.env.RECONCILIATION_TRIGGER_STATUSES
    ? process.env.RECONCILIATION_TRIGGER_STATUSES.split(',').map((s) => s.trim())
    : ['Booked']
);

export default insightSurfaces;
