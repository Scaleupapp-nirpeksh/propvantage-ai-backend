// File: controllers/predictiveController.js
// Description: Controller for predictive analytics endpoints
// Version: 1.0 - Complete implementation for PropVantage AI
// Location: controllers/predictiveController.js

import asyncHandler from 'express-async-handler';
import { generateSalesForecast } from '../services/predictiveAnalyticsService.js';

/**
 * @desc    Generate sales forecast for organization or specific project
 * @route   GET /api/analytics/predictions/sales-forecast
 * @access  Private (Management roles)
 */
const getSalesForecast = asyncHandler(async (req, res) => {
  const { 
    projectId = null,
    period = '3_months',
    format = 'detailed',
    includeScenarios = 'true',
    includeConfidence = 'true'
  } = req.query;

  try {
    console.log('🔮 Generating sales forecast...', { 
      organizationId: req.user.organization, 
      projectId, 
      period 
    });

    const forecastOptions = {
      organizationId: req.user.organization,
      projectId: projectId || null,
      forecastPeriod: period,
      includeConfidenceInterval: includeConfidence === 'true',
      includeScenarios: includeScenarios === 'true'
    };

    const forecast = await generateSalesForecast(forecastOptions);

    // Format response based on requested format
    let response;
    switch (format) {
      case 'summary':
        response = {
          success: true,
          data: {
            totalForecastedSales: forecast.forecast.totalForecastedSales,
            averageMonthlySales: forecast.forecast.averageMonthlySales,
            confidence: forecast.confidence?.confidence80 || null,
            keyInsights: forecast.insights.slice(0, 3), // Top 3 insights
            dataQuality: forecast.metadata.dataQuality,
            period: period
          },
          message: 'Sales forecast summary generated successfully'
        };
        break;

      case 'chart':
        response = {
          success: true,
          data: {
            chartData: forecast.forecast.monthlyBreakdown.map(month => ({
              month: month.date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
              forecastedSales: month.aiAdjustedSales || month.forecastedSales,
              confidence: month.confidence,
              trendComponent: month.trendComponent,
              pipelineComponent: month.pipelineComponent
            })),
            scenarios: forecast.scenarios,
            totalForecast: forecast.forecast.totalForecastedSales
          },
          message: 'Chart data for sales forecast generated successfully'
        };
        break;

      default: // detailed
        response = {
          success: true,
          data: forecast,
          message: 'Detailed sales forecast generated successfully'
        };
    }

    res.json(response);

  } catch (error) {
    console.error('❌ Sales forecast generation failed:', error);
    res.status(500);
    throw new Error(`Failed to generate sales forecast: ${error.message}`);
  }
});

/**
 * @desc    Generate revenue projection based on sales forecast
 * @route   GET /api/analytics/predictions/revenue-projection
 * @access  Private (Management roles)
 */
const getRevenueProjection = asyncHandler(async (req, res) => {
  const { 
    projectId = null,
    period = '3_months',
    includeBreakdown = 'true'
  } = req.query;

  try {
    console.log('💰 Generating revenue projection...', { 
      organizationId: req.user.organization, 
      projectId, 
      period 
    });

    // Get sales forecast first
    const forecastOptions = {
      organizationId: req.user.organization,
      projectId: projectId || null,
      forecastPeriod: period,
      includeConfidenceInterval: true,
      includeScenarios: true
    };

    const salesForecast = await generateSalesForecast(forecastOptions);

    // Calculate revenue projections based on sales forecast
    const revenueProjection = await calculateRevenueProjection(
      salesForecast, 
      req.user.organization, 
      projectId
    );

    const response = {
      success: true,
      data: {
        totalProjectedRevenue: revenueProjection.totalRevenue,
        monthlyBreakdown: includeBreakdown === 'true' ? revenueProjection.monthlyBreakdown : null,
        scenarios: revenueProjection.scenarios,
        confidence: revenueProjection.confidence,
        assumptions: revenueProjection.assumptions,
        basedOnSalesForecast: {
          totalSales: salesForecast.forecast.totalForecastedSales,
          averagePrice: revenueProjection.averageUnitPrice
        }
      },
      message: 'Revenue projection generated successfully'
    };

    res.json(response);

  } catch (error) {
    console.error('❌ Revenue projection generation failed:', error);
    res.status(500);
    throw new Error(`Failed to generate revenue projection: ${error.message}`);
  }
});

/**
 * @desc    Get lead conversion probability predictions
 * @route   GET /api/analytics/predictions/lead-conversion-probability
 * @access  Private (Sales & Management roles)
 */
const getLeadConversionProbability = asyncHandler(async (req, res) => {
  const { 
    leadId = null,
    scoreThreshold = 70,
    timeframe = '30_days'
  } = req.query;

  try {
    console.log('🎯 Calculating lead conversion probabilities...', { 
      organizationId: req.user.organization, 
      leadId, 
      timeframe 
    });

    const conversionData = await calculateLeadConversionProbabilities(
      req.user.organization,
      leadId,
      scoreThreshold,
      timeframe
    );

    const response = {
      success: true,
      data: conversionData,
      message: leadId ? 
        'Lead conversion probability calculated successfully' : 
        'Lead conversion probabilities calculated for all leads'
    };

    res.json(response);

  } catch (error) {
    console.error('❌ Lead conversion probability calculation failed:', error);
    res.status(500);
    throw new Error(`Failed to calculate lead conversion probability: ${error.message}`);
  }
});

/**
 * @desc    Get inventory turnover predictions
 * @route   GET /api/analytics/predictions/inventory-turnover
 * @access  Private (Management roles)
 */
const getInventoryTurnoverPrediction = asyncHandler(async (req, res) => {
  const { 
    projectId = null,
    period = '6_months',
    unitType = 'all'
  } = req.query;

  try {
    console.log('🏠 Generating inventory turnover prediction...', { 
      organizationId: req.user.organization, 
      projectId, 
      period 
    });

    const turnoverPrediction = await calculateInventoryTurnover(
      req.user.organization,
      projectId,
      period,
      unitType
    );

    const response = {
      success: true,
      data: turnoverPrediction,
      message: 'Inventory turnover prediction generated successfully'
    };

    res.json(response);

  } catch (error) {
    console.error('❌ Inventory turnover prediction failed:', error);
    res.status(500);
    throw new Error(`Failed to predict inventory turnover: ${error.message}`);
  }
});

// ================================
// HELPER FUNCTIONS
// ================================

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

    const priceData = await Sale.aggregate([
      { $match: matchQuery },
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
        `Average unit price: ₹${(averageUnitPrice / 100000).toFixed(1)} Lakhs`,
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
          lastInteractionDate: { $max: '$interactions.createdAt' }
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
        averageProbability: leadsWithProbability.reduce((sum, lead) => 
          sum + lead.conversionProbability, 0) / leadsWithProbability.length,
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

/**
 * Calculate inventory turnover prediction
 */
const calculateInventoryTurnover = async (organizationId, projectId, period, unitType) => {
  try {
    // Import models
    const { default: Unit } = await import('../models/unitModel.js');
    const { default: Sale } = await import('../models/salesModel.js');

    const matchQuery = { organization: organizationId };
    if (projectId) {
      matchQuery.project = projectId;
    }
    if (unitType !== 'all') {
      matchQuery.type = unitType;
    }

    // Get current inventory
    const inventoryData = await Unit.aggregate([
      { $match: matchQuery },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          types: { $addToSet: '$type' }
        }
      }
    ]);

    // Get historical turnover rates
    const historicalTurnover = await Sale.aggregate([
      { $match: { organization: organizationId } },
      {
        $group: {
          _id: {
            year: { $year: '$bookingDate' },
            month: { $month: '$bookingDate' }
          },
          salesCount: { $sum: 1 }
        }
      },
      { $sort: { '_id.year': -1, '_id.month': -1 } },
      { $limit: 12 }
    ]);

    const availableUnits = inventoryData.find(item => item._id === 'available')?.count || 0;
    const averageMonthlySales = historicalTurnover.reduce((sum, month) => 
      sum + month.salesCount, 0) / Math.max(historicalTurnover.length, 1);

    const months = period === '3_months' ? 3 : period === '6_months' ? 6 : 12;
    const projectedSales = averageMonthlySales * months;
    const turnoverRate = availableUnits > 0 ? (projectedSales / availableUnits) * 100 : 0;

    return {
      currentInventory: {
        available: availableUnits,
        sold: inventoryData.find(item => item._id === 'sold')?.count || 0,
        total: inventoryData.reduce((sum, item) => sum + item.count, 0)
      },
      turnoverPrediction: {
        period: period,
        projectedSales: Math.round(projectedSales),
        turnoverRate: Math.round(turnoverRate * 100) / 100,
        monthsToSellOut: availableUnits > 0 ? 
          Math.round((availableUnits / averageMonthlySales) * 10) / 10 : 0
      },
      insights: generateInventoryInsights(availableUnits, averageMonthlySales, turnoverRate)
    };

  } catch (error) {
    console.error('🏠 Inventory turnover calculation failed:', error);
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
    'Contacted': 0.9,
    'Qualified': 1.1,
    'Site Visit Scheduled': 1.2,
    'Site Visit Completed': 1.4,
    'Negotiating': 1.6,
    'Booked': 2.0,
    'Lost': 0.1,
    'Unqualified': 0.2
  };
  
  probability *= (statusMultipliers[lead.status] || 1);
  
  // Adjust based on interaction frequency
  if (lead.interactionCount > 5) probability *= 1.1;
  if (lead.interactionCount > 10) probability *= 1.2;
  
  // Adjust based on lead age
  if (lead.daysSinceCreated < 7) probability *= 1.1;  // Fresh leads
  if (lead.daysSinceCreated > 30) probability *= 0.9; // Older leads
  
  return Math.min(Math.max(Math.round(probability), 0), 100);
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

const generateInventoryInsights = (availableUnits, averageMonthlySales, turnoverRate) => {
  const insights = [];
  
  if (turnoverRate > 50) {
    insights.push({
      type: 'positive',
      message: 'High turnover rate indicates strong demand',
      action: 'Consider premium pricing strategies'
    });
  } else if (turnoverRate < 20) {
    insights.push({
      type: 'warning',
      message: 'Low turnover rate may indicate oversupply',
      action: 'Review pricing and marketing strategies'
    });
  }
  
  const monthsToSellOut = availableUnits / averageMonthlySales;
  if (monthsToSellOut < 6) {
    insights.push({
      type: 'alert',
      message: 'Inventory may run out soon',
      action: 'Plan for next phase or adjust sales pace'
    });
  }
  
  return insights;
};

// ================================
// EXPORTS
// ================================

export {
  getSalesForecast,
  getRevenueProjection,
  getLeadConversionProbability,
  getInventoryTurnoverPrediction
};