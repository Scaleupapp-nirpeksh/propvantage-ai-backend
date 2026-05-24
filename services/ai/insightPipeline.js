// File: services/ai/insightPipeline.js
// Description: SP5 — orchestrator for insight generation. Cache-first; on
//   miss, acquires a Mongo sentinel lock, builds facts pack, narrates,
//   validates with retries, falls back to a deterministic template on
//   exhaustion, then caches the result.
//
//   The single public function:
//     getOrGenerateInsight(surface, cpOrgId, user, opts) → AIInsight doc
//
//   Always releases the lock (try/finally). Concurrent callers serialise on
//   the lock and re-check the cache after acquisition (avoids duplicate
//   LLM cost when N requests race on a cold key).

import AIInsight from '../../models/aiInsightModel.js';
import AIInsightLock from '../../models/aiInsightLockModel.js';
import { insightSurfaces } from '../../config/insightSurfaces.js';
import { build as buildPack, hashFactsPack } from './factsPackBuilder.js';
import { collect as collectCandidates } from './recommendationCandidates.js';
import { narrate } from './insightNarrator.js';
import { standardNumericValidator } from './insightValidator.js';
import { deterministicTemplate } from './promptTemplates.js';

const MAX_RETRIES = Number(process.env.INSIGHT_VALIDATOR_MAX_RETRIES) || 2;
const LOCK_POLL_INTERVAL_MS = 500;
const LOCK_POLL_TIMEOUT_MS  = 30 * 1000;

// ─── Lock helpers ─────────────────────────────────────────────────────────

async function acquireLock(cpOrgId, surface) {
  try {
    const doc = await AIInsightLock.create({ cpOrgId, surface });
    return doc;
  } catch (err) {
    if (err.code === 11000) return null; // duplicate-key → someone else holds it
    throw err;
  }
}

async function releaseLock(lockDoc) {
  if (!lockDoc) return;
  try {
    await AIInsightLock.deleteOne({ _id: lockDoc._id });
  } catch {
    // Lock will TTL out in ≤60s; non-fatal.
  }
}

// ─── Cache helpers ────────────────────────────────────────────────────────

async function findFreshCache(cpOrgId, surface) {
  return AIInsight.findOne({
    cpOrgId,
    surface,
    expiresAt: { $gt: new Date() },
  })
    .sort({ generatedAt: -1 })
    .lean();
}

async function waitForConcurrentResult(cpOrgId, surface) {
  const start = Date.now();
  while (Date.now() - start < LOCK_POLL_TIMEOUT_MS) {
    const cached = await findFreshCache(cpOrgId, surface);
    if (cached) return cached;
    await new Promise((r) => setTimeout(r, LOCK_POLL_INTERVAL_MS));
  }
  return null;
}

// ─── Cache writer ─────────────────────────────────────────────────────────

async function persistInsight({
  cpOrgId, surface, factsPack, narration, validationResult, tokenUsage, source,
}) {
  const config = insightSurfaces[surface];
  const now = new Date();
  const expiresAt = new Date(now.getTime() + (config?.cacheTtl || 24 * 60 * 60 * 1000));
  const factsPackHash = hashFactsPack(factsPack);
  const citations = (narration.citations || []).map((c) => (typeof c === 'string' ? { url: c, label: c } : c));

  return AIInsight.create({
    cpOrgId,
    surface,
    period: factsPack.period || {},
    factsPackHash,
    narrative: narration.narrative || null,
    headlinedCandidates: narration.headlinedCandidates || [],
    citations,
    confidence: narration.confidence || 'medium',
    source,
    generatedAt: now,
    expiresAt,
    validationResult: validationResult || { valid: true, retries: 0, fellBackToTemplate: false, failureReason: '' },
    tokenUsage: tokenUsage || { prompt: 0, completion: 0, total: 0, costUsd: 0 },
  });
}

// ─── Public entry ─────────────────────────────────────────────────────────

/**
 * Get or generate an insight for a (cpOrgId, surface).
 *
 * @param {string} surface
 * @param {string|ObjectId} cpOrgId
 * @param {Object} user — { _id, organization, roleRef }
 * @param {{ forceRegenerate?: boolean, range?: string }} [opts]
 * @returns {Promise<Object>} the AIInsight doc (lean / .toObject())
 */
export async function getOrGenerateInsight(surface, cpOrgId, user, opts = {}) {
  if (!insightSurfaces[surface]) {
    const err = new Error(`Unknown surface: ${surface}`);
    err.statusCode = 400;
    throw err;
  }

  // Every returned insight is annotated with _wasFreshGeneration:
  //   true  → the LLM was actually invoked on this request (caller should
  //            increment the meter)
  //   false → served from cache OR skipped LLM (insufficient_data)
  // This replaces the previous "age < 5s" heuristic which was fragile under
  // clock drift / slow LLM responses.

  // 1. Cache-first.
  if (!opts.forceRegenerate) {
    const cached = await findFreshCache(cpOrgId, surface);
    if (cached) return { ...cached, _wasFreshGeneration: false };
  }

  // 2. Acquire lock; if held, await peer's result.
  const lock = await acquireLock(cpOrgId, surface);
  if (!lock) {
    const peerResult = await waitForConcurrentResult(cpOrgId, surface);
    if (peerResult) return { ...peerResult, _wasFreshGeneration: false };
    const err = new Error('Insight generation timed out waiting for concurrent caller');
    err.statusCode = 503;
    throw err;
  }

  try {
    // 3. Re-check cache (peer may have finished between our miss and lock).
    if (!opts.forceRegenerate) {
      const cached2 = await findFreshCache(cpOrgId, surface);
      if (cached2) return { ...cached2, _wasFreshGeneration: false };
    }

    // 4. Build facts pack.
    const factsPack = await buildPack(surface, cpOrgId, user, opts.range);

    // 5. Insufficient data → write a fallback-confidence record with no
    //    narrative. NO LLM call was made → _wasFreshGeneration: false.
    const source = opts.forceRegenerate ? 'on_demand' : 'scheduled';
    if (factsPack.hasInsufficientData) {
      const insufficient = await persistInsight({
        cpOrgId,
        surface,
        factsPack,
        narration: { narrative: null, headlinedCandidates: [], confidence: 'fallback', citations: [] },
        validationResult: { valid: true, retries: 0, fellBackToTemplate: false, failureReason: 'insufficient_data' },
        source,
      });
      return { ...insufficient.toObject(), _wasFreshGeneration: false };
    }

    // 6. Populate candidates.
    factsPack.candidates = { recommendations: collectCandidates(surface, factsPack) };

    // 7. Narrator + validator retry loop.
    let narration, validation, tokenUsage = { prompt: 0, completion: 0, total: 0, costUsd: 0 };
    let attempts = 0;
    let lastHint;
    while (attempts <= MAX_RETRIES) {
      const result = await narrate(surface, factsPack, lastHint);
      narration = result.narration;
      // Accumulate token cost across retries — every attempt costs money.
      tokenUsage = {
        prompt:     tokenUsage.prompt     + result.tokenUsage.prompt,
        completion: tokenUsage.completion + result.tokenUsage.completion,
        total:      tokenUsage.total      + result.tokenUsage.total,
        costUsd:    tokenUsage.costUsd    + result.tokenUsage.costUsd,
      };
      validation = standardNumericValidator(narration, factsPack);
      if (validation.valid) break;
      lastHint = validation.retryHint;
      attempts++;
    }

    // 8. Validation exhausted → deterministic template fallback.
    if (!validation.valid) {
      const config = insightSurfaces[surface];
      narration = deterministicTemplate(config.fallbackTemplate, factsPack);
    }

    // 9. Persist + return.
    const insight = await persistInsight({
      cpOrgId,
      surface,
      factsPack,
      narration,
      validationResult: {
        valid: validation.valid,
        retries: attempts,
        fellBackToTemplate: !validation.valid,
        failureReason: validation.valid ? '' : (validation.reason || ''),
      },
      tokenUsage,
      source,
    });
    return { ...insight.toObject(), _wasFreshGeneration: true };
  } finally {
    await releaseLock(lock);
  }
}

export default { getOrGenerateInsight };
