// tests/unit/leadScoring.config.test.js
import {
  DEFAULT_SCORING_CONFIG, getLeadPriority, calculateSourceScore, calculateTimelineScore,
} from '../../services/leadScoringService.js';

describe('lead scoring config + pure factor functions', () => {
  it('weights sum to 1.0 with occupancy timeline the single largest factor', () => {
    const c = DEFAULT_SCORING_CONFIG;
    const sum = c.budgetAlignment.weight + c.engagementLevel.weight + c.timelineUrgency.weight
      + c.sourceQuality.weight + c.recencyFactor.weight;
    expect(Math.round(sum * 100) / 100).toBe(1);
    expect(c.timelineUrgency.weight).toBe(0.40);
    [c.budgetAlignment.weight, c.engagementLevel.weight, c.sourceQuality.weight, c.recencyFactor.weight]
      .forEach((w) => expect(c.timelineUrgency.weight).toBeGreaterThan(w));
  });

  it('source-quality rules are keyed to the 6 new sources', () => {
    const r = DEFAULT_SCORING_CONFIG.sourceQuality.rules;
    expect(Object.keys(r).sort()).toEqual(
      ['channelPartner', 'coldCalling', 'direct', 'management', 'marketing', 'other', 'referral']);
    expect(r.referral).toBeGreaterThan(r.coldCalling);
  });

  it('calculateSourceScore maps each new source to its quality tier', () => {
    const cfg = DEFAULT_SCORING_CONFIG.sourceQuality;
    expect(calculateSourceScore({ source: 'Referral' }, cfg).rawScore).toBe(100);
    expect(calculateSourceScore({ source: 'Channel Partner' }, cfg).rawScore).toBe(85);
    expect(calculateSourceScore({ source: 'Management' }, cfg).rawScore).toBe(80);
    expect(calculateSourceScore({ source: 'Direct' }, cfg).rawScore).toBe(70);
    expect(calculateSourceScore({ source: 'Marketing' }, cfg).rawScore).toBe(55);
    expect(calculateSourceScore({ source: 'Cold Calling' }, cfg).rawScore).toBe(30);
    expect(calculateSourceScore({ source: 'Anything Else' }, cfg).rawScore).toBe(40); // other
  });

  it('calculateTimelineScore rewards immediacy and is the dominant signal', () => {
    const cfg = DEFAULT_SCORING_CONFIG.timelineUrgency;
    expect(calculateTimelineScore({ requirements: { timeline: 'immediate' } }, cfg).rawScore).toBe(100);
    expect(calculateTimelineScore({ requirements: { timeline: '1-3_months' } }, cfg).rawScore).toBe(85);
    expect(calculateTimelineScore({ requirements: { timeline: '12+_months' } }, cfg).rawScore).toBe(25);
  });

  it('getLeadPriority returns the 4 levels (no Critical)', () => {
    expect(getLeadPriority(99)).toBe('High');
    expect(getLeadPriority(65)).toBe('Medium');
    expect(getLeadPriority(45)).toBe('Low');
    expect(getLeadPriority(10)).toBe('Very Low');
    expect(['High', 'Medium', 'Low', 'Very Low']).toContain(getLeadPriority(88));
  });
});
