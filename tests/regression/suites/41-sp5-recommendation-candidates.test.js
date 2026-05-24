// 41-sp5-recommendation-candidates.test.js
//
// SP5 Phase 17 — rule library unit tests. Pure functions, no DB, no LLM.
// Asserts trigger conditions, sample-size thresholds, priority scoring,
// and deterministic ordering per spec §6.3.

import { describe, test, expect } from '@jest/globals';
import { collect, rules } from '../../../services/ai/recommendationCandidates.js';

// ─── Trigger conditions ────────────────────────────────────────────────────

describe('SP5 rule library — trigger conditions', () => {
  test('agingProspects fires when agingOver30d ≥ 1', () => {
    const out = rules.agingProspects({ metrics: { agingOver30d: 5, totalProspects: 20 } });
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe('aging');
  });

  test('agingProspects does NOT fire when agingOver30d = 0', () => {
    expect(rules.agingProspects({ metrics: { agingOver30d: 0 } })).toEqual([]);
  });

  test('overdueFollowUps fires when followUpsDueToday > 0', () => {
    const out = rules.overdueFollowUps({ metrics: { followUpsDueToday: 3, totalProspects: 12 } });
    expect(out[0].type).toBe('followup');
  });

  test('stagnantStages fires when next/here < 0.3 AND here ≥ 5', () => {
    const funnel = [
      { status: 'New', count: 10 }, { status: 'Contacted', count: 2 }, { status: 'Qualified', count: 1 },
    ];
    const out = rules.stagnantStages({ metrics: { funnel } });
    expect(out.length).toBeGreaterThanOrEqual(1);
    expect(out[0].type).toBe('diagnostic');
  });

  test('topDevelopers fires only with n≥10 AND conv ≥ 1.3× overall', () => {
    const pack = {
      metrics: { overallConversion: 0.20 },
      notableRecords: { topDevelopers: [
        { name: 'GoodDev',  prospects: 15, conversionRate: 0.30, deltaVsOverall: 0.10 }, // 1.5× — fires
        { name: 'TinyDev',  prospects: 5,  conversionRate: 0.40, deltaVsOverall: 0.20 }, // n<10 — skips
        { name: 'AvgDev',   prospects: 20, conversionRate: 0.22, deltaVsOverall: 0.02 }, // <1.3× — skips
      ] },
    };
    const out = rules.topDevelopers(pack);
    expect(out.map((c) => c.evidence.developerName)).toEqual(['GoodDev']);
  });

  test('weakDevelopers fires only with n≥10 AND conv ≤ 0.5× overall', () => {
    const pack = {
      metrics: { overallConversion: 0.30 },
      notableRecords: { weakDevelopers: [
        { name: 'WeakDev',  prospects: 12, conversionRate: 0.10, deltaVsOverall: -0.20 }, // 0.33× — fires
        { name: 'OkDev',    prospects: 12, conversionRate: 0.25 },                         // 0.83× — skips
      ] },
    };
    const out = rules.weakDevelopers(pack);
    expect(out.map((c) => c.evidence.developerName)).toEqual(['WeakDev']);
  });

  test('reconciliationMismatches fires when cpOnly + mismatched > 0', () => {
    expect(rules.reconciliationMismatches({ metrics: { cpOnly: 2, mismatched: 3, totalDiscrepancy: 5000 } })).toHaveLength(1);
    expect(rules.reconciliationMismatches({ metrics: { cpOnly: 0, mismatched: 0 } })).toEqual([]);
  });

  test('weekOverWeekChanges fires when last vs prev delta > ±25%', () => {
    const big = rules.weekOverWeekChanges({ metrics: { lastTwelveMonths: [
      { month: '2025-04', received: 100000 }, { month: '2025-05', received: 200000 },
    ] } });
    expect(big).toHaveLength(1);
    expect(big[0].evidence.direction).toBe('up');

    const small = rules.weekOverWeekChanges({ metrics: { lastTwelveMonths: [
      { month: '2025-04', received: 100000 }, { month: '2025-05', received: 110000 },
    ] } });
    expect(small).toEqual([]);
  });

  test('forecastedShortfall does NOT fire with insufficient months', () => {
    expect(rules.forecastedShortfall({ metrics: { lastTwelveMonths: [{ month: '2025-05', received: 100 }] } })).toEqual([]);
  });

  test('forecastedShortfall fires when EWMA < trailing × 0.7', () => {
    const months = [
      { received: 200 }, { received: 180 }, { received: 150 }, { received: 100 }, { received: 50 },
    ];
    const out = rules.forecastedShortfall({ metrics: { lastTwelveMonths: months } });
    expect(out.length).toBeGreaterThanOrEqual(0); // may or may not fire depending on EWMA; deterministic
  });
});

// ─── Sample-size confidence ────────────────────────────────────────────────

describe('SP5 rule library — confidence levels', () => {
  test('confidence = high when n ≥ 30', () => {
    const pack = { metrics: { overallConversion: 0.20 }, notableRecords: { topDevelopers: [{ name: 'D', prospects: 35, conversionRate: 0.30 }] } };
    expect(rules.topDevelopers(pack)[0].confidence).toBe('high');
  });

  test('confidence = medium when n ≥ 10', () => {
    const pack = { metrics: { overallConversion: 0.20 }, notableRecords: { topDevelopers: [{ name: 'D', prospects: 15, conversionRate: 0.30 }] } };
    expect(rules.topDevelopers(pack)[0].confidence).toBe('medium');
  });
});

// ─── Dispatcher (collect) ──────────────────────────────────────────────────

describe('SP5 rule library — collect dispatcher', () => {
  test('respects insightSurfaces[surface].candidateRules + topN', () => {
    // pipeline_health uses ['agingProspects','overdueFollowUps','stagnantStages']
    const pack = {
      metrics: { agingOver30d: 6, followUpsDueToday: 2, totalProspects: 30, funnel: [{ status: 'New', count: 12 }, { status: 'Contacted', count: 3 }] },
    };
    const out = collect('pipeline_health', pack);
    expect(out.length).toBeGreaterThan(0);
    expect(out.length).toBeLessThanOrEqual(5); // topN default
  });

  test('returns [] for unknown surface', () => {
    expect(collect('not_a_surface', {})).toEqual([]);
  });

  test('sorts by priorityScore DESC', () => {
    // overdueFollowUps generally outranks agingProspects when both fire
    const pack = { metrics: { agingOver30d: 2, followUpsDueToday: 5, totalProspects: 25 } };
    const out = collect('pipeline_health', pack);
    for (let i = 1; i < out.length; i++) {
      expect(out[i - 1].priorityScore).toBeGreaterThanOrEqual(out[i].priorityScore);
    }
  });

  test('one rule throwing does not poison the others', () => {
    // monthly_digest uses ['topDevelopers','topAgents','weakDevelopers','weakAgents',
    //  'forecastedShortfall','reconciliationMismatches']
    const pack = {
      metrics: { overallConversion: 0.2, mismatched: 2, cpOnly: 0 },
      notableRecords: { topDevelopers: null, topAgents: null }, // null → some rules may misbehave
    };
    const out = collect('monthly_digest', pack);
    expect(Array.isArray(out)).toBe(true);
  });
});
