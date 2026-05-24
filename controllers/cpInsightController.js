// File: controllers/cpInsightController.js
// Description: SP5 — HTTP handlers for /api/cp/insights/:surface.
//   GET  /:surface           → cache-first; runs LLM only on cold cache
//   POST /:surface/generate  → forceRegenerate; always runs LLM (on_demand
//                              counter incremented)
//
//   Both gated by routes/cpInsightRoutes.js with protect + requireOrgType +
//   cp_analytics:view + aiRateLimit.

import asyncHandler from 'express-async-handler';
import { getOrGenerateInsight } from '../services/ai/insightPipeline.js';
import { insightSurfaces } from '../config/insightSurfaces.js';
import { incrementMeter } from '../services/ai/aiUsageMeterService.js';

const KNOWN_SURFACES = Object.keys(insightSurfaces);

function validateSurface(req, res) {
  const s = req.params.surface;
  if (!KNOWN_SURFACES.includes(s)) {
    res.status(400);
    throw new Error(`Unknown surface '${s}'. Valid: ${KNOWN_SURFACES.join(', ')}`);
  }
  return s;
}

/**
 * Increment the meter only when the pipeline actually invoked the LLM.
 * The pipeline tags every returned insight with _wasFreshGeneration so the
 * controller doesn't have to guess from timestamps (the previous "age < 5s"
 * heuristic was fragile under clock drift / slow LLM responses and silently
 * over- or under-counted).
 */
async function maybeIncrement(cpOrgId, insight, forceRegenerate) {
  if (!insight?._wasFreshGeneration) return;
  const kind = forceRegenerate ? 'on_demand' : 'scheduled';
  await incrementMeter(cpOrgId, kind, insight.tokenUsage);
}

export const getInsight = asyncHandler(async (req, res) => {
  const surface = validateSurface(req, res);
  const insight = await getOrGenerateInsight(surface, req.user.organization, req.user);
  await maybeIncrement(req.user.organization, insight, false);
  res.json({ success: true, data: insight });
});

export const generateInsight = asyncHandler(async (req, res) => {
  const surface = validateSurface(req, res);
  const range = req.body?.range || req.query?.range;
  const insight = await getOrGenerateInsight(surface, req.user.organization, req.user, {
    forceRegenerate: true,
    ...(range ? { range } : {}),
  });
  await maybeIncrement(req.user.organization, insight, true);
  res.status(insight.validationResult?.fellBackToTemplate ? 200 : 201).json({ success: true, data: insight });
});
