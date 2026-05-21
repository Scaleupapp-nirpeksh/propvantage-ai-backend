// File: controllers/channelPartnerAnalyticsController.js
// Description: Web endpoints for Channel Partner analytics. Thin wrappers over
//   services/channelPartnerAnalyticsService.js.

import asyncHandler from 'express-async-handler';
import mongoose from 'mongoose';
import { projectAccessFilter, verifyProjectAccess } from '../utils/projectAccessHelper.js';
import {
  getVolumeBreakdown,
  getCommissionBreakdown,
} from '../services/channelPartnerAnalyticsService.js';

// Resolve query params into { organization, projectFilter, startDate, endDate }.
const resolveScope = (req, res) => {
  const organization = req.user.organization;

  // Date range — explicit ISO params, else default to start-of-year → now.
  let startDate = null;
  let endDate = null;
  const hasFrom = req.query.dateFrom !== undefined && req.query.dateFrom !== '';
  const hasTo   = req.query.dateTo   !== undefined && req.query.dateTo   !== '';
  if (hasFrom !== hasTo) {
    res.status(400);
    throw new Error('Provide both dateFrom and dateTo, or neither');
  }
  if (hasFrom && hasTo) {
    const from = new Date(req.query.dateFrom);
    const to   = new Date(req.query.dateTo);
    if (isNaN(from.getTime()) || isNaN(to.getTime())) {
      res.status(400);
      throw new Error('Invalid dateFrom/dateTo — expected ISO date strings');
    }
    startDate = from;
    endDate   = to;
  } else {
    const now = new Date();
    startDate = new Date(now.getFullYear(), 0, 1);
    endDate   = now;
  }

  // Project scope — start from the access filter; narrow if a valid project given.
  let projectFilter = projectAccessFilter(req);
  const { project } = req.query;
  if (project && project !== 'all' && mongoose.isValidObjectId(project)) {
    verifyProjectAccess(req, res, project); // throws 403 if not allowed
    projectFilter = { project: new mongoose.Types.ObjectId(project) };
  }

  return { organization, projectFilter, startDate, endDate };
};

// @route GET /api/analytics/channel-partners/volume
export const getChannelPartnerVolumeAnalytics = asyncHandler(async (req, res) => {
  const scope = resolveScope(req, res);
  const data = await getVolumeBreakdown(scope);
  res.json({ success: true, data });
});

// @route GET /api/analytics/channel-partners/commission
export const getChannelPartnerCommissionAnalytics = asyncHandler(async (req, res) => {
  const scope = resolveScope(req, res);
  const data = await getCommissionBreakdown(scope);
  res.json({ success: true, data });
});
