// File: routes/searchRoutes.js
// Global search across org entities. Authenticated; results are org-scoped.

import express from 'express';
import { globalSearch } from '../controllers/searchController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();
router.use(protect);

router.get('/', globalSearch);

export default router;
