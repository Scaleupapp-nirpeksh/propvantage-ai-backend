// File: routes/homeRoutes.js
// Description: Authenticated Home screen routes. The intent router is best-effort
//   and adds no extra permission gate — the data card it returns is run later by
//   the viewer-scoped workspace engine, and actions just navigate.
import express from 'express';
import { protect } from '../middleware/authMiddleware.js';
import { homeIntent } from '../controllers/homeController.js';

const router = express.Router();

router.use(protect);
router.post('/intent', homeIntent);

export default router;
