// File: models/projectAssignmentModel.js
// Description: Junction table linking Users to Projects for project-level access control.

import mongoose from 'mongoose';

const projectAssignmentSchema = new mongoose.Schema(
  {
    organization: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    project: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
      index: true,
    },
    assignedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    assignedAt: {
      type: Date,
      default: Date.now,
    },
    notes: {
      type: String,
      maxlength: 500,
      default: '',
    },
  },
  {
    timestamps: true,
  }
);

// One user can be assigned to a project only once
projectAssignmentSchema.index(
  { organization: 1, user: 1, project: 1 },
  { unique: true }
);

// Look up all projects for a user in an org
projectAssignmentSchema.index({ organization: 1, user: 1 });

// Look up all users for a project
projectAssignmentSchema.index({ organization: 1, project: 1 });

const ProjectAssignment = mongoose.model(
  'ProjectAssignment',
  projectAssignmentSchema
);

export default ProjectAssignment;
