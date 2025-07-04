// File: services/budgetVsActualService.js
// Description: Comprehensive Budget vs Actual tracking and analytics service
// Version: 1.0 - Complete implementation for financial tracking
// Location: services/budgetVsActualService.js

import mongoose from 'mongoose';

// Import models dynamically to avoid circular dependencies
let Project, Unit, Sale, Lead, ConstructionMilestone;

const initializeModels = async () => {
  if (!Project) {
    try {
      const { default: ProjectModel } = await import('../models/projectModel.js');
      const { default: UnitModel } = await import('../models/unitModel.js');
      const { default: SaleModel } = await import('../models/salesModel.js');
      const { default: LeadModel } = await import('../models/leadModel.js');
      
      Project = ProjectModel;
      Unit = UnitModel;
      Sale = SaleModel;
      Lead = LeadModel;
      
      // Construction milestone is optional
      try {
        const { default: ConstructionMilestoneModel } = await import('../models/constructionMilestoneModel.js');
        ConstructionMilestone = ConstructionMilestoneModel;
      } catch (constructionError) {
        console.log('Construction milestone model not available');
      }
      
      console.log('✅ Budget vs Actual models initialized');
    } catch (error) {
      console.error('❌ Failed to initialize Budget vs Actual models:', error.message);
      throw error;
    }
  }
};

/**
 * CORE FUNCTION: Calculate comprehensive budget vs actual analysis
 * @param {Object} options - Analysis options
 * @returns {Object} Complete budget vs actual report
 */
const calculateBudgetVsActual = async (options = {}) => {
  try {
    await initializeModels();
    
    const {
      organizationId,
      projectId = null,
      period = 'current_year', // current_year, last_year, ytd, custom
      startDate = null,
      endDate = null,
      includeProjections = true,
      includeCostAnalysis = true
    } = options;
    
    console.log('📊 Starting Budget vs Actual calculation...', { organizationId, projectId, period });
    
    // Get date range for analysis
    const dateRange = getDateRange(period, startDate, endDate);
    console.log('📅 Analysis period:', dateRange);
    
    // Get base query filters
    const baseQuery = getBaseQuery(organizationId, projectId, dateRange);
    
    // Calculate all metrics in parallel for better performance
    const [
      revenueAnalysis,
      salesAnalysis,
      leadAnalysis,
      costAnalysis,
      projectAnalysis,
      marketingAnalysis
    ] = await Promise.all([
      calculateRevenueAnalysis(baseQuery, dateRange),
      calculateSalesAnalysis(baseQuery, dateRange),
      calculateLeadAnalysis(baseQuery, dateRange),
      includeCostAnalysis ? calculateCostAnalysis(baseQuery, dateRange) : null,
      calculateProjectWiseAnalysis(baseQuery, dateRange),
      calculateMarketingAnalysis(baseQuery, dateRange)
    ]);
    
    // Calculate projections if requested
    let projections = null;
    if (includeProjections) {
      projections = await calculateProjections(baseQuery, dateRange, {
        revenue: revenueAnalysis,
        sales: salesAnalysis,
        leads: leadAnalysis
      });
    }
    
    // Compile comprehensive report
    const report = {
      summary: calculateSummaryMetrics({
        revenue: revenueAnalysis,
        sales: salesAnalysis,
        leads: leadAnalysis,
        costs: costAnalysis
      }),
      revenue: revenueAnalysis,
      sales: salesAnalysis,
      leads: leadAnalysis,
      costs: costAnalysis,
      projects: projectAnalysis,
      marketing: marketingAnalysis,
      projections,
      metadata: {
        organizationId,
        projectId,
        period,
        dateRange,
        generatedAt: new Date(),
        dataPoints: {
          projectsAnalyzed: projectAnalysis?.length || 0,
          salesTracked: salesAnalysis?.actualSales || 0,
          leadsTracked: leadAnalysis?.actualLeads || 0
        }
      }
    };
    
    console.log('✅ Budget vs Actual calculation completed');
    return report;
    
  } catch (error) {
    console.error('❌ Budget vs Actual calculation failed:', error);
    throw new Error(`Failed to calculate budget vs actual: ${error.message}`);
  }
};

/**
 * Calculate revenue budget vs actual analysis
 * @param {Object} baseQuery - Base MongoDB query
 * @param {Object} dateRange - Date range for analysis
 * @returns {Object} Revenue analysis
 */
const calculateRevenueAnalysis = async (baseQuery, dateRange) => {
  try {
    console.log('💰 Calculating revenue analysis...');
    
    // Get target revenue from projects
    const targetRevenueResult = await Project.aggregate([
      { $match: baseQuery.project },
      {
        $group: {
          _id: null,
          totalTargetRevenue: { $sum: '$targetRevenue' },
          projectCount: { $sum: 1 },
          avgTargetRevenue: { $avg: '$targetRevenue' }
        }
      }
    ]);
    
    // Get actual revenue from sales
    const actualRevenueResult = await Sale.aggregate([
      { 
        $match: {
          ...baseQuery.sale,
          bookingDate: {
            $gte: dateRange.start,
            $lte: dateRange.end
          }
        }
      },
      {
        $group: {
          _id: null,
          totalActualRevenue: { $sum: '$salePrice' },
          salesCount: { $sum: 1 },
          avgSalePrice: { $avg: '$salePrice' },
          maxSalePrice: { $max: '$salePrice' },
          minSalePrice: { $min: '$salePrice' }
        }
      }
    ]);
    
    // Get monthly revenue trend
    const monthlyTrend = await Sale.aggregate([
      { 
        $match: {
          ...baseQuery.sale,
          bookingDate: {
            $gte: dateRange.start,
            $lte: dateRange.end
          }
        }
      },
      {
        $group: {
          _id: {
            year: { $year: '$bookingDate' },
            month: { $month: '$bookingDate' }
          },
          revenue: { $sum: '$salePrice' },
          salesCount: { $sum: 1 }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } }
    ]);
    
    const targetRevenue = targetRevenueResult[0]?.totalTargetRevenue || 0;
    const actualRevenue = actualRevenueResult[0]?.totalActualRevenue || 0;
    const variance = actualRevenue - targetRevenue;
    const variancePercentage = targetRevenue > 0 ? (variance / targetRevenue) * 100 : 0;
    
    return {
      target: {
        totalRevenue: targetRevenue,
        projectCount: targetRevenueResult[0]?.projectCount || 0,
        averagePerProject: targetRevenueResult[0]?.avgTargetRevenue || 0
      },
      actual: {
        totalRevenue: actualRevenue,
        salesCount: actualRevenueResult[0]?.salesCount || 0,
        averagePerSale: actualRevenueResult[0]?.avgSalePrice || 0,
        highestSale: actualRevenueResult[0]?.maxSalePrice || 0,
        lowestSale: actualRevenueResult[0]?.minSalePrice || 0
      },
      variance: {
        absolute: variance,
        percentage: Math.round(variancePercentage * 100) / 100,
        status: variance >= 0 ? 'ahead' : 'behind'
      },
      trend: {
        monthly: monthlyTrend,
        growth: calculateGrowthRate(monthlyTrend)
      },
      performance: {
        achievementRate: targetRevenue > 0 ? Math.round((actualRevenue / targetRevenue) * 10000) / 100 : 0,
        revenuePerUnit: actualRevenueResult[0]?.salesCount > 0 ? 
          Math.round(actualRevenue / actualRevenueResult[0].salesCount) : 0
      }
    };
    
  } catch (error) {
    console.error('💰 Revenue analysis error:', error);
    throw error;
  }
};

/**
 * Calculate sales budget vs actual analysis
 * @param {Object} baseQuery - Base MongoDB query
 * @param {Object} dateRange - Date range for analysis
 * @returns {Object} Sales analysis
 */
const calculateSalesAnalysis = async (baseQuery, dateRange) => {
  try {
    console.log('🏠 Calculating sales analysis...');
    
    // Get target units (total available units as target)
    const unitsResult = await Unit.aggregate([
      { $match: baseQuery.unit },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);
    
    // Get actual sales
    const salesResult = await Sale.aggregate([
      { 
        $match: {
          ...baseQuery.sale,
          bookingDate: {
            $gte: dateRange.start,
            $lte: dateRange.end
          }
        }
      },
      {
        $lookup: {
          from: 'units',
          localField: 'unit',
          foreignField: '_id',
          as: 'unitDetails'
        }
      },
      { $unwind: '$unitDetails' },
      {
        $group: {
          _id: '$unitDetails.type',
          count: { $sum: 1 },
          totalRevenue: { $sum: '$salePrice' },
          avgPrice: { $avg: '$salePrice' }
        }
      }
    ]);
    
    // Calculate sales velocity (sales per month)
    const salesVelocity = await Sale.aggregate([
      { 
        $match: {
          ...baseQuery.sale,
          bookingDate: {
            $gte: dateRange.start,
            $lte: dateRange.end
          }
        }
      },
      {
        $group: {
          _id: {
            year: { $year: '$bookingDate' },
            month: { $month: '$bookingDate' }
          },
          salesCount: { $sum: 1 }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } }
    ]);
    
    const totalUnits = unitsResult.reduce((sum, status) => sum + status.count, 0);
    const soldUnits = unitsResult.find(s => s._id === 'sold')?.count || 0;
    const actualSales = salesResult.reduce((sum, type) => sum + type.count, 0);
    
    // Calculate target sales rate (assume target is to sell 70% of units in the period)
    const targetSalesRate = 0.7; // 70% target
    const targetSales = Math.round(totalUnits * targetSalesRate);
    
    return {
      target: {
        totalUnits,
        targetSales,
        targetSalesRate,
        remainingUnits: totalUnits - soldUnits
      },
      actual: {
        totalSales: actualSales,
        soldUnits,
        salesByType: salesResult,
        inventoryStatus: unitsResult
      },
      variance: {
        unitsSold: actualSales - targetSales,
        salesRate: soldUnits > 0 ? Math.round((soldUnits / totalUnits) * 10000) / 100 : 0,
        status: actualSales >= targetSales ? 'ahead' : 'behind'
      },
      velocity: {
        monthly: salesVelocity,
        averagePerMonth: salesVelocity.length > 0 ? 
          Math.round(salesVelocity.reduce((sum, m) => sum + m.salesCount, 0) / salesVelocity.length) : 0
      },
      performance: {
        conversionRate: Math.round((actualSales / totalUnits) * 10000) / 100,
        sellThroughRate: Math.round((soldUnits / totalUnits) * 10000) / 100
      }
    };
    
  } catch (error) {
    console.error('🏠 Sales analysis error:', error);
    throw error;
  }
};

/**
 * Calculate lead generation budget vs actual analysis
 * @param {Object} baseQuery - Base MongoDB query
 * @param {Object} dateRange - Date range for analysis
 * @returns {Object} Lead analysis
 */
const calculateLeadAnalysis = async (baseQuery, dateRange) => {
  try {
    console.log('🎯 Calculating lead analysis...');
    
    // Get lead generation metrics
    const leadMetrics = await Lead.aggregate([
      { 
        $match: {
          ...baseQuery.lead,
          createdAt: {
            $gte: dateRange.start,
            $lte: dateRange.end
          }
        }
      },
      {
        $group: {
          _id: '$source',
          count: { $sum: 1 },
          qualifiedCount: {
            $sum: { 
              $cond: [
                { $in: ['$status', ['Qualified', 'Site Visit Scheduled', 'Site Visit Completed', 'Negotiating', 'Booked']] }, 
                1, 
                0
              ]
            }
          },
          bookedCount: {
            $sum: { $cond: [{ $eq: ['$status', 'Booked'] }, 1, 0] }
          },
          avgScore: { $avg: '$score' }
        }
      }
    ]);
    
    // Calculate lead conversion funnel
    const conversionFunnel = await Lead.aggregate([
      { 
        $match: {
          ...baseQuery.lead,
          createdAt: {
            $gte: dateRange.start,
            $lte: dateRange.end
          }
        }
      },
      {
        $group: {
          _id: null,
          totalLeads: { $sum: 1 },
          contactedLeads: {
            $sum: { 
              $cond: [
                { $ne: ['$status', 'New'] }, 
                1, 
                0
              ]
            }
          },
          qualifiedLeads: {
            $sum: { 
              $cond: [
                { $in: ['$status', ['Qualified', 'Site Visit Scheduled', 'Site Visit Completed', 'Negotiating', 'Booked']] }, 
                1, 
                0
              ]
            }
          },
          bookedLeads: {
            $sum: { $cond: [{ $eq: ['$status', 'Booked'] }, 1, 0] }
          },
          avgLeadScore: { $avg: '$score' }
        }
      }
    ]);
    
    // Get monthly lead generation trend
    const monthlyLeadTrend = await Lead.aggregate([
      { 
        $match: {
          ...baseQuery.lead,
          createdAt: {
            $gte: dateRange.start,
            $lte: dateRange.end
          }
        }
      },
      {
        $group: {
          _id: {
            year: { $year: '$createdAt' },
            month: { $month: '$createdAt' }
          },
          leadsGenerated: { $sum: 1 },
          qualifiedLeads: {
            $sum: { 
              $cond: [
                { $in: ['$status', ['Qualified', 'Site Visit Scheduled', 'Site Visit Completed', 'Negotiating', 'Booked']] }, 
                1, 
                0
              ]
            }
          }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } }
    ]);
    
    const totalLeads = conversionFunnel[0]?.totalLeads || 0;
    const qualifiedLeads = conversionFunnel[0]?.qualifiedLeads || 0;
    const bookedLeads = conversionFunnel[0]?.bookedLeads || 0;
    
    // Assume target is to generate 150 leads per month and qualify 30%
    const monthsInPeriod = Math.max(1, Math.ceil((dateRange.end - dateRange.start) / (30 * 24 * 60 * 60 * 1000)));
    const targetLeadsPerMonth = 150;
    const targetQualificationRate = 0.30; // 30%
    const targetConversionRate = 0.05; // 5%
    
    const targetLeads = targetLeadsPerMonth * monthsInPeriod;
    const targetQualified = Math.round(targetLeads * targetQualificationRate);
    const targetBooked = Math.round(targetLeads * targetConversionRate);
    
    return {
      target: {
        totalLeads: targetLeads,
        qualifiedLeads: targetQualified,
        bookedLeads: targetBooked,
        qualificationRate: targetQualificationRate * 100,
        conversionRate: targetConversionRate * 100
      },
      actual: {
        totalLeads,
        qualifiedLeads,
        bookedLeads,
        leadsBySource: leadMetrics,
        averageScore: conversionFunnel[0]?.avgLeadScore || 0
      },
      variance: {
        totalLeads: totalLeads - targetLeads,
        qualifiedLeads: qualifiedLeads - targetQualified,
        bookedLeads: bookedLeads - targetBooked,
        status: totalLeads >= targetLeads ? 'ahead' : 'behind'
      },
      performance: {
        qualificationRate: totalLeads > 0 ? Math.round((qualifiedLeads / totalLeads) * 10000) / 100 : 0,
        conversionRate: totalLeads > 0 ? Math.round((bookedLeads / totalLeads) * 10000) / 100 : 0,
        leadVelocity: monthsInPeriod > 0 ? Math.round(totalLeads / monthsInPeriod) : 0
      },
      trend: {
        monthly: monthlyLeadTrend,
        growth: calculateGrowthRate(monthlyLeadTrend.map(m => ({ value: m.leadsGenerated })))
      }
    };
    
  } catch (error) {
    console.error('🎯 Lead analysis error:', error);
    throw error;
  }
};

/**
 * Calculate cost budget vs actual analysis
 * @param {Object} baseQuery - Base MongoDB query
 * @param {Object} dateRange - Date range for analysis
 * @returns {Object} Cost analysis
 */
const calculateCostAnalysis = async (baseQuery, dateRange) => {
  try {
    console.log('💸 Calculating cost analysis...');
    
    // This would integrate with construction milestones if available
    if (!ConstructionMilestone) {
      return {
        message: 'Cost analysis requires construction milestone data',
        available: false
      };
    }
    
    // Get cost data from construction milestones
    const costAnalysis = await ConstructionMilestone.aggregate([
      { 
        $match: {
          ...baseQuery.construction,
          createdAt: {
            $gte: dateRange.start,
            $lte: dateRange.end
          }
        }
      },
      {
        $group: {
          _id: '$phase',
          plannedCost: { $sum: '$budget.plannedCost' },
          actualCost: { $sum: '$budget.actualCost' },
          milestoneCount: { $sum: 1 },
          completedCount: {
            $sum: { $cond: [{ $eq: ['$status', 'Completed'] }, 1, 0] }
          }
        }
      }
    ]);
    
    const totalPlannedCost = costAnalysis.reduce((sum, phase) => sum + (phase.plannedCost || 0), 0);
    const totalActualCost = costAnalysis.reduce((sum, phase) => sum + (phase.actualCost || 0), 0);
    const costVariance = totalActualCost - totalPlannedCost;
    const costVariancePercentage = totalPlannedCost > 0 ? (costVariance / totalPlannedCost) * 100 : 0;
    
    return {
      target: {
        totalPlannedCost,
        phaseBreakdown: costAnalysis.map(phase => ({
          phase: phase._id,
          plannedCost: phase.plannedCost,
          milestoneCount: phase.milestoneCount
        }))
      },
      actual: {
        totalActualCost,
        phaseBreakdown: costAnalysis.map(phase => ({
          phase: phase._id,
          actualCost: phase.actualCost,
          completedCount: phase.completedCount
        }))
      },
      variance: {
        absolute: costVariance,
        percentage: Math.round(costVariancePercentage * 100) / 100,
        status: costVariance <= 0 ? 'under_budget' : 'over_budget'
      },
      performance: {
        costEfficiency: totalPlannedCost > 0 ? Math.round((totalPlannedCost / totalActualCost) * 10000) / 100 : 0,
        completionRate: costAnalysis.reduce((sum, phase) => sum + phase.completedCount, 0) /
                       costAnalysis.reduce((sum, phase) => sum + phase.milestoneCount, 0) * 100
      },
      available: true
    };
    
  } catch (error) {
    console.error('💸 Cost analysis error:', error);
    return {
      error: error.message,
      available: false
    };
  }
};

/**
 * Calculate project-wise budget vs actual analysis
 * @param {Object} baseQuery - Base MongoDB query
 * @param {Object} dateRange - Date range for analysis
 * @returns {Array} Project-wise analysis
 */
const calculateProjectWiseAnalysis = async (baseQuery, dateRange) => {
  try {
    console.log('🏗️ Calculating project-wise analysis...');
    
    const projectAnalysis = await Project.aggregate([
      { $match: baseQuery.project },
      {
        $lookup: {
          from: 'units',
          localField: '_id',
          foreignField: 'project',
          as: 'units'
        }
      },
      {
        $lookup: {
          from: 'sales',
          let: { projectId: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: { $eq: ['$project', '$$projectId'] },
                bookingDate: {
                  $gte: dateRange.start,
                  $lte: dateRange.end
                }
              }
            }
          ],
          as: 'sales'
        }
      },
      {
        $lookup: {
          from: 'leads',
          let: { projectId: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: { $eq: ['$project', '$$projectId'] },
                createdAt: {
                  $gte: dateRange.start,
                  $lte: dateRange.end
                }
              }
            }
          ],
          as: 'leads'
        }
      },
      {
        $addFields: {
          totalUnits: { $size: '$units' },
          soldUnits: {
            $size: {
              $filter: {
                input: '$units',
                cond: { $eq: ['$$this.status', 'sold'] }
              }
            }
          },
          actualRevenue: { $sum: '$sales.salePrice' },
          totalLeads: { $size: '$leads' },
          qualifiedLeads: {
            $size: {
              $filter: {
                input: '$leads',
                cond: { 
                  $in: ['$$this.status', ['Qualified', 'Site Visit Scheduled', 'Site Visit Completed', 'Negotiating', 'Booked']] 
                }
              }
            }
          }
        }
      },
      {
        $project: {
          name: 1,
          type: 1,
          location: 1,
          targetRevenue: 1,
          totalUnits: 1,
          soldUnits: 1,
          actualRevenue: 1,
          totalLeads: 1,
          qualifiedLeads: 1,
          revenueVariance: { $subtract: ['$actualRevenue', '$targetRevenue'] },
          revenueAchievement: {
            $cond: [
              { $eq: ['$targetRevenue', 0] },
              0,
              { $multiply: [{ $divide: ['$actualRevenue', '$targetRevenue'] }, 100] }
            ]
          },
          salesRate: {
            $cond: [
              { $eq: ['$totalUnits', 0] },
              0,
              { $multiply: [{ $divide: ['$soldUnits', '$totalUnits'] }, 100] }
            ]
          },
          leadConversion: {
            $cond: [
              { $eq: ['$totalLeads', 0] },
              0,
              { $multiply: [{ $divide: ['$qualifiedLeads', '$totalLeads'] }, 100] }
            ]
          }
        }
      },
      { $sort: { revenueAchievement: -1 } }
    ]);
    
    return projectAnalysis;
    
  } catch (error) {
    console.error('🏗️ Project analysis error:', error);
    throw error;
  }
};

/**
 * Calculate marketing budget vs actual analysis
 * @param {Object} baseQuery - Base MongoDB query
 * @param {Object} dateRange - Date range for analysis
 * @returns {Object} Marketing analysis
 */
const calculateMarketingAnalysis = async (baseQuery, dateRange) => {
  try {
    console.log('📢 Calculating marketing analysis...');
    
    // Analyze lead sources as marketing channels
    const sourceAnalysis = await Lead.aggregate([
      { 
        $match: {
          ...baseQuery.lead,
          createdAt: {
            $gte: dateRange.start,
            $lte: dateRange.end
          }
        }
      },
      {
        $group: {
          _id: '$source',
          totalLeads: { $sum: 1 },
          qualifiedLeads: {
            $sum: { 
              $cond: [
                { $in: ['$status', ['Qualified', 'Site Visit Scheduled', 'Site Visit Completed', 'Negotiating', 'Booked']] }, 
                1, 
                0
              ]
            }
          },
          bookedLeads: {
            $sum: { $cond: [{ $eq: ['$status', 'Booked'] }, 1, 0] }
          },
          avgScore: { $avg: '$score' }
        }
      },
      {
        $addFields: {
          qualificationRate: {
            $cond: [
              { $eq: ['$totalLeads', 0] },
              0,
              { $multiply: [{ $divide: ['$qualifiedLeads', '$totalLeads'] }, 100] }
            ]
          },
          conversionRate: {
            $cond: [
              { $eq: ['$totalLeads', 0] },
              0,
              { $multiply: [{ $divide: ['$bookedLeads', '$totalLeads'] }, 100] }
            ]
          }
        }
      },
      { $sort: { conversionRate: -1 } }
    ]);
    
    // Calculate ROI for different sources (simplified)
    const sourceROI = sourceAnalysis.map(source => {
      // Assume different cost per lead for different sources
      const costPerLead = {
        'Website': 500,
        'Property Portal': 800,
        'Social Media': 300,
        'Advertisement': 1000,
        'Referral': 100,
        'Walk-in': 0,
        'Cold Call': 200
      };
      
      const estimatedCost = (costPerLead[source._id] || 500) * source.totalLeads;
      
      // Assume average sale value of 30 lakhs
      const avgSaleValue = 3000000;
      const revenue = source.bookedLeads * avgSaleValue;
      const roi = estimatedCost > 0 ? ((revenue - estimatedCost) / estimatedCost) * 100 : 0;
      
      return {
        ...source,
        estimatedCost,
        estimatedRevenue: revenue,
        roi: Math.round(roi * 100) / 100
      };
    });
    
    return {
      channels: sourceROI,
      summary: {
        totalLeads: sourceAnalysis.reduce((sum, s) => sum + s.totalLeads, 0),
        totalQualified: sourceAnalysis.reduce((sum, s) => sum + s.qualifiedLeads, 0),
        totalBooked: sourceAnalysis.reduce((sum, s) => sum + s.bookedLeads, 0),
        bestPerformingChannel: sourceROI.reduce((best, current) => 
          current.roi > best.roi ? current : best, sourceROI[0] || {}),
        averageROI: sourceROI.length > 0 ? 
          sourceROI.reduce((sum, s) => sum + s.roi, 0) / sourceROI.length : 0
      }
    };
    
  } catch (error) {
    console.error('📢 Marketing analysis error:', error);
    throw error;
  }
};

/**
 * Calculate projections based on current performance
 * @param {Object} baseQuery - Base MongoDB query
 * @param {Object} dateRange - Date range for analysis
 * @param {Object} currentData - Current performance data
 * @returns {Object} Projections
 */
const calculateProjections = async (baseQuery, dateRange, currentData) => {
  try {
    console.log('🔮 Calculating projections...');
    
    const monthsInPeriod = Math.max(1, Math.ceil((dateRange.end - dateRange.start) / (30 * 24 * 60 * 60 * 1000)));
    const currentMonthlyAverage = {
      revenue: currentData.revenue.actual.totalRevenue / monthsInPeriod,
      sales: currentData.sales.actual.totalSales / monthsInPeriod,
      leads: currentData.leads.actual.totalLeads / monthsInPeriod
    };
    
    // Project to end of year
    const monthsRemaining = 12 - monthsInPeriod;
    
    return {
      endOfYear: {
        projectedRevenue: currentData.revenue.actual.totalRevenue + (currentMonthlyAverage.revenue * monthsRemaining),
        projectedSales: currentData.sales.actual.totalSales + (currentMonthlyAverage.sales * monthsRemaining),
        projectedLeads: currentData.leads.actual.totalLeads + (currentMonthlyAverage.leads * monthsRemaining)
      },
      confidence: calculateProjectionConfidence(currentData),
      assumptions: [
        'Current monthly average performance continues',
        'No major market changes',
        'Seasonal variations not considered'
      ]
    };
    
  } catch (error) {
    console.error('🔮 Projection calculation error:', error);
    throw error;
  }
};

/**
 * HELPER: Calculate summary metrics
 * @param {Object} data - All analysis data
 * @returns {Object} Summary metrics
 */
const calculateSummaryMetrics = (data) => {
  const revenueStatus = data.revenue.variance.status;
  const salesStatus = data.sales.variance.status;
  const leadsStatus = data.leads.variance.status;
  
  const overallStatus = 
    (revenueStatus === 'ahead' ? 1 : 0) +
    (salesStatus === 'ahead' ? 1 : 0) +
    (leadsStatus === 'ahead' ? 1 : 0) >= 2 ? 'on_track' : 'needs_attention';
  
  return {
    overallStatus,
    keyMetrics: {
      revenueAchievement: data.revenue.performance.achievementRate,
      salesConversion: data.sales.performance.conversionRate,
      leadQualification: data.leads.performance.qualificationRate
    },
    alerts: generateAlerts(data),
    recommendations: generateRecommendations(data)
  };
};

/**
 * HELPER: Generate alerts based on performance
 * @param {Object} data - Analysis data
 * @returns {Array} Alerts
 */
const generateAlerts = (data) => {
  const alerts = [];
  
  if (data.revenue.variance.percentage < -20) {
    alerts.push({
      type: 'critical',
      category: 'revenue',
      message: `Revenue is ${Math.abs(data.revenue.variance.percentage).toFixed(1)}% below target`,
      impact: 'high'
    });
  }
  
  if (data.sales.variance.status === 'behind' && data.sales.performance.conversionRate < 50) {
    alerts.push({
      type: 'warning',
      category: 'sales',
      message: 'Sales velocity is below expectations',
      impact: 'medium'
    });
  }
  
  if (data.leads.performance.qualificationRate < 20) {
    alerts.push({
      type: 'warning',
      category: 'leads',
      message: 'Lead qualification rate is too low',
      impact: 'medium'
    });
  }
  
  return alerts;
};

/**
 * HELPER: Generate recommendations
 * @param {Object} data - Analysis data
 * @returns {Array} Recommendations
 */
const generateRecommendations = (data) => {
  const recommendations = [];
  
  if (data.revenue.variance.status === 'behind') {
    recommendations.push({
      category: 'revenue',
      action: 'Focus on higher-value units and premium segments',
      priority: 'high',
      estimatedImpact: '15-25% revenue increase'
    });
  }
  
  if (data.marketing && data.marketing.summary.bestPerformingChannel) {
    recommendations.push({
      category: 'marketing',
      action: `Increase investment in ${data.marketing.summary.bestPerformingChannel._id} channel`,
      priority: 'medium',
      estimatedImpact: 'Improve lead quality and ROI'
    });
  }
  
  return recommendations;
};

/**
 * HELPER: Get date range for analysis
 * @param {String} period - Period type
 * @param {Date} startDate - Custom start date
 * @param {Date} endDate - Custom end date
 * @returns {Object} Date range
 */
const getDateRange = (period, startDate, endDate) => {
  const now = new Date();
  
  switch (period) {
    case 'current_year':
      return {
        start: new Date(now.getFullYear(), 0, 1),
        end: now
      };
    case 'last_year':
      return {
        start: new Date(now.getFullYear() - 1, 0, 1),
        end: new Date(now.getFullYear() - 1, 11, 31)
      };
    case 'ytd':
      return {
        start: new Date(now.getFullYear(), 0, 1),
        end: now
      };
    case 'custom':
      return {
        start: new Date(startDate),
        end: new Date(endDate)
      };
    default:
      return {
        start: new Date(now.getFullYear(), 0, 1),
        end: now
      };
  }
};

/**
 * HELPER: Get base query filters
 * @param {String} organizationId - Organization ID
 * @param {String} projectId - Project ID (optional)
 * @param {Object} dateRange - Date range
 * @returns {Object} Base queries
 */
const getBaseQuery = (organizationId, projectId, dateRange) => {
  const baseQuery = {
    project: { organization: new mongoose.Types.ObjectId(organizationId) },
    unit: { organization: new mongoose.Types.ObjectId(organizationId) },
    sale: { organization: new mongoose.Types.ObjectId(organizationId) },
    lead: { organization: new mongoose.Types.ObjectId(organizationId) },
    construction: { organization: new mongoose.Types.ObjectId(organizationId) }
  };
  
  if (projectId) {
    const projectObjectId = new mongoose.Types.ObjectId(projectId);
    baseQuery.project._id = projectObjectId;
    baseQuery.unit.project = projectObjectId;
    baseQuery.sale.project = projectObjectId;
    baseQuery.lead.project = projectObjectId;
    baseQuery.construction.project = projectObjectId;
  }
  
  return baseQuery;
};

/**
 * HELPER: Calculate growth rate from trend data
 * @param {Array} trendData - Monthly trend data
 * @returns {Number} Growth rate percentage
 */
const calculateGrowthRate = (trendData) => {
  if (!trendData || trendData.length < 2) return 0;
  
  const firstValue = trendData[0].value || trendData[0].revenue || trendData[0].salesCount || 0;
  const lastValue = trendData[trendData.length - 1].value || 
                   trendData[trendData.length - 1].revenue || 
                   trendData[trendData.length - 1].salesCount || 0;
  
  if (firstValue === 0) return 0;
  return ((lastValue - firstValue) / firstValue) * 100;
};

/**
 * HELPER: Calculate projection confidence
 * @param {Object} currentData - Current performance data
 * @returns {Number} Confidence percentage
 */
const calculateProjectionConfidence = (currentData) => {
  let confidence = 50; // Base confidence
  
  // Increase confidence based on data quality
  if (currentData.revenue.actual.salesCount > 10) confidence += 20;
  if (currentData.leads.actual.totalLeads > 50) confidence += 15;
  if (Math.abs(currentData.revenue.variance.percentage) < 10) confidence += 15;
  
  return Math.min(100, confidence);
};

// Export main functions
export {
  calculateBudgetVsActual,
  calculateRevenueAnalysis,
  calculateSalesAnalysis,
  calculateLeadAnalysis,
  calculateCostAnalysis,
  calculateProjectWiseAnalysis,
  calculateMarketingAnalysis
};