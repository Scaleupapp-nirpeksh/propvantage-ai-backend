// File: routes/unitRoutes.js
// Description: Enhanced unit routes with statistics and all endpoints

import express from 'express';
import {
  createUnit,
  getUnits,
  getUnitById,
  updateUnit,
  deleteUnit,
  getUnitStatistics
} from '../controllers/unitController.js';
import { protect, hasPermission } from '../middleware/authMiddleware.js';
import { PERMISSIONS } from '../config/permissions.js';

const router = express.Router();

router.use(protect);

// Statistics route (MUST come before /:id route)
router.get('/statistics', hasPermission(PERMISSIONS.UNITS.STATISTICS), getUnitStatistics);

// Main CRUD routes
router.route('/')
  .get(hasPermission(PERMISSIONS.UNITS.VIEW), getUnits)
  .post(hasPermission(PERMISSIONS.UNITS.CREATE), createUnit);

router.route('/:id')
  .get(hasPermission(PERMISSIONS.UNITS.VIEW), getUnitById)
  .put(hasPermission(PERMISSIONS.UNITS.UPDATE), updateUnit)
  .delete(hasPermission(PERMISSIONS.UNITS.DELETE), deleteUnit);

export default router;
