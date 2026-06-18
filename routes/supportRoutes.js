// File: routes/supportRoutes.js
// Description: Routes for the email-to-ticket support system.
//   The inbound provider webhook (POST /inbound/:provider) is UNAUTHENTICATED — it
//   is registered BEFORE `router.use(protect)` so the auth gate never applies to it;
//   it is signature-verified per provider, rate-limited, and body-size capped.
//   Every other route requires a valid token (protect) and scopes to the caller's org.

import express from 'express';
import rateLimit from 'express-rate-limit';
import { protect } from '../middleware/authMiddleware.js';
import {
  inboundEmail,
  ingestTest,
  listTickets,
  getTicket,
  replyToClient,
  addNote,
} from '../controllers/supportController.js';

const router = express.Router();

// ─── UNAUTHENTICATED INBOUND WEBHOOK (must precede `protect`) ────────────────
// Rate-limit by provider + IP to throttle abuse; cap the body since providers POST
// raw email. Verification + routing happen in the controller.
const inboundLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 120,
  message: {
    success: false,
    message: 'Too many requests. Please try again later.',
    code: 'INBOUND_RATE_LIMITED',
    retryAfter: 900,
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `${req.params.provider || 'unknown'}_${req.ip}`,
});

// Body-size cap for inbound payloads (raw MIME / form fields).
const inboundBodyCap = [
  express.json({ limit: '1mb', type: ['application/json', 'text/plain'] }),
  express.urlencoded({ extended: true, limit: '1mb' }),
];

router.post('/inbound/:provider', inboundLimiter, ...inboundBodyCap, inboundEmail);

// ─── EVERYTHING BELOW REQUIRES AUTH ──────────────────────────────────────────
router.use(protect);

// Stands in for the provider webhook (Phase 2) — admin/owner only (enforced in controller).
router.post('/ingest-test', ingestTest);

router.get('/', listTickets);
router.get('/:id', getTicket);
router.post('/:id/reply', replyToClient);
router.post('/:id/note', addNote);

export default router;
