// File: controllers/reportTemplateController.js
// Description: CRUD + ad-hoc generation for report templates (Leadership Report Builder).

import asyncHandler from 'express-async-handler';
import ReportTemplate from '../models/reportTemplateModel.js';
import { validateTemplatePayload } from '../services/reports/templateValidation.js';
import { generateInstance } from '../services/reports/snapshotService.js';

/**
 * @desc    List report templates for the org (paginated)
 * @route   GET /api/reports/templates
 * @access  Private (reports:view)
 */
export const getTemplates = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, status, sortBy = 'updatedAt', sortOrder = 'desc' } = req.query;
  const query = { organization: req.user.organization };
  if (status) query.status = status;

  const pageNum = Math.max(parseInt(page, 10) || 1, 1);
  const limitNum = Math.max(parseInt(limit, 10) || 20, 1);
  const skip = (pageNum - 1) * limitNum;

  const [templates, total] = await Promise.all([
    ReportTemplate.find(query)
      .sort({ [sortBy]: sortOrder === 'asc' ? 1 : -1 })
      .limit(limitNum)
      .skip(skip),
    ReportTemplate.countDocuments(query),
  ]);

  const totalPages = Math.ceil(total / limitNum);
  res.json({
    success: true,
    data: {
      templates,
      pagination: {
        total, currentPage: pageNum, totalPages,
        hasNextPage: pageNum < totalPages, hasPrevPage: pageNum > 1, limit: limitNum,
      },
    },
  });
});

/**
 * @desc    Get a single report template
 * @route   GET /api/reports/templates/:id
 * @access  Private (reports:view)
 */
export const getTemplateById = asyncHandler(async (req, res) => {
  const template = await ReportTemplate.findOne({
    _id: req.params.id,
    organization: req.user.organization,
  });
  if (!template) { res.status(404); throw new Error('Report template not found'); }
  res.json({ success: true, data: template });
});

/**
 * @desc    Create a report template
 * @route   POST /api/reports/templates
 * @access  Private (reports:manage)
 */
export const createTemplate = asyncHandler(async (req, res) => {
  const { valid, errors } = validateTemplatePayload(req.body, { partial: false });
  if (!valid) { res.status(400); throw new Error(`Validation error: ${errors.join('; ')}`); }

  const template = await ReportTemplate.create({
    ...req.body,
    organization: req.user.organization,
    createdBy: req.user._id,
    updatedBy: req.user._id,
  });
  res.status(201).json({ success: true, data: template, message: 'Report template created' });
});

/**
 * @desc    Update a report template
 * @route   PUT /api/reports/templates/:id
 * @access  Private (reports:manage)
 */
export const updateTemplate = asyncHandler(async (req, res) => {
  const { valid, errors } = validateTemplatePayload(req.body, { partial: true });
  if (!valid) { res.status(400); throw new Error(`Validation error: ${errors.join('; ')}`); }

  const template = await ReportTemplate.findOne({
    _id: req.params.id,
    organization: req.user.organization,
  });
  if (!template) { res.status(404); throw new Error('Report template not found'); }

  // Apply only provided fields; never let the client move the doc to another org or spoof createdBy.
  const immutable = new Set(['organization', 'createdBy', '_id', 'createdAt', 'updatedAt']);
  Object.keys(req.body).forEach((key) => {
    if (!immutable.has(key) && req.body[key] !== undefined) template[key] = req.body[key];
  });
  template.updatedBy = req.user._id;

  const updated = await template.save();
  res.json({ success: true, data: updated, message: 'Report template updated' });
});

/**
 * @desc    Delete a report template
 * @route   DELETE /api/reports/templates/:id
 * @access  Private (reports:manage)
 */
export const deleteTemplate = asyncHandler(async (req, res) => {
  const template = await ReportTemplate.findOne({
    _id: req.params.id,
    organization: req.user.organization,
  });
  if (!template) { res.status(404); throw new Error('Report template not found'); }
  await ReportTemplate.deleteOne({ _id: template._id });
  res.json({ success: true, message: `Report template '${template.name}' deleted` });
});

/**
 * @desc    Generate a report instance now (ad-hoc / preview) from a template
 * @route   POST /api/reports/templates/:id/generate
 * @access  Private (reports:manage)
 */
export const generateTemplateInstance = asyncHandler(async (req, res) => {
  const template = await ReportTemplate.findOne({
    _id: req.params.id,
    organization: req.user.organization,
  });
  if (!template) { res.status(404); throw new Error('Report template not found'); }

  const instance = await generateInstance(template, {
    createdBy: req.user._id,
    accessibleProjectIds: req.accessibleProjectIds,
  });
  res.status(201).json({ success: true, data: instance, message: 'Report generated' });
});
