// File: models/conversationModel.js
// Description: Conversation model for the chat/messaging system

import mongoose from 'mongoose';

// ─── CONSTANTS ───────────────────────────────────────────────

export const CONVERSATION_TYPES = ['direct', 'group', 'entity'];

export const ENTITY_TYPES = [
  'Lead',
  'Sale',
  'Project',
  'Invoice',
  'ConstructionMilestone',
  'PaymentTransaction',
];

// ─── PARTICIPANT SUB-SCHEMA ──────────────────────────────────

const participantSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    role: {
      type: String,
      enum: ['admin', 'member'],
      default: 'member',
    },
    joinedAt: {
      type: Date,
      default: Date.now,
    },
    lastReadAt: {
      type: Date,
      default: Date.now,
    },
    unreadCount: {
      type: Number,
      default: 0,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    leftAt: {
      type: Date,
    },
    notifications: {
      type: String,
      enum: ['all', 'mentions', 'none'],
      default: 'all',
    },
  },
  { _id: false }
);

// ─── MAIN CONVERSATION SCHEMA ────────────────────────────────

const conversationSchema = new mongoose.Schema(
  {
    organization: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: [true, 'Organization is required'],
      index: true,
    },

    type: {
      type: String,
      enum: CONVERSATION_TYPES,
      required: [true, 'Conversation type is required'],
    },

    name: {
      type: String,
      trim: true,
      maxlength: 200,
    },

    description: {
      type: String,
      trim: true,
      maxlength: 1000,
    },

    // Entity-linked conversations
    entity: {
      entityType: {
        type: String,
        enum: ENTITY_TYPES,
      },
      entityId: {
        type: mongoose.Schema.Types.ObjectId,
      },
      displayLabel: {
        type: String,
        trim: true,
      },
    },

    participants: [participantSchema],

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    // Denormalized last message for fast list rendering
    lastMessage: {
      text: String,
      sender: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
      senderName: String,
      timestamp: Date,
      messageType: String,
    },

    messageCount: {
      type: Number,
      default: 0,
    },

    isActive: {
      type: Boolean,
      default: true,
    },

    isArchived: {
      type: Boolean,
      default: false,
    },

    archivedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },

    archivedAt: {
      type: Date,
    },

    settings: {
      allowFileSharing: { type: Boolean, default: true },
      allowReactions: { type: Boolean, default: true },
    },
  },
  {
    timestamps: true,
  }
);

// ─── INDEXES ─────────────────────────────────────────────────

// Primary: user's conversations sorted by last message
conversationSchema.index({
  organization: 1,
  'participants.user': 1,
  'lastMessage.timestamp': -1,
});

// Find conversations by type
conversationSchema.index({ organization: 1, type: 1 });

// Entity conversations — one per entity (unique sparse)
conversationSchema.index(
  { organization: 1, 'entity.entityType': 1, 'entity.entityId': 1 },
  {
    unique: true,
    sparse: true,
    partialFilterExpression: { 'entity.entityType': { $exists: true } },
  }
);

// ─── INSTANCE METHODS ────────────────────────────────────────

conversationSchema.methods.isParticipant = function (userId) {
  return this.participants.some(
    (p) =>
      p.user.toString() === userId.toString() && p.isActive && !p.leftAt
  );
};

conversationSchema.methods.isAdmin = function (userId) {
  const participant = this.participants.find(
    (p) => p.user.toString() === userId.toString() && p.isActive
  );
  return participant?.role === 'admin';
};

conversationSchema.methods.addParticipant = function (
  userId,
  addedBy,
  role = 'member'
) {
  const existing = this.participants.find(
    (p) => p.user.toString() === userId.toString()
  );

  if (existing) {
    if (!existing.isActive || existing.leftAt) {
      existing.isActive = true;
      existing.leftAt = null;
      existing.joinedAt = new Date();
      existing.lastReadAt = new Date();
      existing.unreadCount = 0;
    }
  } else {
    this.participants.push({
      user: userId,
      role,
      joinedAt: new Date(),
      lastReadAt: new Date(),
      unreadCount: 0,
      isActive: true,
    });
  }
};

conversationSchema.methods.removeParticipant = function (userId) {
  const participant = this.participants.find(
    (p) => p.user.toString() === userId.toString()
  );
  if (participant) {
    participant.isActive = false;
    participant.leftAt = new Date();
  }
};

conversationSchema.methods.markAsRead = function (userId) {
  const participant = this.participants.find(
    (p) => p.user.toString() === userId.toString() && p.isActive
  );
  if (participant) {
    participant.lastReadAt = new Date();
    participant.unreadCount = 0;
  }
};

conversationSchema.methods.incrementUnreadExcept = function (senderUserId) {
  this.participants.forEach((p) => {
    if (p.user.toString() !== senderUserId.toString() && p.isActive) {
      p.unreadCount = (p.unreadCount || 0) + 1;
    }
  });
};

conversationSchema.methods.updateLastMessage = function (message, senderName) {
  const preview =
    message.type === 'system'
      ? message.content?.systemEvent || 'System message'
      : message.content?.text?.substring(0, 100) ||
        (message.attachments?.length ? 'Sent an attachment' : 'Message');

  this.lastMessage = {
    text: preview,
    sender: message.sender,
    senderName: senderName || '',
    timestamp: message.createdAt || new Date(),
    messageType: message.type,
  };
  this.messageCount = (this.messageCount || 0) + 1;
};

// ─── STATIC METHODS ──────────────────────────────────────────

conversationSchema.statics.findOrCreateDirect = async function (
  organizationId,
  user1Id,
  user2Id,
  createdBy
) {
  const userIds = [user1Id.toString(), user2Id.toString()].sort();

  let conversation = await this.findOne({
    organization: organizationId,
    type: 'direct',
    'participants.user': { $all: userIds.map((id) => new mongoose.Types.ObjectId(id)) },
  }).then((doc) => {
    // Verify exactly 2 participants for direct
    if (doc && doc.participants.length === 2) return doc;
    return null;
  });

  if (!conversation) {
    conversation = await this.create({
      organization: organizationId,
      type: 'direct',
      participants: [
        { user: userIds[0], role: 'member', isActive: true },
        { user: userIds[1], role: 'member', isActive: true },
      ],
      createdBy,
    });
  }

  return conversation;
};

conversationSchema.statics.findOrCreateEntity = async function (
  organizationId,
  entityType,
  entityId,
  displayLabel,
  createdBy,
  initialParticipantIds = []
) {
  let conversation = await this.findOne({
    organization: organizationId,
    type: 'entity',
    'entity.entityType': entityType,
    'entity.entityId': entityId,
  });

  if (!conversation) {
    const participants = initialParticipantIds.map((uid) => ({
      user: uid,
      role: 'member',
      isActive: true,
    }));

    conversation = await this.create({
      organization: organizationId,
      type: 'entity',
      name: displayLabel,
      entity: { entityType, entityId, displayLabel },
      participants,
      createdBy,
    });
  }

  return conversation;
};

const Conversation = mongoose.model('Conversation', conversationSchema);

export default Conversation;
