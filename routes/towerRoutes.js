// File: routes/towerRoutes.js
// Description: Tower management routes with permission-based authorization

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
import { protect, hasPermission } from '../middleware/authMiddleware.js';
import { PERMISSIONS } from '../config/permissions.js';

const router = express.Router();

router.use(protect);

// Tower CRUD routes
router.route('/')
  .get(hasPermission(PERMISSIONS.TOWERS.VIEW), getTowers)
  .post(hasPermission(PERMISSIONS.TOWERS.CREATE), createTower);

router.route('/:id')
  .get(hasPermission(PERMISSIONS.TOWERS.VIEW), getTowerById)
  .put(hasPermission(PERMISSIONS.TOWERS.UPDATE), updateTower)
  .delete(hasPermission(PERMISSIONS.TOWERS.DELETE), deleteTower);

// Tower analytics route
router.get('/:id/analytics', hasPermission(PERMISSIONS.TOWERS.ANALYTICS), getTowerAnalytics);

// Bulk operations
router.post('/:id/units/bulk-create', hasPermission(PERMISSIONS.TOWERS.BULK_CREATE_UNITS), bulkCreateUnits);

export default router;
