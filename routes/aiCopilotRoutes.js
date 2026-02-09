// File: routes/aiCopilotRoutes.js
// Description: Route definition for AI Copilot chat endpoint

import express from 'express';
import { copilotChat } from '../controllers/aiCopilotController.js';
import { protect } from '../middleware/authMiddleware.js';
import copilotRateLimiter from '../middleware/copilotRateLimit.js';

const router = express.Router();

// Apply auth middleware to all copilot routes
router.use(protect);

// POST /api/ai/copilot/chat — Natural language query interface
router.post('/chat', copilotRateLimiter, copilotChat);

export default router;
