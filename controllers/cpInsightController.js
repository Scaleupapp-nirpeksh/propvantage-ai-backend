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
 * Increment the meter for a freshly-generated insight. Cached returns
 * (where the insight was generated more than 5 seconds ago) do not
 * increment — only the original generation event costs money.
 */
async function maybeIncrement(cpOrgId, insight, forceRegenerate) {
  if (!insight || !insight.generatedAt) return;
  const ageMs = Date.now() - new Date(insight.generatedAt).getTime();
  if (ageMs > 5_000) return; // older than 5s = served from cache
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
