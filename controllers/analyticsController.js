// File: controllers/analyticsController.js
// Description: Handles complex data aggregation for dashboard and analytics endpoints.

import asyncHandler from 'express-async-handler';
import Sale from '../models/salesModel.js';
import Lead from '../models/leadModel.js';
import Unit from '../models/unitModel.js';
import Project from '../models/projectModel.js';
import User from '../models/userModel.js';
import Interaction from '../models/interactionModel.js';
import mongoose from 'mongoose';

/**
 * @desc    Get a high-level sales summary for the entire organization or a specific project
 * @route   GET /api/analytics/sales-summary
 * @access  Private (Management/Finance roles)
 */
const getSalesSummary = asyncHandler(async (req, res) => {
  const { projectId } = req.query; // Optional query parameter to filter by project

  const query = {
    organization: req.user.organization,
    status: { $ne: 'Cancelled' }, // Exclude cancelled sales
  };

  if (projectId) {
    query.project = projectId;
  }

  // 1. Aggregate total revenue and units sold
  const salesAggregation = await Sale.aggregate([
    { $match: query },
    {
      $group: {
        _id: null,
        totalRevenue: { $sum: '$salePrice' },
        unitsSold: { $sum: 1 },
      },
    },
  ]);

  // 2. Get total available units
  const unitQuery = { organization: req.user.organization };
  if (projectId) {
    unitQuery.project = projectId;
  }
  const totalUnits = await Unit.countDocuments(unitQuery);

  const summary = {
    totalRevenue: salesAggregation[0]?.totalRevenue || 0,
    unitsSold: salesAggregation[0]?.unitsSold || 0,
    totalUnits: totalUnits,
    unitsAvailable: totalUnits - (salesAggregation[0]?.unitsSold || 0),
  };

  res.json(summary);
});

/**
 * @desc    Get a lead funnel analysis (count of leads by status)
 * @route   GET /api/analytics/lead-funnel
 * @access  Private (Management/Sales roles)
 */
const getLeadFunnel = asyncHandler(async (req, res) => {
  const { projectId } = req.query;

  const query = { organization: req.user.organization };
  if (projectId) {
    query.project = projectId;
  }

  const leadFunnel = await Lead.aggregate([
    { $match: query },
    {
      $group: {
        _id: '$status', // Group by the status field
        count: { $sum: 1 },
      },
    },
    {
      $sort: { _id: 1 }, // Sort by status name
    },
  ]);

  // Format the data for easier consumption by frontend charts
  const formattedFunnel = leadFunnel.reduce((acc, item) => {
    acc[item._id] = item.count;
    return acc;
  }, {});

  res.json(formattedFunnel);
});

/**
 * @desc    Get comprehensive sales analytics dashboard data
 * @route   GET /api/analytics/dashboard
 * @access  Private (Management roles)
 */
const getDashboardAnalytics = asyncHandler(async (req, res) => {
  const { period = '30', projectId } = req.query;
  const orgId = req.user.organization;
  
  // Calculate date range based on period
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - parseInt(period));
  
  // Build match conditions
  const matchConditions = {
    organization: orgId,
    createdAt: { $gte: startDate }
  };
  
  if (projectId) {
    matchConditions.project = new mongoose.Types.ObjectId(projectId);
  }

  try {
    // 1. Sales Performance Metrics
    const salesMetrics = await Sale.aggregate([
      { $match: matchConditions },
      {
        $group: {
          _id: null,
          totalSales: { $sum: 1 },
          totalRevenue: { $sum: '$salePrice' },
          averageSalePrice: { $avg: '$salePrice' },
          totalUnitsBooked: { $sum: 1 }
        }
      }
    ]);

    // 2. Lead Performance Metrics
    const leadMetrics = await Lead.aggregate([
      { $match: matchConditions },
      {
        $group: {
          _id: null,
          totalLeads: { $sum: 1 },
          qualifiedLeads: {
            $sum: {
              $cond: [
                { $in: ['$status', ['Qualified', 'Site Visit Scheduled', 'Site Visit Completed', 'Negotiating', 'Booked']] },
                1, 0
              ]
            }
          },
          bookedLeads: {
            $sum: { $cond: [{ $eq: ['$status', 'Booked'] }, 1, 0] }
          }
        }
      }
    ]);

    // 3. Lead Conversion Funnel
    const conversionFunnel = await Lead.aggregate([
      { $match: { organization: orgId } },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      },
      { $sort: { count: -1 } }
    ]);

    // 4. Sales by Project
    const salesByProject = await Sale.aggregate([
      { $match: { organization: orgId } },
      {
        $lookup: {
          from: 'projects',
          localField: 'project',
          foreignField: '_id',
          as: 'projectInfo'
        }
      },
      { $unwind: '$projectInfo' },
      {
        $group: {
          _id: '$project',
          projectName: { $first: '$projectInfo.name' },
          totalSales: { $sum: 1 },
          totalRevenue: { $sum: '$salePrice' },
          averagePrice: { $avg: '$salePrice' }
        }
      },
      { $sort: { totalRevenue: -1 } }
    ]);

    // 5. Monthly Sales Trend
    const monthlySalesTrend = await Sale.aggregate([
      { $match: { organization: orgId } },
      {
        $group: {
          _id: {
            year: { $year: '$bookingDate' },
            month: { $month: '$bookingDate' }
          },
          salesCount: { $sum: 1 },
          revenue: { $sum: '$salePrice' }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } },
      { $limit: 12 } // Last 12 months
    ]);

    // 6. Lead Sources Performance
    const leadSourcesPerformance = await Lead.aggregate([
      { $match: { organization: orgId } },
      {
        $group: {
          _id: '$source',
          totalLeads: { $sum: 1 },
          qualifiedLeads: {
            $sum: {
              $cond: [
                { $in: ['$status', ['Qualified', 'Site Visit Scheduled', 'Site Visit Completed', 'Negotiating', 'Booked']] },
                1, 0
              ]
            }
          },
          bookedLeads: {
            $sum: { $cond: [{ $eq: ['$status', 'Booked'] }, 1, 0] }
          }
        }
      },
      {
        $addFields: {
          conversionRate: {
            $multiply: [
              { $divide: ['$bookedLeads', '$totalLeads'] },
              100
            ]
          }
        }
      },
      { $sort: { totalLeads: -1 } }
    ]);

    // 7. Sales Team Performance
    const teamPerformance = await Sale.aggregate([
      { $match: { organization: orgId } },
      {
        $lookup: {
          from: 'users',
          localField: 'salesPerson',
          foreignField: '_id',
          as: 'salesperson'
        }
      },
      { $unwind: '$salesperson' },
      {
        $group: {
          _id: '$salesPerson',
          salesPersonName: { 
            $first: { 
              $concat: ['$salesperson.firstName', ' ', '$salesperson.lastName'] 
            }
          },
          totalSales: { $sum: 1 },
          totalRevenue: { $sum: '$salePrice' },
          averagePrice: { $avg: '$salePrice' }
        }
      },
      { $sort: { totalRevenue: -1 } }
    ]);

    // 8. Project Inventory Status
    const inventoryStatus = await Unit.aggregate([
      { $match: { organization: orgId } },
      {
        $lookup: {
          from: 'projects',
          localField: 'project',
          foreignField: '_id',
          as: 'projectInfo'
        }
      },
      { $unwind: '$projectInfo' },
      {
        $group: {
          _id: {
            project: '$project',
            status: '$status'
          },
          projectName: { $first: '$projectInfo.name' },
          count: { $sum: 1 }
        }
      },
      {
        $group: {
          _id: '$_id.project',
          projectName: { $first: '$projectName' },
          statusBreakdown: {
            $push: {
              status: '$_id.status',
              count: '$count'
            }
          },
          totalUnits: { $sum: '$count' }
        }
      }
    ]);

    // Compile dashboard data
    const dashboardData = {
      overview: {
        totalSales: salesMetrics[0]?.totalSales || 0,
        totalRevenue: salesMetrics[0]?.totalRevenue || 0,
        averageSalePrice: salesMetrics[0]?.averageSalePrice || 0,
        totalLeads: leadMetrics[0]?.totalLeads || 0,
        qualifiedLeads: leadMetrics[0]?.qualifiedLeads || 0,
        bookedLeads: leadMetrics[0]?.bookedLeads || 0,
        conversionRate: leadMetrics[0]?.totalLeads ? 
          ((leadMetrics[0]?.bookedLeads || 0) / leadMetrics[0].totalLeads * 100).toFixed(2) : 0
      },
      charts: {
        conversionFunnel,
        salesByProject,
        monthlySalesTrend,
        leadSourcesPerformance,
        teamPerformance,
        inventoryStatus
      },
      period: period,
      generatedAt: new Date()
    };

    res.json(dashboardData);
  } catch (error) {
    console.error('Dashboard analytics error:', error);
    res.status(500);
    throw new Error('Failed to generate dashboard analytics');
  }
});

/**
 * @desc    Get detailed sales analytics report
 * @route   GET /api/analytics/sales-report
 * @access  Private (Management roles)
 */
const getSalesReport = asyncHandler(async (req, res) => {
  const { startDate, endDate, projectId, salesPersonId } = req.query;
  const orgId = req.user.organization;
  
  // Build match conditions
  const matchConditions = { organization: orgId };
  
  if (startDate && endDate) {
    matchConditions.bookingDate = {
      $gte: new Date(startDate),
      $lte: new Date(endDate)
    };
  }
  
  if (projectId) {
    matchConditions.project = new mongoose.Types.ObjectId(projectId);
  }
  
  if (salesPersonId) {
    matchConditions.salesPerson = new mongoose.Types.ObjectId(salesPersonId);
  }

  try {
    const salesReport = await Sale.aggregate([
      { $match: matchConditions },
      {
        $lookup: {
          from: 'projects',
          localField: 'project',
          foreignField: '_id',
          as: 'projectInfo'
        }
      },
      {
        $lookup: {
          from: 'units',
          localField: 'unit',
          foreignField: '_id',
          as: 'unitInfo'
        }
      },
      {
        $lookup: {
          from: 'users',
          localField: 'salesPerson',
          foreignField: '_id',
          as: 'salespersonInfo'
        }
      },
      {
        $lookup: {
          from: 'leads',
          localField: 'lead',
          foreignField: '_id',
          as: 'leadInfo'
        }
      },
      { $unwind: '$projectInfo' },
      { $unwind: '$unitInfo' },
      { $unwind: '$salespersonInfo' },
      { $unwind: '$leadInfo' },
      {
        $project: {
          _id: 1,
          bookingDate: 1,
          salePrice: 1,
          discountApplied: 1,
          finalAmount: 1,
          projectName: '$projectInfo.name',
          unitNumber: '$unitInfo.unitNumber',
          unitType: '$unitInfo.unitType',
          salesPersonName: {
            $concat: ['$salespersonInfo.firstName', ' ', '$salespersonInfo.lastName']
          },
          leadSource: '$leadInfo.source',
          customerName: {
            $concat: ['$leadInfo.firstName', ' ', '$leadInfo.lastName']
          },
          paymentStatus: 1,
          createdAt: 1
        }
      },
      { $sort: { bookingDate: -1 } }
    ]);

    // Calculate summary statistics
    const summary = await Sale.aggregate([
      { $match: matchConditions },
      {
        $group: {
          _id: null,
          totalSales: { $sum: 1 },
          totalRevenue: { $sum: '$salePrice' },
          totalDiscount: { $sum: '$discountApplied' },
          averageSalePrice: { $avg: '$salePrice' },
          averageDiscount: { $avg: '$discountApplied' }
        }
      }
    ]);

    res.json({
      summary: summary[0] || {},
      sales: salesReport,
      filters: {
        startDate,
        endDate,
        projectId,
        salesPersonId
      },
      generatedAt: new Date()
    });
  } catch (error) {
    console.error('Sales report error:', error);
    res.status(500);
    throw new Error('Failed to generate sales report');
  }
});



export {
  getSalesSummary,
  getLeadFunnel,
  getDashboardAnalytics,
  getSalesReport
};