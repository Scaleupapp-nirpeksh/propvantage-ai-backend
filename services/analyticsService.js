// File: services/analyticsService.js
// Description: Service for advanced analytics calculations and data processing

import Lead from '../models/leadModel.js';
import Sale from '../models/saleModel.js';
import Project from '../models/projectModel.js';
import Unit from '../models/unitModel.js';
import Interaction from '../models/interactionModel.js';
import mongoose from 'mongoose';

/**
 * Calculates advanced lead conversion metrics
 * @param {string} organizationId - Organization ID
 * @param {Object} filters - Optional filters (dateRange, projectId, etc.)
 * @returns {Object} Lead conversion analytics
 */
const calculateLeadConversionMetrics = async (organizationId, filters = {}) => {
  try {
    const matchConditions = { organization: organizationId };
    
    // Apply date filters if provided
    if (filters.startDate && filters.endDate) {
      matchConditions.createdAt = {
        $gte: new Date(filters.startDate),
        $lte: new Date(filters.endDate)
      };
    }
    
    if (filters.projectId) {
      matchConditions.project = new mongoose.Types.ObjectId(filters.projectId);
    }

    // Calculate conversion metrics with detailed breakdown
    const conversionMetrics = await Lead.aggregate([
      { $match: matchConditions },
      {
        $facet: {
          // Overall conversion funnel
          overallFunnel: [
            {
              $group: {
                _id: '$status',
                count: { $sum: 1 },
                avgBudget: { $avg: { $avg: ['$budget.min', '$budget.max'] } }
              }
            },
            { $sort: { count: -1 } }
          ],
          
          // Source-wise conversion
          sourceConversion: [
            {
              $group: {
                _id: {
                  source: '$source',
                  status: '$status'
                },
                count: { $sum: 1 }
              }
            },
            {
              $group: {
                _id: '$_id.source',
                statusBreakdown: {
                  $push: {
                    status: '$_id.status',
                    count: '$count'
                  }
                },
                totalLeads: { $sum: '$count' }
              }
            }
          ],
          
          // Time-based conversion trends
          timeBasedConversion: [
            {
              $group: {
                _id: {
                  year: { $year: '$createdAt' },
                  month: { $month: '$createdAt' },
                  status: '$status'
                },
                count: { $sum: 1 }
              }
            },
            { $sort: { '_id.year': 1, '_id.month': 1 } }
          ],
          
          // Lead scoring analysis
          leadScoring: [
            {
              $bucket: {
                groupBy: '$score',
                boundaries: [0, 20, 40, 60, 80, 100],
                default: 'other',
                output: {
                  count: { $sum: 1 },
                  avgConversionRate: {
                    $avg: {
                      $cond: [
                        { $eq: ['$status', 'Booked'] },
                        1, 0
                      ]
                    }
                  }
                }
              }
            }
          ]
        }
      }
    ]);

    return conversionMetrics[0];
  } catch (error) {
    console.error('Lead conversion metrics calculation error:', error);
    throw new Error('Failed to calculate lead conversion metrics');
  }
};

/**
 * Calculates sales performance metrics with trends
 * @param {string} organizationId - Organization ID
 * @param {Object} filters - Optional filters
 * @returns {Object} Sales performance analytics
 */
const calculateSalesPerformanceMetrics = async (organizationId, filters = {}) => {
  try {
    const matchConditions = { organization: organizationId };
    
    if (filters.startDate && filters.endDate) {
      matchConditions.bookingDate = {
        $gte: new Date(filters.startDate),
        $lte: new Date(filters.endDate)
      };
    }

    const salesMetrics = await Sale.aggregate([
      { $match: matchConditions },
      {
        $facet: {
          // Monthly sales trends
          monthlySales: [
            {
              $group: {
                _id: {
                  year: { $year: '$bookingDate' },
                  month: { $month: '$bookingDate' }
                },
                totalSales: { $sum: 1 },
                totalRevenue: { $sum: '$salePrice' },
                averagePrice: { $avg: '$salePrice' },
                totalDiscount: { $sum: '$discountApplied' }
              }
            },
            { $sort: { '_id.year': 1, '_id.month': 1 } }
          ],
          
          // Sales by unit type
          unitTypeSales: [
            {
              $lookup: {
                from: 'units',
                localField: 'unit',
                foreignField: '_id',
                as: 'unitInfo'
              }
            },
            { $unwind: '$unitInfo' },
            {
              $group: {
                _id: '$unitInfo.unitType',
                totalSales: { $sum: 1 },
                totalRevenue: { $sum: '$salePrice' },
                averagePrice: { $avg: '$salePrice' }
              }
            },
            { $sort: { totalRevenue: -1 } }
          ],
          
          // Payment status analysis
          paymentAnalysis: [
            {
              $group: {
                _id: '$paymentStatus',
                count: { $sum: 1 },
                totalAmount: { $sum: '$salePrice' }
              }
            }
          ],
          
          // Discount impact analysis
          discountAnalysis: [
            {
              $group: {
                _id: {
                  $switch: {
                    branches: [
                      { case: { $eq: ['$discountApplied', 0] }, then: 'No Discount' },
                      { case: { $lte: ['$discountApplied', 50000] }, then: 'Low Discount' },
                      { case: { $lte: ['$discountApplied', 100000] }, then: 'Medium Discount' },
                      { case: { $gt: ['$discountApplied', 100000] }, then: 'High Discount' }
                    ],
                    default: 'Other'
                  }
                },
                count: { $sum: 1 },
                averageDiscount: { $avg: '$discountApplied' },
                totalRevenue: { $sum: '$salePrice' }
              }
            }
          ]
        }
      }
    ]);

    return salesMetrics[0];
  } catch (error) {
    console.error('Sales performance metrics calculation error:', error);
    throw new Error('Failed to calculate sales performance metrics');
  }
};

/**
 * Calculates project performance analytics
 * @param {string} organizationId - Organization ID
 * @param {string} projectId - Optional specific project ID
 * @returns {Object} Project performance analytics
 */
const calculateProjectPerformanceMetrics = async (organizationId, projectId = null) => {
  try {
    const matchConditions = { organization: organizationId };
    
    if (projectId) {
      matchConditions._id = new mongoose.Types.ObjectId(projectId);
    }

    const projectMetrics = await Project.aggregate([
      { $match: matchConditions },
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
          localField: '_id',
          foreignField: 'project',
          as: 'sales'
        }
      },
      {
        $lookup: {
          from: 'leads',
          localField: '_id',
          foreignField: 'project',
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
          availableUnits: {
            $size: {
              $filter: {
                input: '$units',
                cond: { $eq: ['$$this.status', 'available'] }
              }
            }
          },
          totalSales: { $size: '$sales' },
          totalRevenue: { $sum: '$sales.salePrice' },
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
        $addFields: {
          salesRatio: {
            $cond: [
              { $eq: ['$totalUnits', 0] },
              0,
              { $divide: ['$soldUnits', '$totalUnits'] }
            ]
          },
          revenueProgress: {
            $cond: [
              { $eq: ['$targetRevenue', 0] },
              0,
              { $divide: ['$totalRevenue', '$targetRevenue'] }
            ]
          },
          leadConversionRate: {
            $cond: [
              { $eq: ['$totalLeads', 0] },
              0,
              { $divide: ['$qualifiedLeads', '$totalLeads'] }
            ]
          }
        }
      },
      {
        $project: {
          name: 1,
          type: 1,
          status: 1,
          targetRevenue: 1,
          totalUnits: 1,
          soldUnits: 1,
          availableUnits: 1,
          totalSales: 1,
          totalRevenue: 1,
          totalLeads: 1,
          qualifiedLeads: 1,
          salesRatio: 1,
          revenueProgress: 1,
          leadConversionRate: 1,
          createdAt: 1
        }
      }
    ]);

    return projectMetrics;
  } catch (error) {
    console.error('Project performance metrics calculation error:', error);
    throw new Error('Failed to calculate project performance metrics');
  }
};

/**
 * Calculates team performance metrics
 * @param {string} organizationId - Organization ID
 * @param {Object} filters - Optional filters
 * @returns {Object} Team performance analytics
 */
const calculateTeamPerformanceMetrics = async (organizationId, filters = {}) => {
  try {
    const matchConditions = { organization: organizationId };
    
    if (filters.startDate && filters.endDate) {
      matchConditions.createdAt = {
        $gte: new Date(filters.startDate),
        $lte: new Date(filters.endDate)
      };
    }

    const teamMetrics = await Sale.aggregate([
      { $match: matchConditions },
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
          role: { $first: '$salesperson.role' },
          totalSales: { $sum: 1 },
          totalRevenue: { $sum: '$salePrice' },
          averageSalePrice: { $avg: '$salePrice' },
          totalDiscount: { $sum: '$discountApplied' },
          averageDiscount: { $avg: '$discountApplied' }
        }
      },
      {
        $lookup: {
          from: 'leads',
          let: { salesPersonId: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ['$assignedTo', '$$salesPersonId'] },
                    { $eq: ['$organization', organizationId] }
                  ]
                }
              }
            }
          ],
          as: 'assignedLeads'
        }
      },
      {
        $addFields: {
          totalAssignedLeads: { $size: '$assignedLeads' },
          conversionRate: {
            $cond: [
              { $eq: [{ $size: '$assignedLeads' }, 0] },
              0,
              { $divide: ['$totalSales', { $size: '$assignedLeads' }] }
            ]
          }
        }
      },
      {
        $project: {
          salesPersonName: 1,
          role: 1,
          totalSales: 1,
          totalRevenue: 1,
          averageSalePrice: 1,
          totalDiscount: 1,
          averageDiscount: 1,
          totalAssignedLeads: 1,
          conversionRate: 1
        }
      },
      { $sort: { totalRevenue: -1 } }
    ]);

    return teamMetrics;
  } catch (error) {
    console.error('Team performance metrics calculation error:', error);
    throw new Error('Failed to calculate team performance metrics');
  }
};

export {
  calculateLeadConversionMetrics,
  calculateSalesPerformanceMetrics,
  calculateProjectPerformanceMetrics,
  calculateTeamPerformanceMetrics
};