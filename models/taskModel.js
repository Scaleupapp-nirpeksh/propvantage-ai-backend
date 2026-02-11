// File: models/taskModel.js
// Description: Task/ticket model for organization-scoped task management with SLA, hierarchy, and auto-generation

import mongoose from 'mongoose';

// ─── EMBEDDED SUB-SCHEMAS ────────────────────────────────────────

const checklistItemSchema = new mongoose.Schema({
  text: { type: String, required: true, trim: true, maxlength: 500 },
  isCompleted: { type: Boolean, default: false },
  completedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  completedAt: { type: Date },
  order: { type: Number, default: 0 },
});

const commentSchema = new mongoose.Schema({
  text: { type: String, required: true, trim: true, maxlength: 5000 },
  author: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  mentions: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  isEdited: { type: Boolean, default: false },
  editedAt: { type: Date },
  createdAt: { type: Date, default: Date.now },
});

const activityLogSchema = new mongoose.Schema({
  action: {
    type: String,
    required: true,
    enum: [
      'created',
      'updated',
      'status_changed',
      'assigned',
      'reassigned',
      'priority_changed',
      'comment_added',
      'checklist_updated',
      'due_date_changed',
      'watcher_added',
      'watcher_removed',
      'escalated',
      'sub_task_added',
      'tag_added',
      'tag_removed',
      'linked_entity_added',
      'template_applied',
      'auto_generated',
      'bulk_updated',
      'accepted',
      'declined',
    ],
  },
  performedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  performedAt: { type: Date, default: Date.now },
  details: { type: mongoose.Schema.Types.Mixed },
  previousValue: { type: mongoose.Schema.Types.Mixed },
  newValue: { type: mongoose.Schema.Types.Mixed },
});

const escalationSchema = new mongoose.Schema({
  level: { type: Number, required: true, min: 1, max: 5 },
  escalatedTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  escalatedAt: { type: Date, default: Date.now },
  reason: { type: String, required: true, trim: true },
  acknowledged: { type: Boolean, default: false },
  acknowledgedAt: { type: Date },
  resolvedAt: { type: Date },
});

// ─── CONSTANTS ───────────────────────────────────────────────────

const TASK_STATUSES = [
  'Open',
  'In Progress',
  'Under Review',
  'Completed',
  'On Hold',
  'Cancelled',
];

const TASK_PRIORITIES = ['Critical', 'High', 'Medium', 'Low'];

const TASK_CATEGORIES = [
  'Lead & Sales',
  'Payment & Collection',
  'Construction',
  'Document & Compliance',
  'Customer Service',
  'Approval',
  'General',
];

const ASSIGNMENT_TYPES = ['direct', 'self', 'system', 'cross_department_request'];

const LINKED_ENTITY_TYPES = [
  'Lead',
  'Sale',
  'PaymentPlan',
  'PaymentTransaction',
  'Installment',
  'Invoice',
  'ConstructionMilestone',
  'Project',
  'Unit',
  'Contractor',
  'User',
  'File',
];

const TRIGGER_TYPES = [
  'overdue_payment',
  'missed_follow_up',
  'delayed_milestone',
  'pending_approval',
  'new_sale_onboarding',
  'recurring_schedule',
  'manual',
];

const RECURRENCE_PATTERNS = [
  'daily',
  'weekly',
  'biweekly',
  'monthly',
  'quarterly',
];

// Status transition map (state machine)
const STATUS_TRANSITIONS = {
  Open: ['In Progress', 'On Hold', 'Cancelled'],
  'In Progress': ['Under Review', 'On Hold', 'Cancelled', 'Completed'],
  'Under Review': ['In Progress', 'Completed', 'On Hold'],
  'On Hold': ['Open', 'In Progress', 'Cancelled'],
  Completed: ['Open'], // Reopen
  Cancelled: ['Open'], // Reopen
};

// ─── MAIN TASK SCHEMA ────────────────────────────────────────────

const taskSchema = new mongoose.Schema(
  {
    // === ORGANIZATION SCOPING ===
    organization: {
      type: mongoose.Schema.Types.ObjectId,
      required: [true, 'Organization is required'],
      ref: 'Organization',
      index: true,
    },

    // === IDENTIFICATION ===
    taskNumber: {
      type: String,
      index: true,
    },
    sequenceNumber: {
      type: Number,
    },
    title: {
      type: String,
      required: [true, 'Task title is required'],
      trim: true,
      maxlength: [300, 'Title cannot exceed 300 characters'],
    },
    description: {
      type: String,
      trim: true,
      maxlength: [5000, 'Description cannot exceed 5000 characters'],
    },

    // === CATEGORIZATION ===
    category: {
      type: String,
      required: [true, 'Task category is required'],
      enum: TASK_CATEGORIES,
      default: 'General',
    },
    tags: [
      {
        type: String,
        trim: true,
        lowercase: true,
        maxlength: 50,
      },
    ],

    // === STATUS & PRIORITY ===
    status: {
      type: String,
      enum: TASK_STATUSES,
      default: 'Open',
      index: true,
    },
    priority: {
      type: String,
      enum: TASK_PRIORITIES,
      default: 'Medium',
      index: true,
    },

    // === ASSIGNMENT ===
    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      index: true,
    },
    assignedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    assignmentType: {
      type: String,
      enum: ASSIGNMENT_TYPES,
      default: 'direct',
    },
    assignmentStatus: {
      type: String,
      enum: ['accepted', 'pending', 'declined'],
      default: 'accepted',
    },
    declineReason: { type: String, trim: true },

    // === WATCHERS ===
    watchers: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
    ],

    // === DATES & SLA ===
    dueDate: {
      type: Date,
      index: true,
    },
    startDate: {
      type: Date,
    },
    completedAt: {
      type: Date,
    },
    sla: {
      targetResolutionHours: { type: Number },
      warningThresholdHours: { type: Number },
      isOverdue: { type: Boolean, default: false },
      overdueSince: { type: Date },
    },

    // === HIERARCHY ===
    parentTask: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Task',
      default: null,
    },
    depth: {
      type: Number,
      default: 0,
      max: 3,
    },

    // === CHECKLIST ===
    checklist: [checklistItemSchema],

    // === ENTITY LINKING (polymorphic) ===
    linkedEntity: {
      entityType: {
        type: String,
        enum: LINKED_ENTITY_TYPES,
      },
      entityId: {
        type: mongoose.Schema.Types.ObjectId,
      },
      displayLabel: { type: String, trim: true },
    },

    // === RECURRENCE ===
    recurrence: {
      isRecurring: { type: Boolean, default: false },
      pattern: {
        type: String,
        enum: RECURRENCE_PATTERNS,
      },
      interval: { type: Number, default: 1, min: 1 },
      dayOfWeek: { type: Number, min: 0, max: 6 },
      dayOfMonth: { type: Number, min: 1, max: 31 },
      endDate: { type: Date },
      nextOccurrence: { type: Date },
      generatedFromTemplate: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'TaskTemplate',
      },
    },

    // === COMMENTS ===
    comments: [commentSchema],

    // === ATTACHMENTS ===
    attachments: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'File',
      },
    ],

    // === AUTO-GENERATION METADATA ===
    autoGenerated: {
      isAutoGenerated: { type: Boolean, default: false },
      triggerType: {
        type: String,
        enum: TRIGGER_TYPES,
      },
      triggerEntityType: { type: String },
      triggerEntityId: { type: mongoose.Schema.Types.ObjectId },
      deduplicationKey: { type: String, index: true },
    },

    // === TEMPLATE REFERENCE ===
    createdFromTemplate: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TaskTemplate',
    },

    // === ESCALATION TRACKING ===
    escalations: [escalationSchema],
    currentEscalationLevel: {
      type: Number,
      default: 0,
      min: 0,
      max: 5,
    },

    // === ACTIVITY LOG ===
    activityLog: [activityLogSchema],

    // === RESOLUTION ===
    resolution: {
      summary: { type: String, trim: true, maxlength: 2000 },
      resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      resolvedAt: { type: Date },
    },

    // === AUDIT ===
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    lastModifiedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ─── INDEXES ─────────────────────────────────────────────────────

taskSchema.index({ organization: 1, status: 1 });
taskSchema.index({ organization: 1, assignedTo: 1, status: 1 });
taskSchema.index({ organization: 1, category: 1, status: 1 });
taskSchema.index({ organization: 1, priority: 1, status: 1 });
taskSchema.index({ organization: 1, dueDate: 1, status: 1 });
taskSchema.index({ organization: 1, taskNumber: 1 }, { unique: true });
taskSchema.index({ parentTask: 1 });
taskSchema.index({
  'linkedEntity.entityType': 1,
  'linkedEntity.entityId': 1,
});
taskSchema.index({ 'autoGenerated.deduplicationKey': 1 }, { sparse: true });
taskSchema.index({ assignedTo: 1, status: 1, dueDate: 1 });
taskSchema.index({ 'sla.isOverdue': 1, organization: 1 });
taskSchema.index({
  'recurrence.isRecurring': 1,
  'recurrence.nextOccurrence': 1,
});
taskSchema.index({ title: 'text', description: 'text' });

// ─── VIRTUALS ────────────────────────────────────────────────────

taskSchema.virtual('displayId').get(function () {
  if (this.sequenceNumber) {
    return `TASK-${String(this.sequenceNumber).padStart(3, '0')}`;
  }
  return this.taskNumber;
});

taskSchema.virtual('daysUntilDue').get(function () {
  if (!this.dueDate) return null;
  const now = new Date();
  const diff = this.dueDate - now;
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
});

taskSchema.virtual('isOverdue').get(function () {
  if (!this.dueDate) return false;
  if (['Completed', 'Cancelled'].includes(this.status)) return false;
  return new Date() > this.dueDate;
});

taskSchema.virtual('overdueDays').get(function () {
  if (!this.dueDate) return 0;
  if (['Completed', 'Cancelled'].includes(this.status)) return 0;
  const now = new Date();
  if (now <= this.dueDate) return 0;
  return Math.ceil((now - this.dueDate) / (1000 * 60 * 60 * 24));
});

taskSchema.virtual('checklistProgress').get(function () {
  if (!this.checklist || this.checklist.length === 0) return null;
  const completed = this.checklist.filter((item) => item.isCompleted).length;
  return Math.round((completed / this.checklist.length) * 100);
});

taskSchema.virtual('subTaskCount', {
  ref: 'Task',
  localField: '_id',
  foreignField: 'parentTask',
  count: true,
});

taskSchema.virtual('resolutionTimeHours').get(function () {
  if (!this.completedAt || !this.createdAt) return null;
  return (
    Math.round(
      ((this.completedAt - this.createdAt) / (1000 * 60 * 60)) * 10
    ) / 10
  );
});

// ─── PRE-SAVE HOOKS ─────────────────────────────────────────────

taskSchema.pre('save', async function (next) {
  try {
    // Generate sequential task number for new tasks
    if (this.isNew) {
      const lastTask = await this.constructor
        .findOne({ organization: this.organization })
        .sort({ sequenceNumber: -1 })
        .select('sequenceNumber');

      this.sequenceNumber = lastTask ? lastTask.sequenceNumber + 1 : 1;
      this.taskNumber = `TASK-${String(this.sequenceNumber).padStart(3, '0')}`;

      // Add creation activity log
      this.activityLog.push({
        action: 'created',
        performedBy: this.createdBy,
        details: { title: this.title, category: this.category },
      });
    }

    // Auto-detect overdue status
    if (this.dueDate && !['Completed', 'Cancelled'].includes(this.status)) {
      const now = new Date();
      const wasOverdue = this.sla?.isOverdue;
      if (now > this.dueDate) {
        this.sla.isOverdue = true;
        if (!wasOverdue) {
          this.sla.overdueSince = now;
        }
      } else {
        this.sla.isOverdue = false;
        this.sla.overdueSince = undefined;
      }
    }

    // Auto-set completedAt when status transitions to Completed
    if (
      this.isModified('status') &&
      this.status === 'Completed' &&
      !this.completedAt
    ) {
      this.completedAt = new Date();
    }

    // Clear overdue when completed/cancelled
    if (
      this.isModified('status') &&
      ['Completed', 'Cancelled'].includes(this.status)
    ) {
      this.sla.isOverdue = false;
    }

    next();
  } catch (error) {
    next(error);
  }
});

// ─── INSTANCE METHODS ────────────────────────────────────────────

/**
 * Check if a status transition is valid
 */
taskSchema.methods.canTransitionTo = function (newStatus) {
  const allowed = STATUS_TRANSITIONS[this.status] || [];
  return allowed.includes(newStatus);
};

/**
 * Transition task status with validation and activity logging
 */
taskSchema.methods.transitionStatus = function (newStatus, userId, notes) {
  if (!this.canTransitionTo(newStatus)) {
    throw new Error(
      `Cannot transition from '${this.status}' to '${newStatus}'`
    );
  }

  const previousStatus = this.status;
  this.status = newStatus;
  this.lastModifiedBy = userId;

  if (newStatus === 'Completed') {
    this.completedAt = new Date();
    this.resolution = {
      ...this.resolution?.toObject?.() || {},
      resolvedBy: userId,
      resolvedAt: new Date(),
    };
  }

  if (newStatus === 'In Progress' && !this.startDate) {
    this.startDate = new Date();
  }

  this.activityLog.push({
    action: 'status_changed',
    performedBy: userId,
    previousValue: previousStatus,
    newValue: newStatus,
    details: { notes },
  });

  return this;
};

/**
 * Add a comment with @mentions
 */
taskSchema.methods.addComment = function (text, authorId, mentionIds = []) {
  const comment = {
    text,
    author: authorId,
    mentions: mentionIds,
    createdAt: new Date(),
  };
  this.comments.push(comment);

  this.activityLog.push({
    action: 'comment_added',
    performedBy: authorId,
    details: { commentPreview: text.substring(0, 100) },
  });

  return this.comments[this.comments.length - 1];
};

/**
 * Toggle checklist item completion
 */
taskSchema.methods.updateChecklistItem = function (
  itemId,
  isCompleted,
  userId
) {
  const item = this.checklist.id(itemId);
  if (!item) throw new Error('Checklist item not found');

  item.isCompleted = isCompleted;
  if (isCompleted) {
    item.completedBy = userId;
    item.completedAt = new Date();
  } else {
    item.completedBy = undefined;
    item.completedAt = undefined;
  }

  this.activityLog.push({
    action: 'checklist_updated',
    performedBy: userId,
    details: { itemText: item.text, isCompleted },
  });

  return item;
};

// ─── STATIC METHODS ──────────────────────────────────────────────

/**
 * Get overdue tasks for an organization
 */
taskSchema.statics.getOverdue = function (organizationId, options = {}) {
  const now = new Date();
  const query = {
    organization: organizationId,
    status: { $nin: ['Completed', 'Cancelled'] },
    dueDate: { $lt: now },
  };
  if (options.assignedTo) query.assignedTo = options.assignedTo;
  if (options.category) query.category = options.category;
  if (options.priority) query.priority = options.priority;

  return this.find(query)
    .populate('assignedTo', 'firstName lastName email')
    .populate('createdBy', 'firstName lastName')
    .sort({ dueDate: 1 });
};

/**
 * Get task statistics via aggregation
 */
taskSchema.statics.getStatistics = async function (
  organizationId,
  filters = {}
) {
  const match = {
    organization: new mongoose.Types.ObjectId(organizationId),
    ...filters,
  };

  return this.aggregate([
    { $match: match },
    {
      $facet: {
        statusDistribution: [
          { $group: { _id: '$status', count: { $sum: 1 } } },
        ],
        priorityDistribution: [
          { $group: { _id: '$priority', count: { $sum: 1 } } },
        ],
        categoryDistribution: [
          { $group: { _id: '$category', count: { $sum: 1 } } },
        ],
        overdueSummary: [
          {
            $match: {
              status: { $nin: ['Completed', 'Cancelled'] },
              dueDate: { $lt: new Date() },
            },
          },
          { $count: 'overdueCount' },
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
      },
    },
  ]);
};

// ─── EXPORT ──────────────────────────────────────────────────────

const Task = mongoose.model('Task', taskSchema);

export default Task;
export {
  TASK_STATUSES,
  TASK_PRIORITIES,
  TASK_CATEGORIES,
  ASSIGNMENT_TYPES,
  LINKED_ENTITY_TYPES,
  TRIGGER_TYPES,
  RECURRENCE_PATTERNS,
  STATUS_TRANSITIONS,
};
