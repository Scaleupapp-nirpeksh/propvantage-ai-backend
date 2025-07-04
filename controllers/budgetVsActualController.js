// File: controllers/budgetVsActualController.js
// Description: Complete Budget vs Actual tracking controller
// Version: 1.0 - Full implementation with all endpoints
// Location: controllers/budgetVsActualController.js

import asyncHandler from 'express-async-handler';
import { 
  calculateBudgetVsActual,
  calculateRevenueAnalysis,
  calculateSalesAnalysis,
  calculateLeadAnalysis,
  calculateCostAnalysis,
  calculateProjectWiseAnalysis,
  calculateMarketingAnalysis
} from '../services/budgetVsActualService.js';

/**
 * @desc    Get comprehensive budget vs actual report
 * @route   GET /api/analytics/budget-vs-actual
 * @access  Private (Management roles)
 */
const getBudgetVsActualReport = asyncHandler(async (req, res) => {
  const {
    period = 'current_year',
    projectId,
    startDate,
    endDate,
    includeProjections = 'true',
    includeCostAnalysis = 'true',
    format = 'detailed' // detailed, summary, dashboard
  } = req.query;

  try {
    console.log('📊 Generating Budget vs Actual report...', {
      user: req.user.email,
      organization: req.user.organization,
      period,
      projectId
    });

    const options = {
      organizationId: req.user.organization,
      projectId: projectId || null,
      period,
      startDate: startDate ? new Date(startDate) : null,
      endDate: endDate ? new Date(endDate) : null,
      includeProjections: includeProjections === 'true',
      includeCostAnalysis: includeCostAnalysis === 'true'
    };

    const report = await calculateBudgetVsActual(options);

    // Format response based on requested format
    let response;
    switch (format) {
      case 'summary':
        response = {
          success: true,
          data: {
            summary: report.summary,
            revenue: {
              target: report.revenue.target.totalRevenue,
              actual: report.revenue.actual.totalRevenue,
              variance: report.revenue.variance,
              achievement: report.revenue.performance.achievementRate
            },
            sales: {
              target: report.sales.target.targetSales,
              actual: report.sales.actual.totalSales,
              variance: report.sales.variance,
              conversion: report.sales.performance.conversionRate
            },
            leads: {
              target: report.leads.target.totalLeads,
              actual: report.leads.actual.totalLeads,
              variance: report.leads.variance,
              qualification: report.leads.performance.qualificationRate
            }
          },
          metadata: report.metadata
        };
        break;
        
      case 'dashboard':
        response = {
          success: true,
          data: {
            kpis: {
              revenueAchievement: report.revenue.performance.achievementRate,
              salesConversion: report.sales.performance.conversionRate,
              leadQualification: report.leads.performance.qualificationRate,
              overallStatus: report.summary.overallStatus
            },
            charts: {
              revenueTrend: report.revenue.trend.monthly,
              salesVelocity: report.sales.velocity.monthly,
              leadGeneration: report.leads.trend.monthly,
              projectPerformance: report.projects.slice(0, 5) // Top 5 projects
            },
            alerts: report.summary.alerts,
            topPerformers: {
              bestProject: report.projects[0],
              bestLeadSource: report.marketing.summary.bestPerformingChannel
            }
          },
          metadata: report.metadata
        };
        break;
        
      default: // detailed
        response = {
          success: true,
          data: report,
          message: 'Budget vs Actual report generated successfully'
        };
    }

    res.json(response);

  } catch (error) {
    console.error('❌ Budget vs Actual report generation failed:', error);
    res.status(500);
    throw new Error(`Failed to generate Budget vs Actual report: ${error.message}`);
  }
});

/**
 * @desc    Get revenue budget vs actual analysis
 * @route   GET /api/analytics/revenue-analysis
 * @access  Private (Management roles)
 */
const getRevenueAnalysis = asyncHandler(async (req, res) => {
  const { period = 'current_year', projectId, startDate, endDate } = req.query;

  try {
    const options = {
      organizationId: req.user.organization,
      projectId: projectId || null,
      period,
      startDate: startDate ? new Date(startDate) : null,
      endDate: endDate ? new Date(endDate) : null
    };

    const report = await calculateBudgetVsActual(options);

    res.json({
      success: true,
      data: {
        revenue: report.revenue,
        projects: report.projects.map(p => ({
          name: p.name,
          targetRevenue: p.targetRevenue,
          actualRevenue: p.actualRevenue,
          revenueAchievement: p.revenueAchievement,
          variance: p.revenueVariance
        }))
      },
      metadata: {
        period: report.metadata.period,
        generatedAt: new Date()
      }
    });

  } catch (error) {
    console.error('❌ Revenue analysis failed:', error);
    res.status(500);
    throw new Error(`Failed to generate revenue analysis: ${error.message}`);
  }
});

/**
 * @desc    Get sales performance analysis
 * @route   GET /api/analytics/sales-analysis
 * @access  Private (Management roles)
 */
const getSalesAnalysis = asyncHandler(async (req, res) => {
  const { period = 'current_year', projectId, includeVelocity = 'true' } = req.query;

  try {
    const options = {
      organizationId: req.user.organization,
      projectId: projectId || null,
      period
    };

    const report = await calculateBudgetVsActual(options);

    const response = {
      success: true,
      data: {
        sales: report.sales,
        inventory: {
          totalUnits: report.sales.target.totalUnits,
          soldUnits: report.sales.actual.soldUnits,
          remainingUnits: report.sales.target.remainingUnits,
          sellThroughRate: report.sales.performance.sellThroughRate
        }
      }
    };

    // Include velocity data if requested
    if (includeVelocity === 'true') {
      response.data.velocity = {
        monthly: report.sales.velocity.monthly,
        averagePerMonth: report.sales.velocity.averagePerMonth,
        projectedCompletion: calculateProjectedCompletion(report.sales)
      };
    }

    res.json(response);

  } catch (error) {
    console.error('❌ Sales analysis failed:', error);
    res.status(500);
    throw new Error(`Failed to generate sales analysis: ${error.message}`);
  }
});

/**
 * @desc    Get lead generation analysis
 * @route   GET /api/analytics/lead-analysis
 * @access  Private (Management/Sales roles)
 */
const getLeadAnalysis = asyncHandler(async (req, res) => {
  const { 
    period = 'current_year', 
    projectId, 
    includeSourceBreakdown = 'true',
    includeConversionFunnel = 'true' 
  } = req.query;

  try {
    // Sales Executives can only see their organization data
    const options = {
      organizationId: req.user.organization,
      projectId: projectId || null,
      period
    };

    const report = await calculateBudgetVsActual(options);

    const response = {
      success: true,
      data: {
        leads: report.leads,
        performance: {
          qualificationRate: report.leads.performance.qualificationRate,
          conversionRate: report.leads.performance.conversionRate,
          leadVelocity: report.leads.performance.leadVelocity
        }
      }
    };

    // Include source breakdown if requested
    if (includeSourceBreakdown === 'true') {
      response.data.sources = report.marketing.channels;
      response.data.bestPerformingSource = report.marketing.summary.bestPerformingChannel;
    }

    // Include conversion funnel if requested
    if (includeConversionFunnel === 'true') {
      response.data.conversionFunnel = {
        totalLeads: report.leads.actual.totalLeads,
        qualifiedLeads: report.leads.actual.qualifiedLeads,
        bookedLeads: report.leads.actual.bookedLeads,
        stages: [
          { stage: 'Generated', count: report.leads.actual.totalLeads, percentage: 100 },
          { 
            stage: 'Qualified', 
            count: report.leads.actual.qualifiedLeads, 
            percentage: report.leads.performance.qualificationRate 
          },
          { 
            stage: 'Booked', 
            count: report.leads.actual.bookedLeads, 
            percentage: report.leads.performance.conversionRate 
          }
        ]
      };
    }

    res.json(response);

  } catch (error) {
    console.error('❌ Lead analysis failed:', error);
    res.status(500);
    throw new Error(`Failed to generate lead analysis: ${error.message}`);
  }
});

/**
 * @desc    Get project-wise performance comparison
 * @route   GET /api/analytics/project-comparison
 * @access  Private (Management roles)
 */
const getProjectComparison = asyncHandler(async (req, res) => {
  const { 
    period = 'current_year',
    sortBy = 'revenueAchievement',
    limit = 10 
  } = req.query;

  try {
    const options = {
      organizationId: req.user.organization,
      period
    };

    const report = await calculateBudgetVsActual(options);

    // Sort projects based on requested criteria
    let sortedProjects = [...report.projects];
    switch (sortBy) {
      case 'salesRate':
        sortedProjects.sort((a, b) => b.salesRate - a.salesRate);
        break;
      case 'leadConversion':
        sortedProjects.sort((a, b) => b.leadConversion - a.leadConversion);
        break;
      default: // revenueAchievement
        sortedProjects.sort((a, b) => b.revenueAchievement - a.revenueAchievement);
    }

    // Limit results
    sortedProjects = sortedProjects.slice(0, parseInt(limit));

    // Calculate project rankings
    const projectsWithRanking = sortedProjects.map((project, index) => ({
      ...project,
      rank: index + 1,
      status: getProjectStatus(project),
      insights: generateProjectInsights(project)
    }));

    res.json({
      success: true,
      data: {
        projects: projectsWithRanking,
        summary: {
          totalProjects: report.projects.length,
          averageRevenue: report.projects.reduce((sum, p) => sum + p.actualRevenue, 0) / report.projects.length,
          topPerformer: projectsWithRanking[0],
          needsAttention: projectsWithRanking.filter(p => p.status === 'needs_attention')
        },
        sortedBy: sortBy,
        period
      }
    });

  } catch (error) {
    console.error('❌ Project comparison failed:', error);
    res.status(500);
    throw new Error(`Failed to generate project comparison: ${error.message}`);
  }
});

/**
 * @desc    Get marketing ROI analysis
 * @route   GET /api/analytics/marketing-roi
 * @access  Private (Management roles)
 */
const getMarketingROI = asyncHandler(async (req, res) => {
  const { period = 'current_year', includeRecommendations = 'true' } = req.query;

  try {
    const options = {
      organizationId: req.user.organization,
      period
    };

    const report = await calculateBudgetVsActual(options);

    const response = {
      success: true,
      data: {
        summary: report.marketing.summary,
        channels: report.marketing.channels.map(channel => ({
          ...channel,
          efficiency: calculateChannelEfficiency(channel),
          recommendation: getChannelRecommendation(channel)
        })),
        insights: {
          bestPerforming: report.marketing.summary.bestPerformingChannel,
          averageROI: report.marketing.summary.averageROI,
          totalInvestment: report.marketing.channels.reduce((sum, c) => sum + c.estimatedCost, 0),
          totalReturn: report.marketing.channels.reduce((sum, c) => sum + c.estimatedRevenue, 0)
        }
      }
    };

    // Include recommendations if requested
    if (includeRecommendations === 'true') {
      response.data.recommendations = generateMarketingRecommendations(report.marketing);
    }

    res.json(response);

  } catch (error) {
    console.error('❌ Marketing ROI analysis failed:', error);
    res.status(500);
    throw new Error(`Failed to generate marketing ROI analysis: ${error.message}`);
  }
});

/**
 * @desc    Get budget vs actual dashboard summary
 * @route   GET /api/analytics/budget-dashboard
 * @access  Private (Management roles)
 */
const getBudgetDashboard = asyncHandler(async (req, res) => {
  const { period = 'current_year' } = req.query;

  try {
    const options = {
      organizationId: req.user.organization,
      period,
      includeProjections: true
    };

    const report = await calculateBudgetVsActual(options);

    // Create dashboard-optimized response
    const dashboard = {
      kpis: [
        {
          name: 'Revenue Achievement',
          value: report.revenue.performance.achievementRate,
          target: 100,
          unit: '%',
          status: report.revenue.variance.status,
          trend: getTrendDirection(report.revenue.trend.growth)
        },
        {
          name: 'Sales Conversion',
          value: report.sales.performance.conversionRate,
          target: 70,
          unit: '%',
          status: report.sales.variance.status,
          trend: getTrendDirection(0)
        },
        {
          name: 'Lead Quality',
          value: report.leads.performance.qualificationRate,
          target: 30,
          unit: '%',
          status: report.leads.variance.status,
          trend: getTrendDirection(report.leads.trend.growth)
        },
        {
          name: 'Marketing ROI',
          value: report.marketing.summary.averageROI,
          target: 200,
          unit: '%',
          status: report.marketing.summary.averageROI > 200 ? 'ahead' : 'behind',
          trend: 'stable'
        }
      ],
      alerts: report.summary.alerts,
      topInsights: [
        `Revenue is ${Math.abs(report.revenue.variance.percentage).toFixed(1)}% ${report.revenue.variance.status === 'ahead' ? 'above' : 'below'} target`,
        `Best performing project: ${report.projects[0]?.name || 'N/A'}`,
        `Top lead source: ${report.marketing.summary.bestPerformingChannel?._id || 'N/A'} with ${report.marketing.summary.bestPerformingChannel?.conversionRate?.toFixed(1) || 0}% conversion`
      ],
      quickActions: report.summary.recommendations.slice(0, 3),
      projections: report.projections
    };

    res.json({
      success: true,
      data: dashboard,
      metadata: {
        period,
        lastUpdated: new Date(),
        nextUpdate: 'Real-time'
      }
    });

  } catch (error) {
    console.error('❌ Budget dashboard generation failed:', error);
    res.status(500);
    throw new Error(`Failed to generate budget dashboard: ${error.message}`);
  }
});

// ====================================================================
// HELPER FUNCTIONS
// ====================================================================

const calculateProjectedCompletion = (salesData) => {
  const remainingUnits = salesData.target.remainingUnits;
  const averagePerMonth = salesData.velocity.averagePerMonth;
  
  if (averagePerMonth === 0) return 'Indefinite';
  
  const monthsToCompletion = Math.ceil(remainingUnits / averagePerMonth);
  const completionDate = new Date();
  completionDate.setMonth(completionDate.getMonth() + monthsToCompletion);
  
  return {
    monthsRemaining: monthsToCompletion,
    estimatedCompletionDate: completionDate,
    confidence: monthsToCompletion <= 12 ? 'high' : monthsToCompletion <= 24 ? 'medium' : 'low'
  };
};

const getProjectStatus = (project) => {
  if (project.revenueAchievement >= 90 && project.salesRate >= 60) return 'excellent';
  if (project.revenueAchievement >= 70 && project.salesRate >= 40) return 'good';
  if (project.revenueAchievement >= 50 && project.salesRate >= 25) return 'average';
  return 'needs_attention';
};

const generateProjectInsights = (project) => {
  const insights = [];
  
  if (project.revenueAchievement > 100) {
    insights.push('Exceeding revenue targets');
  } else if (project.revenueAchievement < 50) {
    insights.push('Revenue significantly below target');
  }
  
  if (project.salesRate > 80) {
    insights.push('High inventory turnover');
  } else if (project.salesRate < 30) {
    insights.push('Slow sales velocity');
  }
  
  if (project.leadConversion > 40) {
    insights.push('Strong lead conversion');
  } else if (project.leadConversion < 20) {
    insights.push('Poor lead quality or conversion');
  }
  
  return insights;
};

const calculateChannelEfficiency = (channel) => {
  const costPerLead = channel.estimatedCost / channel.totalLeads;
  const costPerQualified = channel.qualifiedLeads > 0 ? channel.estimatedCost / channel.qualifiedLeads : Infinity;
  const costPerBooked = channel.bookedLeads > 0 ? channel.estimatedCost / channel.bookedLeads : Infinity;
  
  return {
    costPerLead: Math.round(costPerLead),
    costPerQualified: isFinite(costPerQualified) ? Math.round(costPerQualified) : 'N/A',
    costPerBooked: isFinite(costPerBooked) ? Math.round(costPerBooked) : 'N/A',
    efficiency: channel.roi > 200 ? 'high' : channel.roi > 100 ? 'medium' : 'low'
  };
};

const getChannelRecommendation = (channel) => {
  if (channel.roi > 300) return 'Increase investment - high ROI';
  if (channel.roi > 150) return 'Maintain current investment';
  if (channel.roi > 50) return 'Optimize campaigns to improve ROI';
  return 'Consider reducing investment or major optimization';
};

const generateMarketingRecommendations = (marketing) => {
  const recommendations = [];
  
  if (marketing.summary.bestPerformingChannel) {
    recommendations.push({
      type: 'investment',
      message: `Increase budget for ${marketing.summary.bestPerformingChannel._id} - highest ROI channel`,
      priority: 'high',
      impact: 'revenue_growth'
    });
  }
  
  const lowPerformingChannels = marketing.channels.filter(c => c.roi < 50);
  if (lowPerformingChannels.length > 0) {
    recommendations.push({
      type: 'optimization',
      message: `Optimize or reduce investment in ${lowPerformingChannels.map(c => c._id).join(', ')}`,
      priority: 'medium',
      impact: 'cost_reduction'
    });
  }
  
  return recommendations;
};

const getTrendDirection = (growthRate) => {
  if (growthRate > 5) return 'up';
  if (growthRate < -5) return 'down';
  return 'stable';
};

// Export all functions - FIXED: Added getBudgetDashboard to exports
export {
  getBudgetVsActualReport,
  getRevenueAnalysis,
  getSalesAnalysis,
  getLeadAnalysis,
  getProjectComparison,
  getMarketingROI,
  getBudgetDashboard  // ✅ FIXED: This was missing!
};