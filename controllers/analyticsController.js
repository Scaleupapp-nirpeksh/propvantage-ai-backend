// File: controllers/analyticsController.js
// Description: Handles complex data aggregation for dashboard and analytics endpoints.

import asyncHandler from 'express-async-handler';
import Sale from '../models/salesModel.js';
import Lead from '../models/leadModel.js';
import Unit from '../models/unitModel.js';
import Project from '../models/projectModel.js';

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

export { getSalesSummary, getLeadFunnel };
