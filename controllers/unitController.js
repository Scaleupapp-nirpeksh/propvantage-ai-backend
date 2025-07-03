// File: controllers/unitController.js
// Description: Handles the business logic for creating and managing units within a project.

import asyncHandler from 'express-async-handler';
import Unit from '../models/unitModel.js';
import Project from '../models/projectModel.js';

/**
 * @desc    Create a new unit for a project
 * @route   POST /api/units
 * @access  Private (Project Director/Admin roles)
 */
const createUnit = asyncHandler(async (req, res) => {
  const { project, unitNumber, type, floor, areaSqft, basePrice } = req.body;

  // 1. Validate input
  if (!project || !unitNumber || !type || !floor || !areaSqft || !basePrice) {
    res.status(400);
    throw new Error('All unit fields are required.');
  }

  // 2. Verify the project exists and belongs to the user's organization
  const projectExists = await Project.findOne({
    _id: project,
    organization: req.user.organization,
  });

  if (!projectExists) {
    res.status(404);
    throw new Error('Project not found or you do not have permission to access it.');
  }

  // 3. Create the unit
  const unit = new Unit({
    ...req.body,
    organization: req.user.organization,
    currentPrice: basePrice, // Initially, current price is the same as base price
  });

  const createdUnit = await unit.save();
  res.status(201).json(createdUnit);
});

export { createUnit };
