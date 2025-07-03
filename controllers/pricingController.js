// File: controllers/pricingController.js
// Description: Handles API requests related to pricing, cost sheets, and dynamic price optimization.

import asyncHandler from 'express-async-handler';
import {
  generateCostSheetForUnit,
  calculateDynamicPricingForProject,
} from '../services/pricingService.js';
import Unit from '../models/unitModel.js';
import Project from '../models/projectModel.js';

/**
 * @desc    Generate a cost sheet for a specific unit
 * @route   POST /api/pricing/cost-sheet/:unitId
 * @access  Private
 */
const getCostSheet = asyncHandler(async (req, res) => {
  const { unitId } = req.params;
  const { discountPercentage } = req.body;

  // 1. Verify unit exists and belongs to the user's organization
  const unit = await Unit.findById(unitId);
  if (!unit || unit.organization.toString() !== req.user.organization.toString()) {
    res.status(404);
    throw new Error('Unit not found or you do not have permission to access it.');
  }

  // 2. Call the service to generate the cost sheet
  const costSheet = await generateCostSheetForUnit(unitId, { discountPercentage });

  res.json(costSheet);
});

/**
 * @desc    Get dynamic pricing suggestions for a project
 * @route   GET /api/pricing/dynamic/:projectId
 * @access  Private (Admin/Manager roles)
 */
const getDynamicPricing = asyncHandler(async (req, res) => {
  const { projectId } = req.params;

  // 1. Verify project exists and belongs to the user's organization
  const project = await Project.findById(projectId);
  if (!project || project.organization.toString() !== req.user.organization.toString()) {
    res.status(404);
    throw new Error('Project not found or you do not have permission to access it.');
  }

  // 2. Call the service to calculate suggestions
  const pricingData = await calculateDynamicPricingForProject(projectId);

  res.json(pricingData);
});

export { getCostSheet, getDynamicPricing };
