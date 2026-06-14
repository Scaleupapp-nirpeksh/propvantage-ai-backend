// File: controllers/reportInstanceController.js
// Description: Authenticated read endpoints for generated report instances + open-rate analytics.

import asyncHandler from 'express-async-handler';
import ReportInstance from '../models/reportInstanceModel.js';
import ReportView from '../models/reportViewModel.js';

/**
 * @desc    List generated report instances for the org (paginated, newest first)
 * @route   GET /api/reports/instances
 * @access  Private (reports:view)
 */
export const getInstances = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, template } = req.query;
  const query = { organization: req.user.organization };
  if (template) query.template = template;

  const pageNum = Math.max(parseInt(page, 10) || 1, 1);
  const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
  const skip = (pageNum - 1) * limitNum;

  const [instances, total] = await Promise.all([
    ReportInstance.find(query)
      .select('title periodLabel publicSlug gate expiresAt review.status distribution.status stats createdAt template')
      .sort({ createdAt: -1 })
      .limit(limitNum)
      .skip(skip),
    ReportInstance.countDocuments(query),
  ]);

  const totalPages = Math.ceil(total / limitNum);
  res.json({
    success: true,
    data: {
      instances,
      pagination: { total, currentPage: pageNum, totalPages, hasNextPage: pageNum < totalPages, hasPrevPage: pageNum > 1, limit: limitNum },
    },
  });
});

/**
 * @desc    Get a single generated instance (full snapshot, for an internal preview)
 * @route   GET /api/reports/instances/:id
 * @access  Private (reports:view)
 */
export const getInstanceById = asyncHandler(async (req, res) => {
  const instance = await ReportInstance.findOne({ _id: req.params.id, organization: req.user.organization });
  if (!instance) { res.status(404); throw new Error('Report not found'); }
  res.json({ success: true, data: instance });
});

/**
 * @desc    Open-rate analytics for an instance (stats rollup + per-viewer rows)
 * @route   GET /api/reports/instances/:id/analytics
 * @access  Private (reports:view)
 */
export const getInstanceAnalytics = asyncHandler(async (req, res) => {
  const instance = await ReportInstance.findOne({ _id: req.params.id, organization: req.user.organization })
    .select('title stats distribution.recipients publicSlug');
  if (!instance) { res.status(404); throw new Error('Report not found'); }

  const views = await ReportView.find({ reportInstance: instance._id })
    .select('email matchedRecipient isForwarded viewCount firstViewedAt lastViewedAt')
    .sort({ lastViewedAt: -1 })
    .lean();

  res.json({
    success: true,
    data: {
      title: instance.title,
      publicSlug: instance.publicSlug,
      stats: instance.stats,
      recipients: instance.distribution?.recipients || [],
      views,
    },
  });
});
