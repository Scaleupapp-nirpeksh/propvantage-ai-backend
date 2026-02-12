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
  // Business events
  'payment_overdue',
  'lead_follow_up_due',
  'milestone_delayed',
  'sale_booked',
  // Chat
  'chat_message',
  'chat_mention',
];

export const NOTIFICATION_PRIORITIES = ['low', 'medium', 'high', 'urgent'];

export const RELATED_ENTITY_TYPES = [
  'Task', 'Lead', 'Sale', 'Installment', 'ConstructionMilestone', 'Invoice', 'Project',
  'Conversation',
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
