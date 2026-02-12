// File: services/notificationService.js
// Description: Central service for creating and managing in-app notifications.
// All notification creation goes through this service to keep logic in one place.

import mongoose from 'mongoose';
import Notification, { NOTIFICATION_TYPES } from '../models/notificationModel.js';
import User from '../models/userModel.js';
import Task from '../models/taskModel.js';

// =============================================================================
// CORE FUNCTIONS
// =============================================================================

/**
 * Create a single in-app notification
 * Checks user preferences before creating — if user has disabled the type, skips it.
 */
export async function createNotification({
  organization,
  recipient,
  type,
  title,
  message,
  actionUrl,
  relatedEntity,
  priority = 'medium',
  actor,
  metadata,
}) {
  try {
    // Skip if recipient is the same as the actor (don't notify yourself)
    if (actor && recipient && actor.toString() === recipient.toString()) {
      return null;
    }

    // Check user preferences
    const user = await User.findById(recipient).select('preferences').lean();
    if (user?.preferences?.notificationPreferences?.[type] === false) {
      return null; // User has disabled this notification type
    }

    const notification = await Notification.create({
      organization,
      recipient,
      type,
      title,
      message,
      actionUrl,
      relatedEntity,
      priority,
      actor,
      metadata,
    });

    return notification;
  } catch (error) {
    console.error(`❌ [NotificationService] createNotification failed:`, error.message);
    return null;
  }
}

/**
 * Create multiple notifications at once (for cron jobs / bulk operations)
 * Filters out disabled notification types per user.
 */
export async function createBulkNotifications(notifications) {
  try {
    if (!notifications || notifications.length === 0) return [];

    // Gather unique recipient IDs
    const recipientIds = [...new Set(notifications.map((n) => n.recipient.toString()))];

    // Fetch preferences for all recipients in one query
    const users = await User.find({ _id: { $in: recipientIds } })
      .select('_id preferences')
      .lean();

    const prefsMap = {};
    users.forEach((u) => {
      prefsMap[u._id.toString()] = u.preferences?.notificationPreferences || {};
    });

    // Filter out notifications where user has disabled the type or actor === recipient
    const filtered = notifications.filter((n) => {
      if (n.actor && n.recipient && n.actor.toString() === n.recipient.toString()) return false;
      const userPrefs = prefsMap[n.recipient.toString()] || {};
      return userPrefs[n.type] !== false;
    });

    if (filtered.length === 0) return [];

    const created = await Notification.insertMany(filtered, { ordered: false });
    return created;
  } catch (error) {
    console.error(`❌ [NotificationService] createBulkNotifications failed:`, error.message);
    return [];
  }
}

// =============================================================================
// TASK NOTIFICATION HELPERS
// =============================================================================

/**
 * Notify when a task is assigned to someone
 */
export async function notifyTaskAssigned({ task, assignee, assigner }) {
  if (!task || !assignee) return;

  const assigneeId = assignee._id || assignee;
  const assignerId = assigner?._id || assigner;
  const assignerName = assigner?.firstName
    ? `${assigner.firstName} ${assigner.lastName || ''}`.trim()
    : 'System';

  return createNotification({
    organization: task.organization,
    recipient: assigneeId,
    type: 'task_assigned',
    title: `Task assigned: ${task.taskNumber}`,
    message: `${assignerName} assigned you "${task.title}" — Priority: ${task.priority}`,
    actionUrl: `/tasks/${task._id}`,
    relatedEntity: {
      entityType: 'Task',
      entityId: task._id,
      displayLabel: task.taskNumber || task.displayId,
    },
    priority: task.priority === 'Critical' ? 'urgent' : 'high',
    actor: assignerId,
    metadata: {
      taskNumber: task.taskNumber,
      taskPriority: task.priority,
      taskCategory: task.category,
      dueDate: task.dueDate,
    },
  });
}

/**
 * Notify watchers + creator when a task status changes
 */
export async function notifyTaskStatusChanged({ task, changedBy, oldStatus, newStatus }) {
  if (!task) return;

  const changedById = changedBy?._id || changedBy;
  const changedByName = changedBy?.firstName
    ? `${changedBy.firstName} ${changedBy.lastName || ''}`.trim()
    : 'System';

  // Collect recipients: creator + watchers + assignee (excluding the person who made the change)
  const recipientSet = new Set();
  if (task.createdBy) recipientSet.add(task.createdBy.toString());
  if (task.assignedTo) recipientSet.add(task.assignedTo.toString());
  if (task.watchers) task.watchers.forEach((w) => recipientSet.add(w.toString()));
  if (changedById) recipientSet.delete(changedById.toString());

  if (recipientSet.size === 0) return;

  const notifications = [...recipientSet].map((recipientId) => ({
    organization: task.organization,
    recipient: new mongoose.Types.ObjectId(recipientId),
    type: 'task_status_changed',
    title: `${task.taskNumber}: ${oldStatus} → ${newStatus}`,
    message: `${changedByName} changed the status of "${task.title}"`,
    actionUrl: `/tasks/${task._id}`,
    relatedEntity: {
      entityType: 'Task',
      entityId: task._id,
      displayLabel: task.taskNumber,
    },
    priority: 'medium',
    actor: changedById,
    metadata: { taskNumber: task.taskNumber, oldStatus, newStatus },
  }));

  return createBulkNotifications(notifications);
}

/**
 * Notify creator + assignedBy when a task is completed
 */
export async function notifyTaskCompleted({ task, completedBy }) {
  if (!task) return;

  const completedById = completedBy?._id || completedBy;
  const completedByName = completedBy?.firstName
    ? `${completedBy.firstName} ${completedBy.lastName || ''}`.trim()
    : 'Someone';

  const recipientSet = new Set();
  if (task.createdBy) recipientSet.add(task.createdBy.toString());
  if (task.assignedBy) recipientSet.add(task.assignedBy.toString());
  if (completedById) recipientSet.delete(completedById.toString());

  if (recipientSet.size === 0) return;

  const notifications = [...recipientSet].map((recipientId) => ({
    organization: task.organization,
    recipient: new mongoose.Types.ObjectId(recipientId),
    type: 'task_completed',
    title: `${task.taskNumber} completed`,
    message: `${completedByName} completed "${task.title}"`,
    actionUrl: `/tasks/${task._id}`,
    relatedEntity: {
      entityType: 'Task',
      entityId: task._id,
      displayLabel: task.taskNumber,
    },
    priority: 'medium',
    actor: completedById,
    metadata: { taskNumber: task.taskNumber, taskCategory: task.category },
  }));

  return createBulkNotifications(notifications);
}

/**
 * Notify watchers + assignee when a comment is added (excluding the author)
 */
export async function notifyTaskComment({ task, comment, author }) {
  if (!task || !comment) return;

  const authorId = author?._id || author;
  const authorName = author?.firstName
    ? `${author.firstName} ${author.lastName || ''}`.trim()
    : 'Someone';

  const recipientSet = new Set();
  if (task.assignedTo) recipientSet.add(task.assignedTo.toString());
  if (task.createdBy) recipientSet.add(task.createdBy.toString());
  if (task.watchers) task.watchers.forEach((w) => recipientSet.add(w.toString()));
  if (authorId) recipientSet.delete(authorId.toString());

  if (recipientSet.size === 0) return;

  const commentPreview = (comment.text || comment).substring(0, 100);

  const notifications = [...recipientSet].map((recipientId) => ({
    organization: task.organization,
    recipient: new mongoose.Types.ObjectId(recipientId),
    type: 'task_comment',
    title: `Comment on ${task.taskNumber}`,
    message: `${authorName}: "${commentPreview}${commentPreview.length >= 100 ? '...' : ''}"`,
    actionUrl: `/tasks/${task._id}`,
    relatedEntity: {
      entityType: 'Task',
      entityId: task._id,
      displayLabel: task.taskNumber,
    },
    priority: 'medium',
    actor: authorId,
    metadata: { taskNumber: task.taskNumber },
  }));

  return createBulkNotifications(notifications);
}

/**
 * Notify users who are @mentioned in a comment
 */
export async function notifyTaskMention({ task, mentionedUsers, commenter, commentText }) {
  if (!task || !mentionedUsers || mentionedUsers.length === 0) return;

  const commenterId = commenter?._id || commenter;
  const commenterName = commenter?.firstName
    ? `${commenter.firstName} ${commenter.lastName || ''}`.trim()
    : 'Someone';

  const preview = (commentText || '').substring(0, 100);

  const notifications = mentionedUsers
    .filter((u) => {
      const userId = u._id || u;
      return userId.toString() !== commenterId?.toString();
    })
    .map((u) => {
      const userId = u._id || u;
      return {
        organization: task.organization,
        recipient: typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId,
        type: 'task_mention',
        title: `Mentioned in ${task.taskNumber}`,
        message: `${commenterName} mentioned you: "${preview}${preview.length >= 100 ? '...' : ''}"`,
        actionUrl: `/tasks/${task._id}`,
        relatedEntity: {
          entityType: 'Task',
          entityId: task._id,
          displayLabel: task.taskNumber,
        },
        priority: 'high',
        actor: commenterId,
        metadata: { taskNumber: task.taskNumber },
      };
    });

  if (notifications.length === 0) return;
  return createBulkNotifications(notifications);
}

/**
 * Notify manager when a task is escalated to them
 */
export async function notifyTaskEscalated({ task, escalatedTo, level, reason }) {
  if (!task || !escalatedTo) return;

  const escalatedToId = escalatedTo._id || escalatedTo;

  return createNotification({
    organization: task.organization,
    recipient: escalatedToId,
    type: 'task_escalated',
    title: `Escalation L${level}: ${task.taskNumber}`,
    message: reason || `"${task.title}" has been escalated to you — Priority: ${task.priority}`,
    actionUrl: `/tasks/${task._id}`,
    relatedEntity: {
      entityType: 'Task',
      entityId: task._id,
      displayLabel: task.taskNumber,
    },
    priority: 'urgent',
    metadata: {
      taskNumber: task.taskNumber,
      escalationLevel: level,
      taskPriority: task.priority,
    },
  });
}

/**
 * Notify assignee when a task is auto-generated for them
 */
export async function notifyTaskAutoGenerated({ task }) {
  if (!task || !task.assignedTo) return;

  const triggerLabels = {
    overdue_payment: 'Overdue Payment',
    missed_follow_up: 'Missed Follow-up',
    delayed_milestone: 'Delayed Milestone',
    new_sale_onboarding: 'New Sale Onboarding',
    recurring_schedule: 'Recurring Task',
  };

  const triggerLabel = triggerLabels[task.autoGenerated?.triggerType] || 'Auto-generated';

  return createNotification({
    organization: task.organization,
    recipient: task.assignedTo,
    type: 'task_auto_generated',
    title: `New task: ${task.taskNumber}`,
    message: `[${triggerLabel}] "${task.title}" has been created and assigned to you`,
    actionUrl: `/tasks/${task._id}`,
    relatedEntity: {
      entityType: 'Task',
      entityId: task._id,
      displayLabel: task.taskNumber,
    },
    priority: task.priority === 'Critical' ? 'high' : 'medium',
    metadata: {
      taskNumber: task.taskNumber,
      triggerType: task.autoGenerated?.triggerType,
      taskPriority: task.priority,
      taskCategory: task.category,
    },
  });
}

// =============================================================================
// CRON JOB FUNCTIONS
// =============================================================================

/**
 * Generate daily task digest notifications — tasks due today + overdue tasks
 * Called once per day (8:00 AM IST) via backgroundJobService cron
 */
export async function generateDailyTaskDigest() {
  try {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
    const todayStr = now.toISOString().split('T')[0]; // YYYY-MM-DD for dedup

    console.log('🔔 [NotificationService] Running daily task digest...');

    // ── Tasks due today ──
    const tasksDueToday = await Task.find({
      status: { $nin: ['Completed', 'Cancelled'] },
      dueDate: { $gte: startOfDay, $lte: endOfDay },
      assignedTo: { $exists: true, $ne: null },
    })
      .select('organization assignedTo taskNumber title priority category dueDate')
      .lean();

    // Group by assignee
    const dueTodayByUser = {};
    tasksDueToday.forEach((t) => {
      const key = t.assignedTo.toString();
      if (!dueTodayByUser[key]) dueTodayByUser[key] = { organization: t.organization, tasks: [] };
      dueTodayByUser[key].tasks.push(t);
    });

    const dueTodayNotifications = [];
    for (const [userId, data] of Object.entries(dueTodayByUser)) {
      const count = data.tasks.length;
      const topTask = data.tasks[0];
      dueTodayNotifications.push({
        organization: data.organization,
        recipient: new mongoose.Types.ObjectId(userId),
        type: 'task_due_today',
        title: `${count} task${count > 1 ? 's' : ''} due today`,
        message: count === 1
          ? `"${topTask.title}" (${topTask.taskNumber}) is due today`
          : `"${topTask.title}" and ${count - 1} more task${count - 1 > 1 ? 's are' : ' is'} due today`,
        actionUrl: '/tasks/my',
        priority: 'high',
        metadata: {
          taskCount: count,
          date: todayStr,
          taskNumbers: data.tasks.map((t) => t.taskNumber),
        },
      });
    }

    // ── Overdue tasks ──
    const overdueTasks = await Task.find({
      status: { $nin: ['Completed', 'Cancelled'] },
      dueDate: { $lt: startOfDay },
      assignedTo: { $exists: true, $ne: null },
    })
      .select('organization assignedTo taskNumber title priority category dueDate')
      .lean();

    const overdueByUser = {};
    overdueTasks.forEach((t) => {
      const key = t.assignedTo.toString();
      if (!overdueByUser[key]) overdueByUser[key] = { organization: t.organization, tasks: [] };
      overdueByUser[key].tasks.push(t);
    });

    const overdueNotifications = [];
    for (const [userId, data] of Object.entries(overdueByUser)) {
      const count = data.tasks.length;
      const mostOverdue = data.tasks[0];
      const daysOverdue = Math.floor((now - new Date(mostOverdue.dueDate)) / (1000 * 60 * 60 * 24));

      overdueNotifications.push({
        organization: data.organization,
        recipient: new mongoose.Types.ObjectId(userId),
        type: 'task_overdue',
        title: `${count} overdue task${count > 1 ? 's' : ''}`,
        message: count === 1
          ? `"${mostOverdue.title}" (${mostOverdue.taskNumber}) is ${daysOverdue} day${daysOverdue > 1 ? 's' : ''} overdue`
          : `You have ${count} overdue tasks — oldest is ${daysOverdue} day${daysOverdue > 1 ? 's' : ''} overdue`,
        actionUrl: '/tasks/my',
        priority: 'urgent',
        metadata: {
          taskCount: count,
          date: todayStr,
          taskNumbers: data.tasks.map((t) => t.taskNumber),
        },
      });
    }

    const allNotifications = [...dueTodayNotifications, ...overdueNotifications];
    if (allNotifications.length > 0) {
      await createBulkNotifications(allNotifications);
    }

    console.log(
      `✅ [NotificationService] Daily digest: ${dueTodayNotifications.length} due-today, ${overdueNotifications.length} overdue notifications`
    );
  } catch (error) {
    console.error('❌ [NotificationService] generateDailyTaskDigest failed:', error.message);
  }
}

/**
 * Generate "due soon" notifications — tasks due within 24 hours
 * Called every 4 hours via backgroundJobService cron
 */
export async function generateDueSoonNotifications() {
  try {
    const now = new Date();
    const in24Hours = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    console.log('🔔 [NotificationService] Checking for tasks due soon...');

    const tasksDueSoon = await Task.find({
      status: { $nin: ['Completed', 'Cancelled'] },
      dueDate: { $gt: now, $lte: in24Hours },
      assignedTo: { $exists: true, $ne: null },
    })
      .select('organization assignedTo taskNumber title priority category dueDate')
      .lean();

    if (tasksDueSoon.length === 0) {
      console.log('✅ [NotificationService] No tasks due in the next 24 hours');
      return;
    }

    // Dedup: check which tasks already have a due_soon notification created today
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const existingNotifications = await Notification.find({
      type: 'task_due_soon',
      'relatedEntity.entityType': 'Task',
      'relatedEntity.entityId': { $in: tasksDueSoon.map((t) => t._id) },
      createdAt: { $gte: todayStart },
    })
      .select('relatedEntity.entityId')
      .lean();

    const alreadyNotifiedIds = new Set(
      existingNotifications.map((n) => n.relatedEntity.entityId.toString())
    );

    const notifications = tasksDueSoon
      .filter((t) => !alreadyNotifiedIds.has(t._id.toString()))
      .map((t) => ({
        organization: t.organization,
        recipient: t.assignedTo,
        type: 'task_due_soon',
        title: `Due soon: ${t.taskNumber}`,
        message: `"${t.title}" is due within 24 hours — Priority: ${t.priority}`,
        actionUrl: `/tasks/${t._id}`,
        relatedEntity: {
          entityType: 'Task',
          entityId: t._id,
          displayLabel: t.taskNumber,
        },
        priority: 'medium',
        metadata: {
          taskNumber: t.taskNumber,
          taskPriority: t.priority,
          dueDate: t.dueDate,
        },
      }));

    if (notifications.length > 0) {
      await createBulkNotifications(notifications);
    }

    console.log(`✅ [NotificationService] Due-soon: ${notifications.length} notifications created`);
  } catch (error) {
    console.error('❌ [NotificationService] generateDueSoonNotifications failed:', error.message);
  }
}
