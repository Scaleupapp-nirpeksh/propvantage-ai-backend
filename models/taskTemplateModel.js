// File: models/taskTemplateModel.js
// Description: Reusable task templates for common workflows and auto-generation triggers

import mongoose from 'mongoose';

const templateChecklistItemSchema = new mongoose.Schema({
  text: { type: String, required: true, trim: true, maxlength: 500 },
  order: { type: Number, default: 0 },
});

const templateSubTaskSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true,
    maxlength: 300,
  },
  description: {
    type: String,
    trim: true,
    maxlength: 2000,
  },
  category: {
    type: String,
    enum: [
      'Lead & Sales',
      'Payment & Collection',
      'Construction',
      'Document & Compliance',
      'Customer Service',
      'Approval',
      'General',
    ],
  },
  priority: {
    type: String,
    enum: ['Critical', 'High', 'Medium', 'Low'],
    default: 'Medium',
  },
  relativeDueDays: { type: Number, default: 0, min: 0 },
  checklist: [templateChecklistItemSchema],
  order: { type: Number, default: 0 },
  assigneeRole: { type: String, trim: true },
});

const taskTemplateSchema = new mongoose.Schema(
  {
    organization: {
      type: mongoose.Schema.Types.ObjectId,
      required: [true, 'Organization is required'],
      ref: 'Organization',
      index: true,
    },

    name: {
      type: String,
      required: [true, 'Template name is required'],
      trim: true,
      maxlength: [200, 'Template name cannot exceed 200 characters'],
    },
    description: {
      type: String,
      trim: true,
      maxlength: [2000, 'Description cannot exceed 2000 characters'],
    },
    category: {
      type: String,
      required: [true, 'Template category is required'],
      enum: [
        'Lead & Sales',
        'Payment & Collection',
        'Construction',
        'Document & Compliance',
        'Customer Service',
        'Approval',
        'General',
      ],
    },

    // Template defaults for the parent task
    defaultTitle: {
      type: String,
      trim: true,
      maxlength: 300,
    },
    defaultDescription: {
      type: String,
      trim: true,
      maxlength: 5000,
    },
    defaultPriority: {
      type: String,
      enum: ['Critical', 'High', 'Medium', 'Low'],
      default: 'Medium',
    },
    defaultDueDays: {
      type: Number,
      default: 7,
      min: 0,
    },
    defaultTags: [
      {
        type: String,
        trim: true,
        lowercase: true,
      },
    ],

    // Checklist items for the parent task
    checklist: [templateChecklistItemSchema],

    // Sub-task definitions
    subTasks: [templateSubTaskSchema],

    // Metadata
    isSystemTemplate: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
    usageCount: { type: Number, default: 0 },

    // Auto-generation trigger mapping
    triggerType: {
      type: String,
      enum: [
        'overdue_payment',
        'missed_follow_up',
        'delayed_milestone',
        'pending_approval',
        'new_sale_onboarding',
        'recurring_schedule',
        'manual',
        null,
      ],
      default: null,
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Indexes
taskTemplateSchema.index({ organization: 1, isActive: 1 });
taskTemplateSchema.index({ organization: 1, category: 1 });
taskTemplateSchema.index({ organization: 1, triggerType: 1 });

const TaskTemplate = mongoose.model('TaskTemplate', taskTemplateSchema);

export default TaskTemplate;
