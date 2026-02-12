// File: socket/socketHandler.js
// Description: Socket.IO handler for real-time chat events

import jwt from 'jsonwebtoken';
import User from '../models/userModel.js';
import Conversation from '../models/conversationModel.js';

// ─── IN-MEMORY STORES ────────────────────────────────────────
// userId -> Set<socketId> (one user can have multiple tabs/devices)
const onlineUsers = new Map();

// conversationId -> Set<userId> (who is currently typing)
const typingUsers = new Map();

// ─── MAIN INITIALIZER ────────────────────────────────────────

export function initializeSocket(io) {
  // ─── AUTH MIDDLEWARE ──────────────────────────────────────
  io.use(async (socket, next) => {
    try {
      const token =
        socket.handshake.auth?.token ||
        socket.handshake.headers?.authorization?.split(' ')[1];

      if (!token) {
        return next(new Error('Authentication error: No token provided'));
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      const user = await User.findById(decoded.userId)
        .select('-password')
        .lean();

      if (!user || !user.isActive) {
        return next(new Error('Authentication error: User not found or inactive'));
      }

      socket.userId = user._id.toString();
      socket.organizationId = user.organization.toString();
      socket.userName = `${user.firstName} ${user.lastName}`.trim();

      next();
    } catch (error) {
      next(new Error('Authentication error: Invalid token'));
    }
  });

  // ─── CONNECTION ──────────────────────────────────────────
  io.on('connection', async (socket) => {
    console.log(`[Socket] User connected: ${socket.userName} (${socket.userId})`);

    // Track online status
    if (!onlineUsers.has(socket.userId)) {
      onlineUsers.set(socket.userId, new Set());
    }
    onlineUsers.get(socket.userId).add(socket.id);

    // Join org room
    socket.join(`org:${socket.organizationId}`);

    // Broadcast online status to org
    socket.to(`org:${socket.organizationId}`).emit('user:online', {
      userId: socket.userId,
    });

    // Auto-join user's conversations
    try {
      const conversations = await Conversation.find({
        organization: socket.organizationId,
        'participants.user': socket.userId,
        'participants.isActive': true,
      }).select('_id').lean();

      conversations.forEach((conv) => {
        socket.join(`conversation:${conv._id}`);
      });
    } catch (err) {
      console.error('[Socket] Error joining conversations:', err.message);
    }

    // ─── CONVERSATION EVENTS ─────────────────────────────

    socket.on('conversation:join', ({ conversationId }) => {
      socket.join(`conversation:${conversationId}`);
    });

    socket.on('conversation:leave', ({ conversationId }) => {
      socket.leave(`conversation:${conversationId}`);
    });

    socket.on('conversation:read', async ({ conversationId }, callback) => {
      try {
        const conversation = await Conversation.findOne({
          _id: conversationId,
          organization: socket.organizationId,
        });

        if (!conversation || !conversation.isParticipant(socket.userId)) {
          return callback?.({ success: false, error: 'Not authorized' });
        }

        conversation.markAsRead(socket.userId);
        await conversation.save();

        // Broadcast read receipt
        io.to(`conversation:${conversationId}`).emit('conversation:read', {
          conversationId,
          userId: socket.userId,
          timestamp: new Date(),
        });

        callback?.({ success: true });
      } catch (error) {
        console.error('[Socket] conversation:read error:', error.message);
        callback?.({ success: false, error: error.message });
      }
    });

    // ─── TYPING INDICATORS ───────────────────────────────

    socket.on('typing:start', ({ conversationId }) => {
      if (!typingUsers.has(conversationId)) {
        typingUsers.set(conversationId, new Set());
      }
      typingUsers.get(conversationId).add(socket.userId);

      socket.to(`conversation:${conversationId}`).emit('typing:start', {
        conversationId,
        userId: socket.userId,
        userName: socket.userName,
      });
    });

    socket.on('typing:stop', ({ conversationId }) => {
      if (typingUsers.has(conversationId)) {
        typingUsers.get(conversationId).delete(socket.userId);
      }

      socket.to(`conversation:${conversationId}`).emit('typing:stop', {
        conversationId,
        userId: socket.userId,
      });
    });

    // ─── DISCONNECT ──────────────────────────────────────

    socket.on('disconnect', () => {
      console.log(`[Socket] User disconnected: ${socket.userName} (${socket.userId})`);

      // Remove socket from user's set
      if (onlineUsers.has(socket.userId)) {
        onlineUsers.get(socket.userId).delete(socket.id);

        // Only emit offline if user has no more connections
        if (onlineUsers.get(socket.userId).size === 0) {
          onlineUsers.delete(socket.userId);

          socket.to(`org:${socket.organizationId}`).emit('user:offline', {
            userId: socket.userId,
          });
        }
      }

      // Clear typing indicators for this user
      typingUsers.forEach((users, conversationId) => {
        if (users.has(socket.userId)) {
          users.delete(socket.userId);
          io.to(`conversation:${conversationId}`).emit('typing:stop', {
            conversationId,
            userId: socket.userId,
          });
        }
      });
    });
  });

  console.log('[Socket] Socket.IO initialized');
}

// ─── EXPORTED HELPERS FOR CONTROLLERS ────────────────────────

/**
 * Get array of currently online user IDs.
 */
export function getOnlineUserIds() {
  return Array.from(onlineUsers.keys());
}

/**
 * Check if a specific user is online.
 */
export function isUserOnline(userId) {
  return onlineUsers.has(userId.toString());
}

/**
 * Emit a real-time event to a conversation room.
 * Used by REST controllers after creating/editing/deleting messages.
 */
export function emitToConversation(io, conversationId, event, data) {
  io.to(`conversation:${conversationId}`).emit(event, data);
}

/**
 * Emit an event to a specific user (all their connected sockets).
 */
export function emitToUser(io, userId, event, data) {
  const userSockets = onlineUsers.get(userId.toString());
  if (userSockets) {
    userSockets.forEach((socketId) => {
      io.to(socketId).emit(event, data);
    });
  }
}

/**
 * Make a specific socket join a conversation room.
 * Called after creating a new conversation to ensure participants receive events.
 */
export function joinConversationRoom(io, userId, conversationId) {
  const userSockets = onlineUsers.get(userId.toString());
  if (userSockets) {
    userSockets.forEach((socketId) => {
      const socket = io.sockets.sockets.get(socketId);
      if (socket) {
        socket.join(`conversation:${conversationId}`);
      }
    });
  }
}
