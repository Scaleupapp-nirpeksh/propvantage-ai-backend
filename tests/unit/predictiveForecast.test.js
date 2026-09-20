// Sales forecast, pipeline weighting, inventory cap and conversion predictions (in-memory Mongo).
import { jest } from '@jest/globals';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

const { default: Organization } = await import('../../models/organizationModel.js');
const { default: User } = await import('../../models/userModel.js');
const { default: Project } = await import('../../models/projectModel.js');
const { default: Unit } = await import('../../models/unitModel.js');
const { default: Lead } = await import('../../models/leadModel.js');
const { default: Sale } = await import('../../models/salesModel.js');
const P = await import('../../services/predictiveAnalyticsService.js');

jest.setTimeout(120000);
const DAY = 86400000;
let mongod; let org; let user; let project; let unitSeq = 0;
const ago = (days) => new Date(Date.now() - days * DAY);

async function lead(status, touchedDaysAgo, extra = {}) {
  return Lead.create({ organization: org._id, project: project._id, firstName: 'Test', lastName: `Lead${Math.random().toString(36).slice(2, 8)}`, phone: `+9198${Math.floor(1e7 + Math.random() * 9e7)}`, status, score: 60,
    engagementMetrics: { lastInteractionDate: ago(touchedDaysAgo) }, createdAt: ago(touchedDaysAgo + 10), ...extra });
}
async function sale(daysAgo, status = 'Booked') {
  unitSeq += 1;
  const u = await Unit.create({ organization: org._id, project: project._id, unitNumber: `S-${unitSeq}`, type: '3BHK', floor: 1, areaSqft: 1000, basePrice: 2e7, currentPrice: 2e7, status: 'sold' });
  const l = await lead('Booked', daysAgo);
  return Sale.create({ organization: org._id, project: project._id, unit: u._id, lead: l._id, salesPerson: user._id, salePrice: 2e7, costSheetSnapshot: {}, bookingDate: ago(daysAgo), status });
}

beforeAll(async () => {
  mongod = await MongoMemoryServer.create(); await mongoose.connect(mongod.getUri());
  org = await Organization.create({ name: 'Forecast Test Developers', country: 'India', city: 'Mumbai', type: 'builder' });
  user = await User.create({ organization: org._id, firstName: 'Admin', lastName: 'Owner', email: 'owner@forecast-dev.test', password: 'Demo@1234', role: 'Business Head', isActive: true, invitationStatus: 'accepted' });
  project = await Project.create({ organization: org._id, name: 'Forecast Towers', type: 'apartment', status: 'launched', location: { city: 'Mumbai', area: 'Worli' }, totalUnits: 20, priceRange: { min: 1, max: 2 }, targetRevenue: 10 });
  // 6 bookings spread over the last year — several months have none
  for (const d of [20, 45, 50, 200, 210, 330]) await sale(d);
  await sale(40, 'Cancelled');
  // 8 apartments left to sell
  for (let i = 0; i < 8; i += 1) await Unit.create({ organization: org._id, project: project._id, unitNumber: `A-${i}`, type: '3BHK', floor: 2, areaSqft: 1000, basePrice: 2e7, currentPrice: 2e7, status: 'available' });
  // pipeline: a few live leads and a crowd of long-silent ones
  for (let i = 0; i < 10; i += 1) await lead('Site Visit Completed', 15);
  for (let i = 0; i < 60; i += 1) await lead('Site Visit Completed', 500);
  for (let i = 0; i < 4; i += 1) await lead('Lost', 100);
});
afterAll(async () => { await mongoose.disconnect(); await mongod.stop(); });

describe('predictive · history', () => {
  test('the monthly run-rate counts months with no bookings and ignores cancelled ones', async () => {
    await P.initializePredictiveModels();
    const h = await P.getHistoricalSalesData(org._id, null);
    expect(h.totalHistoricalSales).toBe(6);
    expect(h.calendarSeries.length).toBeGreaterThanOrEqual(11);
    expect(h.calendarSeries.some((m) => m.salesCount === 0)).toBe(true);
    expect(h.averageMonthlySales).toBeLessThan(1); // 6 bookings over ~12 months, not 6 over the 4 months that had one
  });
});

describe('predictive · pipeline', () => {
  let pl;
  beforeAll(async () => { pl = await P.getCurrentPipelineData(org._id, null); });

  test('clients who already booked, or were lost, add nothing to the pipeline', () => {
    expect(pl.pipeline.find((x) => x._id === 'Booked').projectedSales).toBe(0);
    expect(pl.pipeline.find((x) => x._id === 'Lost').projectedSales).toBe(0);
  });

  test('sixty long-silent leads weigh far less than ten live ones', () => {
    const svc = pl.pipeline.find((x) => x._id === 'Site Visit Completed');
    expect(svc.count).toBe(70);
    expect(svc.activeWeight).toBeGreaterThanOrEqual(10); expect(svc.activeWeight).toBeLessThan(13); // 10×1 + 60×0.02
    expect(pl.staleOpenLeads).toBe(60);
  });

  test('conversion is anchored to this organisation\'s own visit → booking rate, never above the ladder', () => {
    expect(pl.conversionBasis).toBe('organisation_history');
    const expected = Math.round((7 / (70 + 7 + 4)) * 1000) / 10; // leads marked Booked ÷ (visited + booked + lost); 7 = 6 live bookings + 1 whose booking was later cancelled
    expect(pl.observedLeadToBookingRate).toBe(expected);
    expect(pl.conversionRates['Site Visit Completed']).toBeLessThanOrEqual(60);
    expect(pl.conversionRates['Site Visit Completed']).toBeCloseTo(expected, 0);
  });

  test('a young organisation with no history falls back to the default ladder', async () => {
    const other = await Organization.create({ name: 'Brand New Builders', country: 'India', city: 'Pune', type: 'builder' });
    const p2 = await P.getCurrentPipelineData(other._id, null);
    expect(p2.conversionBasis).toBe('industry_defaults'); expect(p2.expectedConversions).toBe(0);
  });
});

describe('predictive · forecast', () => {
  test('is in the same order of magnitude as the run-rate and can never exceed what is left to sell', async () => {
    const f12 = await P.generateSalesForecast({ organizationId: org._id, forecastPeriod: '12_months' });
    expect(f12.metadata.sellableInventory).toBe(8);
    expect(f12.forecast.totalForecastedSales).toBeLessThanOrEqual(8);
    expect(f12.forecast.monthlyBreakdown).toHaveLength(12);
    expect(f12.confidence.confidence95.lower).toBeGreaterThanOrEqual(0);
    const f3 = await P.generateSalesForecast({ organizationId: org._id, forecastPeriod: '3_months' });
    expect(f3.forecast.totalForecastedSales).toBeLessThanOrEqual(6); // ~0.5 a month historically + ~1 expected from 10 live leads
    expect(f3.insights.some((i) => /no contact for over six months/.test(i.message))).toBe(true);
  });

  test('revenue follows the forecast (units × recent average price)', async () => {
    const f3 = await P.generateSalesForecast({ organizationId: org._id, forecastPeriod: '3_months' });
    const r = await P.calculateRevenueProjection(f3, org._id, null);
    expect(r.averageUnitPrice).toBe(2e7);
    expect(r.totalRevenue).toBe(f3.forecast.totalForecastedSales * 2e7);
    expect(r.assumptions[0]).toMatch(/₹2\.00 Cr/);
  });
});

describe('predictive · lead conversion', () => {
  test('only leads that can still convert are ranked, and nothing is "100% certain"', async () => {
    const c = await P.calculateLeadConversionProbabilities(org._id, null, 70, '30_days');
    expect(c.totalLeads).toBe(70); // 6 booked + 1 cancelled-sale lead (Booked) + 4 lost are left out
    expect(c.topLeads.every((l) => !['Booked', 'Lost'].includes(l.status))).toBe(true);
    expect(Math.max(...c.topLeads.map((l) => l.conversionProbability))).toBeLessThanOrEqual(95);
  });
});
