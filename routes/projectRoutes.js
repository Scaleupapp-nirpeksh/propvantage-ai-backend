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
import { protect, hasPermission } from '../middleware/authMiddleware.js';
import { PERMISSIONS } from '../config/permissions.js';

const router = express.Router();

router.use(protect);

// @route   /api/projects
router.route('/')
  .post(hasPermission(PERMISSIONS.PROJECTS.CREATE), createProject)
  .get(hasPermission(PERMISSIONS.PROJECTS.VIEW), getProjects);

// @route   /api/projects/:id
router.route('/:id')
  .get(hasPermission(PERMISSIONS.PROJECTS.VIEW), getProjectById)
  .put(hasPermission(PERMISSIONS.PROJECTS.UPDATE), updateProject)
  .delete(hasPermission(PERMISSIONS.PROJECTS.DELETE), deleteProject);

export default router;
