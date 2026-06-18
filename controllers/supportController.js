// File: controllers/supportController.js
// Description: Phase 1 support (email-to-ticket) controller. Everything is scoped
//   to req.user.organization. `ingestTest` stands in for the real provider
//   webhook (Phase 2) and lets an admin/owner exercise the internal loop.

import asyncHandler from 'express-async-handler';
import axios from 'axios';
import SupportTicket from '../models/supportTicketModel.js';
import SupportInbox from '../models/supportInboxModel.js';
import {
  createTicketFromMessage,
  replyToClient as replyToClientSvc,
  addInternalNote as addInternalNoteSvc,
  appendInboundReply,
} from '../services/support/supportService.js';
import { getOrgInbox, regenerateOrgInbox } from '../services/support/supportInboxService.js';
import * as testAdapter from '../services/support/inbound/test.js';
import * as sesAdapter from '../services/support/inbound/ses.js';
import * as mailgunAdapter from '../services/support/inbound/mailgun.js';
import { SES_SUBSCRIPTION_CONFIRMATION } from '../services/support/inbound/ses.js';

const INBOUND_ADAPTERS = {
  test: testAdapter,
  ses: sesAdapter,
  mailgun: mailgunAdapter,
};

// Normalize a recipient address: lowercase + strip a `+tag` from the local-part.
function normalizeRecipient(addr) {
  if (!addr) return null;
  // Handle `"Name" <a@b.com>` forms.
  const m = String(addr).match(/<([^>]+)>/);
  const email = (m ? m[1] : addr).trim().toLowerCase();
  const at = email.indexOf('@');
  if (at < 0) return email;
  const local = email.slice(0, at).split('+')[0];
  return `${local}${email.slice(at)}`;
}

// =============================================================================
// TEST INGESTION (stands in for the provider webhook in Phase 2)
// =============================================================================

/**
 * @desc    Create a ticket from a normalized inbound message (test endpoint)
 * @route   POST /api/support/ingest-test
 * @access  Admin / owner
 */
export const ingestTest = asyncHandler(async (req, res) => {
  // Owner, an org department-head/management tier (roleLevel <= 3), or an explicit
  // support:configure permission may use this seed/test endpoint.
  const isManagement = (req.userRoleLevel ?? 100) <= 3;
  if (!req.isOwner && !isManagement && !(req.userPermissions || []).includes('support:configure')) {
    res.status(403);
    throw new Error('Only an admin or department head may use the test ingestion endpoint');
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
// INBOUND WEBHOOK (UNAUTHENTICATED — provider-abstracted)
// =============================================================================

/**
 * @desc    Ingest an inbound email from a provider webhook.
 * @route   POST /api/support/inbound/:provider
 * @access  Public (signature-verified per provider; never trusts org id in payload)
 *
 * Always responds 2xx for accepted/handled/ignored input so providers don't retry;
 * 4xx only for an unknown provider, a failed signature, or an unparseable body.
 * Never throws to a 5xx on bad input — bad input is logged and answered.
 */
export const inboundEmail = asyncHandler(async (req, res) => {
  const adapter = INBOUND_ADAPTERS[req.params.provider];
  if (!adapter) {
    res.status(404);
    throw new Error('Unknown inbound provider');
  }

  // 1. Verify the provider signature before touching anything.
  let verified = false;
  try {
    verified = await adapter.verify(req);
  } catch (err) {
    console.warn(`⚠️ [inbound] verify threw for ${req.params.provider}:`, err.message);
    verified = false;
  }
  if (!verified) {
    res.status(401);
    throw new Error('Inbound signature verification failed');
  }

  // 2. Normalize (and handle the SES subscription-confirmation handshake).
  let msg;
  try {
    msg = await adapter.normalize(req);
  } catch (err) {
    console.warn(`⚠️ [inbound] normalize threw for ${req.params.provider}:`, err.message);
    msg = null;
  }

  if (msg && msg.__signal === SES_SUBSCRIPTION_CONFIRMATION) {
    try {
      if (msg.subscribeURL) await axios.get(msg.subscribeURL, { timeout: 5000 });
      console.log('✅ [inbound] confirmed SES/SNS subscription');
    } catch (err) {
      console.warn('⚠️ [inbound] SNS subscription confirmation failed:', err.message);
    }
    return res.status(200).json({ success: true, confirmed: true });
  }

  if (!msg || !msg.from) {
    res.status(400);
    throw new Error('Could not parse the inbound message');
  }

  // 3. Route by RECIPIENT only (never trust an org id in the payload).
  const address = normalizeRecipient(msg.to);
  const inbox = address
    ? await SupportInbox.findOne({ address, active: true })
    : null;
  if (!inbox) {
    // Don't drop silently and don't open a ticket in a random org — log + 200.
    console.warn(`⚠️ [inbound] unrouted recipient "${msg.to}" (normalized: "${address}")`);
    return res.status(200).json({ success: true, routed: false });
  }
  const organization = inbox.organization;

  // 4. Dedup: skip a re-delivered message we've already ingested anywhere.
  if (msg.messageId) {
    const dup = await SupportTicket.findOne({
      organization,
      $or: [
        { originalMessageId: msg.messageId },
        { lastInboundMessageId: msg.messageId },
        { 'messages.messageId': msg.messageId },
      ],
    }).select('_id');
    if (dup) {
      return res.status(200).json({ success: true, deduped: true });
    }
  }

  // 5. Thread: subject [TKT-####] OR inReplyTo/references → an existing ticket.
  const existing = await findThreadTicket(organization, msg);

  if (existing) {
    await appendInboundReply(existing._id, msg);
    return res.status(200).json({ success: true, threaded: true });
  }

  await createTicketFromMessage(organization, msg);
  return res.status(200).json({ success: true, created: true });
});

/**
 * Find the ticket an inbound reply belongs to, within an org:
 *  1. subject carries `[TKT-000123]`
 *  2. inReplyTo / references matches a stored messageId (original or any message)
 */
async function findThreadTicket(organization, msg) {
  const subjectMatch = (msg.subject || '').match(/\[(TKT-\d+)\]/i);
  if (subjectMatch) {
    const byDisplay = await SupportTicket.findOne({
      organization,
      displayId: subjectMatch[1].toUpperCase(),
    });
    if (byDisplay) return byDisplay;
  }

  const refIds = [];
  if (msg.inReplyTo) refIds.push(...extractMessageIds(msg.inReplyTo));
  if (msg.references) refIds.push(...extractMessageIds(msg.references));
  if (refIds.length) {
    const byRef = await SupportTicket.findOne({
      organization,
      $or: [
        { originalMessageId: { $in: refIds } },
        { lastInboundMessageId: { $in: refIds } },
        { 'messages.messageId': { $in: refIds } },
      ],
    });
    if (byRef) return byRef;
  }
  return null;
}

// Pull `<id@host>` tokens out of an In-Reply-To / References header value.
function extractMessageIds(value) {
  const out = [];
  const re = /<([^>]+)>/g;
  let m;
  while ((m = re.exec(String(value))) !== null) out.push(m[1]);
  if (!out.length && value) out.push(String(value).trim());
  return out;
}

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

// =============================================================================
// HELPDESK INBOX (the org's public helpdesk address; auto-provisioned)
// =============================================================================

/**
 * @desc    Get the org's helpdesk address (provisions on first read)
 * @route   GET /api/support/inbox
 * @access  Authenticated (any org member — the address is shareable, not secret)
 */
export const getInbox = asyncHandler(async (req, res) => {
  const inbox = await getOrgInbox(req.user.organization);
  res.json({ success: true, data: { address: inbox.address, active: inbox.active } });
});

/**
 * @desc    Regenerate the org's helpdesk address (optionally from a slug)
 * @route   POST /api/support/inbox/regenerate
 * @access  Owner / department-head (roleLevel <= 3)
 */
export const regenerateInbox = asyncHandler(async (req, res) => {
  const isManagement = (req.userRoleLevel ?? 100) <= 3;
  if (!req.isOwner && !isManagement) {
    res.status(403);
    throw new Error('Only an admin or department head may change the helpdesk address');
  }
  const inbox = await regenerateOrgInbox(req.user.organization, req.body?.slug || null);
  res.json({ success: true, data: { address: inbox.address, active: inbox.active } });
});
