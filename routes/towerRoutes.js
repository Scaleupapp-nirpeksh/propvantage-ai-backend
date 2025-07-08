// ===================================================================
// File: routes/towerRoutes.js
// Description: Tower management routes with proper authorization
// ===================================================================

import express from 'express';
import {
  createTower,
  getTowers,
  getTowerById,
  updateTower,
  deleteTower,
  getTowerAnalytics,
  bulkCreateUnits
} from '../controllers/towerController.js';
import { protect, authorize } from '../middleware/authMiddleware.js';

const router = express.Router();

// Apply authentication to all routes
router.use(protect);

// Define role-based access control
const managementRoles = [
  'Business Head',
  'Project Director',
  'Sales Head',
  'Finance Head',
  'Marketing Head',
  'Sales Manager',
  'Finance Manager'
];

const allRoles = [
  'Business Head',
  'Project Director',
  'Sales Head',
  'Finance Head',
  'Marketing Head',
  'Sales Manager',
  'Finance Manager',
  'Channel Partner Manager',
  'Sales Executive',
  'Channel Partner Admin',
  'Channel Partner Agent'
];

// Tower CRUD routes
router.route('/')
  .get(authorize(...allRoles), getTowers)
  .post(authorize(...managementRoles), createTower);

router.route('/:id')
  .get(authorize(...allRoles), getTowerById)
  .put(authorize(...managementRoles), updateTower)
  .delete(authorize(...managementRoles), deleteTower);

// Tower analytics route
router.get('/:id/analytics', authorize(...managementRoles), getTowerAnalytics);

// Bulk operations
router.post('/:id/units/bulk-create', authorize(...managementRoles), bulkCreateUnits);

export default router;