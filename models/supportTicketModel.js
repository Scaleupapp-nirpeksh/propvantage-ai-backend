// File: models/supportTicketModel.js
// Description: Email-to-ticket support ticket. A ticket is opened from an inbound
//   client message, auto-assigned to a department head, and linked to a Task
//   (the internal work item). The client thread (public) and internal notes live
//   on `messages[]`, filtered by visibility for the (future) public status page.

import mongoose from 'mongoose';
import crypto from 'crypto';

// ─── CONSTANTS ───────────────────────────────────────────────────

const TICKET_STATUSES = [
  'new',
  'assigned',
  'in_progress',
  'waiting_on_client',
  'resolved',
  'closed',
];

const TICKET_PRIORITIES = ['Critical', 'High', 'Medium', 'Low'];

// Default org categories (org-configurable in a later phase).
const TICKET_CATEGORIES = ['sales', 'legal', 'crm', 'finance', 'other'];

// ─── EMBEDDED SUB-SCHEMA ─────────────────────────────────────────

const messageSchema = new mongoose.Schema(
  {
    direction: {
      type: String,
      enum: ['inbound', 'outbound', 'internal'],
      required: true,
    },
    visibility: {
      type: String,
      enum: ['public', 'internal'],
      default: 'public',
    },
    from: { type: String, trim: true },
    body: { type: String },
    html: { type: String },
    messageId: { type: String }, // provider Message-Id, for threading + dedup
    at: { type: Date, default: Date.now },
    authorUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    attachments: { type: [mongoose.Schema.Types.Mixed], default: [] },
  },
  { _id: true }
);

// ─── MAIN SCHEMA ─────────────────────────────────────────────────

const supportTicketSchema = new mongoose.Schema(
  {
    organization: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: [true, 'Organization is required'],
      index: true,
    },

    // === IDENTIFICATION ===
    ticketNumber: { type: Number },
    displayId: { type: String }, // e.g. 'TKT-000412'
    publicToken: {
      type: String,
      unique: true,
      default: () => crypto.randomBytes(16).toString('base64url'),
    },

    // === CATEGORIZATION ===
    category: { type: String, default: 'other' },
    subject: { type: String, trim: true },

    // === STATUS & PRIORITY ===
    status: {
      type: String,
      enum: TICKET_STATUSES,
      default: 'new',
      index: true,
    },
    priority: {
      type: String,
      enum: TICKET_PRIORITIES,
      default: 'Medium',
    },

    // === CLIENT ===
    client: {
      email: { type: String, required: [true, 'Client email is required'], trim: true },
      name: { type: String, trim: true },
    },

    // === INGESTION METADATA ===
    source: { type: String, default: 'email' },
    originalMessageId: { type: String, index: true },
    lastInboundMessageId: { type: String },

    // === THREAD ===
    messages: { type: [messageSchema], default: [] },

    // === LINKAGE ===
    linkedTask: { type: mongoose.Schema.Types.ObjectId, ref: 'Task' },
    assignee: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

    // === CLIENT-COMMS TRACKING ===
    lastClientNotifiedAt: { type: Date },
    closedAt: { type: Date },
  },
  { timestamps: true }
);

// ─── INDEXES ─────────────────────────────────────────────────────

supportTicketSchema.index({ organization: 1, status: 1 });
supportTicketSchema.index({ organization: 1, ticketNumber: 1 }, { unique: true });
supportTicketSchema.index({ publicToken: 1 }, { unique: true });

// ─── STATICS ─────────────────────────────────────────────────────

/**
 * Mint the next per-org sequential ticket number + padded displayId.
 * Phase 1 uses a count-based approach (count of org tickets + 1).
 * @returns {Promise<{ ticketNumber: number, displayId: string }>}
 */
supportTicketSchema.statics.mintTicketNumber = async function (organizationId) {
  const count = await this.countDocuments({ organization: organizationId });
  const ticketNumber = count + 1;
  const displayId = `TKT-${String(ticketNumber).padStart(6, '0')}`;
  return { ticketNumber, displayId };
};

// ─── EXPORT ──────────────────────────────────────────────────────

const SupportTicket = mongoose.model('SupportTicket', supportTicketSchema);

export default SupportTicket;
export { TICKET_STATUSES, TICKET_PRIORITIES, TICKET_CATEGORIES };
