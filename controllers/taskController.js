// File: controllers/taskController.js
// Description: Complete task management controller with CRUD, status transitions,
// comments, sub-tasks, bulk operations, personal/team views, analytics, and templates.

import asyncHandler from 'express-async-handler';
import mongoose from 'mongoose';
import Task from '../models/taskModel.js';
import TaskTemplate from '../models/taskTemplateModel.js';
import User from '../models/userModel.js';
import Role from '../models/roleModel.js';
import {
  notifyTaskAssigned,
  notifyTaskStatusChanged,
  notifyTaskCompleted,
  notifyTaskComment,
  notifyTaskMention,
} from '../services/notificationService.js';

// =============================================================================
// CRUD OPERATIONS
// =============================================================================

/**
 * @desc    Create a new task
 * @route   POST /api/tasks
 * @access  Private (tasks:create)
 */
const createTask = asyncHandler(async (req, res) => {
  const {
    title,
    description,
    category,
    priority,
    assignedTo,
    dueDate,
    startDate,
    tags,
    checklist,
    linkedEntity,
    parentTask,
    recurrence,
    createdFromTemplate,
    sla,
  } = req.body;

  if (!title) {
    res.status(400);
    throw new Error('Task title is required');
  }

  // Validate assignee exists in org
  if (assignedTo) {
    const assignee = await User.findOne({
      _id: assignedTo,
      organization: req.user.organization,
    }).select('_id');
    if (!assignee) {
      res.status(400);
      throw new Error('Assigned user not found in your organization');
    }
  }

  // Validate parent task if provided
  let parentDepth = 0;
  if (parentTask) {
    const parent = await Task.findOne({
      _id: parentTask,
      organization: req.user.organization,
    }).select('depth');
    if (!parent) {
      res.status(400);
      throw new Error('Parent task not found in your organization');
    }
    if (parent.depth >= 3) {
      res.status(400);
      throw new Error('Maximum sub-task depth (3) exceeded');
    }
    parentDepth = parent.depth + 1;
  }

  // Determine assignment type
  let assignmentType = 'direct';
  if (!assignedTo || assignedTo === req.user._id.toString()) {
    assignmentType = 'self';
  }

  const task = await Task.create({
    organization: req.user.organization,
    title,
    description,
    category: category || 'General',
    priority: priority || 'Medium',
    assignedTo: assignedTo || req.user._id,
    assignedBy: req.user._id,
    assignmentType,
    dueDate,
    startDate,
    tags,
    checklist,
    linkedEntity,
    parentTask: parentTask || null,
    depth: parentDepth,
    recurrence,
    createdFromTemplate,
    sla,
    createdBy: req.user._id,
  });

  // If this is a sub-task, log on parent
  if (parentTask) {
    await Task.findByIdAndUpdate(parentTask, {
      $push: {
        activityLog: {
          action: 'sub_task_added',
          performedBy: req.user._id,
          details: { subTaskId: task._id, subTaskTitle: title },
        },
      },
    });
  }

  const populated = await Task.findById(task._id)
    .populate('assignedTo', 'firstName lastName email')
    .populate('createdBy', 'firstName lastName email');

  // Fire-and-forget: notify assignee
  if (assignedTo && assignedTo !== req.user._id.toString()) {
    notifyTaskAssigned({ task: populated, assignee: assignedTo, assigner: req.user }).catch(() => {});
  }

  res.status(201).json({
    success: true,
    message: 'Task created successfully',
    data: { task: populated },
  });
});

/**
 * @desc    Get all tasks (paginated, filtered, permission-scoped)
 * @route   GET /api/tasks
 * @access  Private (tasks:view / tasks:view_team / tasks:view_all)
 */
const getTasks = asyncHandler(async (req, res) => {
  const {
    page = 1,
    limit = 20,
    sortBy = 'createdAt',
    sortOrder = 'desc',
    status,
    priority,
    category,
    assignedTo,
    dueBefore,
    dueAfter,
    search,
    tags,
    isOverdue,
    linkedEntityType,
    parentTask,
  } = req.query;

  const query = { organization: req.user.organization };

  // Permission-based scoping
  const userPerms = req.userPermissions || [];
  if (userPerms.includes('tasks:view_all')) {
    // See all org tasks — no additional filter
  } else if (userPerms.includes('tasks:view_team')) {
    // See own tasks + tasks assigned to subordinates
    const subordinates = await User.find({
      organization: req.user.organization,
      'roleRef': { $exists: true },
    })
      .populate('roleRef', 'level')
      .select('_id roleRef');

    const subordinateIds = subordinates
      .filter((u) => u.roleRef && u.roleRef.level > req.userRoleLevel)
      .map((u) => u._id);

    subordinateIds.push(req.user._id);
    query.$or = [
      { assignedTo: { $in: subordinateIds } },
      { createdBy: req.user._id },
      { watchers: req.user._id },
    ];
  } else {
    // Basic view — only own tasks
    query.$or = [
      { assignedTo: req.user._id },
      { createdBy: req.user._id },
      { watchers: req.user._id },
    ];
  }

  // Apply filters
  if (status) query.status = status;
  if (priority) query.priority = priority;
  if (category) query.category = category;
  if (assignedTo) query.assignedTo = assignedTo;
  if (linkedEntityType) query['linkedEntity.entityType'] = linkedEntityType;

  if (parentTask === 'null' || parentTask === 'root') {
    query.parentTask = null;
  } else if (parentTask) {
    query.parentTask = parentTask;
  }

  if (dueBefore || dueAfter) {
    query.dueDate = {};
    if (dueBefore) query.dueDate.$lte = new Date(dueBefore);
    if (dueAfter) query.dueDate.$gte = new Date(dueAfter);
  }

  if (isOverdue === 'true') {
    query.dueDate = { ...(query.dueDate || {}), $lt: new Date() };
    query.status = { $nin: ['Completed', 'Cancelled'] };
  }

  if (tags) {
    const tagArray = tags.split(',').map((t) => t.trim().toLowerCase());
    query.tags = { $in: tagArray };
  }

  if (search) {
    query.$text = { $search: search };
  }

  const pageNum = parseInt(page);
  const limitNum = parseInt(limit);
  const skip = (pageNum - 1) * limitNum;
  const sort = {};
  sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

  const [tasks, total] = await Promise.all([
    Task.find(query)
      .populate('assignedTo', 'firstName lastName email')
      .populate('createdBy', 'firstName lastName email')
      .populate('assignedBy', 'firstName lastName')
      .select('-comments -activityLog')
      .sort(sort)
      .skip(skip)
      .limit(limitNum),
    Task.countDocuments(query),
  ]);

  res.json({
    success: true,
    data: {
      tasks,
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
 * @desc    Get task by ID
 * @route   GET /api/tasks/:id
 * @access  Private (tasks:view)
 */
const getTaskById = asyncHandler(async (req, res) => {
  const task = await Task.findOne({
    _id: req.params.id,
    organization: req.user.organization,
  })
    .populate('assignedTo', 'firstName lastName email')
    .populate('createdBy', 'firstName lastName email')
    .populate('assignedBy', 'firstName lastName email')
    .populate('watchers', 'firstName lastName email')
    .populate('comments.author', 'firstName lastName email')
    .populate('comments.mentions', 'firstName lastName')
    .populate('escalations.escalatedTo', 'firstName lastName email')
    .populate('parentTask', 'title taskNumber status')
    .populate('createdFromTemplate', 'name');

  if (!task) {
    res.status(404);
    throw new Error('Task not found');
  }

  // Also fetch sub-tasks
  const subTasks = await Task.find({
    parentTask: task._id,
    organization: req.user.organization,
  })
    .populate('assignedTo', 'firstName lastName email')
    .select('title taskNumber status priority dueDate assignedTo depth')
    .sort({ createdAt: 1 });

  res.json({
    success: true,
    data: {
      task,
      subTasks,
    },
  });
});

/**
 * @desc    Update task
 * @route   PUT /api/tasks/:id
 * @access  Private (tasks:update)
 */
const updateTask = asyncHandler(async (req, res) => {
  const task = await Task.findOne({
    _id: req.params.id,
    organization: req.user.organization,
  });

  if (!task) {
    res.status(404);
    throw new Error('Task not found');
  }

  const allowedFields = [
    'title',
    'description',
    'category',
    'priority',
    'dueDate',
    'startDate',
    'tags',
    'checklist',
    'linkedEntity',
    'sla',
  ];

  const changes = [];

  for (const field of allowedFields) {
    if (req.body[field] !== undefined) {
      const oldVal = task[field];
      task[field] = req.body[field];

      if (field === 'priority' && oldVal !== req.body[field]) {
        changes.push({
          action: 'priority_changed',
          performedBy: req.user._id,
          previousValue: oldVal,
          newValue: req.body[field],
        });
      } else if (field === 'dueDate' && String(oldVal) !== String(req.body[field])) {
        changes.push({
          action: 'due_date_changed',
          performedBy: req.user._id,
          previousValue: oldVal,
          newValue: req.body[field],
        });
      }
    }
  }

  // Handle assignee change
  if (req.body.assignedTo && req.body.assignedTo !== task.assignedTo?.toString()) {
    const newAssignee = await User.findOne({
      _id: req.body.assignedTo,
      organization: req.user.organization,
    }).select('_id');
    if (!newAssignee) {
      res.status(400);
      throw new Error('Assigned user not found in your organization');
    }
    changes.push({
      action: 'reassigned',
      performedBy: req.user._id,
      previousValue: task.assignedTo,
      newValue: req.body.assignedTo,
    });
    task.assignedTo = req.body.assignedTo;
    task.assignedBy = req.user._id;
  }

  // Handle watcher additions
  if (req.body.addWatchers) {
    for (const watcherId of req.body.addWatchers) {
      if (!task.watchers.some((w) => w.toString() === watcherId)) {
        task.watchers.push(watcherId);
        changes.push({
          action: 'watcher_added',
          performedBy: req.user._id,
          newValue: watcherId,
        });
      }
    }
  }

  if (changes.length > 0) {
    task.activityLog.push(...changes);
  }

  task.lastModifiedBy = req.user._id;
  await task.save();

  const updated = await Task.findById(task._id)
    .populate('assignedTo', 'firstName lastName email')
    .populate('createdBy', 'firstName lastName email')
    .populate('watchers', 'firstName lastName email');

  // Fire-and-forget: notify on reassignment
  if (changes.some((c) => c.action === 'reassigned')) {
    notifyTaskAssigned({ task: updated, assignee: req.body.assignedTo, assigner: req.user }).catch(() => {});
  }

  res.json({
    success: true,
    message: 'Task updated successfully',
    data: { task: updated },
  });
});

/**
 * @desc    Delete (cancel) a task
 * @route   DELETE /api/tasks/:id
 * @access  Private (tasks:delete)
 */
const deleteTask = asyncHandler(async (req, res) => {
  const task = await Task.findOne({
    _id: req.params.id,
    organization: req.user.organization,
  });

  if (!task) {
    res.status(404);
    throw new Error('Task not found');
  }

  // Cancel the task and all sub-tasks
  task.status = 'Cancelled';
  task.lastModifiedBy = req.user._id;
  task.activityLog.push({
    action: 'status_changed',
    performedBy: req.user._id,
    previousValue: task.status,
    newValue: 'Cancelled',
    details: { reason: 'Task deleted' },
  });
  await task.save();

  // Cancel sub-tasks
  await Task.updateMany(
    {
      parentTask: task._id,
      status: { $nin: ['Completed', 'Cancelled'] },
    },
    {
      $set: { status: 'Cancelled', lastModifiedBy: req.user._id },
      $push: {
        activityLog: {
          action: 'status_changed',
          performedBy: req.user._id,
          newValue: 'Cancelled',
          details: { reason: 'Parent task deleted' },
        },
      },
    }
  );

  res.json({
    success: true,
    message: 'Task cancelled successfully',
  });
});

// =============================================================================
// STATUS MANAGEMENT
// =============================================================================

/**
 * @desc    Update task status with state machine validation
 * @route   PUT /api/tasks/:id/status
 * @access  Private (tasks:update)
 */
const updateTaskStatus = asyncHandler(async (req, res) => {
  const { status, notes, resolution } = req.body;

  if (!status) {
    res.status(400);
    throw new Error('Status is required');
  }

  const task = await Task.findOne({
    _id: req.params.id,
    organization: req.user.organization,
  });

  if (!task) {
    res.status(404);
    throw new Error('Task not found');
  }

  // If completing, check that all sub-tasks are completed
  if (status === 'Completed') {
    const incompleteSubTasks = await Task.countDocuments({
      parentTask: task._id,
      status: { $nin: ['Completed', 'Cancelled'] },
    });
    if (incompleteSubTasks > 0) {
      res.status(400);
      throw new Error(
        `Cannot complete task: ${incompleteSubTasks} sub-task(s) still pending`
      );
    }

    if (resolution) {
      task.resolution = {
        summary: resolution,
        resolvedBy: req.user._id,
        resolvedAt: new Date(),
      };
    }
  }

  const oldStatus = task.status;
  task.transitionStatus(status, req.user._id, notes);
  await task.save();

  const updated = await Task.findById(task._id)
    .populate('assignedTo', 'firstName lastName email')
    .populate('createdBy', 'firstName lastName email');

  // Fire-and-forget: notify on status change
  notifyTaskStatusChanged({ task: updated, changedBy: req.user, oldStatus, newStatus: status }).catch(() => {});
  if (status === 'Completed') {
    notifyTaskCompleted({ task: updated, completedBy: req.user }).catch(() => {});
  }

  res.json({
    success: true,
    message: `Task status updated to '${status}'`,
    data: { task: updated },
  });
});

// =============================================================================
// COMMENTS
// =============================================================================

/**
 * @desc    Add comment to task
 * @route   POST /api/tasks/:id/comments
 * @access  Private (tasks:view)
 */
const addComment = asyncHandler(async (req, res) => {
  const { text, mentions } = req.body;

  if (!text) {
    res.status(400);
    throw new Error('Comment text is required');
  }

  const task = await Task.findOne({
    _id: req.params.id,
    organization: req.user.organization,
  });

  if (!task) {
    res.status(404);
    throw new Error('Task not found');
  }

  const comment = task.addComment(text, req.user._id, mentions || []);

  // Add mentioned users as watchers
  if (mentions && mentions.length > 0) {
    for (const userId of mentions) {
      if (!task.watchers.some((w) => w.toString() === userId)) {
        task.watchers.push(userId);
      }
    }
  }

  await task.save();

  // Populate the comment author for response
  await task.populate('comments.author', 'firstName lastName email');

  const addedComment = task.comments[task.comments.length - 1];

  // Fire-and-forget: notify watchers + assignee about comment
  notifyTaskComment({ task, comment: addedComment, author: req.user }).catch(() => {});
  if (mentions && mentions.length > 0) {
    notifyTaskMention({ task, mentionedUsers: mentions, commenter: req.user, commentText: text }).catch(() => {});
  }

  res.status(201).json({
    success: true,
    message: 'Comment added successfully',
    data: { comment: addedComment },
  });
});

/**
 * @desc    Get comments for a task (paginated)
 * @route   GET /api/tasks/:id/comments
 * @access  Private (tasks:view)
 */
const getComments = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20 } = req.query;

  const task = await Task.findOne({
    _id: req.params.id,
    organization: req.user.organization,
  })
    .select('comments')
    .populate('comments.author', 'firstName lastName email')
    .populate('comments.mentions', 'firstName lastName');

  if (!task) {
    res.status(404);
    throw new Error('Task not found');
  }

  // Sort comments newest first, then paginate
  const sorted = task.comments.sort(
    (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
  );
  const pageNum = parseInt(page);
  const limitNum = parseInt(limit);
  const start = (pageNum - 1) * limitNum;
  const paginated = sorted.slice(start, start + limitNum);
  const total = sorted.length;

  res.json({
    success: true,
    data: {
      comments: paginated,
      pagination: {
        currentPage: pageNum,
        totalPages: Math.ceil(total / limitNum),
        total,
        limit: limitNum,
      },
    },
  });
});

// =============================================================================
// SUB-TASKS
// =============================================================================

/**
 * @desc    Create sub-task
 * @route   POST /api/tasks/:id/subtasks
 * @access  Private (tasks:create)
 */
const createSubTask = asyncHandler(async (req, res) => {
  const parentTask = await Task.findOne({
    _id: req.params.id,
    organization: req.user.organization,
  }).select('depth organization linkedEntity');

  if (!parentTask) {
    res.status(404);
    throw new Error('Parent task not found');
  }

  if (parentTask.depth >= 3) {
    res.status(400);
    throw new Error('Maximum sub-task depth (3) exceeded');
  }

  const { title, description, category, priority, assignedTo, dueDate, checklist } =
    req.body;

  if (!title) {
    res.status(400);
    throw new Error('Sub-task title is required');
  }

  const subTask = await Task.create({
    organization: req.user.organization,
    title,
    description,
    category: category || 'General',
    priority: priority || 'Medium',
    assignedTo: assignedTo || req.user._id,
    assignedBy: req.user._id,
    assignmentType: assignedTo ? 'direct' : 'self',
    dueDate,
    checklist,
    parentTask: parentTask._id,
    depth: parentTask.depth + 1,
    linkedEntity: parentTask.linkedEntity,
    createdBy: req.user._id,
  });

  // Log on parent
  await Task.findByIdAndUpdate(parentTask._id, {
    $push: {
      activityLog: {
        action: 'sub_task_added',
        performedBy: req.user._id,
        details: { subTaskId: subTask._id, subTaskTitle: title },
      },
    },
  });

  const populated = await Task.findById(subTask._id)
    .populate('assignedTo', 'firstName lastName email')
    .populate('createdBy', 'firstName lastName email');

  res.status(201).json({
    success: true,
    message: 'Sub-task created successfully',
    data: { task: populated },
  });
});

// =============================================================================
// PERSONAL & TEAM VIEWS
// =============================================================================

/**
 * @desc    Get my tasks (personal dashboard)
 * @route   GET /api/tasks/my
 * @access  Private (tasks:view)
 */
const getMyTasks = asyncHandler(async (req, res) => {
  const { status, priority, category } = req.query;
  const userId = req.user._id;
  const orgId = req.user.organization;
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayEnd = new Date(todayStart);
  todayEnd.setDate(todayEnd.getDate() + 1);
  const weekEnd = new Date(todayStart);
  weekEnd.setDate(weekEnd.getDate() + 7);

  const baseQuery = { organization: orgId, assignedTo: userId };
  if (status) baseQuery.status = status;
  if (priority) baseQuery.priority = priority;
  if (category) baseQuery.category = category;

  const populate = [
    { path: 'createdBy', select: 'firstName lastName' },
    { path: 'parentTask', select: 'title taskNumber' },
  ];

  const selectFields =
    'title taskNumber status priority category dueDate assignedTo createdBy parentTask linkedEntity tags checklist';

  const [overdue, dueToday, dueThisWeek, inProgress, recentlyCompleted, counts] =
    await Promise.all([
      Task.find({
        ...baseQuery,
        dueDate: { $lt: todayStart },
        status: { $nin: ['Completed', 'Cancelled'] },
      })
        .populate(populate)
        .select(selectFields)
        .sort({ dueDate: 1 })
        .limit(50),
      Task.find({
        ...baseQuery,
        dueDate: { $gte: todayStart, $lt: todayEnd },
        status: { $nin: ['Completed', 'Cancelled'] },
      })
        .populate(populate)
        .select(selectFields)
        .sort({ priority: 1 }),
      Task.find({
        ...baseQuery,
        dueDate: { $gte: todayEnd, $lt: weekEnd },
        status: { $nin: ['Completed', 'Cancelled'] },
      })
        .populate(populate)
        .select(selectFields)
        .sort({ dueDate: 1 }),
      Task.find({
        ...baseQuery,
        status: 'In Progress',
      })
        .populate(populate)
        .select(selectFields)
        .sort({ dueDate: 1 })
        .limit(20),
      Task.find({
        ...baseQuery,
        status: 'Completed',
      })
        .populate(populate)
        .select(selectFields)
        .sort({ completedAt: -1 })
        .limit(10),
      Task.aggregate([
        {
          $match: {
            organization: new mongoose.Types.ObjectId(orgId),
            assignedTo: new mongoose.Types.ObjectId(userId),
          },
        },
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 },
          },
        },
      ]),
    ]);

  const statusCounts = {};
  counts.forEach((c) => {
    statusCounts[c._id] = c.count;
  });

  res.json({
    success: true,
    data: {
      overdue,
      dueToday,
      dueThisWeek,
      inProgress,
      recentlyCompleted,
      summary: {
        overdueCount: overdue.length,
        dueTodayCount: dueToday.length,
        dueThisWeekCount: dueThisWeek.length,
        inProgressCount: inProgress.length,
        statusCounts,
      },
    },
  });
});

/**
 * @desc    Get team tasks (manager view)
 * @route   GET /api/tasks/team
 * @access  Private (tasks:view_team)
 */
const getTeamTasks = asyncHandler(async (req, res) => {
  const {
    page = 1,
    limit = 20,
    status,
    priority,
    groupBy = 'assignee',
  } = req.query;

  // Find subordinates (users with higher role level number = lower in hierarchy)
  const allUsers = await User.find({
    organization: req.user.organization,
    isActive: true,
  })
    .populate('roleRef', 'level name')
    .select('firstName lastName email roleRef');

  const subordinates = allUsers.filter(
    (u) =>
      u.roleRef &&
      u.roleRef.level > req.userRoleLevel
  );
  const subordinateIds = subordinates.map((u) => u._id);

  // Include self
  subordinateIds.push(req.user._id);

  const query = {
    organization: req.user.organization,
    assignedTo: { $in: subordinateIds },
  };
  if (status) query.status = status;
  if (priority) query.priority = priority;

  const pageNum = parseInt(page);
  const limitNum = parseInt(limit);

  const [tasks, total, workloadAgg] = await Promise.all([
    Task.find(query)
      .populate('assignedTo', 'firstName lastName email')
      .populate('createdBy', 'firstName lastName')
      .select('-comments -activityLog')
      .sort({ dueDate: 1 })
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum),
    Task.countDocuments(query),
    Task.aggregate([
      {
        $match: {
          organization: new mongoose.Types.ObjectId(req.user.organization),
          assignedTo: { $in: subordinateIds.map((id) => new mongoose.Types.ObjectId(id)) },
          status: { $nin: ['Completed', 'Cancelled'] },
        },
      },
      {
        $group: {
          _id: '$assignedTo',
          totalTasks: { $sum: 1 },
          overdueTasks: {
            $sum: {
              $cond: [
                { $and: [{ $lt: ['$dueDate', new Date()] }, { $ne: ['$dueDate', null] }] },
                1,
                0,
              ],
            },
          },
          criticalTasks: {
            $sum: { $cond: [{ $eq: ['$priority', 'Critical'] }, 1, 0] },
          },
          highTasks: {
            $sum: { $cond: [{ $eq: ['$priority', 'High'] }, 1, 0] },
          },
        },
      },
    ]),
  ]);

  // Enrich workload with user info
  const workload = await Promise.all(
    workloadAgg.map(async (w) => {
      const user = allUsers.find((u) => u._id.toString() === w._id.toString());
      return {
        user: user
          ? {
              _id: user._id,
              firstName: user.firstName,
              lastName: user.lastName,
              email: user.email,
              role: user.roleRef?.name,
            }
          : { _id: w._id },
        totalTasks: w.totalTasks,
        overdueTasks: w.overdueTasks,
        criticalTasks: w.criticalTasks,
        highTasks: w.highTasks,
      };
    })
  );

  res.json({
    success: true,
    data: {
      tasks,
      workload,
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
 * @desc    Get overdue tasks
 * @route   GET /api/tasks/overdue
 * @access  Private (tasks:view)
 */
const getOverdueTasks = asyncHandler(async (req, res) => {
  const { category, priority, assignedTo } = req.query;

  const options = {};
  if (category) options.category = category;
  if (priority) options.priority = priority;
  if (assignedTo) options.assignedTo = assignedTo;

  // Scope by permission level
  const userPerms = req.userPermissions || [];
  if (!userPerms.includes('tasks:view_all') && !userPerms.includes('tasks:view_team')) {
    options.assignedTo = req.user._id;
  }

  const tasks = await Task.getOverdue(req.user.organization, options);

  res.json({
    success: true,
    data: {
      tasks,
      total: tasks.length,
    },
  });
});

// =============================================================================
// BULK OPERATIONS
// =============================================================================

/**
 * @desc    Bulk assign tasks
 * @route   PUT /api/tasks/bulk/assign
 * @access  Private (tasks:bulk_operations + tasks:assign)
 */
const bulkAssign = asyncHandler(async (req, res) => {
  const { taskIds, assignedTo } = req.body;

  if (!taskIds || !Array.isArray(taskIds) || taskIds.length === 0) {
    res.status(400);
    throw new Error('taskIds array is required');
  }
  if (!assignedTo) {
    res.status(400);
    throw new Error('assignedTo is required');
  }

  // Validate assignee
  const assignee = await User.findOne({
    _id: assignedTo,
    organization: req.user.organization,
  }).select('_id firstName lastName');
  if (!assignee) {
    res.status(400);
    throw new Error('Assigned user not found in your organization');
  }

  const result = await Task.updateMany(
    {
      _id: { $in: taskIds },
      organization: req.user.organization,
      status: { $nin: ['Completed', 'Cancelled'] },
    },
    {
      $set: {
        assignedTo,
        assignedBy: req.user._id,
        lastModifiedBy: req.user._id,
      },
      $push: {
        activityLog: {
          action: 'reassigned',
          performedBy: req.user._id,
          newValue: assignedTo,
          details: { bulkOperation: true },
        },
      },
    }
  );

  // Fire-and-forget: notify the assignee about the bulk assignment
  if (result.modifiedCount > 0) {
    const assignedTasks = await Task.find({
      _id: { $in: taskIds },
      organization: req.user.organization,
      assignedTo,
    }).select('organization taskNumber title priority category dueDate assignedTo createdBy watchers assignedBy').lean();
    for (const t of assignedTasks) {
      notifyTaskAssigned({ task: t, assignee: assignedTo, assigner: req.user }).catch(() => {});
    }
  }

  res.json({
    success: true,
    message: `${result.modifiedCount} task(s) assigned to ${assignee.firstName} ${assignee.lastName}`,
    data: { modifiedCount: result.modifiedCount },
  });
});

/**
 * @desc    Bulk update status
 * @route   PUT /api/tasks/bulk/status
 * @access  Private (tasks:bulk_operations)
 */
const bulkUpdateStatus = asyncHandler(async (req, res) => {
  const { taskIds, status } = req.body;

  if (!taskIds || !Array.isArray(taskIds) || taskIds.length === 0) {
    res.status(400);
    throw new Error('taskIds array is required');
  }
  if (!status) {
    res.status(400);
    throw new Error('status is required');
  }

  const tasks = await Task.find({
    _id: { $in: taskIds },
    organization: req.user.organization,
  });

  let updated = 0;
  let skipped = 0;
  const errors = [];

  for (const task of tasks) {
    try {
      task.transitionStatus(status, req.user._id);
      await task.save();
      updated++;
    } catch (err) {
      skipped++;
      errors.push({ taskId: task._id, taskNumber: task.taskNumber, error: err.message });
    }
  }

  res.json({
    success: true,
    message: `${updated} task(s) updated, ${skipped} skipped`,
    data: { updated, skipped, errors },
  });
});

// =============================================================================
// ANALYTICS
// =============================================================================

/**
 * @desc    Get task analytics
 * @route   GET /api/tasks/analytics
 * @access  Private (tasks:analytics)
 */
const getTaskAnalytics = asyncHandler(async (req, res) => {
  const { period = 30, projectId, category } = req.query;
  const orgId = req.user.organization;

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - parseInt(period));

  const matchConditions = {
    organization: new mongoose.Types.ObjectId(orgId),
    createdAt: { $gte: startDate },
  };
  if (category) matchConditions.category = category;

  const analytics = await Task.aggregate([
    { $match: matchConditions },
    {
      $facet: {
        statusDistribution: [
          { $group: { _id: '$status', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
        ],
        priorityDistribution: [
          { $group: { _id: '$priority', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
        ],
        categoryDistribution: [
          { $group: { _id: '$category', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
        ],
        completionRate: [
          {
            $group: {
              _id: null,
              total: { $sum: 1 },
              completed: {
                $sum: { $cond: [{ $eq: ['$status', 'Completed'] }, 1, 0] },
              },
            },
          },
          {
            $project: {
              _id: 0,
              total: 1,
              completed: 1,
              rate: {
                $cond: [
                  { $gt: ['$total', 0] },
                  {
                    $round: [
                      { $multiply: [{ $divide: ['$completed', '$total'] }, 100] },
                      1,
                    ],
                  },
                  0,
                ],
              },
            },
          },
        ],
        overdueAging: [
          {
            $match: {
              status: { $nin: ['Completed', 'Cancelled'] },
              dueDate: { $lt: new Date() },
            },
          },
          {
            $project: {
              overdueDays: {
                $divide: [
                  { $subtract: [new Date(), '$dueDate'] },
                  1000 * 60 * 60 * 24,
                ],
              },
            },
          },
          {
            $bucket: {
              groupBy: '$overdueDays',
              boundaries: [0, 7, 14, 30, Infinity],
              default: 'Other',
              output: { count: { $sum: 1 } },
            },
          },
        ],
        teamWorkload: [
          {
            $match: { status: { $nin: ['Completed', 'Cancelled'] } },
          },
          {
            $group: {
              _id: '$assignedTo',
              totalTasks: { $sum: 1 },
              overdueTasks: {
                $sum: {
                  $cond: [
                    {
                      $and: [
                        { $lt: ['$dueDate', new Date()] },
                        { $ne: ['$dueDate', null] },
                      ],
                    },
                    1,
                    0,
                  ],
                },
              },
            },
          },
          { $sort: { totalTasks: -1 } },
          { $limit: 20 },
        ],
        avgResolutionTime: [
          {
            $match: { status: 'Completed', completedAt: { $exists: true } },
          },
          {
            $group: {
              _id: null,
              avgHours: {
                $avg: {
                  $divide: [
                    { $subtract: ['$completedAt', '$createdAt'] },
                    1000 * 60 * 60,
                  ],
                },
              },
              count: { $sum: 1 },
            },
          },
        ],
        slaCompliance: [
          {
            $match: {
              status: 'Completed',
              dueDate: { $exists: true },
              completedAt: { $exists: true },
            },
          },
          {
            $group: {
              _id: null,
              total: { $sum: 1 },
              onTime: {
                $sum: {
                  $cond: [{ $lte: ['$completedAt', '$dueDate'] }, 1, 0],
                },
              },
            },
          },
          {
            $project: {
              _id: 0,
              total: 1,
              onTime: 1,
              complianceRate: {
                $cond: [
                  { $gt: ['$total', 0] },
                  {
                    $round: [
                      { $multiply: [{ $divide: ['$onTime', '$total'] }, 100] },
                      1,
                    ],
                  },
                  0,
                ],
              },
            },
          },
        ],
        createdVsCompleted: [
          {
            $group: {
              _id: {
                year: { $year: '$createdAt' },
                week: { $isoWeek: '$createdAt' },
              },
              created: { $sum: 1 },
              completed: {
                $sum: { $cond: [{ $eq: ['$status', 'Completed'] }, 1, 0] },
              },
            },
          },
          { $sort: { '_id.year': 1, '_id.week': 1 } },
        ],
        autoGeneratedBreakdown: [
          { $match: { 'autoGenerated.isAutoGenerated': true } },
          {
            $group: {
              _id: '$autoGenerated.triggerType',
              count: { $sum: 1 },
            },
          },
          { $sort: { count: -1 } },
        ],
      },
    },
  ]);

  // Populate team workload user names
  const workloadData = analytics[0]?.teamWorkload || [];
  const userIds = workloadData.map((w) => w._id).filter(Boolean);
  const users = await User.find({ _id: { $in: userIds } }).select(
    'firstName lastName email'
  );
  const userMap = {};
  users.forEach((u) => {
    userMap[u._id.toString()] = {
      firstName: u.firstName,
      lastName: u.lastName,
      email: u.email,
    };
  });

  const enrichedWorkload = workloadData.map((w) => ({
    ...w,
    user: userMap[w._id?.toString()] || null,
  }));

  const result = analytics[0] || {};
  result.teamWorkload = enrichedWorkload;

  res.json({
    success: true,
    data: {
      period: `${period} days`,
      analytics: result,
    },
  });
});

// =============================================================================
// TEMPLATE CRUD
// =============================================================================

/**
 * @desc    Create task template
 * @route   POST /api/tasks/templates
 * @access  Private (tasks:manage_templates)
 */
const createTemplate = asyncHandler(async (req, res) => {
  const {
    name,
    description,
    category,
    defaultTitle,
    defaultDescription,
    defaultPriority,
    defaultDueDays,
    defaultTags,
    checklist,
    subTasks,
    triggerType,
  } = req.body;

  if (!name || !category) {
    res.status(400);
    throw new Error('Template name and category are required');
  }

  const template = await TaskTemplate.create({
    organization: req.user.organization,
    name,
    description,
    category,
    defaultTitle,
    defaultDescription,
    defaultPriority,
    defaultDueDays,
    defaultTags,
    checklist,
    subTasks,
    triggerType,
    createdBy: req.user._id,
  });

  res.status(201).json({
    success: true,
    message: 'Task template created successfully',
    data: { template },
  });
});

/**
 * @desc    Get all templates
 * @route   GET /api/tasks/templates
 * @access  Private (tasks:view)
 */
const getTemplates = asyncHandler(async (req, res) => {
  const { category, isActive = 'true' } = req.query;

  const query = { organization: req.user.organization };
  if (isActive === 'true') query.isActive = true;
  if (category) query.category = category;

  const templates = await TaskTemplate.find(query)
    .populate('createdBy', 'firstName lastName')
    .sort({ usageCount: -1, createdAt: -1 });

  res.json({
    success: true,
    data: { templates },
  });
});

/**
 * @desc    Get template by ID
 * @route   GET /api/tasks/templates/:templateId
 * @access  Private (tasks:view)
 */
const getTemplateById = asyncHandler(async (req, res) => {
  const template = await TaskTemplate.findOne({
    _id: req.params.templateId,
    organization: req.user.organization,
  }).populate('createdBy', 'firstName lastName email');

  if (!template) {
    res.status(404);
    throw new Error('Template not found');
  }

  res.json({
    success: true,
    data: { template },
  });
});

/**
 * @desc    Update template
 * @route   PUT /api/tasks/templates/:templateId
 * @access  Private (tasks:manage_templates)
 */
const updateTemplate = asyncHandler(async (req, res) => {
  const template = await TaskTemplate.findOne({
    _id: req.params.templateId,
    organization: req.user.organization,
  });

  if (!template) {
    res.status(404);
    throw new Error('Template not found');
  }

  const allowedFields = [
    'name',
    'description',
    'category',
    'defaultTitle',
    'defaultDescription',
    'defaultPriority',
    'defaultDueDays',
    'defaultTags',
    'checklist',
    'subTasks',
    'triggerType',
    'isActive',
  ];

  for (const field of allowedFields) {
    if (req.body[field] !== undefined) {
      template[field] = req.body[field];
    }
  }

  await template.save();

  res.json({
    success: true,
    message: 'Template updated successfully',
    data: { template },
  });
});

/**
 * @desc    Delete template (soft delete)
 * @route   DELETE /api/tasks/templates/:templateId
 * @access  Private (tasks:manage_templates)
 */
const deleteTemplate = asyncHandler(async (req, res) => {
  const template = await TaskTemplate.findOne({
    _id: req.params.templateId,
    organization: req.user.organization,
  });

  if (!template) {
    res.status(404);
    throw new Error('Template not found');
  }

  if (template.isSystemTemplate) {
    res.status(403);
    throw new Error('System templates cannot be deleted');
  }

  template.isActive = false;
  await template.save();

  res.json({
    success: true,
    message: 'Template deleted successfully',
  });
});

/**
 * @desc    Apply template to create a task with sub-tasks
 * @route   POST /api/tasks/templates/:templateId/apply
 * @access  Private (tasks:create)
 */
const applyTemplate = asyncHandler(async (req, res) => {
  const template = await TaskTemplate.findOne({
    _id: req.params.templateId,
    organization: req.user.organization,
    isActive: true,
  });

  if (!template) {
    res.status(404);
    throw new Error('Template not found or inactive');
  }

  const { assignedTo, dueDate, linkedEntity, title, description, overrides } =
    req.body;

  // Calculate due date from template default if not provided
  const taskDueDate =
    dueDate || new Date(Date.now() + template.defaultDueDays * 24 * 60 * 60 * 1000);

  // Create parent task
  const parentTask = await Task.create({
    organization: req.user.organization,
    title: title || template.defaultTitle || template.name,
    description: description || template.defaultDescription,
    category: template.category,
    priority: overrides?.priority || template.defaultPriority,
    assignedTo: assignedTo || req.user._id,
    assignedBy: req.user._id,
    assignmentType: assignedTo ? 'direct' : 'self',
    dueDate: taskDueDate,
    tags: template.defaultTags,
    checklist: template.checklist.map((item) => ({
      text: item.text,
      order: item.order,
      isCompleted: false,
    })),
    linkedEntity,
    createdFromTemplate: template._id,
    createdBy: req.user._id,
  });

  // Create sub-tasks from template
  const subTasks = [];
  if (template.subTasks && template.subTasks.length > 0) {
    for (const subDef of template.subTasks) {
      const subDueDate = new Date(
        taskDueDate.getTime() + subDef.relativeDueDays * 24 * 60 * 60 * 1000
      );

      const subTask = await Task.create({
        organization: req.user.organization,
        title: subDef.title,
        description: subDef.description,
        category: subDef.category || template.category,
        priority: subDef.priority,
        assignedTo: assignedTo || req.user._id,
        assignedBy: req.user._id,
        assignmentType: assignedTo ? 'direct' : 'self',
        dueDate: subDueDate,
        checklist: subDef.checklist
          ? subDef.checklist.map((item) => ({
              text: item.text,
              order: item.order,
              isCompleted: false,
            }))
          : [],
        parentTask: parentTask._id,
        depth: 1,
        linkedEntity,
        createdFromTemplate: template._id,
        createdBy: req.user._id,
      });
      subTasks.push(subTask);
    }
  }

  // Increment usage count
  template.usageCount += 1;
  await template.save();

  const populated = await Task.findById(parentTask._id)
    .populate('assignedTo', 'firstName lastName email')
    .populate('createdBy', 'firstName lastName email')
    .populate('createdFromTemplate', 'name');

  res.status(201).json({
    success: true,
    message: `Task created from template '${template.name}' with ${subTasks.length} sub-task(s)`,
    data: {
      task: populated,
      subTaskCount: subTasks.length,
      subTaskIds: subTasks.map((s) => s._id),
    },
  });
});

// =============================================================================
// CHECKLIST OPERATIONS
// =============================================================================

/**
 * @desc    Toggle checklist item
 * @route   PUT /api/tasks/:id/checklist/:itemId
 * @access  Private (tasks:update)
 */
const toggleChecklistItem = asyncHandler(async (req, res) => {
  const { isCompleted } = req.body;

  const task = await Task.findOne({
    _id: req.params.id,
    organization: req.user.organization,
  });

  if (!task) {
    res.status(404);
    throw new Error('Task not found');
  }

  const item = task.updateChecklistItem(
    req.params.itemId,
    isCompleted,
    req.user._id
  );

  task.lastModifiedBy = req.user._id;
  await task.save();

  res.json({
    success: true,
    message: `Checklist item ${isCompleted ? 'completed' : 'uncompleted'}`,
    data: { item, checklistProgress: task.checklistProgress },
  });
});

// =============================================================================
// EXPORTS
// =============================================================================

export {
  createTask,
  getTasks,
  getTaskById,
  updateTask,
  deleteTask,
  updateTaskStatus,
  addComment,
  getComments,
  createSubTask,
  getMyTasks,
  getTeamTasks,
  getOverdueTasks,
  bulkAssign,
  bulkUpdateStatus,
  getTaskAnalytics,
  createTemplate,
  getTemplates,
  getTemplateById,
  updateTemplate,
  deleteTemplate,
  applyTemplate,
  toggleChecklistItem,
};
