// File: routes/notificationRoutes.js
// Description: In-app notification routes — all require authentication, scoped to current user

import express from 'express';
import {
  getNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  getNotificationPreferences,
  updateNotificationPreferences,
} from '../controllers/notificationController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

// All routes require authentication
router.use(protect);

// Specific routes BEFORE parameterized routes
router.get('/unread-count', getUnreadCount);
router.get('/preferences', getNotificationPreferences);
router.put('/preferences', updateNotificationPreferences);
router.put('/read-all', markAllAsRead);

// Generic routes
router.get('/', getNotifications);
router.put('/:id/read', markAsRead);
router.delete('/:id', deleteNotification);

export default router;
