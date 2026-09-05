// File: routes/voiceRoutes.js
// Description: AI voice agent routes. The provider webhook is UNAUTHENTICATED
//   (registered before `protect`), verified by a shared-secret header, and
//   rate-limited. Everything else requires a valid token and scopes to the org.

import express from 'express';
import rateLimit from 'express-rate-limit';
import { protect, hasPermission, hasAnyPermission } from '../middleware/authMiddleware.js';
import { PERMISSIONS } from '../config/permissions.js';
import {
  providerWebhook,
  createCall,
  listCalls,
  getCallById,
  getSettings,
  updateSettings,
  setupPhoneNumber,
  testCall,
} from '../controllers/voiceController.js';

const router = express.Router();

// ─── UNAUTHENTICATED PROVIDER WEBHOOK (must precede `protect`) ───────────────
const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 600, // tool calls arrive several times per live call
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `${req.params.provider || 'unknown'}_${req.ip}`,
  message: { success: false, message: 'Too many requests', code: 'VOICE_WEBHOOK_RATE_LIMITED' },
});
router.post('/webhooks/:provider', webhookLimiter, express.json({ limit: '5mb' }), providerWebhook);

// ─── EVERYTHING BELOW REQUIRES AUTH ──────────────────────────────────────────
router.use(protect);

router.post('/calls', hasAnyPermission(PERMISSIONS.LEADS.UPDATE, PERMISSIONS.LEADS.CREATE), createCall);
router.get('/calls', hasPermission(PERMISSIONS.LEADS.VIEW), listCalls);
router.get('/calls/:id', hasPermission(PERMISSIONS.LEADS.VIEW), getCallById);

router.get('/settings', hasPermission(PERMISSIONS.LEADS.VIEW), getSettings);
router.put('/settings', hasAnyPermission(PERMISSIONS.USERS.UPDATE, PERMISSIONS.ROLES.UPDATE), updateSettings);
router.post('/setup/phone-number', hasAnyPermission(PERMISSIONS.USERS.UPDATE, PERMISSIONS.ROLES.UPDATE), setupPhoneNumber);
router.post('/test-call', hasAnyPermission(PERMISSIONS.USERS.UPDATE, PERMISSIONS.ROLES.UPDATE, PERMISSIONS.LEADS.CREATE), testCall);

export default router;
