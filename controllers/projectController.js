// File: controllers/projectController.js
// Description: Handles the business logic for creating and managing projects.

import asyncHandler from 'express-async-handler';
import Project from '../models/projectModel.js';
import Unit from '../models/unitModel.js';
import Lead from '../models/leadModel.js';
import Sale from '../models/salesModel.js';

/**
 * @desc    Create a new project
 * @route   POST /api/projects
 * @access  Private (Admin/Manager roles)
 */
const createProject = asyncHandler(async (req, res) => {
  const { name, type, totalUnits, targetRevenue } = req.body;

  // Basic validation
  if (!name || !type || !totalUnits || !targetRevenue) {
    res.status(400);
    throw new Error('Name, type, total units, and target revenue are required.');
  }

  const project = new Project({
    ...req.body,
    organization: req.user.organization, // Set organization from logged-in user
  });

  const createdProject = await project.save();
  res.status(201).json({
    success: true,
    data: createdProject,
    message: 'Project created successfully'
  });
});

/**
 * @desc    Get all projects for the user's organization
 * @route   GET /api/projects
 * @access  Private
 */
const getProjects = asyncHandler(async (req, res) => {
  const projects = await Project.find({ organization: req.user.organization });
  
  res.json({
    success: true,
    count: projects.length,
    data: projects
  });
});

/**
 * @desc    Get a single project by ID with its units
 * @route   GET /api/projects/:id
 * @access  Private
 */
const getProjectById = asyncHandler(async (req, res) => {
  const project = await Project.findOne({
    _id: req.params.id,
    organization: req.user.organization,
  });

  if (!project) {
    res.status(404);
    throw new Error('Project not found');
  }

  // Get units for this project
  const units = await Unit.find({ project: req.params.id });
  
  // Get project statistics
  const projectStats = {
    totalUnits: units.length,
    availableUnits: units.filter(unit => unit.status === 'Available').length,
    bookedUnits: units.filter(unit => unit.status === 'Booked').length,
    soldUnits: units.filter(unit => unit.status === 'Sold').length,
  };

  res.json({
    success: true,
    data: {
      ...project.toObject(),
      units,
      statistics: projectStats
    }
  });
});

/**
 * @desc    Update a project
 * @route   PUT /api/projects/:id
 * @access  Private (Manager roles)
 */
const updateProject = asyncHandler(async (req, res) => {
  const project = await Project.findOne({
    _id: req.params.id,
    organization: req.user.organization,
  });

  if (!project) {
    res.status(404);
    throw new Error('Project not found');
  }

  // Validate required fields if they are being updated
  const { name, type, totalUnits, targetRevenue } = req.body;
  
  if (name !== undefined && !name) {
    res.status(400);
    throw new Error('Project name cannot be empty');
  }
  
  if (type !== undefined && !type) {
    res.status(400);
    throw new Error('Project type cannot be empty');
  }
  
  if (totalUnits !== undefined && (!totalUnits || totalUnits < 1)) {
    res.status(400);
    throw new Error('Total units must be greater than 0');
  }
  
  if (targetRevenue !== undefined && (!targetRevenue || targetRevenue < 0)) {
    res.status(400);
    throw new Error('Target revenue must be greater than or equal to 0');
  }

  // Check if totalUnits is being reduced below current unit count
  if (totalUnits !== undefined && totalUnits < project.totalUnits) {
    const currentUnitCount = await Unit.countDocuments({ project: req.params.id });
    if (totalUnits < currentUnitCount) {
      res.status(400);
      throw new Error(`Cannot reduce total units below current unit count (${currentUnitCount}). Please delete excess units first.`);
    }
  }

  // Update project fields
  Object.keys(req.body).forEach(key => {
    if (req.body[key] !== undefined) {
      project[key] = req.body[key];
    }
  });

  // Add update metadata
  project.lastModified = new Date();
  project.lastModifiedBy = req.user._id;

  const updatedProject = await project.save();

  res.json({
    success: true,
    data: updatedProject,
    message: 'Project updated successfully'
  });
});

/**
 * @desc    Delete a project
 * @route   DELETE /api/projects/:id
 * @access  Private (Senior Manager roles only)
 */
const deleteProject = asyncHandler(async (req, res) => {
  const { force } = req.query; // Optional force delete parameter

  const project = await Project.findOne({
    _id: req.params.id,
    organization: req.user.organization,
  });

  if (!project) {
    res.status(404);
    throw new Error('Project not found');
  }

  // Check for dependencies before deletion
  const dependencies = {
    units: await Unit.countDocuments({ project: req.params.id }),
    leads: await Lead.countDocuments({ project: req.params.id }),
    sales: await Sale.countDocuments({ project: req.params.id })
  };

  const totalDependencies = dependencies.units + dependencies.leads + dependencies.sales;

  // If there are dependencies and force is not specified, prevent deletion
  if (totalDependencies > 0 && force !== 'true') {
    res.status(400);
    throw new Error(
      `Cannot delete project. It has ${dependencies.units} units, ${dependencies.leads} leads, and ${dependencies.sales} sales. ` +
      `Delete these records first or use ?force=true to force delete (this will delete all related data).`
    );
  }

  // If force delete is requested, delete all related data
  if (force === 'true' && totalDependencies > 0) {
    // Delete in proper order to maintain referential integrity
    await Sale.deleteMany({ project: req.params.id });
    await Lead.deleteMany({ project: req.params.id });
    await Unit.deleteMany({ project: req.params.id });
    
    console.log(`Force deleted project ${project.name} with ${totalDependencies} related records`);
  }

  // Delete the project
  await Project.findByIdAndDelete(req.params.id);

  res.json({
    success: true,
    message: `Project '${project.name}' deleted successfully`,
    deletedDependencies: force === 'true' ? dependencies : null
  });
});

export { createProject, getProjects, getProjectById, updateProject, deleteProject };