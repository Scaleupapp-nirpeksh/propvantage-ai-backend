// File: routes/supportRoutes.js
// Description: Authenticated routes for the Phase 1 email-to-ticket support system.
//   All routes require a valid token (protect); handlers scope to the caller's org.

import express from 'express';
import { protect } from '../middleware/authMiddleware.js';
import {
  ingestTest,
  listTickets,
  getTicket,
  replyToClient,
  addNote,
} from '../controllers/supportController.js';

const router = express.Router();

router.use(protect);

// Stands in for the provider webhook (Phase 2) — admin/owner only (enforced in controller).
router.post('/ingest-test', ingestTest);

router.get('/', listTickets);
router.get('/:id', getTicket);
router.post('/:id/reply', replyToClient);
router.post('/:id/note', addNote);

export default router;
