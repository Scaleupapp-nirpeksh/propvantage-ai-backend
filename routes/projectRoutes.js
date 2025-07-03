// File: routes/projectRoutes.js
// Description: Defines the API routes for creating and managing projects.

import express from 'express';
import {
  createProject,
  getProjects,
  getProjectById,
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

// @route   /api/projects
router.route('/')
  .post(authorize(...canCreateProjectAccess), createProject)
  .get(authorize(...canViewProjectsAccess), getProjects);

// @route   /api/projects/:id
router.route('/:id')
  .get(authorize(...canViewProjectsAccess), getProjectById);

export default router;
