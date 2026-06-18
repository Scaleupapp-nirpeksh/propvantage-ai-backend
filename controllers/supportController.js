// File: controllers/supportController.js
// Description: Phase 1 support (email-to-ticket) controller. Everything is scoped
//   to req.user.organization. `ingestTest` stands in for the real provider
//   webhook (Phase 2) and lets an admin/owner exercise the internal loop.

import asyncHandler from 'express-async-handler';
import SupportTicket from '../models/supportTicketModel.js';
import {
  createTicketFromMessage,
  replyToClient as replyToClientSvc,
  addInternalNote as addInternalNoteSvc,
} from '../services/support/supportService.js';

// =============================================================================
// TEST INGESTION (stands in for the provider webhook in Phase 2)
// =============================================================================

/**
 * @desc    Create a ticket from a normalized inbound message (test endpoint)
 * @route   POST /api/support/ingest-test
 * @access  Admin / owner
 */
export const ingestTest = asyncHandler(async (req, res) => {
  if (!req.isOwner && !(req.userPermissions || []).includes('support:configure')) {
    res.status(403);
    throw new Error('Only an admin or owner may use the test ingestion endpoint');
  }

  const { from, fromName, subject, text, html } = req.body;
  if (!from) {
    res.status(400);
    throw new Error('`from` (client email) is required');
  }

  const ticket = await createTicketFromMessage(req.user.organization, {
    from,
    fromName,
    subject,
    text,
    html,
    messageId: `test-${Date.now()}`,
  });

  res.status(201).json({ success: true, data: ticket });
});

// =============================================================================
// LIST / GET
// =============================================================================

/**
 * @desc    List tickets for the org (filterable)
 * @route   GET /api/support
 * @access  Authenticated
 */
export const listTickets = asyncHandler(async (req, res) => {
  const filter = { organization: req.user.organization };
  if (req.query.status) filter.status = req.query.status;
  if (req.query.category) filter.category = req.query.category;
  if (req.query.assignee) filter.assignee = req.query.assignee;

  const tickets = await SupportTicket.find(filter)
    .sort({ createdAt: -1 })
    .populate('assignee', 'firstName lastName email role')
    .populate('linkedTask', 'taskNumber title status');

  res.json({ success: true, count: tickets.length, data: tickets });
});

/**
 * @desc    Get a single ticket (org-scoped)
 * @route   GET /api/support/:id
 * @access  Authenticated
 */
export const getTicket = asyncHandler(async (req, res) => {
  const ticket = await SupportTicket.findOne({
    _id: req.params.id,
    organization: req.user.organization,
  })
    .populate('assignee', 'firstName lastName email role')
    .populate('linkedTask', 'taskNumber title status')
    .populate('messages.authorUser', 'firstName lastName');

  if (!ticket) {
    res.status(404);
    throw new Error('Ticket not found');
  }

  res.json({ success: true, data: ticket });
});

// =============================================================================
// REPLY / NOTE
// =============================================================================

/**
 * @desc    Reply to the client (platform-sent email + public message)
 * @route   POST /api/support/:id/reply
 * @access  Authenticated
 */
export const replyToClient = asyncHandler(async (req, res) => {
  const { body } = req.body;
  if (!body || !body.trim()) {
    res.status(400);
    throw new Error('A reply body is required');
  }

  const exists = await SupportTicket.findOne({
    _id: req.params.id,
    organization: req.user.organization,
  }).select('_id');
  if (!exists) {
    res.status(404);
    throw new Error('Ticket not found');
  }

  const ticket = await replyToClientSvc(req.params.id, req.user._id, body);
  res.json({ success: true, data: ticket });
});

/**
 * @desc    Add an internal-only note (no client email)
 * @route   POST /api/support/:id/note
 * @access  Authenticated
 */
export const addNote = asyncHandler(async (req, res) => {
  const { body } = req.body;
  if (!body || !body.trim()) {
    res.status(400);
    throw new Error('A note body is required');
  }

  const exists = await SupportTicket.findOne({
    _id: req.params.id,
    organization: req.user.organization,
  }).select('_id');
  if (!exists) {
    res.status(404);
    throw new Error('Ticket not found');
  }

  const ticket = await addInternalNoteSvc(req.params.id, req.user._id, body);
  res.json({ success: true, data: ticket });
});
