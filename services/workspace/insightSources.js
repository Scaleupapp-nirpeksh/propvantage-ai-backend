// File: services/workspace/insightSources.js
// Description: Insight Cards (Theme D3) — a registry that surfaces existing
//   predictive + budget analytics services as workspace cards of
//   renderMode:'insight'. Each source maps its underlying service result into
//   ONE normalized payload shape so a single renderer can draw any insight.
//   Cards are viewer-scoped + permission-gated in the controller before run().
//
//   No new prediction math lives here — sources only call existing services and
//   reshape the output. See docs spec 2026-06-17-insight-cards-design.md.

import {
  generateSalesForecast,
  calculateRevenueProjection,
  calculateLeadConversionProbabilities,
} from '../predictiveAnalyticsService.js';
import { calculateBudgetVsActual } from '../budgetVsActualService.js';
import { PERMISSIONS } from '../../config/permissions.js';

// ANALYTICS.ADVANCED is the preferred gate for the comparison (budget) source;
// fall back to PREDICTIVE if the catalog ever drops it.
const BUDGET_PERMISSION = PERMISSIONS.ANALYTICS.ADVANCED || PERMISSIONS.ANALYTICS.PREDICTIVE;

// ─── Helpers ──────────────────────────────────────────────────────────────

// Short month label (e.g. "Jun") from a Date-like value, for sparkline points.
const shortMonth = (dateLike) => {
  const d = new Date(dateLike);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short' });
};

// Build a month label from an aggregation _id:{year,month} (month is 1-12).
const shortMonthFromParts = (year, month) => {
  const d = new Date(year, (month || 1) - 1, 1);
  return d.toLocaleDateString('en-US', { month: 'short' });
};

// Map a 0-100 (or 0-1) numeric quality/probability into a confidence band.
const levelFromScore = (score) => {
  const n = score <= 1 ? score * 100 : score;
  if (n >= 80) return 'high';
  if (n >= 60) return 'medium';
  return 'low';
};

// Map the service's textual data-quality (High/Medium/Low/Very Low) to a level.
const levelFromQuality = (quality) => {
  switch (String(quality || '').toLowerCase()) {
    case 'high': return 'high';
    case 'medium': return 'medium';
    default: return 'low';
  }
};

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

// ─── Registry ───────────────────────────────────────────────────────────────

export const INSIGHT_SOURCES = {
  // 1) Sales forecast — total forecasted bookings with scenario bands.
  salesForecast: {
    key: 'salesForecast',
    label: 'Sales forecast',
    kind: 'forecast',
    permission: PERMISSIONS.ANALYTICS.PREDICTIVE,
    params: { period: ['3_months', '6_months', '12_months'] },
    run: async (viewerCtx, cfg) => {
      const result = await generateSalesForecast({
        organizationId: viewerCtx.organization,
        projectId: cfg.projectId || null,
        forecastPeriod: cfg.period || '3_months',
        includeConfidenceInterval: true,
        includeScenarios: true,
      });

      const forecast = result?.forecast || {};
      const scenarios = result?.scenarios || {};
      const monthly = Array.isArray(forecast.monthlyBreakdown) ? forecast.monthlyBreakdown : [];
      const total = num(forecast.totalForecastedSales);

      const bullets = [
        ...(Array.isArray(result?.insights) ? result.insights : []).map((i) => i.message || i),
        ...(Array.isArray(result?.recommendations) ? result.recommendations : []).map((r) => r.action || r),
      ].filter(Boolean).slice(0, 4);

      if (monthly.length === 0 && total === 0) {
        bullets.unshift('Not enough data yet to generate a forecast.');
      }

      return {
        kind: 'forecast',
        headline: { label: 'Forecasted bookings', value: total, format: 'number' },
        bands: [
          { label: 'Pessimistic', value: num(scenarios?.pessimistic?.totalSales), format: 'number', tone: 'negative' },
          { label: 'Realistic', value: num(scenarios?.realistic?.totalSales), format: 'number', tone: 'neutral' },
          { label: 'Optimistic', value: num(scenarios?.optimistic?.totalSales), format: 'number', tone: 'positive' },
        ],
        confidence: { label: 'Data quality', level: levelFromQuality(result?.metadata?.dataQuality) },
        series: monthly.length
          ? monthly.map((m) => ({ label: shortMonth(m.date), value: num(m.aiAdjustedSales ?? m.forecastedSales) }))
          : null,
        bullets: bullets.slice(0, 4),
        asOf: new Date().toISOString(),
        scope: { period: cfg.period || '3_months', projectId: cfg.projectId || null },
      };
    },
  },

  // 2) Revenue projection — total projected revenue, derived from the forecast.
  revenueProjection: {
    key: 'revenueProjection',
    label: 'Revenue projection',
    kind: 'forecast',
    permission: PERMISSIONS.ANALYTICS.PREDICTIVE,
    params: { period: ['3_months', '6_months', '12_months'] },
    run: async (viewerCtx, cfg) => {
      const salesForecast = await generateSalesForecast({
        organizationId: viewerCtx.organization,
        projectId: cfg.projectId || null,
        forecastPeriod: cfg.period || '3_months',
        includeConfidenceInterval: true,
        includeScenarios: true,
      });
      const projection = await calculateRevenueProjection(
        salesForecast,
        viewerCtx.organization,
        cfg.projectId || null
      );

      const monthly = Array.isArray(projection?.monthlyBreakdown) ? projection.monthlyBreakdown : [];
      const total = num(projection?.totalRevenue);
      const scenarios = projection?.scenarios || {};

      const bullets = (Array.isArray(projection?.assumptions) ? projection.assumptions : []).slice(0, 4);
      if (monthly.length === 0 && total === 0) {
        bullets.unshift('Not enough data yet to project revenue.');
      }

      return {
        kind: 'forecast',
        headline: { label: 'Projected revenue', value: total, format: 'currency' },
        bands: [
          { label: 'Pessimistic', value: num(scenarios?.pessimistic?.totalRevenue), format: 'currency', tone: 'negative' },
          { label: 'Realistic', value: num(scenarios?.realistic?.totalRevenue), format: 'currency', tone: 'neutral' },
          { label: 'Optimistic', value: num(scenarios?.optimistic?.totalRevenue), format: 'currency', tone: 'positive' },
        ],
        confidence: { label: 'Data quality', level: levelFromQuality(salesForecast?.metadata?.dataQuality) },
        series: monthly.length
          ? monthly.map((m) => ({ label: shortMonth(m.date), value: num(m.projectedRevenue) }))
          : null,
        bullets: bullets.slice(0, 4),
        asOf: new Date().toISOString(),
        scope: { period: cfg.period || '3_months', projectId: cfg.projectId || null },
      };
    },
  },

  // 3) Lead conversion — average conversion probability with hot/warm/cold bands.
  leadConversion: {
    key: 'leadConversion',
    label: 'Lead conversion',
    kind: 'forecast',
    permission: PERMISSIONS.ANALYTICS.PREDICTIVE,
    params: { timeframe: ['7_days', '30_days', '90_days'] },
    run: async (viewerCtx, cfg) => {
      // The persisted card stores the chosen value in insightConfig.period
      // (the single model field); accept legacy cfg.timeframe too.
      const timeframe = cfg.period || cfg.timeframe || '30_days';
      const result = await calculateLeadConversionProbabilities(
        viewerCtx.organization,
        null,
        70,
        timeframe
      );

      const totalLeads = num(result?.totalLeads);
      const avg = num(result?.averageProbability);
      const breakdown = result?.leadBreakdown || {};

      const bullets = [];
      if (totalLeads === 0) {
        bullets.push('Not enough data yet — no leads to score.');
      } else {
        bullets.push(`${totalLeads} leads scored; ${num(result?.highProbabilityLeads)} high-probability.`);
        const top = Array.isArray(result?.topLeads) ? result.topLeads[0] : null;
        if (top) {
          const name = [top.firstName, top.lastName].filter(Boolean).join(' ') || 'Top lead';
          bullets.push(`Top lead: ${name} at ${num(top.conversionProbability)}% conversion probability.`);
        }
      }

      return {
        kind: 'forecast',
        headline: { label: 'Avg conversion probability', value: Math.round(avg), format: 'percent' },
        bands: [
          { label: 'Hot', value: num(breakdown.hot), format: 'number', tone: 'positive' },
          { label: 'Warm', value: num(breakdown.warm), format: 'number', tone: 'neutral' },
          { label: 'Cold', value: num(breakdown.cold), format: 'number', tone: 'negative' },
        ],
        confidence: totalLeads > 0 ? { label: 'Confidence', level: levelFromScore(avg) } : null,
        series: null,
        bullets: bullets.slice(0, 4),
        asOf: new Date().toISOString(),
        scope: { period: timeframe, projectId: cfg.projectId || null },
      };
    },
  },

  // 4) Budget vs actual — revenue target/actual/variance comparison.
  budgetVsActual: {
    key: 'budgetVsActual',
    label: 'Budget vs actual',
    kind: 'comparison',
    permission: BUDGET_PERMISSION,
    params: { period: ['current_year', 'current_month', 'ytd'] },
    run: async (viewerCtx, cfg) => {
      const result = await calculateBudgetVsActual({
        organizationId: viewerCtx.organization,
        projectId: cfg.projectId || null,
        period: cfg.period || 'current_year',
      });

      const revenue = result?.revenue || {};
      const targetRevenue = num(revenue?.target?.totalRevenue);
      const actualRevenue = num(revenue?.actual?.totalRevenue);
      const variancePct = num(revenue?.variance?.percentage);
      const monthly = Array.isArray(revenue?.trend?.monthly) ? revenue.trend.monthly : [];
      const summary = result?.summary || {};

      const bullets = [];
      if (summary.overallStatus) {
        bullets.push(`Overall status: ${String(summary.overallStatus).replace(/_/g, ' ')}.`);
      }
      const alerts = Array.isArray(summary.alerts) ? summary.alerts : [];
      alerts.slice(0, 3).forEach((a) => bullets.push(a.message || a));
      if (targetRevenue === 0 && actualRevenue === 0) {
        bullets.unshift('Not enough data yet for a budget comparison.');
      }

      return {
        kind: 'comparison',
        headline: { label: 'Actual revenue', value: actualRevenue, format: 'currency' },
        bands: [
          { label: 'Target', value: targetRevenue, format: 'currency', tone: 'neutral' },
          { label: 'Actual', value: actualRevenue, format: 'currency', tone: 'neutral' },
          { label: 'Variance', value: variancePct, format: 'percent', tone: variancePct >= 0 ? 'positive' : 'negative' },
        ],
        confidence: null,
        series: monthly.length
          ? monthly.map((m) => ({ label: shortMonthFromParts(m._id?.year, m._id?.month), value: num(m.revenue) }))
          : null,
        bullets: bullets.slice(0, 4),
        asOf: new Date().toISOString(),
        scope: { period: cfg.period || 'current_year', projectId: cfg.projectId || null },
      };
    },
  },
};

// Serializable metadata for the builder (no run() functions leak to the client).
export const listInsightSources = () =>
  Object.values(INSIGHT_SOURCES).map((s) => ({
    key: s.key,
    label: s.label,
    kind: s.kind,
    params: s.params,
  }));

// Look up a source by key (undefined if unknown).
export const getInsightSource = (key) => INSIGHT_SOURCES[key];
