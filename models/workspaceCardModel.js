// File: models/workspaceCardModel.js
// Description: A saved, filtered query ("card") over one module, rendered as a
//   live list or a metric. Cards are shareable, so they live in their own
//   collection rather than User.preferences. See workspace design spec §5.

import mongoose from 'mongoose';

export const WORKSPACE_MODULES = ['leads', 'sales', 'payments', 'tasks', 'channelPartners'];
export const RENDER_MODES = ['list', 'metric'];
export const METRIC_AGGS = ['count', 'sum', 'avg'];
export const VISIBILITIES = ['private', 'shared'];

const metricConfigSchema = new mongoose.Schema(
  {
    agg: { type: String, enum: METRIC_AGGS, default: 'count' },
    field: { type: String, default: null },
  },
  { _id: false }
);

const workspaceCardSchema = new mongoose.Schema(
  {
    organization: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: [true, 'Organization is required'],
      index: true,
    },
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Owner is required'],
    },
    title: {
      type: String,
      required: [true, 'Title is required'],
      trim: true,
      maxlength: [200, 'Title cannot exceed 200 characters'],
    },
    module: {
      type: String,
      enum: WORKSPACE_MODULES,
      required: [true, 'Module is required'],
    },
    // Validated §3.3 Query Plan. Stored as Mixed; shape is enforced by
    // services/workspace/queryPlanSchema.js at write time in the controller.
    queryPlan: { type: mongoose.Schema.Types.Mixed, default: {} },
    renderMode: { type: String, enum: RENDER_MODES, default: 'list' },
    metricConfig: { type: metricConfigSchema, default: () => ({}) },
    visibility: { type: String, enum: VISIBILITIES, default: 'private' },
    sharedWithUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    sharedWithRoles: [{ type: String, trim: true }], // role names, e.g. 'Sales Manager'
  },
  { timestamps: true }
);

// The two hot read paths: "my cards" and "shared-to-me" lookups are org-scoped.
workspaceCardSchema.index({ organization: 1, ownerId: 1 });
workspaceCardSchema.index({ organization: 1, visibility: 1 });

const WorkspaceCard = mongoose.model('WorkspaceCard', workspaceCardSchema);

export default WorkspaceCard;
