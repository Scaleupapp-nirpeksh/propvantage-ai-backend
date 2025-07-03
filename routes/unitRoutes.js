// File: routes/unitRoutes.js
// Description: Defines the API routes for creating units.

import express from 'express';
import { createUnit } from '../controllers/unitController.js';

import { protect, authorize } from '../middleware/authMiddleware.js';

const router = express.Router();

router.use(protect);

const canManageUnitsAccess = [
  'Business Head',
  'Project Director',
];

router.route('/')
  .post(authorize(...canManageUnitsAccess), createUnit);

export default router;
