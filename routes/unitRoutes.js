// File: routes/unitRoutes.js - ENHANCED VERSION
// Description: Enhanced unit routes with statistics and all missing endpoints
// Location: routes/unitRoutes.js

import express from 'express';
import {
  createUnit,
  getUnits,
  getUnitById,
  updateUnit,
  deleteUnit,
  getUnitStatistics
} from '../controllers/unitController.js';
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

// Statistics route (MUST come before /:id route)
router.get('/statistics', authorize(...allRoles), getUnitStatistics);

// Main CRUD routes
router.route('/')
  .get(authorize(...allRoles), getUnits)
  .post(authorize(...managementRoles), createUnit);

router.route('/:id')
  .get(authorize(...allRoles), getUnitById)
  .put(authorize(...managementRoles), updateUnit)
  .delete(authorize(...managementRoles), deleteUnit);

export default router;