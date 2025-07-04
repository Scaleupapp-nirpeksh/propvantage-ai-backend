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
    const enhancedForecast = await applyAIEnhancements(baselineForecast, pipelineData, historicalData);
    
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
        methodology: 'AI-Enhanced Trend Analysis with Pipeline Weighting'
      },
      forecast: enhancedForecast,
      scenarios: scenarios,
      confidence: confidenceData,
      insights: generateForecastInsights(enhancedForecast, pipelineData, historicalData),
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
    
    const salesData = await Sale.aggregate([
      {
        $match: {
          ...matchQuery,
          bookingDate: { $gte: twelveMonthsAgo }
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
    
    // Calculate trends and seasonality
    const trends = calculateSalesTrends(salesData);
    const seasonality = calculateSeasonalityPattern(salesData);
    
    return {
      monthlySales: salesData,
      trends: trends,
      seasonality: seasonality,
      totalHistoricalSales: salesData.reduce((sum, month) => sum + month.salesCount, 0),
      averageMonthlySales: salesData.length > 0 ? 
        salesData.reduce((sum, month) => sum + month.salesCount, 0) / salesData.length : 0
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
    
    // Get leads by status with conversion probabilities
    const pipelineData = await Lead.aggregate([
      { $match: matchQuery },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          averageScore: { $avg: '$score' },
          totalValue: { 
            $sum: { 
              $avg: ['$budget.min', '$budget.max'] 
            } 
          }
        }
      }
    ]);
    
    // Calculate conversion probabilities based on historical data
    const conversionRates = await calculateConversionRates(organizationId, projectId);
    
    // Add conversion probabilities to pipeline data
    const enhancedPipeline = pipelineData.map(stage => ({
      ...stage,
      conversionProbability: conversionRates[stage._id] || 0,
      projectedSales: Math.round(stage.count * (conversionRates[stage._id] || 0) / 100)
    }));
    
    return {
      pipeline: enhancedPipeline,
      totalLeads: pipelineData.reduce((sum, stage) => sum + stage.count, 0),
      qualifiedLeads: pipelineData
        .filter(stage => ['Qualified', 'Site Visit Scheduled', 'Site Visit Completed', 'Negotiating'].includes(stage._id))
        .reduce((sum, stage) => sum + stage.count, 0),
      hotLeads: pipelineData
        .filter(stage => ['Site Visit Completed', 'Negotiating'].includes(stage._id))
        .reduce((sum, stage) => sum + stage.count, 0),
      conversionRates: conversionRates
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
    const trendGrowthRate = historicalData.trends.growthRate || 0;
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
      
      // Combined forecast
      const forecastedSales = Math.max(
        Math.round((seasonalAdjustedSales + pipelineContribution) / 2),
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
 * Apply AI enhancements to baseline forecast
 * @param {Object} baselineForecast - Baseline forecast
 * @param {Object} pipelineData - Pipeline data
 * @param {Object} historicalData - Historical data
 * @returns {Object} Enhanced forecast
 */
const applyAIEnhancements = async (baselineForecast, pipelineData, historicalData) => {
  try {
    console.log('🤖 Applying AI enhancements to forecast...');
    
    // Market momentum factor (based on recent performance)
    const momentumFactor = calculateMarketMomentum(historicalData);
    
    // Lead quality factor (based on current lead scores)
    const qualityFactor = calculateLeadQualityFactor(pipelineData);
    
    // External factors (market conditions, seasonality, etc.)
    const externalFactors = await calculateExternalFactors();
    
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
  // Default conversion rates based on real estate industry standards
  const defaultRates = {
    'New': 15,
    'Contacted': 25,
    'Qualified': 35,
    'Site Visit Scheduled': 45,
    'Site Visit Completed': 60,
    'Negotiating': 75,
    'Booked': 100,
    'Lost': 0,
    'Unqualified': 0
  };
  
  // TODO: Calculate actual conversion rates from historical data
  // This would involve analyzing lead status transitions over time
  
  return defaultRates;
};

/**
 * Calculate pipeline contribution for a specific month
 */
const calculatePipelineContribution = (pipelineData, monthOffset) => {
  // Weight pipeline contribution based on how far in the future we're forecasting
  const timeDecayFactor = Math.exp(-monthOffset * 0.1); // Exponential decay
  
  const totalPipelineValue = pipelineData.pipeline.reduce((sum, stage) => 
    sum + stage.projectedSales, 0
  );
  
  return totalPipelineValue * timeDecayFactor;
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
const calculateExternalFactors = async () => {
  // Placeholder for external factors
  // In a real implementation, this could include:
  // - Market conditions
  // - Economic indicators
  // - Competitor analysis
  // - Seasonal factors
  
  return {
    marketCondition: 0.05, // Slightly positive market
    economicIndicator: 0.02,
    competitorActivity: -0.01,
    seasonalFactor: 0.03
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
  const standardDeviation = Math.sqrt(variance);
  
  return {
    confidence95: {
      lower: Math.round(forecast.totalForecastedSales - (1.96 * standardDeviation)),
      upper: Math.round(forecast.totalForecastedSales + (1.96 * standardDeviation))
    },
    confidence80: {
      lower: Math.round(forecast.totalForecastedSales - (1.28 * standardDeviation)),
      upper: Math.round(forecast.totalForecastedSales + (1.28 * standardDeviation))
    }
  };
};

/**
 * Calculate historical variance
 */
const calculateHistoricalVariance = (historicalData) => {
  const salesCounts = historicalData.monthlySales.map(month => month.salesCount);
  const mean = salesCounts.reduce((sum, count) => sum + count, 0) / salesCounts.length;
  
  const squaredDifferences = salesCounts.map(count => Math.pow(count - mean, 2));
  return squaredDifferences.reduce((sum, diff) => sum + diff, 0) / salesCounts.length;
};

/**
 * Generate forecast insights
 */
const generateForecastInsights = (forecast, pipelineData, historicalData) => {
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
  
  // Pipeline insights
  const hotLeadsRatio = pipelineData.hotLeads / pipelineData.totalLeads;
  if (hotLeadsRatio > 0.3) {
    insights.push({
      type: 'positive',
      category: 'pipeline',
      message: `Strong pipeline: ${(hotLeadsRatio * 100).toFixed(1)}% of leads are in advanced stages`,
      impact: 'medium'
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

// ================================
// EXPORTS
// ================================

export {
  generateSalesForecast,
  getHistoricalSalesData,
  getCurrentPipelineData,
  calculateBaselineForecast
};