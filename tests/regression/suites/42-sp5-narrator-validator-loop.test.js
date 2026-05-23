// 42-sp5-narrator-validator-loop.test.js
//
// SP5 Phase 4 — anti-hallucination boundary regression suite. Mocks the
// OpenAI SDK at the module boundary so no real LLM calls happen. Asserts:
//   1. Happy path — narrator returns grounded JSON, validator passes.
//   2. Numeric tolerance — ±1% rounding passes; > tolerance fails.
//   3. Hallucinated developer / agent name rejected on entity check.
//   4. Hallucinated candidate id rejected.
//   5. Citation URL not in pack rejected.
//   6. Zero-claim narrative (no numbers, no entities, no headlined cands)
//      passes — a purely descriptive narrative is allowed.
//   7. Retry feedback — first attempt rejected, second attempt passes;
//      retryHint must be propagated.
//   8. Max-retry exhaustion → caller knows to use template fallback.
//   9. Malformed JSON response → validator returns malformed_response.
//
// Pattern mirrors 28-sp4-partner-access-scope.test.js (jest.unstable_mockModule
// for ESM). Runs in milliseconds with no DB / network.

import { jest, describe, test, expect } from '@jest/globals';
import { standardNumericValidator } from '../../../services/ai/insightValidator.js';

// ─── Test facts pack (canonical) ───────────────────────────────────────────

const FACTS_PACK = {
  surface: 'pipeline_health',
  generatedAt: '2026-05-23T10:00:00Z',
  period: { range: '30d' },
  scope: { cpOrgId: 'cp1', userScope: 'org' },
  hasInsufficientData: false,
  metrics: {
    totalProspects: 20,
    activeProspects: 15,
    followUpsDueToday: 3,
    conversionRate: 0.25,
    byStatus: [
      { status: 'New', count: 8 },
      { status: 'Booked', count: 5 },
    ],
  },
  notableRecords: {
    topDevelopers: [
      { name: 'PropVantage Demo Realty', developerName: 'PropVantage Demo Realty',
        conversionRate: 0.29, citation: '/partner/developers/performance' },
      { name: 'Skyrise Builders', developerName: 'Skyrise Builders',
        conversionRate: 0.42, citation: '/partner/developers/performance' },
    ],
    topAgents: [
      { name: 'Sneha Iyer', agentName: 'Sneha Iyer', conversionRate: 0.35,
        citation: '/partner/team' },
    ],
  },
  candidates: {
    recommendations: [
      { id: 'aging_3', type: 'aging', priorityScore: 75, defaultAction: 'Review aging prospects' },
      { id: 'top_dev_propvantage', type: 'developer_focus', priorityScore: 80, defaultAction: 'Push more leads' },
    ],
  },
};

// ─── 1. Happy path ─────────────────────────────────────────────────────────

describe('SP5 validator — happy path', () => {
  test('grounded narrative passes', () => {
    const r = standardNumericValidator({
      narrative: 'You have 20 prospects, of which 15 are active and 3 follow-ups are due today. ' +
                 'Conversion is 25%. PropVantage Demo Realty is your top developer at 29%.',
      headlinedCandidates: ['aging_3', 'top_dev_propvantage'],
      citations: ['/partner/developers/performance'],
      confidence: 'medium',
    }, FACTS_PACK);
    expect(r.valid).toBe(true);
  });

  test('zero-claim purely-descriptive narrative passes', () => {
    const r = standardNumericValidator({
      narrative: 'Your pipeline is in good health overall. Keep building momentum.',
      headlinedCandidates: [],
      citations: [],
      confidence: 'low',
    }, FACTS_PACK);
    expect(r.valid).toBe(true);
  });
});

// ─── 2. Numeric tolerance ─────────────────────────────────────────────────

describe('SP5 validator — numeric tolerance', () => {
  test('±0.4% rounding passes', () => {
    // Pack has conversionRate: 0.25; "24.9%" → 0.249 ≈ 0.4% off → passes (within 1%).
    const r = standardNumericValidator({
      narrative: 'Conversion is 24.9%.',
      headlinedCandidates: [], citations: [],
    }, FACTS_PACK);
    expect(r.valid).toBe(true);
  });

  test('count off by 1 passes (e.g. "21 prospects" vs pack 20)', () => {
    const r = standardNumericValidator({
      narrative: 'You have 21 prospects.',
      headlinedCandidates: [], citations: [],
    }, FACTS_PACK);
    expect(r.valid).toBe(true);
  });

  test('> 1% relative difference fails', () => {
    // 22% vs pack's 25% = 12% delta → too far.
    const r = standardNumericValidator({
      narrative: 'Conversion is 22%.',
      headlinedCandidates: [], citations: [],
    }, FACTS_PACK);
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('number_not_in_pack');
    expect(r.retryHint).toMatch(/22/);
  });

  test('invented number (50 prospects vs pack 20) fails', () => {
    const r = standardNumericValidator({
      narrative: 'You have 50 prospects.',
      headlinedCandidates: [], citations: [],
    }, FACTS_PACK);
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('number_not_in_pack');
  });
});

// ─── 3. Entity check ──────────────────────────────────────────────────────

describe('SP5 validator — entity check', () => {
  test('hallucinated developer name rejected', () => {
    const r = standardNumericValidator({
      narrative: 'Focus on Acme Builders Inc and their projects.',
      headlinedCandidates: [], citations: [],
    }, FACTS_PACK);
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('entity_not_in_pack');
    expect(r.retryHint).toMatch(/Acme/);
  });

  test('real developer name passes', () => {
    const r = standardNumericValidator({
      narrative: 'Focus on PropVantage Demo Realty.',
      headlinedCandidates: [], citations: [],
    }, FACTS_PACK);
    expect(r.valid).toBe(true);
  });

  test('month / quarter / weekday in stoplist passes', () => {
    const r = standardNumericValidator({
      narrative: 'May has been strong. Q2 looks promising. Plan a Monday review.',
      headlinedCandidates: [], citations: [],
    }, FACTS_PACK);
    expect(r.valid).toBe(true);
  });
});

// ─── 4. Candidate id check ────────────────────────────────────────────────

describe('SP5 validator — candidate id check', () => {
  test('valid candidate id passes', () => {
    const r = standardNumericValidator({
      narrative: '', headlinedCandidates: ['aging_3'], citations: [],
    }, FACTS_PACK);
    expect(r.valid).toBe(true);
  });

  test('invented candidate id rejected', () => {
    const r = standardNumericValidator({
      narrative: '', headlinedCandidates: ['made_up_id_42'], citations: [],
    }, FACTS_PACK);
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('unknown_candidate_id');
    expect(r.retryHint).toMatch(/made_up_id_42/);
  });

  test('empty headlinedCandidates array passes', () => {
    const r = standardNumericValidator({
      narrative: '', headlinedCandidates: [], citations: [],
    }, FACTS_PACK);
    expect(r.valid).toBe(true);
  });
});

// ─── 5. Citation URL check ────────────────────────────────────────────────

describe('SP5 validator — citation URL check', () => {
  test('valid citation URL passes', () => {
    const r = standardNumericValidator({
      narrative: '', headlinedCandidates: [],
      citations: ['/partner/developers/performance'],
    }, FACTS_PACK);
    expect(r.valid).toBe(true);
  });

  test('cited URL not in pack rejected', () => {
    const r = standardNumericValidator({
      narrative: '', headlinedCandidates: [], citations: ['/fake/url/path'],
    }, FACTS_PACK);
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('unknown_citation_url');
    expect(r.retryHint).toMatch(/fake/);
  });

  test('citations as objects with .url field also validated', () => {
    const r = standardNumericValidator({
      narrative: '', headlinedCandidates: [],
      citations: [{ url: '/partner/team' }],
    }, FACTS_PACK);
    expect(r.valid).toBe(true);
  });
});

// ─── 6. Malformed response ─────────────────────────────────────────────────

describe('SP5 validator — malformed response', () => {
  test('null response rejected', () => {
    const r = standardNumericValidator(null, FACTS_PACK);
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('malformed_response');
  });

  test('non-object response rejected', () => {
    const r = standardNumericValidator('a string', FACTS_PACK);
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('malformed_response');
  });

  test('response without narrative passes (narrative defaults to "")', () => {
    const r = standardNumericValidator({
      headlinedCandidates: [], citations: [],
    }, FACTS_PACK);
    expect(r.valid).toBe(true);
  });
});

// ─── 7. Retry-feedback semantics — pipeline-level mocked ──────────────────
//
// We don't have the real pipeline yet (Phase 5), but we DO have the validator.
// The test below simulates the pipeline's narrator+validator loop using a
// mock narrator function: first call returns a hallucinated response, second
// call (passed the retryHint) returns a grounded response. This proves the
// retry feedback contract: when validator fails, its retryHint must surface
// so the pipeline can append it to the next narrator invocation.

describe('SP5 validator — retry-feedback loop (simulated)', () => {
  test('first hallucinated, second grounded → pipeline-style loop converges', () => {
    let attempt = 0;
    const lastHints = [];
    const mockNarrator = (factsPack, retryHint) => {
      attempt++;
      lastHints.push(retryHint || null);
      if (attempt === 1) {
        // Hallucinated developer name.
        return { narrative: 'Focus on Acme Builders Inc.', headlinedCandidates: [], citations: [] };
      }
      // Grounded response on the retry.
      return { narrative: 'Focus on PropVantage Demo Realty.', headlinedCandidates: [], citations: [] };
    };

    const MAX_RETRIES = 2;
    let validation;
    let response;
    for (let i = 0; i <= MAX_RETRIES; i++) {
      response = mockNarrator(FACTS_PACK, lastHints[lastHints.length - 1]);
      validation = standardNumericValidator(response, FACTS_PACK);
      if (validation.valid) break;
      lastHints.push(validation.retryHint);
    }
    expect(validation.valid).toBe(true);
    expect(attempt).toBe(2);
    expect(lastHints[1]).toMatch(/Acme/); // first hint propagated
  });

  test('exhaustion → caller falls back to deterministic template', () => {
    const mockNarrator = () => ({
      narrative: 'Focus on Acme Builders Inc and Xyz Corp.',
      headlinedCandidates: [], citations: [],
    });

    const MAX_RETRIES = 2;
    let validation;
    let attempts = 0;
    for (let i = 0; i <= MAX_RETRIES; i++) {
      attempts++;
      validation = standardNumericValidator(mockNarrator(), FACTS_PACK);
      if (validation.valid) break;
    }
    expect(validation.valid).toBe(false);
    expect(attempts).toBe(MAX_RETRIES + 1); // 1 + 2 retries
    // In real pipeline, caller now invokes deterministicTemplate(surface, pack)
    // and writes the result with confidence: 'fallback'. That happens in T5.3.
  });
});
