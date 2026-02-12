// File: controllers/chatController.js
// Description: REST API controllers for the chat/messaging system

import asyncHandler from 'express-async-handler';
import mongoose from 'mongoose';
import Conversation, { ENTITY_TYPES } from '../models/conversationModel.js';
import Message from '../models/messageModel.js';
import User from '../models/userModel.js';
import {
  getEntityParticipants,
  getEntityDisplayLabel,
  notifyChatMessage,
  notifyChatMention,
} from '../services/chatService.js';
import {
  emitToConversation,
  joinConversationRoom,
  getOnlineUserIds,
} from '../socket/socketHandler.js';

// ═══════════════════════════════════════════════════════════════
// CONVERSATION ENDPOINTS
// ═══════════════════════════════════════════════════════════════

/**
 * @desc    Create conversation (direct or group)
 * @route   POST /api/chat/conversations
 * @access  Private (chat:send)
 */
const createConversation = asyncHandler(async (req, res) => {
  const { type, participantIds, name, description } = req.body;

  if (!type || !['direct', 'group'].includes(type)) {
    res.status(400);
    throw new Error('type must be "direct" or "group"');
  }

  let conversation;

  if (type === 'direct') {
    if (!participantIds || participantIds.length !== 1) {
      res.status(400);
      throw new Error('Direct conversation requires exactly one other participant ID');
    }

    // Validate target user exists in same org
    const targetUser = await User.findOne({
      _id: participantIds[0],
      organization: req.user.organization,
      isActive: true,
    }).select('_id');

    if (!targetUser) {
      res.status(404);
      throw new Error('Target user not found in your organization');
    }

    conversation = await Conversation.findOrCreateDirect(
      req.user.organization,
      req.user._id,
      participantIds[0],
      req.user._id
    );
  } else {
    // Group
    if (!participantIds || participantIds.length < 1) {
      res.status(400);
      throw new Error('Group conversation requires at least one other participant');
    }

    if (!req.userPermissions.includes('chat:create_group') && !req.isOwner) {
      res.status(403);
      throw new Error('Not authorized to create group conversations');
    }

    const participants = [
      { user: req.user._id, role: 'admin', isActive: true },
      ...participantIds.map((uid) => ({
        user: uid,
        role: 'member',
        isActive: true,
      })),
    ];

    conversation = await Conversation.create({
      organization: req.user.organization,
      type: 'group',
      name: name || 'New Group',
      description,
      participants,
      createdBy: req.user._id,
    });

    // System message
    await Message.createSystemMessage(
      req.user.organization,
      conversation._id,
      'conversation_created',
      {
        createdBy: req.user._id,
        createdByName: `${req.user.firstName} ${req.user.lastName}`,
        name: conversation.name,
      }
    );
  }

  // Join participants to socket room
  const io = req.app.get('io');
  if (io) {
    conversation.participants.forEach((p) => {
      joinConversationRoom(io, p.user.toString(), conversation._id.toString());
    });
  }

  await conversation.populate([
    { path: 'participants.user', select: 'firstName lastName email profileImage' },
    { path: 'createdBy', select: 'firstName lastName' },
  ]);

  res.status(201).json({
    success: true,
    data: { conversation },
  });
});

/**
 * @desc    Get user's conversations
 * @route   GET /api/chat/conversations
 * @access  Private (chat:view)
 */
const getConversations = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, archived = 'false', type } = req.query;

  const pageNum = parseInt(page);
  const limitNum = Math.min(parseInt(limit), 50);
  const skip = (pageNum - 1) * limitNum;

  const query = {
    organization: req.user.organization,
    'participants.user': req.user._id,
    isArchived: archived === 'true',
  };

  if (type && ['direct', 'group', 'entity'].includes(type)) {
    query.type = type;
  }

  const [conversations, total] = await Promise.all([
    Conversation.find(query)
      .populate('participants.user', 'firstName lastName email profileImage')
      .populate('lastMessage.sender', 'firstName lastName')
      .sort({ 'lastMessage.timestamp': -1, updatedAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .lean(),
    Conversation.countDocuments(query),
  ]);

  // Enrich with user-specific unread count
  const enriched = conversations.map((conv) => {
    const myParticipant = conv.participants.find(
      (p) => p.user?._id?.toString() === req.user._id.toString()
    );
    return {
      ...conv,
      myUnreadCount: myParticipant?.unreadCount || 0,
      myLastReadAt: myParticipant?.lastReadAt,
    };
  });

  res.json({
    success: true,
    data: {
      conversations: enriched,
      pagination: {
        currentPage: pageNum,
        totalPages: Math.ceil(total / limitNum),
        total,
        limit: limitNum,
        hasNextPage: pageNum < Math.ceil(total / limitNum),
        hasPrevPage: pageNum > 1,
      },
    },
  });
});

/**
 * @desc    Get conversation by ID
 * @route   GET /api/chat/conversations/:id
 * @access  Private (chat:view)
 */
const getConversationById = asyncHandler(async (req, res) => {
  const conversation = await Conversation.findOne({
    _id: req.params.id,
    organization: req.user.organization,
  })
    .populate('participants.user', 'firstName lastName email profileImage')
    .populate('createdBy', 'firstName lastName');

  if (!conversation) {
    res.status(404);
    throw new Error('Conversation not found');
  }

  if (!conversation.isParticipant(req.user._id)) {
    res.status(403);
    throw new Error('Not authorized to view this conversation');
  }

  res.json({
    success: true,
    data: { conversation },
  });
});

/**
 * @desc    Update conversation (name, description, settings)
 * @route   PUT /api/chat/conversations/:id
 * @access  Private (chat:send, admin for groups)
 */
const updateConversation = asyncHandler(async (req, res) => {
  const { name, description, settings } = req.body;

  const conversation = await Conversation.findOne({
    _id: req.params.id,
    organization: req.user.organization,
  });

  if (!conversation) {
    res.status(404);
    throw new Error('Conversation not found');
  }

  if (conversation.type === 'direct') {
    res.status(400);
    throw new Error('Cannot update direct conversations');
  }

  if (
    conversation.type === 'group' &&
    !conversation.isAdmin(req.user._id) &&
    !req.userPermissions.includes('chat:manage_groups') &&
    !req.isOwner
  ) {
    res.status(403);
    throw new Error('Only admins can update group settings');
  }

  if (name !== undefined) {
    const oldName = conversation.name;
    conversation.name = name;

    await Message.createSystemMessage(
      req.user.organization,
      conversation._id,
      'name_changed',
      {
        changedBy: req.user._id,
        changedByName: `${req.user.firstName} ${req.user.lastName}`,
        oldName,
        newName: name,
      }
    );
  }

  if (description !== undefined) conversation.description = description;
  if (settings) {
    conversation.settings = { ...conversation.settings.toObject?.() || conversation.settings, ...settings };
  }

  await conversation.save();

  const io = req.app.get('io');
  if (io) {
    emitToConversation(io, conversation._id.toString(), 'conversation:updated', {
      conversationId: conversation._id,
      changes: { name, description, settings },
    });
  }

  res.json({
    success: true,
    message: 'Conversation updated',
    data: { conversation },
  });
});

/**
 * @desc    Add participants to group conversation
 * @route   POST /api/chat/conversations/:id/participants
 * @access  Private (chat:send, admin)
 */
const addParticipants = asyncHandler(async (req, res) => {
  const { userIds } = req.body;

  if (!Array.isArray(userIds) || userIds.length === 0) {
    res.status(400);
    throw new Error('userIds array is required');
  }

  const conversation = await Conversation.findOne({
    _id: req.params.id,
    organization: req.user.organization,
  });

  if (!conversation) {
    res.status(404);
    throw new Error('Conversation not found');
  }

  if (conversation.type === 'direct') {
    res.status(400);
    throw new Error('Cannot add participants to direct conversations');
  }

  if (
    !conversation.isAdmin(req.user._id) &&
    !req.userPermissions.includes('chat:manage_groups') &&
    !req.isOwner
  ) {
    res.status(403);
    throw new Error('Only admins can add participants');
  }

  userIds.forEach((uid) => {
    conversation.addParticipant(uid, req.user._id, 'member');
  });

  await conversation.save();

  // System message
  await Message.createSystemMessage(
    req.user.organization,
    conversation._id,
    'participant_added',
    {
      addedBy: req.user._id,
      addedByName: `${req.user.firstName} ${req.user.lastName}`,
      userIds,
    }
  );

  // Join new participants to socket room
  const io = req.app.get('io');
  if (io) {
    userIds.forEach((uid) => {
      joinConversationRoom(io, uid, conversation._id.toString());
    });
  }

  await conversation.populate('participants.user', 'firstName lastName email profileImage');

  res.json({
    success: true,
    message: `${userIds.length} participant(s) added`,
    data: { conversation },
  });
});

/**
 * @desc    Remove participant from group conversation
 * @route   DELETE /api/chat/conversations/:id/participants/:userId
 * @access  Private (admin or self)
 */
const removeParticipant = asyncHandler(async (req, res) => {
  const conversation = await Conversation.findOne({
    _id: req.params.id,
    organization: req.user.organization,
  });

  if (!conversation) {
    res.status(404);
    throw new Error('Conversation not found');
  }

  if (conversation.type === 'direct') {
    res.status(400);
    throw new Error('Cannot remove participants from direct conversations');
  }

  const removingSelf = req.params.userId === req.user._id.toString();
  if (
    !removingSelf &&
    !conversation.isAdmin(req.user._id) &&
    !req.userPermissions.includes('chat:manage_groups') &&
    !req.isOwner
  ) {
    res.status(403);
    throw new Error('Not authorized to remove participants');
  }

  conversation.removeParticipant(req.params.userId);
  await conversation.save();

  await Message.createSystemMessage(
    req.user.organization,
    conversation._id,
    'participant_removed',
    {
      removedBy: req.user._id,
      removedByName: `${req.user.firstName} ${req.user.lastName}`,
      userId: req.params.userId,
      removedSelf: removingSelf,
    }
  );

  const io = req.app.get('io');
  if (io) {
    emitToConversation(io, conversation._id.toString(), 'conversation:updated', {
      conversationId: conversation._id,
      changes: { participantRemoved: req.params.userId },
    });
  }

  res.json({ success: true, message: 'Participant removed' });
});

/**
 * @desc    Mark conversation as read
 * @route   PUT /api/chat/conversations/:id/read
 * @access  Private (chat:view)
 */
const markAsRead = asyncHandler(async (req, res) => {
  const conversation = await Conversation.findOne({
    _id: req.params.id,
    organization: req.user.organization,
  });

  if (!conversation || !conversation.isParticipant(req.user._id)) {
    res.status(404);
    throw new Error('Conversation not found');
  }

  conversation.markAsRead(req.user._id);
  await conversation.save();

  res.json({ success: true, message: 'Conversation marked as read' });
});

/**
 * @desc    Archive/unarchive conversation
 * @route   PUT /api/chat/conversations/:id/archive
 * @access  Private (chat:view)
 */
const archiveConversation = asyncHandler(async (req, res) => {
  const { archive = true } = req.body;

  const conversation = await Conversation.findOne({
    _id: req.params.id,
    organization: req.user.organization,
  });

  if (!conversation || !conversation.isParticipant(req.user._id)) {
    res.status(404);
    throw new Error('Conversation not found');
  }

  conversation.isArchived = archive;
  conversation.archivedBy = archive ? req.user._id : null;
  conversation.archivedAt = archive ? new Date() : null;
  await conversation.save();

  res.json({
    success: true,
    message: archive ? 'Conversation archived' : 'Conversation unarchived',
  });
});

/**
 * @desc    Leave conversation
 * @route   DELETE /api/chat/conversations/:id
 * @access  Private (chat:view)
 */
const leaveConversation = asyncHandler(async (req, res) => {
  const conversation = await Conversation.findOne({
    _id: req.params.id,
    organization: req.user.organization,
  });

  if (!conversation || !conversation.isParticipant(req.user._id)) {
    res.status(404);
    throw new Error('Conversation not found');
  }

  if (conversation.type === 'direct') {
    res.status(400);
    throw new Error('Cannot leave a direct conversation');
  }

  conversation.removeParticipant(req.user._id);
  await conversation.save();

  await Message.createSystemMessage(
    req.user.organization,
    conversation._id,
    'participant_removed',
    {
      removedBy: req.user._id,
      removedByName: `${req.user.firstName} ${req.user.lastName}`,
      userId: req.user._id,
      removedSelf: true,
    }
  );

  res.json({ success: true, message: 'Left conversation' });
});

// ═══════════════════════════════════════════════════════════════
// MESSAGE ENDPOINTS
// ═══════════════════════════════════════════════════════════════

/**
 * @desc    Send message
 * @route   POST /api/chat/conversations/:id/messages
 * @access  Private (chat:send)
 */
const sendMessage = asyncHandler(async (req, res) => {
  const { text, attachments, mentions, replyTo, entityReference } = req.body;

  if (!text && (!attachments || attachments.length === 0) && !entityReference) {
    res.status(400);
    throw new Error('Message must have text, attachments, or entity reference');
  }

  const conversation = await Conversation.findOne({
    _id: req.params.id,
    organization: req.user.organization,
  });

  if (!conversation || !conversation.isParticipant(req.user._id)) {
    res.status(403);
    throw new Error('Not authorized to send messages in this conversation');
  }

  // Determine message type
  let messageType = 'text';
  if (entityReference) messageType = 'entity_reference';
  else if (attachments?.length && !text) messageType = 'file';

  // Build reply-to data
  let replyToData;
  if (replyTo) {
    const replyMsg = await Message.findOne({
      _id: replyTo,
      conversation: req.params.id,
    })
      .populate('sender', 'firstName lastName')
      .lean();

    if (replyMsg) {
      replyToData = {
        message: replyMsg._id,
        text: replyMsg.content?.text?.substring(0, 200) || '',
        senderName: replyMsg.sender
          ? `${replyMsg.sender.firstName} ${replyMsg.sender.lastName}`
          : '',
      };
    }
  }

  const message = await Message.create({
    organization: req.user.organization,
    conversation: req.params.id,
    sender: req.user._id,
    type: messageType,
    content: { text },
    attachments: attachments || [],
    entityReference,
    mentions: mentions || [],
    replyTo: replyToData,
  });

  // Update conversation
  const senderName = `${req.user.firstName} ${req.user.lastName}`;
  conversation.updateLastMessage(message, senderName);
  conversation.incrementUnreadExcept(req.user._id);
  await conversation.save();

  // Populate for response
  await message.populate([
    { path: 'sender', select: 'firstName lastName profileImage' },
    { path: 'mentions', select: 'firstName lastName' },
  ]);

  // Emit via Socket.IO
  const io = req.app.get('io');
  if (io) {
    emitToConversation(io, conversation._id.toString(), 'message:new', {
      conversationId: conversation._id,
      message,
    });
  }

  // Fire-and-forget notifications
  const onlineIds = getOnlineUserIds();
  notifyChatMessage(conversation, message, req.user._id, senderName, onlineIds).catch(() => {});
  if (mentions?.length > 0) {
    notifyChatMention(conversation, message, mentions, req.user._id, senderName).catch(() => {});
  }

  res.status(201).json({
    success: true,
    data: { message },
  });
});

/**
 * @desc    Get messages (cursor-based pagination)
 * @route   GET /api/chat/conversations/:id/messages
 * @access  Private (chat:view)
 */
const getMessages = asyncHandler(async (req, res) => {
  const { limit = 50, before, after } = req.query;

  const conversation = await Conversation.findOne({
    _id: req.params.id,
    organization: req.user.organization,
  });

  if (!conversation || !conversation.isParticipant(req.user._id)) {
    res.status(403);
    throw new Error('Not authorized to view this conversation');
  }

  const limitNum = Math.min(parseInt(limit), 100);
  const query = { conversation: req.params.id };

  if (before) {
    query._id = { $lt: new mongoose.Types.ObjectId(before) };
  } else if (after) {
    query._id = { $gt: new mongoose.Types.ObjectId(after) };
  }

  const messages = await Message.find(query)
    .populate('sender', 'firstName lastName profileImage')
    .populate('mentions', 'firstName lastName')
    .populate('reactions.user', 'firstName lastName')
    .populate('pinnedBy', 'firstName lastName')
    .sort({ _id: -1 })
    .limit(limitNum)
    .lean();

  // Transform: show "This message was deleted" for soft-deleted
  const transformed = messages.map((msg) => {
    if (msg.isDeleted) {
      return {
        ...msg,
        content: { text: null },
        attachments: [],
        entityReference: null,
        _isDeletedPlaceholder: true,
      };
    }
    return msg;
  });

  res.json({
    success: true,
    data: {
      messages: transformed,
      hasMore: messages.length === limitNum,
      oldestId: messages.length > 0 ? messages[messages.length - 1]._id : null,
      newestId: messages.length > 0 ? messages[0]._id : null,
    },
  });
});

/**
 * @desc    Get pinned messages in conversation
 * @route   GET /api/chat/conversations/:id/messages/pinned
 * @access  Private (chat:view)
 */
const getPinnedMessages = asyncHandler(async (req, res) => {
  const conversation = await Conversation.findOne({
    _id: req.params.id,
    organization: req.user.organization,
  });

  if (!conversation || !conversation.isParticipant(req.user._id)) {
    res.status(403);
    throw new Error('Not authorized');
  }

  const messages = await Message.find({
    conversation: req.params.id,
    isPinned: true,
    isDeleted: false,
  })
    .populate('sender', 'firstName lastName profileImage')
    .populate('pinnedBy', 'firstName lastName')
    .sort({ pinnedAt: -1 })
    .limit(50)
    .lean();

  res.json({
    success: true,
    data: { messages },
  });
});

/**
 * @desc    Edit message
 * @route   PUT /api/chat/messages/:id
 * @access  Private (chat:send, own message)
 */
const editMessage = asyncHandler(async (req, res) => {
  const { text } = req.body;

  if (!text || text.trim().length === 0) {
    res.status(400);
    throw new Error('Message text is required');
  }

  const message = await Message.findOne({
    _id: req.params.id,
    organization: req.user.organization,
    sender: req.user._id,
    isDeleted: false,
  });

  if (!message) {
    res.status(404);
    throw new Error('Message not found or not authorized');
  }

  message.editMessage(text);
  await message.save();

  const io = req.app.get('io');
  if (io) {
    emitToConversation(io, message.conversation.toString(), 'message:edited', {
      conversationId: message.conversation,
      messageId: message._id,
      text,
      isEdited: true,
      editedAt: message.editedAt,
    });
  }

  res.json({
    success: true,
    message: 'Message edited',
    data: { message },
  });
});

/**
 * @desc    Delete message (soft)
 * @route   DELETE /api/chat/messages/:id
 * @access  Private (own + admin + chat:delete_any)
 */
const deleteMessage = asyncHandler(async (req, res) => {
  const message = await Message.findOne({
    _id: req.params.id,
    organization: req.user.organization,
  });

  if (!message || message.isDeleted) {
    res.status(404);
    throw new Error('Message not found');
  }

  // Authorization
  const isOwnMessage = message.sender?.toString() === req.user._id.toString();
  const conversation = await Conversation.findById(message.conversation);
  const isConvAdmin = conversation?.isAdmin(req.user._id);
  const hasDeleteAny = req.userPermissions.includes('chat:delete_any') || req.isOwner;

  if (!isOwnMessage && !isConvAdmin && !hasDeleteAny) {
    res.status(403);
    throw new Error('Not authorized to delete this message');
  }

  message.softDelete(req.user._id);
  await message.save();

  const io = req.app.get('io');
  if (io) {
    emitToConversation(io, message.conversation.toString(), 'message:deleted', {
      conversationId: message.conversation,
      messageId: message._id,
    });
  }

  res.json({ success: true, message: 'Message deleted' });
});

/**
 * @desc    Toggle reaction on message
 * @route   POST /api/chat/messages/:id/reactions
 * @access  Private (chat:view)
 */
const toggleReaction = asyncHandler(async (req, res) => {
  const { emoji } = req.body;

  if (!emoji) {
    res.status(400);
    throw new Error('Emoji is required');
  }

  const message = await Message.findOne({
    _id: req.params.id,
    organization: req.user.organization,
    isDeleted: false,
  });

  if (!message) {
    res.status(404);
    throw new Error('Message not found');
  }

  const result = message.toggleReaction(req.user._id, emoji);
  await message.save();

  const io = req.app.get('io');
  if (io) {
    emitToConversation(io, message.conversation.toString(), 'message:reaction', {
      conversationId: message.conversation,
      messageId: message._id,
      userId: req.user._id,
      emoji,
      action: result.action,
      reactions: message.reactions,
    });
  }

  res.json({
    success: true,
    data: { ...result, reactions: message.reactions },
  });
});

/**
 * @desc    Toggle pin on message
 * @route   POST /api/chat/messages/:id/pin
 * @access  Private (chat:send)
 */
const togglePin = asyncHandler(async (req, res) => {
  const message = await Message.findOne({
    _id: req.params.id,
    organization: req.user.organization,
    isDeleted: false,
  });

  if (!message) {
    res.status(404);
    throw new Error('Message not found');
  }

  const result = message.togglePin(req.user._id);
  await message.save();

  const io = req.app.get('io');
  if (io) {
    emitToConversation(io, message.conversation.toString(), 'message:pinned', {
      conversationId: message.conversation,
      messageId: message._id,
      isPinned: message.isPinned,
      pinnedBy: req.user._id,
    });
  }

  res.json({
    success: true,
    data: { ...result },
  });
});

/**
 * @desc    Forward message to another conversation
 * @route   POST /api/chat/messages/:id/forward
 * @access  Private (chat:send)
 */
const forwardMessage = asyncHandler(async (req, res) => {
  const { targetConversationId } = req.body;

  if (!targetConversationId) {
    res.status(400);
    throw new Error('Target conversation ID is required');
  }

  const originalMessage = await Message.findOne({
    _id: req.params.id,
    organization: req.user.organization,
    isDeleted: false,
  }).populate('sender', 'firstName lastName');

  if (!originalMessage) {
    res.status(404);
    throw new Error('Message not found');
  }

  const targetConversation = await Conversation.findOne({
    _id: targetConversationId,
    organization: req.user.organization,
  });

  if (!targetConversation || !targetConversation.isParticipant(req.user._id)) {
    res.status(403);
    throw new Error('Not authorized to send to target conversation');
  }

  const forwarded = await Message.create({
    organization: req.user.organization,
    conversation: targetConversationId,
    sender: req.user._id,
    type: originalMessage.type === 'system' ? 'text' : originalMessage.type,
    content: originalMessage.content,
    attachments: originalMessage.attachments,
    entityReference: originalMessage.entityReference,
    forwardedFrom: {
      conversation: originalMessage.conversation,
      message: originalMessage._id,
      senderName: originalMessage.sender
        ? `${originalMessage.sender.firstName} ${originalMessage.sender.lastName}`
        : '',
    },
  });

  const senderName = `${req.user.firstName} ${req.user.lastName}`;
  targetConversation.updateLastMessage(forwarded, senderName);
  targetConversation.incrementUnreadExcept(req.user._id);
  await targetConversation.save();

  await forwarded.populate('sender', 'firstName lastName profileImage');

  const io = req.app.get('io');
  if (io) {
    emitToConversation(io, targetConversationId, 'message:new', {
      conversationId: targetConversationId,
      message: forwarded,
    });
  }

  res.status(201).json({
    success: true,
    message: 'Message forwarded',
    data: { message: forwarded },
  });
});

/**
 * @desc    Create task from message
 * @route   POST /api/chat/messages/:id/create-task
 * @access  Private (chat:view + tasks:create)
 */
const createTaskFromMessage = asyncHandler(async (req, res) => {
  if (!req.userPermissions.includes('tasks:create') && !req.isOwner) {
    res.status(403);
    throw new Error('Not authorized to create tasks');
  }

  const message = await Message.findOne({
    _id: req.params.id,
    organization: req.user.organization,
    isDeleted: false,
  }).populate('sender', 'firstName lastName');

  if (!message) {
    res.status(404);
    throw new Error('Message not found');
  }

  const { title, category, priority, assignedTo, dueDate } = req.body;

  const Task = (await import('../models/taskModel.js')).default;

  const task = await Task.create({
    organization: req.user.organization,
    title: title || `Task from chat message`,
    description: message.content?.text || '',
    category: category || 'General',
    priority: priority || 'Medium',
    assignedTo: assignedTo || req.user._id,
    assignedBy: req.user._id,
    createdBy: req.user._id,
    dueDate,
    status: 'Open',
    source: 'chat',
  });

  res.status(201).json({
    success: true,
    message: 'Task created from message',
    data: { task },
  });
});

// ═══════════════════════════════════════════════════════════════
// ENTITY CONVERSATIONS
// ═══════════════════════════════════════════════════════════════

/**
 * @desc    Get or create entity-linked conversation
 * @route   GET /api/chat/entity/:entityType/:entityId
 * @access  Private (chat:view)
 */
const getEntityConversation = asyncHandler(async (req, res) => {
  const { entityType, entityId } = req.params;

  if (!ENTITY_TYPES.includes(entityType)) {
    res.status(400);
    throw new Error(
      `Invalid entity type. Allowed: ${ENTITY_TYPES.join(', ')}`
    );
  }

  // Resolve display label and participants
  const [displayLabel, entityParticipantIds] = await Promise.all([
    getEntityDisplayLabel(req.user.organization, entityType, entityId),
    getEntityParticipants(req.user.organization, entityType, entityId),
  ]);

  // Ensure requesting user is included
  const participantSet = new Set(entityParticipantIds);
  participantSet.add(req.user._id.toString());
  const allParticipantIds = [...participantSet];

  const conversation = await Conversation.findOrCreateEntity(
    req.user.organization,
    entityType,
    entityId,
    displayLabel,
    req.user._id,
    allParticipantIds
  );

  // If user not yet a participant (e.g., entity was updated), add them
  if (!conversation.isParticipant(req.user._id)) {
    conversation.addParticipant(req.user._id, req.user._id, 'member');
    await conversation.save();
  }

  // Join participants to socket room
  const io = req.app.get('io');
  if (io) {
    allParticipantIds.forEach((uid) => {
      joinConversationRoom(io, uid, conversation._id.toString());
    });
  }

  await conversation.populate(
    'participants.user',
    'firstName lastName email profileImage'
  );

  res.json({
    success: true,
    data: { conversation },
  });
});

// ═══════════════════════════════════════════════════════════════
// SEARCH & PRESENCE
// ═══════════════════════════════════════════════════════════════

/**
 * @desc    Search messages across user's conversations
 * @route   GET /api/chat/search
 * @access  Private (chat:view)
 */
const searchMessages = asyncHandler(async (req, res) => {
  const { q, limit = 20, conversationId } = req.query;

  if (!q || q.trim().length < 2) {
    res.status(400);
    throw new Error('Search query must be at least 2 characters');
  }

  const limitNum = Math.min(parseInt(limit), 50);

  // Get user's conversation IDs
  let conversationIds;
  if (conversationId) {
    // Search within specific conversation
    const conv = await Conversation.findOne({
      _id: conversationId,
      organization: req.user.organization,
    });
    if (!conv || !conv.isParticipant(req.user._id)) {
      res.status(403);
      throw new Error('Not authorized');
    }
    conversationIds = [new mongoose.Types.ObjectId(conversationId)];
  } else {
    const userConvs = await Conversation.find({
      organization: req.user.organization,
      'participants.user': req.user._id,
      'participants.isActive': true,
    })
      .select('_id')
      .lean();
    conversationIds = userConvs.map((c) => c._id);
  }

  const messages = await Message.find(
    {
      conversation: { $in: conversationIds },
      isDeleted: false,
      $text: { $search: q },
    },
    { score: { $meta: 'textScore' } }
  )
    .populate('sender', 'firstName lastName profileImage')
    .populate('conversation', 'name type entity')
    .sort({ score: { $meta: 'textScore' } })
    .limit(limitNum)
    .lean();

  res.json({
    success: true,
    data: { messages, total: messages.length },
  });
});

/**
 * @desc    Get online users in organization
 * @route   GET /api/chat/online
 * @access  Private (chat:view)
 */
const getOnlineUsersEndpoint = asyncHandler(async (req, res) => {
  const onlineIds = getOnlineUserIds();

  // Filter by org — get users in this org who are online
  const onlineInOrg = await User.find({
    _id: { $in: onlineIds },
    organization: req.user.organization,
    isActive: true,
  })
    .select('firstName lastName profileImage')
    .lean();

  res.json({
    success: true,
    data: { onlineUsers: onlineInOrg },
  });
});

// ═══════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════

export {
  // Conversations
  createConversation,
  getConversations,
  getConversationById,
  updateConversation,
  addParticipants,
  removeParticipant,
  markAsRead,
  archiveConversation,
  leaveConversation,
  // Messages
  sendMessage,
  getMessages,
  getPinnedMessages,
  editMessage,
  deleteMessage,
  toggleReaction,
  togglePin,
  forwardMessage,
  createTaskFromMessage,
  // Entity
  getEntityConversation,
  // Search & Presence
  searchMessages,
  getOnlineUsersEndpoint,
};
