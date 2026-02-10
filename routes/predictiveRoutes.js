// File: routes/predictiveRoutes.js
// Description: Routes for predictive analytics endpoints
// Version: 1.0 - Complete implementation for PropVantage AI
// Location: routes/predictiveRoutes.js

import express from 'express';
import {
  getSalesForecast,
  getRevenueProjection,
  getLeadConversionProbability,
  getInventoryTurnoverPrediction
} from '../controllers/predictiveController.js';

// Import authentication middleware
import { protect, hasPermission } from '../middleware/authMiddleware.js';
import { PERMISSIONS } from '../config/permissions.js';

const router = express.Router();

// Apply authentication to all routes
router.use(protect);

// =============================================================================
// SALES FORECASTING ROUTES
// =============================================================================

/**
 * @route   GET /api/analytics/predictions/sales-forecast
 * @desc    Generate sales forecast for organization or specific project
 * @access  Private (Management roles)
 * @query   projectId, period (3_months, 6_months, 12_months), format (summary, detailed, chart)
 * @example GET /api/analytics/predictions/sales-forecast?period=6_months&format=summary
 */
router.get(
  '/sales-forecast',
  hasPermission(PERMISSIONS.ANALYTICS.PREDICTIVE),
  getSalesForecast
);

/**
 * @route   GET /api/analytics/predictions/revenue-projection
 * @desc    Generate revenue projection based on sales forecast
 * @access  Private (Management roles)
 * @query   projectId, period, includeBreakdown
 * @example GET /api/analytics/predictions/revenue-projection?period=3_months&includeBreakdown=true
 */
router.get(
  '/revenue-projection',
  hasPermission(PERMISSIONS.ANALYTICS.PREDICTIVE),
  getRevenueProjection
);

// =============================================================================
// LEAD CONVERSION PREDICTION ROUTES
// =============================================================================

/**
 * @route   GET /api/analytics/predictions/lead-conversion-probability
 * @desc    Get lead conversion probability predictions
 * @access  Private (Sales & Management roles)
 * @query   leadId (optional), scoreThreshold, timeframe
 * @example GET /api/analytics/predictions/lead-conversion-probability?scoreThreshold=70
 */
router.get(
  '/lead-conversion-probability',
  hasPermission(PERMISSIONS.ANALYTICS.PREDICTIVE),
  getLeadConversionProbability
);

/**
 * @route   GET /api/analytics/predictions/lead-conversion-probability/:leadId
 * @desc    Get conversion probability for a specific lead
 * @access  Private (Sales & Management roles)
 * @example GET /api/analytics/predictions/lead-conversion-probability/60f1b2e5d4c8a100156789ab
 */
router.get(
  '/lead-conversion-probability/:leadId',
  hasPermission(PERMISSIONS.ANALYTICS.PREDICTIVE),
  (req, res, next) => {
    req.query.leadId = req.params.leadId;
    next();
  },
  getLeadConversionProbability
);

// =============================================================================
// INVENTORY PREDICTION ROUTES
// =============================================================================

/**
 * @route   GET /api/analytics/predictions/inventory-turnover
 * @desc    Get inventory turnover predictions
 * @access  Private (Management roles)
 * @query   projectId, period, unitType
 * @example GET /api/analytics/predictions/inventory-turnover?period=6_months&unitType=3BHK
 */
router.get(
  '/inventory-turnover',
  hasPermission(PERMISSIONS.ANALYTICS.PREDICTIVE),
  getInventoryTurnoverPrediction
);

/**
 * @route   GET /api/analytics/predictions/inventory-turnover/:projectId
 * @desc    Get inventory turnover predictions for a specific project
 * @access  Private (Management roles)
 * @example GET /api/analytics/predictions/inventory-turnover/60f1b2e5d4c8a100156789ab
 */
router.get(
  '/inventory-turnover/:projectId',
  hasPermission(PERMISSIONS.ANALYTICS.PREDICTIVE),
  (req, res, next) => {
    req.query.projectId = req.params.projectId;
    next();
  },
  getInventoryTurnoverPrediction
);

// =============================================================================
// QUICK ACCESS ROUTES FOR DASHBOARD
// =============================================================================

/**
 * @route   GET /api/analytics/predictions/dashboard-summary
 * @desc    Get predictive analytics summary for dashboard
 * @access  Private (Management roles)
 */
router.get(
  '/dashboard-summary',
  hasPermission(PERMISSIONS.ANALYTICS.PREDICTIVE),
  async (req, res) => {
    try {
      console.log('📊 Generating predictive analytics dashboard summary...');

      // Get quick forecasts for dashboard
      const organizationId = req.user?.organization || req.headers['x-organization']; // Fallback for testing

      const [salesForecast, conversionData] = await Promise.all([
        // Quick 3-month sales forecast
        getSalesForecast({
          query: { period: '3_months', format: 'summary' },
          user: { organization: organizationId }
        }),
        // Lead conversion summary
        getLeadConversionProbability({
          query: { scoreThreshold: '70' },
          user: { organization: organizationId }
        })
      ]);

      res.json({
        success: true,
        data: {
          salesForecast: salesForecast?.data || null,
          leadConversion: conversionData?.data || null,
          quickMetrics: {
            forecastPeriod: '3 months',
            dataQuality: salesForecast?.data?.dataQuality || 'Medium',
            lastUpdated: new Date().toISOString()
          }
        },
        message: 'Predictive analytics dashboard summary generated successfully'
      });

    } catch (error) {
      console.error('❌ Dashboard summary generation failed:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to generate dashboard summary',
        error: error.message
      });
    }
  }
);

// =============================================================================
// BULK OPERATIONS ROUTES
// =============================================================================

/**
 * @route   POST /api/analytics/predictions/bulk-forecast
 * @desc    Generate forecasts for multiple projects at once
 * @access  Private (Management roles)
 * @body    projectIds[], period, options
 */
router.post(
  '/bulk-forecast',
  hasPermission(PERMISSIONS.ANALYTICS.PREDICTIVE),
  async (req, res) => {
    try {
      const { projectIds = [], period = '3_months', includeScenarios = true } = req.body;

      console.log('🔮 Generating bulk forecasts...', { projectIds, period });

      const forecasts = await Promise.all(
        projectIds.map(async (projectId) => {
          try {
            const forecastOptions = {
              organizationId: req.user?.organization || req.headers['x-organization'],
              projectId: projectId,
              forecastPeriod: period,
              includeScenarios: includeScenarios
            };

            const { generateSalesForecast } = await import('../services/predictiveAnalyticsService.js');
            const forecast = await generateSalesForecast(forecastOptions);

            return {
              projectId: projectId,
              forecast: forecast.forecast,
              scenarios: forecast.scenarios,
              success: true
            };
          } catch (error) {
            return {
              projectId: projectId,
              error: error.message,
              success: false
            };
          }
        })
      );

      const successfulForecasts = forecasts.filter(f => f.success);
      const failedForecasts = forecasts.filter(f => !f.success);

      res.json({
        success: true,
        data: {
          forecasts: successfulForecasts,
          summary: {
            totalProjects: projectIds.length,
            successful: successfulForecasts.length,
            failed: failedForecasts.length,
            totalForecastedSales: successfulForecasts.reduce((sum, f) =>
              sum + f.forecast.totalForecastedSales, 0)
          },
          errors: failedForecasts.length > 0 ? failedForecasts : null
        },
        message: `Bulk forecast completed: ${successfulForecasts.length}/${projectIds.length} successful`
      });

    } catch (error) {
      console.error('❌ Bulk forecast generation failed:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to generate bulk forecasts',
        error: error.message
      });
    }
  }
);

// =============================================================================
// CONFIGURATION AND TESTING ROUTES
// =============================================================================

/**
 * @route   GET /api/analytics/predictions/config
 * @desc    Get predictive analytics configuration and capabilities
 * @access  Private (Management roles)
 */
router.get(
  '/config',
  hasPermission(PERMISSIONS.ANALYTICS.PREDICTIVE),
  (req, res) => {
    res.json({
      success: true,
      data: {
        capabilities: {
          salesForecasting: {
            enabled: true,
            periods: ['3_months', '6_months', '12_months'],
            formats: ['summary', 'detailed', 'chart'],
            features: ['scenarios', 'confidence_intervals', 'ai_enhancements']
          },
          revenueProjection: {
            enabled: true,
            basedOn: ['sales_forecast', 'historical_pricing'],
            includes: ['monthly_breakdown', 'scenarios', 'assumptions']
          },
          leadConversion: {
            enabled: true,
            methods: ['score_based', 'interaction_based', 'time_based'],
            timeframes: ['7_days', '30_days', '90_days']
          },
          inventoryTurnover: {
            enabled: true,
            periods: ['3_months', '6_months', '12_months'],
            unitTypes: ['all', '1BHK', '2BHK', '3BHK', '4BHK', 'Villa']
          }
        },
        dataRequirements: {
          minimumHistoricalData: '3 months',
          optimalHistoricalData: '12 months',
          requiredData: ['sales', 'leads', 'interactions', 'units'],
          dataQualityThresholds: {
            high: '6+ months data, 50+ leads',
            medium: '3+ months data, 20+ leads',
            low: '1+ month data, 10+ leads'
          }
        },
        algorithms: {
          salesForecasting: 'AI-Enhanced Trend Analysis with Pipeline Weighting',
          confidenceCalculation: 'Historical Variance with Time Decay',
          scenarioGeneration: 'Monte Carlo Simulation',
          aiEnhancements: 'Market Momentum + Lead Quality + External Factors'
        }
      },
      message: 'Predictive analytics configuration retrieved successfully'
    });
  }
);

/**
 * @route   GET /api/analytics/predictions/health-check
 * @desc    Check health and data availability for predictive analytics
 * @access  Private (Management roles)
 */
router.get(
  '/health-check',
  hasPermission(PERMISSIONS.ANALYTICS.PREDICTIVE),
  async (req, res) => {
    try {
      const organizationId = req.user?.organization || req.headers['x-organization'];

      // Check data availability
      const { default: Sale } = await import('../models/salesModel.js');
      const { default: Lead } = await import('../models/leadModel.js');
      const { default: Unit } = await import('../models/unitModel.js');

      const [salesCount, leadsCount, unitsCount] = await Promise.all([
        Sale.countDocuments({ organization: organizationId }),
        Lead.countDocuments({ organization: organizationId }),
        Unit.countDocuments({ organization: organizationId })
      ]);

      // Assess data quality
      let dataQuality = 'Low';
      if (salesCount >= 50 && leadsCount >= 100) dataQuality = 'High';
      else if (salesCount >= 20 && leadsCount >= 50) dataQuality = 'Medium';

      // Check if historical data is sufficient
      const threeMonthsAgo = new Date();
      threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

      const recentSalesCount = await Sale.countDocuments({
        organization: organizationId,
        bookingDate: { $gte: threeMonthsAgo }
      });

      const hasMinimumData = recentSalesCount >= 5;

      res.json({
        success: true,
        data: {
          dataAvailability: {
            sales: salesCount,
            leads: leadsCount,
            units: unitsCount,
            recentSales: recentSalesCount
          },
          dataQuality: dataQuality,
          capabilities: {
            salesForecasting: hasMinimumData,
            revenueProjection: hasMinimumData,
            leadConversion: leadsCount >= 10,
            inventoryTurnover: unitsCount >= 5
          },
          recommendations: generateHealthCheckRecommendations(
            salesCount,
            leadsCount,
            unitsCount,
            recentSalesCount
          ),
          status: hasMinimumData ? 'Ready' : 'Insufficient Data'
        },
        message: 'Predictive analytics health check completed'
      });

    } catch (error) {
      console.error('❌ Health check failed:', error);
      res.status(500).json({
        success: false,
        message: 'Health check failed',
        error: error.message
      });
    }
  }
);

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

const generateHealthCheckRecommendations = (salesCount, leadsCount, unitsCount, recentSalesCount) => {
  const recommendations = [];

  if (salesCount < 20) {
    recommendations.push({
      category: 'data',
      priority: 'high',
      message: 'Increase historical sales data for better forecasting accuracy',
      action: 'Import past sales records or wait for more transactions'
    });
  }

  if (leadsCount < 50) {
    recommendations.push({
      category: 'leads',
      priority: 'medium',
      message: 'More lead data will improve conversion predictions',
      action: 'Ensure all leads are properly tracked and scored'
    });
  }

  if (recentSalesCount < 5) {
    recommendations.push({
      category: 'activity',
      priority: 'high',
      message: 'Recent sales activity is low, affecting forecast reliability',
      action: 'Focus on closing current pipeline or review sales processes'
    });
  }

  if (unitsCount < 10) {
    recommendations.push({
      category: 'inventory',
      priority: 'low',
      message: 'Limited inventory data may affect turnover predictions',
      action: 'Ensure all units are properly catalogued in the system'
    });
  }

  if (recommendations.length === 0) {
    recommendations.push({
      category: 'optimization',
      priority: 'low',
      message: 'Data quality is good, consider advanced analytics features',
      action: 'Enable AI-enhanced forecasting and scenario planning'
    });
  }

  return recommendations;
};

export default router;
