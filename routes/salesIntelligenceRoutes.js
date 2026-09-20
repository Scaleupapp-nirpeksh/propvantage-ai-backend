// File: routes/salesIntelligenceRoutes.js
import express from 'express';
import { protect, hasPermission } from '../middleware/authMiddleware.js';
import { PERMISSIONS } from '../config/permissions.js';
import { getSalesIntelligenceReport } from '../controllers/salesIntelligenceController.js';

const router = express.Router();
router.use(protect);
router.get('/', hasPermission(PERMISSIONS.ANALYTICS.ADVANCED), getSalesIntelligenceReport);
export default router;
