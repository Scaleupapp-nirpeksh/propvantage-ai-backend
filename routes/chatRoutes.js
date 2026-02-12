// File: routes/chatRoutes.js
// Description: Chat/messaging routes with permission-based access control

import express from 'express';
import {
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
} from '../controllers/chatController.js';
import {
  protect,
  hasPermission,
  hasAnyPermission,
} from '../middleware/authMiddleware.js';
import { PERMISSIONS } from '../config/permissions.js';

const router = express.Router();

// All routes require authentication
router.use(protect);

// =============================================================================
// SEARCH & PRESENCE (before :id routes)
// =============================================================================
router.get('/search', hasPermission(PERMISSIONS.CHAT.VIEW), searchMessages);
router.get('/online', hasPermission(PERMISSIONS.CHAT.VIEW), getOnlineUsersEndpoint);

// =============================================================================
// ENTITY CONVERSATIONS (before :id routes)
// =============================================================================
router.get(
  '/entity/:entityType/:entityId',
  hasPermission(PERMISSIONS.CHAT.VIEW),
  getEntityConversation
);

// =============================================================================
// CONVERSATION CRUD
// =============================================================================
router.post('/conversations', hasPermission(PERMISSIONS.CHAT.SEND), createConversation);
router.get('/conversations', hasPermission(PERMISSIONS.CHAT.VIEW), getConversations);
router.get('/conversations/:id', hasPermission(PERMISSIONS.CHAT.VIEW), getConversationById);
router.put('/conversations/:id', hasPermission(PERMISSIONS.CHAT.SEND), updateConversation);
router.delete('/conversations/:id', hasPermission(PERMISSIONS.CHAT.VIEW), leaveConversation);

// =============================================================================
// CONVERSATION PARTICIPANTS
// =============================================================================
router.post(
  '/conversations/:id/participants',
  hasPermission(PERMISSIONS.CHAT.SEND),
  addParticipants
);
router.delete(
  '/conversations/:id/participants/:userId',
  hasPermission(PERMISSIONS.CHAT.SEND),
  removeParticipant
);

// =============================================================================
// CONVERSATION ACTIONS
// =============================================================================
router.put('/conversations/:id/read', hasPermission(PERMISSIONS.CHAT.VIEW), markAsRead);
router.put('/conversations/:id/archive', hasPermission(PERMISSIONS.CHAT.VIEW), archiveConversation);

// =============================================================================
// MESSAGES
// =============================================================================
router.post('/conversations/:id/messages', hasPermission(PERMISSIONS.CHAT.SEND), sendMessage);
router.get('/conversations/:id/messages', hasPermission(PERMISSIONS.CHAT.VIEW), getMessages);
router.get(
  '/conversations/:id/messages/pinned',
  hasPermission(PERMISSIONS.CHAT.VIEW),
  getPinnedMessages
);

// =============================================================================
// MESSAGE ACTIONS (by message ID)
// =============================================================================
router.put('/messages/:id', hasPermission(PERMISSIONS.CHAT.SEND), editMessage);
router.delete('/messages/:id', hasPermission(PERMISSIONS.CHAT.SEND), deleteMessage);
router.post('/messages/:id/reactions', hasPermission(PERMISSIONS.CHAT.VIEW), toggleReaction);
router.post('/messages/:id/pin', hasPermission(PERMISSIONS.CHAT.SEND), togglePin);
router.post('/messages/:id/forward', hasPermission(PERMISSIONS.CHAT.SEND), forwardMessage);
router.post(
  '/messages/:id/create-task',
  hasAnyPermission(PERMISSIONS.CHAT.VIEW, PERMISSIONS.TASKS.CREATE),
  createTaskFromMessage
);

export default router;
