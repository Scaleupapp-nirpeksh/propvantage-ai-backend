// File: models/messageModel.js
// Description: Message model for the chat/messaging system

import mongoose from 'mongoose';

// ─── CONSTANTS ───────────────────────────────────────────────

export const MESSAGE_TYPES = ['text', 'file', 'system', 'entity_reference'];

export const SYSTEM_EVENTS = [
  'participant_added',
  'participant_removed',
  'conversation_created',
  'name_changed',
];

// ─── SUB-SCHEMAS ─────────────────────────────────────────────

const attachmentSchema = new mongoose.Schema(
  {
    file: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'File',
    },
    fileName: String,
    fileSize: Number,
    mimeType: String,
    url: String,
  },
  { _id: false }
);

const entityReferenceSchema = new mongoose.Schema(
  {
    entityType: {
      type: String,
      enum: [
        'Lead',
        'Sale',
        'Project',
        'Invoice',
        'ConstructionMilestone',
        'PaymentTransaction',
        'Task',
      ],
    },
    entityId: mongoose.Schema.Types.ObjectId,
    displayLabel: String,
    metadata: mongoose.Schema.Types.Mixed,
  },
  { _id: false }
);

const reactionSchema = new mongoose.Schema(
  {
    emoji: {
      type: String,
      required: true,
      maxlength: 10,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false }
);

// ─── MAIN MESSAGE SCHEMA ─────────────────────────────────────

const messageSchema = new mongoose.Schema(
  {
    organization: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: [true, 'Organization is required'],
      index: true,
    },

    conversation: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Conversation',
      required: [true, 'Conversation is required'],
    },

    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      // null for system messages
    },

    type: {
      type: String,
      enum: MESSAGE_TYPES,
      default: 'text',
    },

    content: {
      text: {
        type: String,
        trim: true,
        maxlength: 5000,
      },
      systemEvent: {
        type: String,
        enum: SYSTEM_EVENTS,
      },
      systemData: mongoose.Schema.Types.Mixed,
    },

    attachments: [attachmentSchema],

    entityReference: entityReferenceSchema,

    mentions: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
    ],

    replyTo: {
      message: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Message',
      },
      text: String,
      senderName: String,
    },

    reactions: [reactionSchema],

    // Pin
    isPinned: { type: Boolean, default: false },
    pinnedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    pinnedAt: { type: Date },

    // Edit
    isEdited: { type: Boolean, default: false },
    editedAt: { type: Date },

    // Soft delete
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date },
    deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

    // Forward
    forwardedFrom: {
      conversation: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation' },
      message: { type: mongoose.Schema.Types.ObjectId, ref: 'Message' },
      senderName: String,
    },

    // Read receipts
    readBy: [
      {
        user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        readAt: { type: Date, default: Date.now },
        _id: false,
      },
    ],
  },
  {
    timestamps: true,
  }
);

// ─── INDEXES ─────────────────────────────────────────────────

// Primary: messages in conversation, newest first
messageSchema.index({ conversation: 1, createdAt: -1 });

// Cursor-based pagination
messageSchema.index({ conversation: 1, _id: -1 });

// Pinned messages
messageSchema.index({ conversation: 1, isPinned: 1 });

// Full-text search on message content
messageSchema.index({ 'content.text': 'text' });

// User's messages
messageSchema.index({ organization: 1, sender: 1, createdAt: -1 });

// ─── INSTANCE METHODS ────────────────────────────────────────

messageSchema.methods.toggleReaction = function (userId, emoji) {
  const existingIdx = this.reactions.findIndex(
    (r) => r.user.toString() === userId.toString() && r.emoji === emoji
  );

  if (existingIdx > -1) {
    this.reactions.splice(existingIdx, 1);
    return { action: 'removed', emoji };
  } else {
    this.reactions.push({ emoji, user: userId, createdAt: new Date() });
    return { action: 'added', emoji };
  }
};

messageSchema.methods.editMessage = function (newText) {
  this.content.text = newText;
  this.isEdited = true;
  this.editedAt = new Date();
};

messageSchema.methods.softDelete = function (userId) {
  this.isDeleted = true;
  this.deletedAt = new Date();
  this.deletedBy = userId;
};

messageSchema.methods.togglePin = function (userId) {
  if (this.isPinned) {
    this.isPinned = false;
    this.pinnedAt = null;
    this.pinnedBy = null;
    return { action: 'unpinned' };
  } else {
    this.isPinned = true;
    this.pinnedAt = new Date();
    this.pinnedBy = userId;
    return { action: 'pinned' };
  }
};

// ─── STATIC METHODS ──────────────────────────────────────────

messageSchema.statics.createSystemMessage = async function (
  organizationId,
  conversationId,
  systemEvent,
  systemData
) {
  return this.create({
    organization: organizationId,
    conversation: conversationId,
    type: 'system',
    sender: null,
    content: { systemEvent, systemData },
  });
};

const Message = mongoose.model('Message', messageSchema);

export default Message;
