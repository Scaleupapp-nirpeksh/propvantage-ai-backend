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

  for (const role of tryRoles) {
    const user = await User.findOne({ organization: orgId, role, isActive: true });
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
    await sendEmail({
      to: msg.from,
      subject: `Re: ${msg.subject || 'your request'} [${displayId}]`,
      html: autoReplyHtml(displayId, msg.subject),
      text: autoReplyText(displayId, msg.subject),
    });
    ticket.lastClientNotifiedAt = new Date();
    await ticket.save();
  } catch (err) {
    console.error(`❌ [supportService] auto-reply email failed for ${displayId}:`, err.message);
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
    await sendEmail({
      to: ticket.client.email,
      subject: `Re: ${ticket.subject || 'your request'} [${ticket.displayId}]`,
      html: clientReplyHtml(ticket.displayId, bodyText),
      text: clientReplyText(ticket.displayId, bodyText),
    });
    ticket.lastClientNotifiedAt = now;
  } catch (err) {
    console.error(`❌ [supportService] reply email failed for ${ticket.displayId}:`, err.message);
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
      await sendEmail({
        to: ticket.client.email,
        subject: `Update on ${ticket.displayId}`,
        html: statusUpdateHtml(ticket.displayId, mapped),
        text: statusUpdateText(ticket.displayId, mapped),
      });
      ticket.lastClientNotifiedAt = new Date();
    } catch (err) {
      console.error(`❌ [supportService] status email failed for ${ticket.displayId}:`, err.message);
    }
  }

  await ticket.save();
  return ticket;
}

// ─── EMAIL TEMPLATES (Phase 1 — plain, no public link yet) ───────

function autoReplyText(displayId, subject) {
  return `Hi,

We've received your request${subject ? ` regarding "${subject}"` : ''}.

You can track this ticket with reference ${displayId}.

Our team will get back to you shortly.

— Support`;
}

function autoReplyHtml(displayId, subject) {
  return `<p>Hi,</p>
<p>We've received your request${subject ? ` regarding "<strong>${subject}</strong>"` : ''}.</p>
<p>You can track this ticket with reference <strong>${displayId}</strong>.</p>
<p>Our team will get back to you shortly.</p>
<p>— Support</p>`;
}

function clientReplyText(displayId, body) {
  return `${body}

— Support (ref ${displayId})`;
}

function clientReplyHtml(displayId, body) {
  return `<p>${(body || '').replace(/\n/g, '<br/>')}</p>
<p>— Support (ref ${displayId})</p>`;
}

function statusUpdateText(displayId, status) {
  return `Hi,

The status of your ticket ${displayId} is now: ${status}.

— Support`;
}

function statusUpdateHtml(displayId, status) {
  return `<p>Hi,</p>
<p>The status of your ticket <strong>${displayId}</strong> is now: <strong>${status}</strong>.</p>
<p>— Support</p>`;
}

export { CATEGORY_TO_ROLE, FALLBACK_ROLES, TICKET_TASK_CATEGORY };
