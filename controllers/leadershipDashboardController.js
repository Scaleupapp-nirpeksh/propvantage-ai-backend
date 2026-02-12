// File: controllers/leadershipDashboardController.js
// Description: Controller for the Leadership / Promoter / Board Meeting Dashboard

import asyncHandler from 'express-async-handler';
import {
  getLeadershipOverview,
  getLeadershipProjectComparison,
} from '../services/leadershipDashboardService.js';

/**
 * @desc    Get organization-wide leadership overview KPIs
 * @route   GET /api/leadership/overview
 * @access  Private (dashboard:leadership)
 */
const getOverview = asyncHandler(async (req, res) => {
  const { period = '30', startDate, endDate } = req.query;
  const orgId = req.user.organization;

  // Validate date params
  if ((startDate && !endDate) || (!startDate && endDate)) {
    res.status(400);
    throw new Error('Both startDate and endDate must be provided together');
  }

  const data = await getLeadershipOverview(orgId, period, startDate, endDate);

  res.json({
    success: true,
    data,
    metadata: {
      period: parseInt(period),
      dateRange: data._dateRange,
      generatedAt: new Date(),
    },
  });
});

/**
 * @desc    Get side-by-side project comparison metrics
 * @route   GET /api/leadership/project-comparison
 * @access  Private (dashboard:leadership)
 */
const getProjectComparison = asyncHandler(async (req, res) => {
  const {
    period = '30',
    startDate,
    endDate,
    projectIds,
    sortBy = 'revenue',
  } = req.query;
  const orgId = req.user.organization;

  if ((startDate && !endDate) || (!startDate && endDate)) {
    res.status(400);
    throw new Error('Both startDate and endDate must be provided together');
  }

  const projectIdArray = projectIds
    ? projectIds.split(',').map((id) => id.trim())
    : null;

  const data = await getLeadershipProjectComparison(
    orgId,
    period,
    startDate,
    endDate,
    projectIdArray,
    sortBy
  );

  res.json({
    success: true,
    data,
    metadata: {
      period: parseInt(period),
      dateRange: data._dateRange,
      generatedAt: new Date(),
      projectCount: data.projects.length,
      sortedBy: sortBy,
    },
  });
});

export { getOverview, getProjectComparison };
