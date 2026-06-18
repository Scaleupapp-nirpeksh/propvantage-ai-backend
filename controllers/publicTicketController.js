// File: controllers/publicTicketController.js
// Description: Unauthenticated public ticket status page API. Serves ONLY public-safe
//   ticket data behind an unguessable token — never internal notes, assignee PII, or
//   org internals. Unknown tokens get a generic 404 (no enumeration leak).

import asyncHandler from 'express-async-handler';
import SupportTicket from '../models/supportTicketModel.js';
import { addPublicClientReply } from '../services/support/supportService.js';

/**
 * Build the client-facing timeline: a leading 'received' status event, then the
 * ticket's PUBLIC messages only. Internal notes (visibility !== 'public') are
 * dropped entirely; outbound author is always "Support team" (never a real name).
 */
function buildTimeline(ticket) {
  const events = [{ type: 'status', at: ticket.createdAt, status: 'received' }];

  for (const m of ticket.messages || []) {
    if (m.visibility !== 'public') continue;
    if (m.direction !== 'inbound' && m.direction !== 'outbound') continue;
    events.push({
      type: 'message',
      direction: m.direction,
      at: m.at,
      // Never expose the real author; the platform speaks as "Support team".
      author: m.direction === 'outbound' ? 'Support team' : undefined,
      body: m.body || '',
    });
  }

  return events.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
}

/**
 * @desc    Public: fetch a ticket's public-safe status + timeline by token
 * @route   GET /api/public/tickets/:token
 * @access  Public
 */
export const getPublicTicket = asyncHandler(async (req, res) => {
  const ticket = await SupportTicket.findOne({ publicToken: req.params.token });
  // Generic 404 — never reveal whether a token exists.
  if (!ticket) {
    res.status(404);
    throw new Error('Ticket not found');
  }

  res.json({ success: true, data: publicShape(ticket) });
});

// Public-safe projection shared by the GET + reply endpoints.
function publicShape(ticket) {
  return {
    displayId: ticket.displayId,
    subject: ticket.subject,
    status: ticket.status,
    category: ticket.category,
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
    timeline: buildTimeline(ticket),
  };
}

/**
 * @desc    Public: client posts a reply on their ticket from the status page
 * @route   POST /api/public/tickets/:token/reply
 * @access  Public (guarded by the unguessable token + rate limiter)
 */
export const postPublicReply = asyncHandler(async (req, res) => {
  const body = (req.body?.body || '').trim();
  if (!body) {
    res.status(400);
    throw new Error('A message is required');
  }
  if (body.length > 5000) {
    res.status(400);
    throw new Error('Message is too long');
  }

  const ticket = await addPublicClientReply(req.params.token, body);
  // Generic 404 — never reveal whether a token exists.
  if (!ticket) {
    res.status(404);
    throw new Error('Ticket not found');
  }

  res.json({ success: true, data: publicShape(ticket) });
});
