// 43-sp5-insight-cache.test.js
//
// SP5 Phase 17 — insight pipeline cache + lock behaviour. Mocks the
// narrator (no LLM cost) and asserts:
//   • Cache hit returns same insight, no second narrator call
//   • forceRegenerate bypasses cache and bumps a fresh generation
//   • hasInsufficientData path skips the narrator entirely
//   • Validator-exhaustion path falls back to deterministicTemplate
//
// Mongo NOT mocked — pipeline writes to the real AIInsight collection
// (single doc per call, cleaned up at the end of the suite).

import { jest, describe, test, expect, beforeAll, afterAll } from '@jest/globals';

const mockNarrate = jest.fn();
jest.unstable_mockModule('../../../services/ai/insightNarrator.js', () => ({
  narrate: mockNarrate,
}));

// Also mock factsPackBuilder so we control hasInsufficientData and the
// pack contents directly per test.
const mockBuild = jest.fn();
const mockHash = jest.fn(() => 'hash-fixed');
jest.unstable_mockModule('../../../services/ai/factsPackBuilder.js', () => ({
  build: mockBuild,
  hashFactsPack: mockHash,
}));

let getOrGenerateInsight, AIInsight, mongoose;
beforeAll(async () => {
  const dotenv = (await import('dotenv')).default;
  dotenv.config();
  mongoose = (await import('mongoose')).default;
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(process.env.MONGO_URI);
  }
  ({ getOrGenerateInsight } = await import('../../../services/ai/insightPipeline.js'));
  AIInsight = (await import('../../../models/aiInsightModel.js')).default;
});

afterAll(async () => {
  // Cleanup: delete any test-cache entries for our scratch org id.
  if (AIInsight) {
    await AIInsight.deleteMany({ cpOrgId: '600000000000000000000043' });
  }
  if (mongoose?.connection?.readyState !== 0) {
    await mongoose.disconnect();
  }
});

const TEST_ORG = '600000000000000000000043';
const TEST_USER = { _id: '600000000000000000000044', organization: TEST_ORG, roleRef: { slug: 'cp-owner' } };

const makePack = (overrides = {}) => ({
  surface: 'pipeline_health',
  generatedAt: new Date().toISOString(),
  period: { range: '30d' },
  scope: { cpOrgId: String(TEST_ORG), userScope: 'org' },
  hasInsufficientData: false,
  metrics: { totalProspects: 20, activeProspects: 15 },
  notableRecords: {},
  candidates: { recommendations: [] },
  ...overrides,
});

describe('SP5 insight pipeline — cache + lock + fallback', () => {
  test('Cache hit returns same insight without re-running narrator', async () => {
    mockNarrate.mockReset();
    mockBuild.mockReset();
    await AIInsight.deleteMany({ cpOrgId: TEST_ORG });

    mockBuild.mockResolvedValue(makePack());
    mockNarrate.mockResolvedValue({
      narration: { narrative: '20 prospects, 15 active.', headlinedCandidates: [], confidence: 'medium', citations: [] },
      tokenUsage: { prompt: 100, completion: 50, total: 150, costUsd: 0.0005 },
    });

    const first = await getOrGenerateInsight('pipeline_health', TEST_ORG, TEST_USER);
    const second = await getOrGenerateInsight('pipeline_health', TEST_ORG, TEST_USER);

    expect(first._id.toString()).toBe(second._id.toString());
    expect(mockNarrate).toHaveBeenCalledTimes(1); // cache hit on second call
  }, 20000);

  test('forceRegenerate bypasses cache + runs narrator', async () => {
    mockNarrate.mockReset();
    mockBuild.mockReset();
    await AIInsight.deleteMany({ cpOrgId: TEST_ORG });

    mockBuild.mockResolvedValue(makePack());
    mockNarrate.mockResolvedValue({
      narration: { narrative: '20 prospects.', headlinedCandidates: [], confidence: 'medium', citations: [] },
      tokenUsage: { prompt: 100, completion: 50, total: 150, costUsd: 0.0005 },
    });

    await getOrGenerateInsight('pipeline_health', TEST_ORG, TEST_USER);
    await getOrGenerateInsight('pipeline_health', TEST_ORG, TEST_USER, { forceRegenerate: true });
    expect(mockNarrate).toHaveBeenCalledTimes(2);
  }, 20000);

  test('hasInsufficientData skips narrator + persists fallback', async () => {
    mockNarrate.mockReset();
    mockBuild.mockReset();
    await AIInsight.deleteMany({ cpOrgId: TEST_ORG });

    mockBuild.mockResolvedValue(makePack({ hasInsufficientData: true }));

    const insight = await getOrGenerateInsight('pipeline_health', TEST_ORG, TEST_USER);
    expect(mockNarrate).not.toHaveBeenCalled();
    expect(insight.confidence).toBe('fallback');
    expect(insight.validationResult?.failureReason).toBe('insufficient_data');
  }, 15000);

  test('Validator exhaustion → deterministicTemplate fallback', async () => {
    mockNarrate.mockReset();
    mockBuild.mockReset();
    await AIInsight.deleteMany({ cpOrgId: TEST_ORG });

    mockBuild.mockResolvedValue(makePack());
    // Hallucinate a number not in the pack so the validator rejects every attempt.
    mockNarrate.mockResolvedValue({
      narration: { narrative: 'You have 999 prospects.', headlinedCandidates: [], confidence: 'high', citations: [] },
      tokenUsage: { prompt: 100, completion: 50, total: 150, costUsd: 0.0005 },
    });

    const insight = await getOrGenerateInsight('pipeline_health', TEST_ORG, TEST_USER, { forceRegenerate: true });
    expect(insight.confidence).toBe('fallback');
    expect(insight.validationResult?.fellBackToTemplate).toBe(true);
    expect(insight.validationResult?.retries).toBeGreaterThanOrEqual(2);
  }, 20000);
});
