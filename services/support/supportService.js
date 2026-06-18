// File: services/support/supportService.js
// Description: Phase 1 support (email-to-ticket) service. Pure functions over the
//   DB + email + notifications. A ticket is opened from a normalized inbound
//   message, auto-assigned to a department head, linked to a Task, the client is
//   auto-replied to, and internal agents can reply-to-client / add internal notes.
//   Every side-effect (email, notifications) is best-effort and logged so ticket
//   creation never fails because email/notification failed.

import User from '../../models/userModel.js';
import Task from '../../models/taskModel.js';
import SupportTicket from '../../models/supportTicketModel.js';
import { sendEmail } from '../../utils/emailService.js';
import { createNotification } from '../notificationService.js';
import { autoReplyEmail, clientReplyEmail, statusUpdateEmail } from './supportEmails.js';

// ─── ROUTING CONFIG ──────────────────────────────────────────────

const CATEGORY_TO_ROLE = {
  sales: 'Sales Head',
  legal: 'Legal Head',
  crm: 'CRM Head',
  finance: 'Finance Head',
};

const FALLBACK_ROLES = ['CRM Head', 'Business Head'];

// Task category for ticket-created tasks (must be a valid TASK_CATEGORIES value).
const TICKET_TASK_CATEGORY = 'Customer Service';

const KNOWN_CATEGORIES = ['sales', 'legal', 'crm', 'finance'];

// ─── PUBLIC STATUS LINK ──────────────────────────────────────────

/**
 * Build the client-facing public status link for a ticket: `<base>/t/<token>`.
 * base = PUBLIC_TICKET_BASE_URL, else the first CLIENT_URL origin, else ''.
 */
function publicTicketLink(ticket) {
  const base =
    process.env.PUBLIC_TICKET_BASE_URL ||
    (process.env.CLIENT_URL || '').split(',')[0] ||
    '';
  return ticket?.publicToken ? `${base}/t/${ticket.publicToken}` : '';
}

// ─── HELPERS ─────────────────────────────────────────────────────

/**
 * Parse a category from the subject's leading token before a '-' or ':'.
 * e.g. 'Legal - clause 4' → 'legal', 'sales: pricing' → 'sales', 'hi' → 'other'.
 */
export function parseCategory(subject) {
  if (!subject || typeof subject !== 'string') return 'other';
  const match = subject.match(/^\s*([^-:]+)\s*[-:]/);
  if (!match) return 'other';
  const token = match[1].trim().toLowerCase();
  // Match the leading word against known categories (handles 'legal issue').
  const firstWord = token.split(/\s+/)[0];
  if (KNOWN_CATEGORIES.includes(token)) return token;
  if (KNOWN_CATEGORIES.includes(firstWord)) return firstWord;
  return 'other';
}

/**
 * Resolve the department head user for a category in an org. Tries the mapped
 * role first, then the fallback roles in order. Returns the User or null.
 */
export async function resolveAssignee(orgId, category) {
  const tryRoles = [];
  if (CATEGORY_TO_ROLE[category]) tryRoles.push(CATEGORY_TO_ROLE[category]);
  for (const r of FALLBACK_ROLES) {
    if (!tryRoles.includes(r)) tryRoles.push(r);
  }

  // Match the role whether it's set as the legacy `role` string OR via roleRef
  // (the dynamic role doc's name) — so assignment works however the org set it.
  const users = await User.find({ organization: orgId, isActive: true }).populate('roleRef', 'name');
  for (const role of tryRoles) {
    const user = users.find((u) => u.role === role || u.roleRef?.name === role);
    if (user) return user;
  }
  return null;
}

/**
 * Find the org owner / highest-level user to use as a system task creator.
 * Task.createdBy is required, so we need a real user when no assignee exists.
 */
async function getSystemUser(orgId) {
  const owner = await User.findOne({ organization: orgId, isActive: true })
    .populate('roleRef', 'level isOwnerRole')
    .sort({ 'roleRef.level': 1 });
  return owner?._id || null;
}

// ─── CORE: CREATE TICKET FROM A NORMALIZED INBOUND MESSAGE ────────

/**
 * Open a ticket from a normalized inbound message.
 * @param {string|ObjectId} orgId
 * @param {{ from: string, fromName?: string, subject?: string, text?: string,
 *           html?: string, messageId?: string }} msg
 * @returns {Promise<SupportTicket>} the populated ticket
 */
export async function createTicketFromMessage(orgId, msg) {
  const now = new Date();
  const category = parseCategory(msg.subject);
  const { ticketNumber, displayId } = await SupportTicket.mintTicketNumber(orgId);
  const assignee = await resolveAssignee(orgId, category);

  // 1. Create the ticket with the inbound message.
  const ticket = await SupportTicket.create({
    organization: orgId,
    ticketNumber,
    displayId,
    category,
    subject: msg.subject,
    status: assignee ? 'assigned' : 'new',
    client: { email: msg.from, name: msg.fromName },
    source: 'email',
    originalMessageId: msg.messageId,
    lastInboundMessageId: msg.messageId,
    assignee: assignee?._id,
    messages: [
      {
        direction: 'inbound',
        visibility: 'public',
        from: msg.from,
        body: msg.text,
        html: msg.html,
        at: now,
      },
    ],
  });

  // 2. Create the linked internal Task. createdBy is required → fall back to a
  //    system user when there is no assignee.
  const createdBy = assignee?._id || (await getSystemUser(orgId));
  const truncatedDesc = (msg.text || '').substring(0, 5000);
  const task = await Task.create({
    title: `${displayId}: ${msg.subject || '(no subject)'}`.substring(0, 300),
    description: truncatedDesc,
    category: TICKET_TASK_CATEGORY,
    source: 'support_ticket',
    organization: orgId,
    assignedTo: assignee?._id,
    assignedBy: assignee?._id || createdBy,
    assignmentType: 'system',
    createdBy,
    watchers: assignee ? [assignee._id] : [],
    linkedEntity: {
      entityType: 'SupportTicket',
      entityId: ticket._id,
      displayLabel: displayId,
    },
  });

  ticket.linkedTask = task._id;
  await ticket.save();

  // 3. Notify the assignee (best-effort).
  if (assignee) {
    try {
      await createNotification({
        organization: orgId,
        recipient: assignee._id,
        type: 'ticket_assigned',
        title: `New support ticket ${displayId}`,
        message: msg.subject || '(no subject)',
        relatedEntity: {
          entityType: 'SupportTicket',
          entityId: ticket._id,
          displayLabel: displayId,
        },
        priority: 'high',
      });
    } catch (err) {
      console.error(`❌ [supportService] notify assignee failed for ${displayId}:`, err.message);
    }
  }

  // 4. Auto-reply to the client (best-effort — never fail ticket creation).
  try {
    const link = publicTicketLink(ticket);
    const mail = autoReplyEmail({ displayId, subject: msg.subject, clientName: msg.fromName, link });
    const sent = await sendEmail({ to: msg.from, subject: mail.subject, html: mail.html, text: mail.text });
    console.log(`✅ [supportService] auto-reply sent for ${displayId} → ${msg.from} (messageId=${sent?.messageId})`);
    ticket.lastClientNotifiedAt = new Date();
    await ticket.save();
  } catch (err) {
    console.error(`❌ [supportService] auto-reply email failed for ${displayId} → ${msg.from}:`, err?.response || err?.message || err);
  }

  return ticket.populate([
    { path: 'assignee', select: 'firstName lastName email role' },
    { path: 'linkedTask', select: 'taskNumber title status source' },
  ]);
}

// ─── REPLY TO CLIENT (platform-sent) ─────────────────────────────

/**
 * Append a public outbound message, email the client, and move the ticket to
 * 'waiting_on_client'.
 */
export async function replyToClient(ticketId, userId, bodyText) {
  const ticket = await SupportTicket.findById(ticketId);
  if (!ticket) throw new Error('Ticket not found');

  const now = new Date();
  ticket.messages.push({
    direction: 'outbound',
    visibility: 'public',
    from: 'helpdesk',
    body: bodyText,
    authorUser: userId,
    at: now,
  });
  ticket.status = 'waiting_on_client';

  try {
    const link = publicTicketLink(ticket);
    const mail = clientReplyEmail({ displayId: ticket.displayId, subject: ticket.subject, body: bodyText, link });
    const sent = await sendEmail({ to: ticket.client.email, subject: mail.subject, html: mail.html, text: mail.text });
    console.log(`✅ [supportService] reply sent for ${ticket.displayId} → ${ticket.client.email} (messageId=${sent?.messageId})`);
    ticket.lastClientNotifiedAt = now;
  } catch (err) {
    console.error(`❌ [supportService] reply email failed for ${ticket.displayId} → ${ticket.client.email}:`, err?.response || err?.message || err);
  }

  await ticket.save();
  return ticket;
}

// ─── INTERNAL NOTE (no email) ────────────────────────────────────

/**
 * Append an internal-only note. No email is sent.
 */
export async function addInternalNote(ticketId, userId, bodyText) {
  const ticket = await SupportTicket.findById(ticketId);
  if (!ticket) throw new Error('Ticket not found');

  ticket.messages.push({
    direction: 'internal',
    visibility: 'internal',
    authorUser: userId,
    body: bodyText,
    at: new Date(),
  });
  await ticket.save();
  return ticket;
}

// ─── INBOUND REPLY (client emailed back on an existing ticket) ────

/**
 * Append an inbound client reply to an existing ticket. Reopens a resolved/closed
 * ticket to in_progress, stores the messageId, and notifies the assignee.
 * Dedups on messageId so a provider re-delivery is a no-op.
 * @returns {Promise<SupportTicket|null>} the ticket (null if not found)
 */
export async function appendInboundReply(ticketId, msg) {
  const ticket = await SupportTicket.findById(ticketId);
  if (!ticket) return null;

  // Dedup: a re-delivered reply with a known messageId is a no-op.
  if (msg.messageId) {
    const seen =
      ticket.lastInboundMessageId === msg.messageId ||
      ticket.originalMessageId === msg.messageId ||
      (ticket.messages || []).some((m) => m.messageId && m.messageId === msg.messageId);
    if (seen) return ticket;
  }

  const now = new Date();
  ticket.messages.push({
    direction: 'inbound',
    visibility: 'public',
    from: msg.from,
    body: msg.text,
    html: msg.html,
    messageId: msg.messageId,
    at: now,
  });
  ticket.lastInboundMessageId = msg.messageId;

  // A client reply reopens a resolved/closed ticket.
  if (ticket.status === 'resolved' || ticket.status === 'closed') {
    ticket.status = 'in_progress';
    ticket.closedAt = undefined;
  }

  // Notify the assignee (best-effort).
  if (ticket.assignee) {
    try {
      await createNotification({
        organization: ticket.organization,
        recipient: ticket.assignee,
        type: 'ticket_client_reply',
        title: `Client replied on ${ticket.displayId}`,
        message: ticket.subject || '(no subject)',
        relatedEntity: {
          entityType: 'SupportTicket',
          entityId: ticket._id,
          displayLabel: ticket.displayId,
        },
        priority: 'high',
      });
    } catch (err) {
      console.error(`❌ [supportService] notify reply failed for ${ticket.displayId}:`, err.message);
    }
  }

  await ticket.save();
  return ticket;
}

// ─── TASK → TICKET STATUS SYNC ───────────────────────────────────

const TASK_STATUS_TO_TICKET = {
  Open: 'assigned',
  'In Progress': 'in_progress',
  'Under Review': 'in_progress',
  Completed: 'resolved',
  Cancelled: 'closed',
};

/**
 * Map a linked Task's status change onto the ticket. Optionally emails the
 * client a templated status update (debounced — skipped if notified < 30s ago).
 */
export async function syncStatusFromTask(taskId, newStatus) {
  const ticket = await SupportTicket.findOne({ linkedTask: taskId });
  if (!ticket) return null;

  const mapped = TASK_STATUS_TO_TICKET[newStatus];
  if (!mapped || mapped === ticket.status) return ticket;

  ticket.status = mapped;
  if (mapped === 'resolved' || mapped === 'closed') ticket.closedAt = new Date();

  // Debounce client emails: skip if we notified within the last 30s.
  const now = Date.now();
  const last = ticket.lastClientNotifiedAt ? ticket.lastClientNotifiedAt.getTime() : 0;
  if (now - last >= 30 * 1000) {
    try {
      const link = publicTicketLink(ticket);
      const mail = statusUpdateEmail({ displayId: ticket.displayId, status: mapped, link });
      const sent = await sendEmail({ to: ticket.client.email, subject: mail.subject, html: mail.html, text: mail.text });
      console.log(`✅ [supportService] status update sent for ${ticket.displayId} → ${ticket.client.email} (messageId=${sent?.messageId})`);
      ticket.lastClientNotifiedAt = new Date();
    } catch (err) {
      console.error(`❌ [supportService] status email failed for ${ticket.displayId} → ${ticket.client.email}:`, err?.response || err?.message || err);
    }
  }

  await ticket.save();
  return ticket;
}

// Premium HTML email templates live in ./supportEmails.js (autoReplyEmail,
// clientReplyEmail, statusUpdateEmail) and are imported above.

export { CATEGORY_TO_ROLE, FALLBACK_ROLES, TICKET_TASK_CATEGORY };
