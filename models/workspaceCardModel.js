// File: models/workspaceCardModel.js
// Description: A saved, filtered query ("card") over one module, rendered as a
//   live list or a metric. Cards are shareable, so they live in their own
//   collection rather than User.preferences. See workspace design spec §5.

import mongoose from 'mongoose';

export const WORKSPACE_MODULES = ['leads', 'sales', 'payments', 'tasks', 'channelPartners', 'projects', 'supportTickets'];
export const RENDER_MODES = ['list', 'metric', 'insight'];
export const METRIC_AGGS = ['count', 'sum', 'avg'];
export const VISIBILITIES = ['private', 'shared'];

const metricConfigSchema = new mongoose.Schema(
  {
    agg: { type: String, enum: METRIC_AGGS, default: 'count' },
    field: { type: String, default: null },
  },
  { _id: false }
);

// Config for renderMode:'insight' cards (Theme D3). These surface an existing
// analytics service (see services/workspace/insightSources.js) instead of a
// query plan, so they carry a source key + a period/timeframe + an optional
// project scope rather than filters/columns.
const insightConfigSchema = new mongoose.Schema(
  {
    source: { type: String, default: null },
    period: { type: String, default: null },
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', default: null },
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
    // Config for renderMode:'insight' cards — see insightConfigSchema above.
    insightConfig: { type: insightConfigSchema, default: () => ({}) },
    // List-mode display columns: an ordered allow-list of catalog field keys to
    // show. Empty → the frontend falls back to the catalog's default columns.
    // Keys are validated client-side against the module catalog; unknown keys
    // are harmless (rendering ignores keys absent from a row).
    columns: { type: [String], default: [] },
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
