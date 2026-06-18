// File: routes/publicTicketRoutes.js
// Description: Unauthenticated, rate-limited route for the public ticket status page.
// NO `protect` — access is controlled by the unguessable publicToken. Rate-limited
// by token + IP (mirrors the public report limiter) to throttle token-guessing.

import express from 'express';
import rateLimit from 'express-rate-limit';
import { getPublicTicket, postPublicReply } from '../controllers/publicTicketController.js';

const router = express.Router();

const ticketViewLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 60, // generous: legitimate viewers may refresh/poll; throttles token-guessing
  message: {
    success: false,
    message: 'Too many requests. Please try again later.',
    code: 'TICKET_VIEW_RATE_LIMITED',
    retryAfter: 900,
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `${req.params.token || 'unknown'}_${req.ip}`,
});

// Tighter limiter for client replies (writes) — throttles spam/abuse.
const ticketReplyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  message: {
    success: false,
    message: 'Too many messages. Please try again later.',
    code: 'TICKET_REPLY_RATE_LIMITED',
    retryAfter: 900,
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `${req.params.token || 'unknown'}_${req.ip}`,
});

router.get('/:token', ticketViewLimiter, getPublicTicket);
router.post('/:token/reply', ticketReplyLimiter, express.json({ limit: '64kb' }), postPublicReply);

export default router;
