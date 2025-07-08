// File: routes/projectRoutes.js
// Description: Defines the API routes for creating and managing projects.

import express from 'express';
import {
  createProject,
  getProjects,
  getProjectById,
  updateProject,
  deleteProject,
} from '../controllers/projectController.js';

// Import the security middleware
import { protect, authorize } from '../middleware/authMiddleware.js';

const router = express.Router();

// Apply the 'protect' middleware to all routes in this file
router.use(protect);

// Define roles that can create projects
const canCreateProjectAccess = [
  'Business Head',
  'Project Director',
];

// Define roles that can view projects (broader access)
const canViewProjectsAccess = [
  'Business Head',
  'Sales Head',
  'Marketing Head',
  'Finance Head',
  'Project Director',
  'Sales Manager',
  'Finance Manager',
  'Channel Partner Manager',
  'Sales Executive',
];

// Define roles that can update projects
const canUpdateProjectAccess = [
  'Business Head',
  'Project Director',
  'Sales Head',
  'Marketing Head',
];

// Define roles that can delete projects (most restrictive)
const canDeleteProjectAccess = [
  'Business Head',
  'Project Director',
];

// @route   /api/projects
router.route('/')
  .post(authorize(...canCreateProjectAccess), createProject)
  .get(authorize(...canViewProjectsAccess), getProjects);

// @route   /api/projects/:id
router.route('/:id')
  .get(authorize(...canViewProjectsAccess), getProjectById)
  .put(authorize(...canUpdateProjectAccess), updateProject)
  .delete(authorize(...canDeleteProjectAccess), deleteProject);

export default router;