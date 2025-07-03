// File: controllers/projectController.js
// Description: Handles the business logic for creating and managing projects.

import asyncHandler from 'express-async-handler';
import Project from '../models/projectModel.js';
import Unit from '../models/unitModel.js';

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
  res.status(201).json(createdProject);
});

/**
 * @desc    Get all projects for the user's organization
 * @route   GET /api/projects
 * @access  Private
 */
const getProjects = asyncHandler(async (req, res) => {
  const projects = await Project.find({ organization: req.user.organization });
  res.json(projects);
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

  if (project) {
    const units = await Unit.find({ project: req.params.id });
    // Combine project details with its units for a complete response
    res.json({ ...project.toObject(), units });
  } else {
    res.status(404);
    throw new Error('Project not found');
  }
});

export { createProject, getProjects, getProjectById };
