// File: utils/projectAccessHelper.js
// Description: Shared helpers for project-level access control.

import mongoose from 'mongoose';

/**
 * Verify the calling user has access to a specific project.
 * Throws 403 if not. Use in controllers after fetching a document with a project field.
 *
 * @param {Object} req - Express request (needs req.accessibleProjectIds)
 * @param {Object} res - Express response (for setting status code)
 * @param {string|ObjectId} projectId - The project ID to check
 */
export function verifyProjectAccess(req, res, projectId) {
  if (req.hasFullProjectAccess) return;

  const pid = projectId?.toString();
  if (!pid) return;

  if (
    !req.accessibleProjectIds ||
    !req.accessibleProjectIds.includes(pid)
  ) {
    res.status(403);
    throw new Error('You do not have access to this project');
  }
}

/**
 * Build a MongoDB filter that restricts queries to accessible projects.
 * Use in list endpoints for models with a `project` field.
 *
 * @param {Object} req - Express request
 * @returns {Object} e.g. { project: { $in: [ObjectId, ...] } }
 */
export function projectAccessFilter(req) {
  if (req.hasFullProjectAccess) return {};

  if (!req.accessibleProjectIds || req.accessibleProjectIds.length === 0) {
    return { project: { $in: [] } };
  }
  return {
    project: {
      $in: req.accessibleProjectIds.map(
        (id) => new mongoose.Types.ObjectId(id)
      ),
    },
  };
}

/**
 * Build a MongoDB filter for querying the Project model directly.
 * Uses `_id` instead of `project` since we're querying the Project collection.
 *
 * @param {Object} req - Express request
 * @returns {Object} e.g. { _id: { $in: [ObjectId, ...] } }
 */
export function projectIdAccessFilter(req) {
  if (req.hasFullProjectAccess) return {};

  if (!req.accessibleProjectIds || req.accessibleProjectIds.length === 0) {
    return { _id: { $in: [] } };
  }
  return {
    _id: {
      $in: req.accessibleProjectIds.map(
        (id) => new mongoose.Types.ObjectId(id)
      ),
    },
  };
}
