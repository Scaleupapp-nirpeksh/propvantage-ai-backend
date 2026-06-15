// File: routes/amenityRoutes.js
// Org-scoped amenity catalog + lead amenity-demand report.

import express from 'express';
import { getAmenities, createAmenity, getAmenityDemand } from '../controllers/amenityController.js';
import { protect, hasPermission } from '../middleware/authMiddleware.js';
import { PERMISSIONS } from '../config/permissions.js';

const router = express.Router();
router.use(protect);

router.get('/demand', hasPermission(PERMISSIONS.LEADS.VIEW), getAmenityDemand);

router.route('/')
  .get(hasPermission(PERMISSIONS.LEADS.VIEW), getAmenities)
  .post(hasPermission(PERMISSIONS.LEADS.CREATE), createAmenity);

export default router;
