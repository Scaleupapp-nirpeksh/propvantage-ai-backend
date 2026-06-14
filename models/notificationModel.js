// File: models/notificationModel.js
// Description: In-app notification model for platform notifications (bell icon / notification center)

import mongoose from 'mongoose';

// =============================================================================
// CONSTANTS
// =============================================================================

export const NOTIFICATION_TYPES = [
  // Task-related
  'task_assigned',
  'task_status_changed',
  'task_completed',
  'task_comment',
  'task_mention',
  'task_due_today',
  'task_overdue',
  'task_due_soon',
  'task_escalated',
  'task_auto_generated',
  // Approval events
  'approval_requested',
  'approval_approved',
  'approval_rejected',
  'approval_escalated',
  'approval_cancelled',
  // Business events
  'payment_overdue',
  'lead_follow_up_due',
  'milestone_delayed',
  'sale_booked',
  // Chat
  'chat_message',
  'chat_mention',
  // Marketplace partnerships (SP3)
  'partnership_request', // a new application or invite arrived
  'partnership_update',  // a decision or lifecycle change
  // Cross-org lead lifecycle (SP4)
  'lead_registration_received',       // → developer: a CP pushed a new lead for review
  'lead_registration_accepted',       // → CP agent + CP Manager/Owner
  'lead_registration_rejected',       // → CP agent + CP Manager/Owner
  'cp_lead_status_changed',           // → CP agent + CP Manager/Owner — developer moved a CP-attributed lead
  'lead_status_proposed',             // → developer lead owner + dev Manager/Owner
  'lead_status_proposal_accepted',    // → CP agent
  'lead_status_proposal_rejected',    // → CP agent
  'external_developer_claimed',       // → CP Manager/Owner of the inviting CP org
  // SP5+ — Commission invoice lifecycle (cross-org).
  'commission_invoice_ready',         // → CP: customer payment crossed threshold; CP can generate an invoice now
  'commission_invoice_submitted',     // → dev: CP submitted an invoice for review
  'commission_invoice_approved',      // → CP: dev approved their invoice
  'commission_invoice_rejected',      // → CP: dev rejected (with reason)
  'commission_invoice_paid',          // → CP: dev recorded payment against the invoice
  // Lifecycle-repair (2026-05-24) — events that should already have been
  // notifying but were dropped on the floor or never wired.
  'commission_invoice_due',           // → dev: heads-up that a CP-attributed sale crossed the threshold
  'sale_cancelled',                   // → CP: a CP-attributed sale was cancelled by the developer
  'commission_record_created',        // → CP: dev booked a sale; commission accruing
  'commission_rule_missing',          // → dev: a CP-attributed sale has no applicable CommissionRule → record at ₹0
  'cp_sale_booked',                   // → CP: pushed prospect converted to a Sale (the deal-of-the-year notification)
  // Leadership Report Builder (Phase 3) — review workflow
  'report_ready_for_review',   // → approvers: a report was submitted for review
  'report_approved',           // → author: their report was approved
  'report_changes_requested',  // → author: a reviewer requested changes
  'report_flag_raised',        // → data owner: a value was flagged for correction
];

export const NOTIFICATION_PRIORITIES = ['low', 'medium', 'high', 'urgent'];

export const RELATED_ENTITY_TYPES = [
  'Task', 'Lead', 'Sale', 'Installment', 'ConstructionMilestone', 'Invoice', 'Project',
  'Conversation', 'ApprovalRequest', 'Partnership',
  // SP4 — cross-org lead lifecycle entities
  'Prospect', 'ExternalDeveloper',
  // SP5+ — commission invoice
  'CommissionInvoice',
  // Leadership Report Builder
  'ReportInstance',
];

// =============================================================================
// SCHEMA
// =============================================================================

const notificationSchema = new mongoose.Schema(
  {
    organization: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: [true, 'Organization is required'],
      index: true,
    },
    recipient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Recipient is required'],
    },
    type: {
      type: String,
      enum: NOTIFICATION_TYPES,
      required: [true, 'Notification type is required'],
    },
    title: {
      type: String,
      required: [true, 'Notification title is required'],
      trim: true,
      maxlength: 200,
    },
    message: {
      type: String,
      trim: true,
      maxlength: 1000,
    },
    actionUrl: {
      type: String,
      trim: true,
    },
    relatedEntity: {
      entityType: {
        type: String,
        enum: RELATED_ENTITY_TYPES,
      },
      entityId: {
        type: mongoose.Schema.Types.ObjectId,
      },
      displayLabel: {
        type: String,
        trim: true,
      },
    },
    isRead: {
      type: Boolean,
      default: false,
    },
    readAt: {
      type: Date,
    },
    priority: {
      type: String,
      enum: NOTIFICATION_PRIORITIES,
      default: 'medium',
    },
    actor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
    },
    expiresAt: {
      type: Date,
      default: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
    },
  },
  {
    timestamps: true,
  }
);

// =============================================================================
// INDEXES
// =============================================================================

// Main query: user's notifications, newest first, optionally filtered by read status
notificationSchema.index({ recipient: 1, isRead: 1, createdAt: -1 });

// Org-scoped queries
notificationSchema.index({ organization: 1, recipient: 1 });

// TTL index — MongoDB auto-deletes documents when expiresAt passes
notificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Find notifications for a specific entity (for cleanup when entity is deleted)
notificationSchema.index({ 'relatedEntity.entityType': 1, 'relatedEntity.entityId': 1 });

// =============================================================================
// STATICS
// =============================================================================

/**
 * Get unread notification count for a user
 */
notificationSchema.statics.getUnreadCount = function (recipientId) {
  return this.countDocuments({ recipient: recipientId, isRead: false });
};

/**
 * Mark all notifications as read for a user
 */
notificationSchema.statics.markAllRead = function (recipientId) {
  return this.updateMany(
    { recipient: recipientId, isRead: false },
    { $set: { isRead: true, readAt: new Date() } }
  );
};

const Notification = mongoose.model('Notification', notificationSchema);

export default Notification;
