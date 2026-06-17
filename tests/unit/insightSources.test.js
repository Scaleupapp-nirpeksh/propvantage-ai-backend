// tests/unit/insightSources.test.js
// Unit tests for the Insight Cards source registry (Theme D3). The underlying
// analytics services are mocked with jest.unstable_mockModule BEFORE importing
// insightSources, so each source's run() is tested purely as a mapper from a
// representative service result into the ONE normalized payload shape.
import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import mongoose from 'mongoose';

// ─── Mock the underlying analytics services ──────────────────────────────────
const mockGenerateSalesForecast = jest.fn();
const mockCalculateRevenueProjection = jest.fn();
const mockCalculateLeadConversionProbabilities = jest.fn();
jest.unstable_mockModule('../../services/predictiveAnalyticsService.js', () => ({
  generateSalesForecast: mockGenerateSalesForecast,
  calculateRevenueProjection: mockCalculateRevenueProjection,
  calculateLeadConversionProbabilities: mockCalculateLeadConversionProbabilities,
}));

const mockCalculateBudgetVsActual = jest.fn();
jest.unstable_mockModule('../../services/budgetVsActualService.js', () => ({
  calculateBudgetVsActual: mockCalculateBudgetVsActual,
}));

// config/permissions.js is pure — used for real so PREDICTIVE/ADVANCED drift is caught.
const { INSIGHT_SOURCES, listInsightSources, getInsightSource } = await import(
  '../../services/workspace/insightSources.js'
);
const { PERMISSIONS } = await import('../../config/permissions.js');

const ORG = new mongoose.Types.ObjectId();
const PROJ = new mongoose.Types.ObjectId();
const viewer = { organization: ORG, accessibleProjectIds: null, isOwner: true, permissions: [] };

beforeEach(() => {
  [
    mockGenerateSalesForecast,
    mockCalculateRevenueProjection,
    mockCalculateLeadConversionProbabilities,
    mockCalculateBudgetVsActual,
  ].forEach((m) => m.mockReset());
});

// Shared assertion: every run() result must conform to the normalized shape.
const expectNormalizedShape = (payload) => {
  expect(['forecast', 'comparison']).toContain(payload.kind);
  expect(payload.headline).toEqual(expect.objectContaining({
    label: expect.any(String),
    value: expect.any(Number),
    format: expect.stringMatching(/^(currency|number|percent)$/),
  }));
  expect(Array.isArray(payload.bands)).toBe(true);
  for (const b of payload.bands) {
    expect(typeof b.label).toBe('string');
    expect(typeof b.value).toBe('number');
    expect(b.format).toMatch(/^(currency|number|percent)$/);
  }
  expect(payload.confidence === null || typeof payload.confidence.level === 'string').toBe(true);
  expect(payload.series === null || Array.isArray(payload.series)).toBe(true);
  expect(Array.isArray(payload.bullets)).toBe(true);
  expect(payload.bullets.length).toBeLessThanOrEqual(4);
  expect(typeof payload.asOf).toBe('string');
  expect(() => new Date(payload.asOf).toISOString()).not.toThrow();
  expect(payload.scope).toEqual(expect.objectContaining({ period: expect.any(String) }));
};

describe('insightSources — registry metadata', () => {
  test('listInsightSources() returns serializable metadata with no function props', () => {
    const meta = listInsightSources();
    expect(meta.map((m) => m.key).sort()).toEqual(
      ['budgetVsActual', 'leadConversion', 'revenueProjection', 'salesForecast'].sort()
    );
    for (const m of meta) {
      expect(typeof m.key).toBe('string');
      expect(typeof m.label).toBe('string');
      expect(m.kind).toMatch(/^(forecast|comparison)$/);
      expect(typeof m.params).toBe('object');
      expect(typeof m.run).toBe('undefined'); // run() must NOT leak to the client
      // JSON-roundtrippable (no functions anywhere)
      expect(() => JSON.stringify(m)).not.toThrow();
    }
  });

  test('getInsightSource() resolves known keys and returns undefined for unknown', () => {
    expect(getInsightSource('salesForecast')).toBe(INSIGHT_SOURCES.salesForecast);
    expect(getInsightSource('bogus')).toBeUndefined();
  });

  test('permissions are wired: forecast sources use PREDICTIVE; budget uses ADVANCED', () => {
    expect(INSIGHT_SOURCES.salesForecast.permission).toBe(PERMISSIONS.ANALYTICS.PREDICTIVE);
    expect(INSIGHT_SOURCES.revenueProjection.permission).toBe(PERMISSIONS.ANALYTICS.PREDICTIVE);
    expect(INSIGHT_SOURCES.leadConversion.permission).toBe(PERMISSIONS.ANALYTICS.PREDICTIVE);
    expect(INSIGHT_SOURCES.budgetVsActual.permission).toBe(
      PERMISSIONS.ANALYTICS.ADVANCED || PERMISSIONS.ANALYTICS.PREDICTIVE
    );
  });
});

describe('insightSources — salesForecast.run', () => {
  test('maps a forecast result into the normalized shape', async () => {
    mockGenerateSalesForecast.mockResolvedValue({
      forecast: {
        totalForecastedSales: 42,
        averageMonthlySales: 14,
        monthlyBreakdown: [
          { month: 1, date: new Date('2026-07-01'), forecastedSales: 12, aiAdjustedSales: 13, confidence: 80 },
          { month: 2, date: new Date('2026-08-01'), forecastedSales: 14, aiAdjustedSales: 15, confidence: 75 },
        ],
      },
      scenarios: {
        pessimistic: { totalSales: 34 },
        realistic: { totalSales: 42 },
        optimistic: { totalSales: 50 },
      },
      confidence: { confidence80: {}, confidence95: {} },
      insights: [{ message: 'Strong upward trend' }],
      recommendations: [{ action: 'Scale up sales team' }],
      metadata: { dataQuality: 'High' },
    });

    const payload = await INSIGHT_SOURCES.salesForecast.run(viewer, { period: '6_months', projectId: PROJ });
    expectNormalizedShape(payload);
    expect(mockGenerateSalesForecast).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: ORG, projectId: PROJ, forecastPeriod: '6_months',
      includeConfidenceInterval: true, includeScenarios: true,
    }));
    expect(payload.kind).toBe('forecast');
    expect(payload.headline.value).toBe(42);
    expect(payload.headline.format).toBe('number');
    expect(payload.bands.map((b) => b.value)).toEqual([34, 42, 50]);
    expect(payload.confidence.level).toBe('high');
    expect(payload.series).toEqual([
      { label: expect.any(String), value: 13 },
      { label: expect.any(String), value: 15 },
    ]);
    expect(payload.bullets).toEqual(expect.arrayContaining(['Strong upward trend', 'Scale up sales team']));
    expect(payload.scope).toEqual({ period: '6_months', projectId: PROJ });
  });

  test('empty data yields a zero payload with a not-enough-data bullet', async () => {
    mockGenerateSalesForecast.mockResolvedValue({
      forecast: { totalForecastedSales: 0, monthlyBreakdown: [] },
      scenarios: {}, confidence: null, insights: [], recommendations: [], metadata: {},
    });
    const payload = await INSIGHT_SOURCES.salesForecast.run(viewer, {});
    expectNormalizedShape(payload);
    expect(payload.headline.value).toBe(0);
    expect(payload.series).toBeNull();
    expect(payload.bullets.some((b) => /not enough data/i.test(b))).toBe(true);
  });
});

describe('insightSources — revenueProjection.run', () => {
  test('maps a projection result into the normalized shape', async () => {
    mockGenerateSalesForecast.mockResolvedValue({
      forecast: { monthlyBreakdown: [], totalForecastedSales: 10 },
      scenarios: {}, metadata: { dataQuality: 'Medium' },
    });
    mockCalculateRevenueProjection.mockResolvedValue({
      totalRevenue: 50000000,
      monthlyBreakdown: [
        { month: 1, date: new Date('2026-07-01'), projectedRevenue: 25000000, confidence: 80 },
        { month: 2, date: new Date('2026-08-01'), projectedRevenue: 25000000, confidence: 70 },
      ],
      scenarios: {
        pessimistic: { totalRevenue: 45000000 },
        realistic: { totalRevenue: 50000000 },
        optimistic: { totalRevenue: 55000000 },
      },
      confidence: {},
      averageUnitPrice: 5000000,
      assumptions: ['Average unit price: ₹50.0 Lakhs', 'Pricing remains consistent'],
    });

    const payload = await INSIGHT_SOURCES.revenueProjection.run(viewer, { period: '3_months' });
    expectNormalizedShape(payload);
    expect(mockCalculateRevenueProjection).toHaveBeenCalledTimes(1);
    expect(payload.headline.value).toBe(50000000);
    expect(payload.headline.format).toBe('currency');
    expect(payload.bands.map((b) => b.value)).toEqual([45000000, 50000000, 55000000]);
    expect(payload.confidence.level).toBe('medium');
    expect(payload.series.map((s) => s.value)).toEqual([25000000, 25000000]);
    expect(payload.bullets.length).toBeGreaterThan(0);
  });

  test('empty data yields a zero payload with a not-enough-data bullet', async () => {
    mockGenerateSalesForecast.mockResolvedValue({ forecast: { monthlyBreakdown: [] }, scenarios: {}, metadata: {} });
    mockCalculateRevenueProjection.mockResolvedValue({
      totalRevenue: 0, monthlyBreakdown: [], scenarios: {}, confidence: {}, averageUnitPrice: 0, assumptions: [],
    });
    const payload = await INSIGHT_SOURCES.revenueProjection.run(viewer, {});
    expectNormalizedShape(payload);
    expect(payload.headline.value).toBe(0);
    expect(payload.bullets.some((b) => /not enough data/i.test(b))).toBe(true);
  });
});

describe('insightSources — leadConversion.run', () => {
  test('maps a conversion summary into the normalized shape', async () => {
    mockCalculateLeadConversionProbabilities.mockResolvedValue({
      totalLeads: 20,
      highProbabilityLeads: 6,
      averageProbability: 64.4,
      leadBreakdown: { hot: 5, warm: 7, cold: 8 },
      topLeads: [{ firstName: 'Asha', lastName: 'Rao', conversionProbability: 92 }],
    });
    const payload = await INSIGHT_SOURCES.leadConversion.run(viewer, { timeframe: '90_days' });
    expectNormalizedShape(payload);
    expect(mockCalculateLeadConversionProbabilities).toHaveBeenCalledWith(ORG, null, 70, '90_days');
    expect(payload.headline.format).toBe('percent');
    expect(payload.headline.value).toBe(64); // rounded
    expect(payload.bands.map((b) => b.value)).toEqual([5, 7, 8]);
    expect(payload.confidence.level).toBe('medium');
    expect(payload.series).toBeNull();
    expect(payload.bullets.some((b) => /Asha Rao/.test(b))).toBe(true);
    expect(payload.scope).toEqual({ period: '90_days', projectId: null });
  });

  test('empty data (no leads) yields a zero payload with a not-enough-data bullet', async () => {
    mockCalculateLeadConversionProbabilities.mockResolvedValue({
      totalLeads: 0, highProbabilityLeads: 0, averageProbability: 0,
      leadBreakdown: { hot: 0, warm: 0, cold: 0 }, topLeads: [],
    });
    const payload = await INSIGHT_SOURCES.leadConversion.run(viewer, {});
    expectNormalizedShape(payload);
    expect(payload.headline.value).toBe(0);
    expect(payload.confidence).toBeNull();
    expect(payload.bullets.some((b) => /not enough data/i.test(b))).toBe(true);
  });
});

describe('insightSources — budgetVsActual.run', () => {
  test('maps a budget report into the normalized comparison shape', async () => {
    mockCalculateBudgetVsActual.mockResolvedValue({
      summary: { overallStatus: 'on_track', alerts: [{ message: 'Revenue is 5% below target' }] },
      revenue: {
        target: { totalRevenue: 100000000 },
        actual: { totalRevenue: 110000000 },
        variance: { percentage: 10 },
        trend: {
          monthly: [
            { _id: { year: 2026, month: 1 }, revenue: 50000000 },
            { _id: { year: 2026, month: 2 }, revenue: 60000000 },
          ],
        },
      },
      metadata: { generatedAt: new Date() },
    });
    const payload = await INSIGHT_SOURCES.budgetVsActual.run(viewer, { period: 'ytd', projectId: PROJ });
    expectNormalizedShape(payload);
    expect(mockCalculateBudgetVsActual).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: ORG, projectId: PROJ, period: 'ytd',
    }));
    expect(payload.kind).toBe('comparison');
    expect(payload.headline.value).toBe(110000000);
    expect(payload.headline.format).toBe('currency');
    const [target, actual, variance] = payload.bands;
    expect(target.value).toBe(100000000);
    expect(actual.value).toBe(110000000);
    expect(variance.value).toBe(10);
    expect(variance.format).toBe('percent');
    expect(variance.tone).toBe('positive'); // variance >= 0
    expect(payload.series.map((s) => s.value)).toEqual([50000000, 60000000]);
    expect(payload.bullets.some((b) => /on track/i.test(b))).toBe(true);
  });

  test('negative variance tints the variance band negative', async () => {
    mockCalculateBudgetVsActual.mockResolvedValue({
      summary: { overallStatus: 'needs_attention', alerts: [] },
      revenue: {
        target: { totalRevenue: 100000000 },
        actual: { totalRevenue: 70000000 },
        variance: { percentage: -30 },
        trend: { monthly: [] },
      },
      metadata: {},
    });
    const payload = await INSIGHT_SOURCES.budgetVsActual.run(viewer, { period: 'current_year' });
    expectNormalizedShape(payload);
    expect(payload.bands[2].tone).toBe('negative');
    expect(payload.series).toBeNull();
  });

  test('empty data yields a zero payload with a not-enough-data bullet', async () => {
    mockCalculateBudgetVsActual.mockResolvedValue({
      summary: {}, revenue: { target: {}, actual: {}, variance: {}, trend: { monthly: [] } }, metadata: {},
    });
    const payload = await INSIGHT_SOURCES.budgetVsActual.run(viewer, {});
    expectNormalizedShape(payload);
    expect(payload.headline.value).toBe(0);
    expect(payload.bullets.some((b) => /not enough data/i.test(b))).toBe(true);
  });
});
