// File: routes/leadershipDashboardRoutes.js
// Description: Routes for the Leadership / Promoter / Board Meeting Dashboard

import express from 'express';
import {
  getOverview,
  getProjectComparison,
} from '../controllers/leadershipDashboardController.js';
import { protect, hasPermission } from '../middleware/authMiddleware.js';
import { PERMISSIONS } from '../config/permissions.js';

const router = express.Router();

// All routes require authentication
router.use(protect);

// GET /api/leadership/overview — Org-wide KPIs
router.get(
  '/overview',
  hasPermission(PERMISSIONS.DASHBOARD.LEADERSHIP),
  getOverview
);

// GET /api/leadership/project-comparison — Side-by-side project metrics
router.get(
  '/project-comparison',
  hasPermission(PERMISSIONS.DASHBOARD.LEADERSHIP),
  getProjectComparison
);

export default router;
