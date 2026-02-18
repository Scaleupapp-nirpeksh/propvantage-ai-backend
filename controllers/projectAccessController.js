// File: controllers/projectAccessController.js
// Description: Manages project-level access assignments (which users can access which projects).

import asyncHandler from 'express-async-handler';
import mongoose from 'mongoose';
import ProjectAssignment from '../models/projectAssignmentModel.js';
import User from '../models/userModel.js';
import Project from '../models/projectModel.js';

/**
 * @desc    Get current user's project assignments
 * @route   GET /api/project-access/me
 * @access  Private (any authenticated user)
 */
const getMyProjects = asyncHandler(async (req, res) => {
  const assignments = await ProjectAssignment.find({
    organization: req.user.organization,
    user: req.user._id,
  })
    .populate('project', 'name type status location totalUnits priceRange')
    .populate('assignedBy', 'firstName lastName email')
    .sort({ assignedAt: -1 });

  res.json({
    success: true,
    count: assignments.length,
    data: assignments,
  });
});

/**
 * @desc    Get all users assigned to a project
 * @route   GET /api/project-access/projects/:projectId/users
 * @access  Private (project_access:view)
 */
const getProjectUsers = asyncHandler(async (req, res) => {
  const { projectId } = req.params;

  const project = await Project.findOne({
    _id: projectId,
    organization: req.user.organization,
  }).select('name type status');

  if (!project) {
    res.status(404);
    throw new Error('Project not found');
  }

  const assignments = await ProjectAssignment.find({
    organization: req.user.organization,
    project: projectId,
  })
    .populate('user', 'firstName lastName email role roleRef isActive')
    .populate({
      path: 'user',
      populate: { path: 'roleRef', select: 'name slug level' },
    })
    .populate('assignedBy', 'firstName lastName email')
    .sort({ assignedAt: -1 });

  res.json({
    success: true,
    project,
    count: assignments.length,
    data: assignments,
  });
});

/**
 * @desc    Get all projects a user is assigned to
 * @route   GET /api/project-access/users/:userId/projects
 * @access  Private (project_access:view)
 */
const getUserProjects = asyncHandler(async (req, res) => {
  const { userId } = req.params;

  const user = await User.findOne({
    _id: userId,
    organization: req.user.organization,
  }).select('firstName lastName email role');

  if (!user) {
    res.status(404);
    throw new Error('User not found');
  }

  const assignments = await ProjectAssignment.find({
    organization: req.user.organization,
    user: userId,
  })
    .populate('project', 'name type status location totalUnits priceRange')
    .populate('assignedBy', 'firstName lastName email')
    .sort({ assignedAt: -1 });

  res.json({
    success: true,
    user,
    count: assignments.length,
    data: assignments,
  });
});

/**
 * @desc    Assign a user to a project
 * @route   POST /api/project-access/assign
 * @access  Private (project_access:manage)
 */
const assignUserToProject = asyncHandler(async (req, res) => {
  const { userId, projectId, notes } = req.body;

  if (!userId || !projectId) {
    res.status(400);
    throw new Error('userId and projectId are required');
  }

  // Validate user exists in org
  const user = await User.findOne({
    _id: userId,
    organization: req.user.organization,
  }).select('firstName lastName email');

  if (!user) {
    res.status(404);
    throw new Error('User not found in this organization');
  }

  // Validate project exists in org
  const project = await Project.findOne({
    _id: projectId,
    organization: req.user.organization,
  }).select('name');

  if (!project) {
    res.status(404);
    throw new Error('Project not found in this organization');
  }

  // Caller must have access to this project themselves
  if (!req.accessibleProjectIds.includes(projectId.toString())) {
    res.status(403);
    throw new Error(
      'You can only grant access to projects you have access to'
    );
  }

  // Check for duplicate
  const existing = await ProjectAssignment.findOne({
    organization: req.user.organization,
    user: userId,
    project: projectId,
  });

  if (existing) {
    res.status(409);
    throw new Error('User already has access to this project');
  }

  const assignment = await ProjectAssignment.create({
    organization: req.user.organization,
    user: userId,
    project: projectId,
    assignedBy: req.user._id,
    notes: notes || '',
  });

  res.status(201).json({
    success: true,
    message: `${user.firstName} ${user.lastName} assigned to ${project.name}`,
    data: assignment,
  });
});

/**
 * @desc    Bulk assign users to projects (cross-product)
 * @route   POST /api/project-access/bulk-assign
 * @access  Private (project_access:manage)
 */
const bulkAssignUsers = asyncHandler(async (req, res) => {
  const { userIds, projectIds, notes } = req.body;

  if (
    !Array.isArray(userIds) ||
    !Array.isArray(projectIds) ||
    userIds.length === 0 ||
    projectIds.length === 0
  ) {
    res.status(400);
    throw new Error('userIds and projectIds arrays are required');
  }

  // Validate all users exist in org
  const users = await User.find({
    _id: { $in: userIds },
    organization: req.user.organization,
  }).select('_id');

  const validUserIds = users.map((u) => u._id.toString());

  // Validate all projects exist in org
  const projects = await Project.find({
    _id: { $in: projectIds },
    organization: req.user.organization,
  }).select('_id');

  const validProjectIds = projects.map((p) => p._id.toString());

  // Caller must have access to all target projects
  const inaccessible = validProjectIds.filter(
    (pid) => !req.accessibleProjectIds.includes(pid)
  );
  if (inaccessible.length > 0) {
    res.status(403);
    throw new Error(
      'You can only grant access to projects you have access to'
    );
  }

  // Build cross-product assignments
  const docs = [];
  for (const uid of validUserIds) {
    for (const pid of validProjectIds) {
      docs.push({
        organization: req.user.organization,
        user: new mongoose.Types.ObjectId(uid),
        project: new mongoose.Types.ObjectId(pid),
        assignedBy: req.user._id,
        notes: notes || '',
      });
    }
  }

  // Insert, skipping duplicates
  let created = 0;
  if (docs.length > 0) {
    try {
      const result = await ProjectAssignment.insertMany(docs, {
        ordered: false,
      });
      created = result.length;
    } catch (err) {
      // BulkWriteError — some may be duplicate key errors
      if (err.code === 11000 || err.insertedDocs) {
        created = err.insertedDocs?.length || 0;
      } else {
        throw err;
      }
    }
  }

  res.status(201).json({
    success: true,
    message: `${created} assignment(s) created`,
    requested: docs.length,
    created,
    skippedDuplicates: docs.length - created,
  });
});

/**
 * @desc    Revoke a user's access to a project
 * @route   DELETE /api/project-access/revoke
 * @access  Private (project_access:manage)
 */
const revokeAccess = asyncHandler(async (req, res) => {
  const { userId, projectId } = req.body;

  if (!userId || !projectId) {
    res.status(400);
    throw new Error('userId and projectId are required');
  }

  const result = await ProjectAssignment.findOneAndDelete({
    organization: req.user.organization,
    user: userId,
    project: projectId,
  });

  if (!result) {
    res.status(404);
    throw new Error('Assignment not found');
  }

  res.json({
    success: true,
    message: 'Project access revoked',
  });
});

/**
 * @desc    Bulk revoke users from projects
 * @route   POST /api/project-access/bulk-revoke
 * @access  Private (project_access:manage)
 */
const bulkRevokeAccess = asyncHandler(async (req, res) => {
  const { userIds, projectIds } = req.body;

  if (
    !Array.isArray(userIds) ||
    !Array.isArray(projectIds) ||
    userIds.length === 0 ||
    projectIds.length === 0
  ) {
    res.status(400);
    throw new Error('userIds and projectIds arrays are required');
  }

  const result = await ProjectAssignment.deleteMany({
    organization: req.user.organization,
    user: { $in: userIds },
    project: { $in: projectIds },
  });

  res.json({
    success: true,
    message: `${result.deletedCount} assignment(s) revoked`,
    revoked: result.deletedCount,
  });
});

/**
 * @desc    Sync a user's project access to an exact list (replace all assignments)
 * @route   PUT /api/project-access/users/:userId/sync
 * @access  Private (project_access:manage)
 *
 * Replaces the user's entire project access with the provided projectIds list.
 * - Projects in the new list but not currently assigned → added
 * - Projects currently assigned but not in the new list → removed
 * - Caller can only sync projects they themselves have access to
 */
const syncUserProjectAccess = asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const { projectIds = [] } = req.body;

  if (!Array.isArray(projectIds)) {
    res.status(400);
    throw new Error('projectIds must be an array');
  }

  // Validate user exists in org
  const user = await User.findOne({
    _id: userId,
    organization: req.user.organization,
  }).select('firstName lastName email');

  if (!user) {
    res.status(404);
    throw new Error('User not found in this organization');
  }

  // Validate all provided projects exist in org
  const validProjects = await Project.find({
    _id: { $in: projectIds },
    organization: req.user.organization,
  }).select('_id name');

  const validProjectIds = validProjects.map((p) => p._id.toString());

  // Caller can only assign projects they themselves have access to
  if (!req.hasFullProjectAccess) {
    const inaccessible = validProjectIds.filter(
      (pid) => !req.accessibleProjectIds.includes(pid)
    );
    if (inaccessible.length > 0) {
      res.status(403);
      throw new Error('You can only assign projects you have access to');
    }
  }

  // Get current assignments for this user
  const existing = await ProjectAssignment.find({
    organization: req.user.organization,
    user: userId,
  }).select('project');

  const existingProjectIds = existing.map((a) => a.project.toString());

  // Diff: what to add and what to remove
  const toAdd = validProjectIds.filter((id) => !existingProjectIds.includes(id));
  const toRemove = existingProjectIds.filter((id) => !validProjectIds.includes(id));

  // Add new assignments
  if (toAdd.length > 0) {
    const newDocs = toAdd.map((pid) => ({
      organization: req.user.organization,
      user: new mongoose.Types.ObjectId(userId),
      project: new mongoose.Types.ObjectId(pid),
      assignedBy: req.user._id,
      notes: '',
    }));
    await ProjectAssignment.insertMany(newDocs, { ordered: false });
  }

  // Remove revoked assignments
  if (toRemove.length > 0) {
    await ProjectAssignment.deleteMany({
      organization: req.user.organization,
      user: userId,
      project: { $in: toRemove },
    });
  }

  res.json({
    success: true,
    message: `Project access updated for ${user.firstName} ${user.lastName}`,
    added: toAdd.length,
    removed: toRemove.length,
    total: validProjectIds.length,
  });
});

export {
  getMyProjects,
  getProjectUsers,
  getUserProjects,
  assignUserToProject,
  bulkAssignUsers,
  revokeAccess,
  bulkRevokeAccess,
  syncUserProjectAccess,
};
