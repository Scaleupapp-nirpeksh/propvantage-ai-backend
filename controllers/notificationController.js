// File: controllers/notificationController.js
// Description: In-app notification endpoints — fetch, mark read, preferences

import asyncHandler from 'express-async-handler';
import Notification, { NOTIFICATION_TYPES } from '../models/notificationModel.js';
import User from '../models/userModel.js';

// =============================================================================
// FETCH NOTIFICATIONS
// =============================================================================

/**
 * @desc    Get current user's notifications (paginated, filterable)
 * @route   GET /api/notifications
 * @access  Private
 */
const getNotifications = asyncHandler(async (req, res) => {
  const {
    page = 1,
    limit = 20,
    isRead,
    type,
    priority,
  } = req.query;

  const query = { recipient: req.user._id };

  // Filters
  if (isRead === 'true') query.isRead = true;
  if (isRead === 'false') query.isRead = false;

  if (type) {
    const types = type.split(',').filter((t) => NOTIFICATION_TYPES.includes(t));
    if (types.length > 0) query.type = { $in: types };
  }

  if (priority) {
    const priorities = priority.split(',');
    query.priority = { $in: priorities };
  }

  const pageNum = parseInt(page);
  const limitNum = Math.min(parseInt(limit), 50); // Cap at 50
  const skip = (pageNum - 1) * limitNum;

  const [notifications, total] = await Promise.all([
    Notification.find(query)
      .populate('actor', 'firstName lastName')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .lean(),
    Notification.countDocuments(query),
  ]);

  res.json({
    success: true,
    data: {
      notifications,
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

// =============================================================================
// UNREAD COUNT
// =============================================================================

/**
 * @desc    Get unread notification count (for bell badge)
 * @route   GET /api/notifications/unread-count
 * @access  Private
 */
const getUnreadCount = asyncHandler(async (req, res) => {
  const count = await Notification.getUnreadCount(req.user._id);

  res.json({
    success: true,
    data: { count },
  });
});

// =============================================================================
// MARK AS READ
// =============================================================================

/**
 * @desc    Mark a single notification as read
 * @route   PUT /api/notifications/:id/read
 * @access  Private
 */
const markAsRead = asyncHandler(async (req, res) => {
  const notification = await Notification.findOne({
    _id: req.params.id,
    recipient: req.user._id,
  });

  if (!notification) {
    res.status(404);
    throw new Error('Notification not found');
  }

  if (!notification.isRead) {
    notification.isRead = true;
    notification.readAt = new Date();
    await notification.save();
  }

  res.json({
    success: true,
    message: 'Notification marked as read',
    data: { notification },
  });
});

/**
 * @desc    Mark all notifications as read
 * @route   PUT /api/notifications/read-all
 * @access  Private
 */
const markAllAsRead = asyncHandler(async (req, res) => {
  const result = await Notification.markAllRead(req.user._id);

  res.json({
    success: true,
    message: `${result.modifiedCount} notification(s) marked as read`,
    data: { modifiedCount: result.modifiedCount },
  });
});

// =============================================================================
// DELETE
// =============================================================================

/**
 * @desc    Delete a single notification
 * @route   DELETE /api/notifications/:id
 * @access  Private
 */
const deleteNotification = asyncHandler(async (req, res) => {
  const notification = await Notification.findOneAndDelete({
    _id: req.params.id,
    recipient: req.user._id,
  });

  if (!notification) {
    res.status(404);
    throw new Error('Notification not found');
  }

  res.json({
    success: true,
    message: 'Notification deleted',
  });
});

// =============================================================================
// PREFERENCES
// =============================================================================

/**
 * @desc    Get notification preferences for current user
 * @route   GET /api/notifications/preferences
 * @access  Private
 */
const getNotificationPreferences = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).select('preferences.notificationPreferences').lean();

  // Return defaults if not set
  const defaults = {};
  NOTIFICATION_TYPES.forEach((t) => { defaults[t] = true; });

  const prefs = user?.preferences?.notificationPreferences || {};
  const merged = { ...defaults, ...prefs };

  res.json({
    success: true,
    data: {
      preferences: merged,
      availableTypes: NOTIFICATION_TYPES,
    },
  });
});

/**
 * @desc    Update notification preferences for current user
 * @route   PUT /api/notifications/preferences
 * @access  Private
 */
const updateNotificationPreferences = asyncHandler(async (req, res) => {
  const { preferences } = req.body;

  if (!preferences || typeof preferences !== 'object') {
    res.status(400);
    throw new Error('preferences object is required');
  }

  // Build update object — only accept known notification types with boolean values
  const update = {};
  for (const [key, value] of Object.entries(preferences)) {
    if (NOTIFICATION_TYPES.includes(key) && typeof value === 'boolean') {
      update[`preferences.notificationPreferences.${key}`] = value;
    }
  }

  if (Object.keys(update).length === 0) {
    res.status(400);
    throw new Error('No valid preference updates provided');
  }

  const user = await User.findByIdAndUpdate(
    req.user._id,
    { $set: update },
    { new: true }
  ).select('preferences.notificationPreferences');

  res.json({
    success: true,
    message: 'Notification preferences updated',
    data: { preferences: user.preferences.notificationPreferences },
  });
});

export {
  getNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  getNotificationPreferences,
  updateNotificationPreferences,
};
