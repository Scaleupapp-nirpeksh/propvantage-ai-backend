// File: routes/reportRoutes.js
// Description: Authenticated routes for the Report Builder (Phase 0: catalog only).

import express from 'express';
import { protect, hasPermission } from '../middleware/authMiddleware.js';
import { PERMISSIONS } from '../config/permissions.js';
import { getCatalog } from '../controllers/reportController.js';

const router = express.Router();

router.get('/catalog', protect, hasPermission(PERMISSIONS.REPORTS.MANAGE), getCatalog);

export default router;
