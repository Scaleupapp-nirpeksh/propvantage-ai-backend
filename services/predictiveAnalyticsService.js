// File: services/predictiveAnalyticsService.js
// Description: AI-powered predictive analytics for sales forecasting and revenue projections
// Version: 1.0 - Complete implementation for PropVantage AI
// Location: services/predictiveAnalyticsService.js

import mongoose from 'mongoose';

// Import models dynamically to avoid circular dependencies
let Project, Unit, Sale, Lead, Interaction;

const initializeModels = async () => {
  if (!Project) {
    try {
      const { default: ProjectModel } = await import('../models/projectModel.js');
      const { default: UnitModel } = await import('../models/unitModel.js');
      const { default: SaleModel } = await import('../models/salesModel.js');
      const { default: LeadModel } = await import('../models/leadModel.js');
      const { default: InteractionModel } = await import('../models/interactionModel.js');
      
      Project = ProjectModel;
      Unit = UnitModel;
      Sale = SaleModel;
      Lead = LeadModel;
      Interaction = InteractionModel;
      
      console.log('✅ Predictive Analytics models initialized');
    } catch (error) {
      console.error('❌ Failed to initialize Predictive Analytics models:', error.message);
      throw error;
    }
  }
};

/**
 * CORE FUNCTION: Sales Forecasting Algorithm
 * Predicts future sales based on current pipeline and historical data
 * @param {Object} options - Forecasting options
 * @returns {Object} Complete sales forecast
 */
const generateSalesForecast = async (options = {}) => {
  try {
    await initializeModels();
    
    const {
      organizationId,
      projectId = null,
      forecastPeriod = '3_months', // 3_months, 6_months, 12_months
      includeConfidenceInterval = true,
      includeScenarios = true
    } = options;
    
    console.log('🔮 Generating sales forecast...', { organizationId, projectId, forecastPeriod });
    
    // Get historical sales data for pattern analysis
    const historicalData = await getHistoricalSalesData(organizationId, projectId);
    
    // Get current pipeline data
    const pipelineData = await getCurrentPipelineData(organizationId, projectId);
    
    // Calculate baseline forecast using multiple methods
    const baselineForecast = await calculateBaselineForecast(historicalData, pipelineData, forecastPeriod);
    
    // Apply AI-enhanced adjustments
    const enhancedForecast = await applyAIEnhancements(baselineForecast, pipelineData, historicalData, organizationId, projectId);
    
    // You cannot sell more apartments than exist: cap the cumulative forecast at sellable inventory.
    const inventory = await applyInventoryCap(enhancedForecast, organizationId, projectId);
    
    // Generate different scenarios if requested
    const scenarios = includeScenarios ? await generateForecastScenarios(enhancedForecast, historicalData) : null;
    
    // Calculate confidence intervals
    const confidenceData = includeConfidenceInterval ? 
      await calculateConfidenceIntervals(enhancedForecast, historicalData) : null;
    
    return {
      metadata: {
        organizationId,
        projectId,
        forecastPeriod,
        generatedAt: new Date(),
        dataQuality: assessDataQuality(historicalData, pipelineData),
        methodology: 'AI-Enhanced Trend Analysis with Pipeline Weighting',
        conversionBasis: pipelineData.conversionBasis,
        observedLeadToBookingRate: pipelineData.observedLeadToBookingRate,
        sellableInventory: inventory.sellable,
        cappedByInventory: inventory.capped
      },
      forecast: enhancedForecast,
      scenarios: scenarios,
      confidence: confidenceData,
      insights: generateForecastInsights(enhancedForecast, pipelineData, historicalData, inventory),
      recommendations: generateForecastRecommendations(enhancedForecast, pipelineData, historicalData)
    };
    
  } catch (error) {
    console.error('🔮 Sales forecasting failed:', error);
    throw new Error(`Sales forecasting failed: ${error.message}`);
  }
};

/**
 * Get historical sales data for pattern analysis
 * @param {String} organizationId - Organization ID
 * @param {String} projectId - Project ID (optional)
 * @returns {Object} Historical sales data
 */
const getHistoricalSalesData = async (organizationId, projectId) => {
  try {
    const matchQuery = { organization: new mongoose.Types.ObjectId(organizationId) };
    if (projectId) {
      matchQuery.project = new mongoose.Types.ObjectId(projectId);
    }
    
    // Get sales data for the last 12 months
    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);
    
    const now = new Date();
    const salesData = await Sale.aggregate([
      {
        $match: {
          ...matchQuery,
          status: { $ne: 'Cancelled' },
          bookingDate: { $gte: twelveMonthsAgo, $lte: now }
        }
      },
      {
        $group: {
          _id: {
            year: { $year: '$bookingDate' },
            month: { $month: '$bookingDate' }
          },
          salesCount: { $sum: 1 },
          totalRevenue: { $sum: '$salePrice' },
          averagePrice: { $avg: '$salePrice' }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } }
    ]);
    
    // A month with no bookings is a real data point (zero), not a gap: averaging only the months
    // that had a sale overstates the run-rate. The window starts at the first booking ever made
    // (so a young organisation is not diluted by months before it started selling), capped at 12.
    const firstSale = await Sale.findOne({ ...matchQuery, status: { $ne: 'Cancelled' }, bookingDate: { $ne: null, $lte: now } }).sort({ bookingDate: 1 }).select('bookingDate').lean();
    const windowStart = firstSale && firstSale.bookingDate > twelveMonthsAgo ? new Date(firstSale.bookingDate) : twelveMonthsAgo;
    const byKey = new Map(salesData.map((m) => [`${m._id.year}-${m._id.month}`, m]));
    const calendarSeries = [];
    const cursor = new Date(windowStart.getFullYear(), windowStart.getMonth(), 1);
    while (cursor <= now) {
      const hit = byKey.get(`${cursor.getFullYear()}-${cursor.getMonth() + 1}`);
      calendarSeries.push(hit || { _id: { year: cursor.getFullYear(), month: cursor.getMonth() + 1 }, salesCount: 0, totalRevenue: 0, averagePrice: 0 });
      cursor.setMonth(cursor.getMonth() + 1);
    }
    const totalHistoricalSales = salesData.reduce((sum, month) => sum + month.salesCount, 0);

    // Calculate trends and seasonality
    const trends = calculateSalesTrends(calendarSeries);
    const seasonality = calculateSeasonalityPattern(salesData);
    
    return {
      monthlySales: salesData,
      calendarSeries,
      trends: trends,
      seasonality: seasonality,
      totalHistoricalSales,
      averageMonthlySales: firstSale ? totalHistoricalSales / Math.max(1, calendarSeries.length) : 0
    };
    
  } catch (error) {
    console.error('📊 Historical data retrieval failed:', error);
    throw error;
  }
};

/**
 * Get current sales pipeline data
 * @param {String} organizationId - Organization ID
 * @param {String} projectId - Project ID (optional)
 * @returns {Object} Current pipeline data
 */
const getCurrentPipelineData = async (organizationId, projectId) => {
  try {
    const matchQuery = { organization: new mongoose.Types.ObjectId(organizationId) };
    if (projectId) {
      matchQuery.project = new mongoose.Types.ObjectId(projectId);
    }
    
    // Get leads by status. A lead nobody has been in touch with for a year is not the same pipeline
    // as one met last week, so each lead carries a recency weight.
    const DAY_MS = 24 * 60 * 60 * 1000;
    const nowDate = new Date();
    const pipelineData = await Lead.aggregate([
      { $match: matchQuery },
      {
        $addFields: {
          _daysSinceTouch: {
            $divide: [
              { $subtract: [nowDate, { $ifNull: ['$engagementMetrics.lastInteractionDate', { $ifNull: ['$statusChangedAt', '$createdAt'] }] }] },
              DAY_MS
            ]
          }
        }
      },
      {
        $addFields: {
          _recencyWeight: {
            $switch: {
              branches: [
                { case: { $lte: ['$_daysSinceTouch', 90] }, then: 1 },
                { case: { $lte: ['$_daysSinceTouch', 180] }, then: 0.4 },
                { case: { $lte: ['$_daysSinceTouch', 365] }, then: 0.1 }
              ],
              default: 0.02
            }
          }
        }
      },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          activeWeight: { $sum: '$_recencyWeight' },
          staleCount: { $sum: { $cond: [{ $gt: ['$_daysSinceTouch', 180] }, 1, 0] } },
          averageScore: { $avg: '$score' },
          totalValue: { 
            $sum: { 
              $avg: ['$budget.min', '$budget.max'] 
            } 
          }
        }
      }
    ]);
    
    // Conversion probabilities: this organisation's own history where there is enough of it
    const conversion = await calculateConversionRates(organizationId, projectId);
    const conversionRates = conversion.rates;
    const TERMINAL = ['Booked', 'Lost', 'Unqualified', 'pending'];
    
    // Only open leads can still convert — someone who has already booked is not pipeline.
    const enhancedPipeline = pipelineData.map(stage => {
      const open = !TERMINAL.includes(stage._id);
      return {
        ...stage,
        activeWeight: Math.round((stage.activeWeight || 0) * 10) / 10,
        conversionProbability: conversionRates[stage._id] || 0,
        projectedSales: open ? Math.round((stage.activeWeight || 0) * (conversionRates[stage._id] || 0)) / 100 : 0
      };
    });
    const openStages = pipelineData.filter(stage => !TERMINAL.includes(stage._id));
    const ADVANCED = ['Site Visit Completed', 'Negotiating'];
    
    return {
      pipeline: enhancedPipeline,
      totalLeads: pipelineData.reduce((sum, stage) => sum + stage.count, 0),
      qualifiedLeads: pipelineData
        .filter(stage => ['Qualified', 'Site Visit Scheduled', 'Site Visit Completed', 'Negotiating'].includes(stage._id))
        .reduce((sum, stage) => sum + stage.count, 0),
      hotLeads: pipelineData
        .filter(stage => ['Site Visit Completed', 'Negotiating'].includes(stage._id))
        .reduce((sum, stage) => sum + stage.count, 0),
      openLeads: openStages.reduce((sum, stage) => sum + stage.count, 0),
      staleOpenLeads: openStages.reduce((sum, stage) => sum + (stage.staleCount || 0), 0),
      activeAdvancedLeads: Math.round(openStages.filter(stage => ADVANCED.includes(stage._id)).reduce((sum, stage) => sum + (stage.activeWeight || 0), 0)),
      expectedConversions: Math.round(enhancedPipeline.reduce((sum, stage) => sum + stage.projectedSales, 0) * 10) / 10,
      conversionRates: conversionRates,
      conversionBasis: conversion.basis,
      observedLeadToBookingRate: conversion.observedRate
    };
    
  } catch (error) {
    console.error('📈 Pipeline data retrieval failed:', error);
    throw error;
  }
};

/**
 * Calculate baseline forecast using trend analysis
 * @param {Object} historicalData - Historical sales data
 * @param {Object} pipelineData - Current pipeline data
 * @param {String} forecastPeriod - Forecast period
 * @returns {Object} Baseline forecast
 */
const calculateBaselineForecast = async (historicalData, pipelineData, forecastPeriod) => {
  try {
    const months = getPeriodInMonths(forecastPeriod);
    const monthlyForecasts = [];
    
    // Calculate trend-based forecast
    // A half-on-half swing is a signal, not a law of nature: carry at most ±50% of it over a year
    const trendGrowthRate = Math.max(-0.5, Math.min(0.5, historicalData.trends.growthRate || 0));
    const averageMonthlySales = historicalData.averageMonthlySales || 0;
    const seasonalityMultipliers = historicalData.seasonality || {};
    
    for (let i = 1; i <= months; i++) {
      const futureMonth = new Date();
      futureMonth.setMonth(futureMonth.getMonth() + i);
      const monthKey = futureMonth.getMonth() + 1; // 1-12
      
      // Apply trend growth
      const trendAdjustedSales = averageMonthlySales * (1 + (trendGrowthRate * i / 12));
      
      // Apply seasonality
      const seasonalMultiplier = seasonalityMultipliers[monthKey] || 1;
      const seasonalAdjustedSales = trendAdjustedSales * seasonalMultiplier;
      
      // Pipeline-based adjustment
      const pipelineContribution = calculatePipelineContribution(pipelineData, i);
      
      // Combined forecast. Today's pipeline only speaks for the next few months; beyond that window
      // the run-rate stands on its own (halving it against an empty pipeline understated far months).
      const withinPipelineWindow = i <= PIPELINE_CONVERSION_WINDOW_MONTHS;
      const forecastedSales = Math.max(
        Math.round(withinPipelineWindow ? (seasonalAdjustedSales + pipelineContribution) / 2 : seasonalAdjustedSales),
        0
      );
      
      monthlyForecasts.push({
        month: i,
        date: new Date(futureMonth),
        forecastedSales: forecastedSales,
        trendComponent: Math.round(trendAdjustedSales),
        seasonalComponent: Math.round(seasonalAdjustedSales),
        pipelineComponent: Math.round(pipelineContribution),
        confidence: calculateMonthlyConfidence(i, historicalData)
      });
    }
    
    return {
      totalForecastedSales: monthlyForecasts.reduce((sum, month) => sum + month.forecastedSales, 0),
      monthlyBreakdown: monthlyForecasts,
      averageMonthlySales: monthlyForecasts.reduce((sum, month) => sum + month.forecastedSales, 0) / months,
      methodology: 'Trend + Seasonality + Pipeline Analysis'
    };
    
  } catch (error) {
    console.error('📊 Baseline forecast calculation failed:', error);
    throw error;
  }
};

/**
 * Cap the cumulative forecast at the inventory that can still be sold (available + on hold).
 * Organisations with no inventory loaded are left uncapped. Mutates and returns cap details.
 */
const applyInventoryCap = async (forecast, organizationId, projectId) => {
  try {
    const q = { organization: new mongoose.Types.ObjectId(organizationId) };
    if (projectId) q.project = new mongoose.Types.ObjectId(projectId);
    const [total, sellable] = await Promise.all([Unit.countDocuments(q), Unit.countDocuments({ ...q, status: { $in: ['available', 'blocked'] } })]);
    if (!total) return { sellable: null, capped: false };
    let remaining = sellable; let capped = false;
    forecast.monthlyBreakdown = forecast.monthlyBreakdown.map((month) => {
      const key = month.aiAdjustedSales !== undefined ? 'aiAdjustedSales' : 'forecastedSales';
      const allowed = Math.max(0, Math.min(month[key], remaining));
      if (allowed < month[key]) capped = true;
      remaining -= allowed;
      return { ...month, [key]: allowed, ...(key === 'aiAdjustedSales' ? { forecastedSales: Math.min(month.forecastedSales, allowed) } : {}) };
    });
    forecast.totalForecastedSales = forecast.monthlyBreakdown.reduce((sum, m) => sum + (m.aiAdjustedSales ?? m.forecastedSales), 0);
    forecast.averageMonthlySales = forecast.totalForecastedSales / Math.max(1, forecast.monthlyBreakdown.length);
    return { sellable, capped };
  } catch (error) {
    console.error('🏢 Inventory cap skipped:', error.message);
    return { sellable: null, capped: false };
  }
};

/**
 * Apply AI enhancements to baseline forecast
 * @param {Object} baselineForecast - Baseline forecast
 * @param {Object} pipelineData - Pipeline data
 * @param {Object} historicalData - Historical data
 * @returns {Object} Enhanced forecast
 */
const applyAIEnhancements = async (baselineForecast, pipelineData, historicalData, organizationId, projectId) => {
  try {
    console.log('🤖 Applying AI enhancements to forecast...');
    
    // Market momentum factor (based on recent performance)
    const momentumFactor = calculateMarketMomentum(historicalData);
    
    // Lead quality factor (based on current lead scores)
    const qualityFactor = calculateLeadQualityFactor(pipelineData);
    
    // External factors (market conditions, seasonality, competitive data)
    const externalFactors = await calculateExternalFactors(organizationId, projectId);
    
    // Apply AI adjustments to each month
    const enhancedMonthly = baselineForecast.monthlyBreakdown.map(month => {
      const aiAdjustment = (momentumFactor + qualityFactor + externalFactors.marketCondition) / 3;
      const adjustedSales = Math.round(month.forecastedSales * (1 + aiAdjustment));
      
      return {
        ...month,
        aiAdjustedSales: Math.max(adjustedSales, 0),
        aiFactors: {
          momentumFactor: momentumFactor,
          qualityFactor: qualityFactor,
          externalFactors: externalFactors,
          totalAdjustment: aiAdjustment
        }
      };
    });
    
    return {
      ...baselineForecast,
      monthlyBreakdown: enhancedMonthly,
      totalForecastedSales: enhancedMonthly.reduce((sum, month) => sum + month.aiAdjustedSales, 0),
      aiEnhancements: {
        momentumFactor,
        qualityFactor,
        externalFactors,
        overallImpact: (momentumFactor + qualityFactor + externalFactors.marketCondition) / 3
      }
    };
    
  } catch (error) {
    console.error('🤖 AI enhancement failed:', error);
    // Return baseline forecast if AI enhancement fails
    return baselineForecast;
  }
};

// ================================
// HELPER FUNCTIONS
// ================================

/**
 * Calculate sales trends from historical data
 */
const calculateSalesTrends = (salesData) => {
  if (salesData.length < 2) return { growthRate: 0, trend: 'stable' };
  
  const firstHalf = salesData.slice(0, Math.floor(salesData.length / 2));
  const secondHalf = salesData.slice(Math.floor(salesData.length / 2));
  
  const firstHalfAvg = firstHalf.reduce((sum, month) => sum + month.salesCount, 0) / firstHalf.length;
  const secondHalfAvg = secondHalf.reduce((sum, month) => sum + month.salesCount, 0) / secondHalf.length;
  
  const growthRate = firstHalfAvg > 0 ? (secondHalfAvg - firstHalfAvg) / firstHalfAvg : 0;
  
  return {
    growthRate: growthRate,
    trend: growthRate > 0.1 ? 'growing' : growthRate < -0.1 ? 'declining' : 'stable',
    firstHalfAvg: Math.round(firstHalfAvg),
    secondHalfAvg: Math.round(secondHalfAvg)
  };
};

/**
 * Calculate seasonality patterns
 */
const calculateSeasonalityPattern = (salesData) => {
  const monthlyTotals = {};
  const monthlyCount = {};
  
  salesData.forEach(data => {
    const month = data._id.month;
    monthlyTotals[month] = (monthlyTotals[month] || 0) + data.salesCount;
    monthlyCount[month] = (monthlyCount[month] || 0) + 1;
  });
  
  const monthlyAverages = {};
  const overallAverage = Object.values(monthlyTotals).reduce((sum, total) => sum + total, 0) / 
                        Object.values(monthlyCount).reduce((sum, count) => sum + count, 0);
  
  for (let month = 1; month <= 12; month++) {
    const average = monthlyCount[month] ? monthlyTotals[month] / monthlyCount[month] : overallAverage;
    monthlyAverages[month] = overallAverage > 0 ? average / overallAverage : 1;
  }
  
  return monthlyAverages;
};

/**
 * Calculate conversion rates by lead status
 */
const calculateConversionRates = async (organizationId, projectId) => {
  // Stage ladder (relative likelihood by stage) — used as-is only when there is no history to learn from.
  const defaultRates = {
    'New': 15,
    'Contacted': 25,
    'Qualified': 35,
    'Revived': 35,
    'Site Visit Scheduled': 45,
    'Site Visit Completed': 60,
    'Negotiating': 75,
    'Booked': 100,
    'Lost': 0,
    'Unqualified': 0
  };

  try {
    const matchQuery = { organization: new mongoose.Types.ObjectId(organizationId) };
    if (projectId) matchQuery.project = new mongoose.Types.ObjectId(projectId);
    const byStatus = await Lead.aggregate([{ $match: matchQuery }, { $group: { _id: '$status', n: { $sum: 1 } } }]);
    const total = byStatus.reduce((sum, r) => sum + r.n, 0);
    const booked = byStatus.find((r) => r._id === 'Booked')?.n || 0;

    // Enough history: keep the SHAPE of the ladder but anchor it to what actually happens here.
    // Anchor = of the leads that got as far as a completed site visit (including those since lost),
    // how many booked. That observed rate becomes the "Site Visit Completed" rung and every other
    // rung moves in proportion. Never scaled above the ladder, so a small lucky sample cannot
    // inflate a forecast.
    const n = (status) => byStatus.find((r) => r._id === status)?.n || 0;
    const reachedVisit = n('Site Visit Completed') + n('Negotiating') + booked + n('Lost');
    if (total >= 50 && booked >= 5 && reachedVisit > 0) {
      const observedRate = (booked / reachedVisit) * 100;
      const scale = Math.min(1, observedRate / defaultRates['Site Visit Completed']);
      const rates = {};
      for (const [stage, rate] of Object.entries(defaultRates)) rates[stage] = stage === 'Booked' || rate === 0 ? rate : Math.round(rate * scale * 10) / 10;
      return { rates, basis: 'organisation_history', observedRate: Math.round(observedRate * 10) / 10 };
    }
  } catch (error) {
    console.error('📈 Conversion-rate calculation failed, using defaults:', error.message);
  }
  return { rates: defaultRates, basis: 'industry_defaults', observedRate: null };
};

/**
 * Calculate pipeline contribution for a specific month
 */
const PIPELINE_CONVERSION_WINDOW_MONTHS = 6;
const calculatePipelineContribution = (pipelineData, monthOffset) => {
  // `projectedSales` is how many of today's open leads are expected to convert AT ALL. They do
  // so over the coming months (front-loaded), not all of them again every month.
  const expectedConversions = pipelineData.pipeline.reduce((sum, stage) => 
    sum + stage.projectedSales, 0
  );
  if (monthOffset > PIPELINE_CONVERSION_WINDOW_MONTHS) return 0;
  const weights = Array.from({ length: PIPELINE_CONVERSION_WINDOW_MONTHS }, (_, i) => Math.exp(-i * 0.25));
  const share = weights[monthOffset - 1] / weights.reduce((a, b) => a + b, 0);
  
  return expectedConversions * share;
};

/**
 * Calculate market momentum factor
 */
const calculateMarketMomentum = (historicalData) => {
  const recentTrend = historicalData.trends.growthRate || 0;
  
  // Convert trend to momentum factor (-0.2 to +0.2)
  return Math.max(-0.2, Math.min(0.2, recentTrend));
};

/**
 * Calculate lead quality factor
 */
const calculateLeadQualityFactor = (pipelineData) => {
  const totalLeads = pipelineData.totalLeads || 1;
  const qualifiedLeads = pipelineData.qualifiedLeads || 0;
  const qualityRatio = qualifiedLeads / totalLeads;
  
  // Convert quality ratio to adjustment factor (-0.1 to +0.1)
  const industryBenchmark = 0.3; // 30% qualification rate benchmark
  return Math.max(-0.1, Math.min(0.1, (qualityRatio - industryBenchmark) * 0.33));
};

/**
 * Calculate external factors
 */
const calculateExternalFactors = async (organizationId, projectId) => {
  let competitorFactor = 0;
  let competitorContext = null;

  try {
    // Pull competitive data if available
    if (organizationId && projectId) {
      const project = await Project.findById(projectId).select('location priceRange').lean();
      if (project?.location?.city && project?.location?.area) {
        const { default: CompetitorProject } = await import('../models/competitorProjectModel.js');
        const competitors = await CompetitorProject.find({
          organization: organizationId,
          'location.city': new RegExp(`^${project.location.city.trim()}$`, 'i'),
          'location.area': new RegExp(`^${project.location.area.trim()}$`, 'i'),
          isActive: true,
          'pricing.pricePerSqft.avg': { $gt: 0 },
        })
          .select('pricing.pricePerSqft.avg projectStatus')
          .lean();

        if (competitors.length >= 3) {
          const avgMarketPrice = competitors.reduce((s, c) => s + c.pricing.pricePerSqft.avg, 0) / competitors.length;
          const ourAvgPrice = project.priceRange ? (project.priceRange.min + project.priceRange.max) / 2 : 0;

          // If our price is lower than market avg, positive factor (competitive advantage)
          // If higher, negative factor (price resistance)
          if (ourAvgPrice > 0 && avgMarketPrice > 0) {
            const priceDiff = (avgMarketPrice - ourAvgPrice) / avgMarketPrice;
            competitorFactor = Math.max(-0.1, Math.min(0.1, priceDiff * 0.5));
          }

          // Supply pressure: more pre-launch/newly-launched projects = negative
          const newSupply = competitors.filter(c =>
            c.projectStatus === 'pre_launch' || c.projectStatus === 'newly_launched'
          ).length;
          const supplyPressure = newSupply > competitors.length * 0.4 ? -0.03 : 0;
          competitorFactor += supplyPressure;

          competitorContext = {
            competitorCount: competitors.length,
            marketAvgPrice: Math.round(avgMarketPrice),
            ourAvgPrice: Math.round(ourAvgPrice),
            newSupplyProjects: newSupply,
          };
        }
      }
    }
  } catch {
    // Silently continue if competitive data unavailable
  }

  return {
    marketCondition: 0.05,
    economicIndicator: 0.02,
    competitorActivity: competitorFactor,
    seasonalFactor: 0.03,
    competitorContext,
  };
};

/**
 * Get period in months
 */
const getPeriodInMonths = (period) => {
  switch (period) {
    case '3_months': return 3;
    case '6_months': return 6;
    case '12_months': return 12;
    default: return 3;
  }
};

/**
 * Calculate monthly confidence level
 */
const calculateMonthlyConfidence = (monthOffset, historicalData) => {
  const baseConfidence = 0.85; // 85% base confidence
  const timeDecay = Math.exp(-monthOffset * 0.15); // Confidence decreases over time
  const dataQuality = historicalData.monthlySales.length / 12; // More data = higher confidence
  
  return Math.round((baseConfidence * timeDecay * dataQuality) * 100);
};

/**
 * Assess data quality for forecasting
 */
const assessDataQuality = (historicalData, pipelineData) => {
  const historicalScore = Math.min(historicalData.monthlySales.length / 6, 1); // 6+ months ideal
  const pipelineScore = Math.min(pipelineData.totalLeads / 50, 1); // 50+ leads ideal
  
  const overallScore = (historicalScore + pipelineScore) / 2;
  
  if (overallScore >= 0.8) return 'High';
  if (overallScore >= 0.6) return 'Medium';
  if (overallScore >= 0.4) return 'Low';
  return 'Very Low';
};

/**
 * Generate forecast scenarios
 */
const generateForecastScenarios = async (baseForecast, historicalData) => {
  const pessimisticMultiplier = 0.8; // 20% lower
  const optimisticMultiplier = 1.2;  // 20% higher
  
  return {
    pessimistic: {
      totalSales: Math.round(baseForecast.totalForecastedSales * pessimisticMultiplier),
      probability: 25,
      description: 'Conservative scenario assuming market slowdown'
    },
    realistic: {
      totalSales: baseForecast.totalForecastedSales,
      probability: 50,
      description: 'Most likely scenario based on current trends'
    },
    optimistic: {
      totalSales: Math.round(baseForecast.totalForecastedSales * optimisticMultiplier),
      probability: 25,
      description: 'Aggressive scenario assuming market acceleration'
    }
  };
};

/**
 * Calculate confidence intervals
 */
const calculateConfidenceIntervals = async (forecast, historicalData) => {
  const variance = calculateHistoricalVariance(historicalData);
  // Monthly spread, carried over the number of months being forecast
  const months = Math.max(1, forecast.monthlyBreakdown?.length || 1);
  const standardDeviation = Math.sqrt(variance * months);
  const floor0 = (n) => Math.max(0, Math.round(n));
  
  return {
    confidence95: {
      lower: floor0(forecast.totalForecastedSales - (1.96 * standardDeviation)),
      upper: Math.round(forecast.totalForecastedSales + (1.96 * standardDeviation))
    },
    confidence80: {
      lower: floor0(forecast.totalForecastedSales - (1.28 * standardDeviation)),
      upper: Math.round(forecast.totalForecastedSales + (1.28 * standardDeviation))
    }
  };
};

/**
 * Calculate historical variance
 */
const calculateHistoricalVariance = (historicalData) => {
  const series = historicalData.calendarSeries?.length ? historicalData.calendarSeries : historicalData.monthlySales;
  if (!series.length) return 0;
  const salesCounts = series.map(month => month.salesCount);
  const mean = salesCounts.reduce((sum, count) => sum + count, 0) / salesCounts.length;
  
  const squaredDifferences = salesCounts.map(count => Math.pow(count - mean, 2));
  return squaredDifferences.reduce((sum, diff) => sum + diff, 0) / salesCounts.length;
};

/**
 * Generate forecast insights
 */
const generateForecastInsights = (forecast, pipelineData, historicalData, inventory = {}) => {
  const insights = [];
  
  // Trend insights
  if (historicalData.trends.growthRate > 0.1) {
    insights.push({
      type: 'positive',
      category: 'trend',
      message: `Strong upward trend detected: ${(historicalData.trends.growthRate * 100).toFixed(1)}% growth rate`,
      impact: 'high'
    });
  } else if (historicalData.trends.growthRate < -0.1) {
    insights.push({
      type: 'warning',
      category: 'trend',
      message: `Declining trend detected: ${Math.abs(historicalData.trends.growthRate * 100).toFixed(1)}% decline rate`,
      impact: 'high'
    });
  }
  
  // Pipeline insights — judged on leads that are actually live, not on everyone ever met
  const openLeads = pipelineData.openLeads || 0;
  const activeAdvancedRatio = openLeads > 0 ? (pipelineData.activeAdvancedLeads || 0) / openLeads : 0;
  const staleRatio = openLeads > 0 ? (pipelineData.staleOpenLeads || 0) / openLeads : 0;
  if (activeAdvancedRatio > 0.3) {
    insights.push({
      type: 'positive',
      category: 'pipeline',
      message: `Strong pipeline: ${(activeAdvancedRatio * 100).toFixed(1)}% of open leads are in advanced stages and recently in touch`,
      impact: 'medium'
    });
  }
  if (staleRatio > 0.5) {
    insights.push({
      type: 'warning',
      category: 'pipeline',
      message: `${(staleRatio * 100).toFixed(0)}% of open leads (${pipelineData.staleOpenLeads}) have had no contact for over six months — they add little to the forecast until re-engaged`,
      impact: 'high'
    });
  }
  if (pipelineData.conversionBasis === 'organisation_history') {
    insights.push({
      type: 'info',
      category: 'conversion',
      message: `Conversion rates are anchored to your own history: ${pipelineData.observedLeadToBookingRate}% of leads that reached a site visit went on to book`,
      impact: 'medium'
    });
  }
  if (inventory.capped) {
    insights.push({
      type: 'warning',
      category: 'inventory',
      message: `Forecast limited by inventory: only ${inventory.sellable} apartments are left to sell`,
      impact: 'high'
    });
  }
  
  // Seasonality insights
  const nextMonth = new Date().getMonth() + 2; // Next month (1-12)
  const seasonalMultiplier = historicalData.seasonality[nextMonth] || 1;
  if (seasonalMultiplier > 1.2) {
    insights.push({
      type: 'opportunity',
      category: 'seasonality',
      message: `Favorable seasonal period ahead: ${((seasonalMultiplier - 1) * 100).toFixed(1)}% above average`,
      impact: 'medium'
    });
  }
  
  return insights;
};

/**
 * Generate forecast recommendations
 */
const generateForecastRecommendations = (forecast, pipelineData, historicalData) => {
  const recommendations = [];
  
  // Pipeline recommendations
  if (pipelineData.qualifiedLeads < pipelineData.totalLeads * 0.3) {
    recommendations.push({
      category: 'lead_qualification',
      priority: 'high',
      action: 'Improve lead qualification processes',
      rationale: 'Low qualification rate may impact future sales',
      estimatedImpact: '15-20% sales increase'
    });
  }
  
  // Capacity recommendations
  const averageMonthlySales = forecast.averageMonthlySales;
  if (averageMonthlySales > (historicalData?.averageMonthlySales || 0) * 1.5) {
    recommendations.push({
      category: 'capacity_planning',
      priority: 'medium',
      action: 'Scale up sales team and operations',
      rationale: 'Forecasted demand exceeds historical capacity',
      estimatedImpact: 'Prevent sales bottlenecks'
    });
  }
  
  // Trend-based recommendations
  if (historicalData?.trends?.growthRate < -0.1) {
    recommendations.push({
      category: 'sales_strategy',
      priority: 'high',
      action: 'Implement aggressive sales initiatives',
      rationale: 'Declining trend detected in historical data',
      estimatedImpact: 'Reverse negative trend'
    });
  }
  
  return recommendations;
};

/**
 * Calculate revenue projection based on sales forecast
 */
const calculateRevenueProjection = async (salesForecast, organizationId, projectId) => {
  try {
    // Import models
    const { default: Unit } = await import('../models/unitModel.js');
    const { default: Sale } = await import('../models/salesModel.js');

    // Get average unit prices
    const matchQuery = { organization: organizationId };
    if (projectId) {
      matchQuery.project = projectId;
    }

    const yearAgo = new Date(); yearAgo.setMonth(yearAgo.getMonth() - 12);
    const recent = await Sale.countDocuments({ ...matchQuery, status: { $ne: 'Cancelled' }, bookingDate: { $gte: yearAgo } });
    const priceData = await Sale.aggregate([
      { $match: { ...matchQuery, status: { $ne: 'Cancelled' }, ...(recent >= 5 ? { bookingDate: { $gte: yearAgo } } : {}) } },
      {
        $group: {
          _id: null,
          averagePrice: { $avg: '$salePrice' },
          medianPrice: { $avg: '$salePrice' }, // Simplified median calculation
          minPrice: { $min: '$salePrice' },
          maxPrice: { $max: '$salePrice' }
        }
      }
    ]);

    const averageUnitPrice = priceData[0]?.averagePrice || 5000000; // Default 50L if no data

    // Calculate monthly revenue breakdown
    const monthlyBreakdown = salesForecast.forecast.monthlyBreakdown.map(month => ({
      month: month.month,
      date: month.date,
      projectedSales: month.aiAdjustedSales || month.forecastedSales,
      projectedRevenue: (month.aiAdjustedSales || month.forecastedSales) * averageUnitPrice,
      confidence: month.confidence
    }));

    // Calculate scenarios
    const scenarios = {
      pessimistic: {
        totalRevenue: salesForecast.scenarios.pessimistic.totalSales * averageUnitPrice * 0.9, // 10% price reduction
        description: 'Conservative revenue with potential price adjustments'
      },
      realistic: {
        totalRevenue: salesForecast.scenarios.realistic.totalSales * averageUnitPrice,
        description: 'Most likely revenue based on current pricing'
      },
      optimistic: {
        totalRevenue: salesForecast.scenarios.optimistic.totalSales * averageUnitPrice * 1.1, // 10% price premium
        description: 'Aggressive revenue with potential price optimization'
      }
    };

    return {
      totalRevenue: monthlyBreakdown.reduce((sum, month) => sum + month.projectedRevenue, 0),
      monthlyBreakdown: monthlyBreakdown,
      scenarios: scenarios,
      confidence: salesForecast.confidence,
      averageUnitPrice: averageUnitPrice,
      assumptions: [
        `Average unit price: ${averageUnitPrice >= 10000000 ? `₹${(averageUnitPrice / 10000000).toFixed(2)} Cr` : `₹${(averageUnitPrice / 100000).toFixed(1)} Lakhs`}${recent >= 5 ? ' (bookings of the last 12 months)' : ''}`,
        'Pricing remains consistent with historical averages',
        'No major market disruptions',
        'Current sales process efficiency maintained'
      ]
    };

  } catch (error) {
    console.error('💰 Revenue projection calculation failed:', error);
    throw error;
  }
};

/**
 * Calculate lead conversion probabilities
 */
const calculateLeadConversionProbabilities = async (organizationId, leadId, scoreThreshold, timeframe) => {
  try {
    // Import models
    const { default: Lead } = await import('../models/leadModel.js');
    const { default: Interaction } = await import('../models/interactionModel.js');

    const matchQuery = { organization: organizationId };
    if (leadId) {
      matchQuery._id = leadId;
    } else {
      // Someone who has already booked (or been lost) is not a conversion prospect — leaving them
      // in filled the "most likely to convert" list with clients who had already bought.
      matchQuery.status = { $nin: ['Booked', 'Lost', 'Unqualified', 'pending'] };
    }

    // Get leads with their scores and interaction counts
    const leadsData = await Lead.aggregate([
      { $match: matchQuery },
      {
        $lookup: {
          from: 'interactions',
          localField: '_id',
          foreignField: 'lead',
          as: 'interactions'
        }
      },
      {
        $addFields: {
          interactionCount: { $size: '$interactions' },
          daysSinceCreated: {
            $divide: [
              { $subtract: [new Date(), '$createdAt'] },
              1000 * 60 * 60 * 24
            ]
          },
          lastInteractionDate: { $max: { $map: { input: '$interactions', as: 'i', in: { $ifNull: ['$$i.occurredAt', '$$i.createdAt'] } } } }
        }
      },
      {
        $project: {
          firstName: 1,
          lastName: 1,
          status: 1,
          score: 1,
          scoreGrade: 1,
          source: 1,
          interactionCount: 1,
          daysSinceCreated: 1,
          lastInteractionDate: 1,
          budget: 1
        }
      }
    ]);

    // Calculate conversion probability for each lead
    const leadsWithProbability = leadsData.map(lead => {
      const probability = calculateIndividualConversionProbability(lead, timeframe);
      return {
        ...lead,
        conversionProbability: probability,
        riskLevel: getRiskLevel(probability),
        recommendations: getLeadRecommendations(lead, probability)
      };
    });

    if (leadId) {
      // Return single lead data
      return leadsWithProbability[0] || null;
    } else {
      // Return summary for all leads
      const highProbabilityLeads = leadsWithProbability.filter(lead =>
        lead.conversionProbability >= scoreThreshold
      );

      return {
        totalLeads: leadsWithProbability.length,
        highProbabilityLeads: highProbabilityLeads.length,
        averageProbability: leadsWithProbability.length ? leadsWithProbability.reduce((sum, lead) =>
          sum + lead.conversionProbability, 0) / leadsWithProbability.length : 0,
        leadBreakdown: {
          hot: leadsWithProbability.filter(lead => lead.conversionProbability >= 80).length,
          warm: leadsWithProbability.filter(lead =>
            lead.conversionProbability >= 60 && lead.conversionProbability < 80).length,
          cold: leadsWithProbability.filter(lead => lead.conversionProbability < 60).length
        },
        topLeads: leadsWithProbability
          .sort((a, b) => b.conversionProbability - a.conversionProbability)
          .slice(0, 10)
      };
    }

  } catch (error) {
    console.error('🎯 Lead conversion probability calculation failed:', error);
    throw error;
  }
};

// ================================
// UTILITY FUNCTIONS
// ================================

const calculateIndividualConversionProbability = (lead, timeframe) => {
  let probability = lead.score || 0;

  // Adjust based on status
  const statusMultipliers = {
    'New': 0.8,
    'Qualified': 1.1,
    'Site Visit Completed': 1.4,
    'Negotiating': 1.6,
    'Booked': 2.0,
    'Lost': 0.1,
    'Revived': 1.1
  };

  probability *= (statusMultipliers[lead.status] || 1);

  // Adjust based on interaction frequency
  if (lead.interactionCount > 5) probability *= 1.1;
  if (lead.interactionCount > 10) probability *= 1.2;

  // Adjust based on lead age
  if (lead.daysSinceCreated < 7) probability *= 1.1;  // Fresh leads
  if (lead.daysSinceCreated > 30) probability *= 0.9; // Older leads

  // Long silence: a lead nobody has been in touch with for months is unlikely to convert in the timeframe
  if (lead.lastInteractionDate) {
    const silentDays = (Date.now() - new Date(lead.lastInteractionDate).getTime()) / (1000 * 60 * 60 * 24);
    if (silentDays > 365) probability *= 0.5;
    else if (silentDays > 180) probability *= 0.7;
  }

  // Nothing is certain until it is booked
  return Math.min(Math.max(Math.round(probability), 0), 95);
};

const getRiskLevel = (probability) => {
  if (probability >= 80) return 'Very Low';
  if (probability >= 60) return 'Low';
  if (probability >= 40) return 'Medium';
  if (probability >= 20) return 'High';
  return 'Very High';
};

const getLeadRecommendations = (lead, probability) => {
  const recommendations = [];

  if (probability < 40) {
    recommendations.push('Increase engagement frequency');
    recommendations.push('Provide more personalized content');
  }

  if (lead.interactionCount < 3) {
    recommendations.push('Schedule immediate follow-up call');
  }

  if (lead.status === 'Qualified' && probability > 60) {
    recommendations.push('Schedule site visit immediately');
  }

  return recommendations;
};

// ================================
// EXPORTS
// ================================

export {
  initializeModels as initializePredictiveModels,
  getHistoricalSalesData,
  generateSalesForecast,
  getCurrentPipelineData,
  calculateBaselineForecast,
  calculateRevenueProjection,
  calculateLeadConversionProbabilities
};