// File: routes/projectAccessRoutes.js
// Description: Routes for managing project-level access assignments.

import express from 'express';
import { protect, hasPermission } from '../middleware/authMiddleware.js';
import { PERMISSIONS } from '../config/permissions.js';
import {
  getMyProjects,
  getProjectUsers,
  getUserProjects,
  assignUserToProject,
  bulkAssignUsers,
  revokeAccess,
  bulkRevokeAccess,
  syncUserProjectAccess,
} from '../controllers/projectAccessController.js';

const router = express.Router();

router.use(protect);

// Current user's project assignments (any authenticated user)
router.get('/me', getMyProjects);

// View assignments (requires project_access:view)
router.get(
  '/projects/:projectId/users',
  hasPermission(PERMISSIONS.PROJECT_ACCESS.VIEW),
  getProjectUsers
);
router.get(
  '/users/:userId/projects',
  hasPermission(PERMISSIONS.PROJECT_ACCESS.VIEW),
  getUserProjects
);

// Manage assignments (requires project_access:manage)
router.post(
  '/assign',
  hasPermission(PERMISSIONS.PROJECT_ACCESS.MANAGE),
  assignUserToProject
);
router.post(
  '/bulk-assign',
  hasPermission(PERMISSIONS.PROJECT_ACCESS.MANAGE),
  bulkAssignUsers
);
router.delete(
  '/revoke',
  hasPermission(PERMISSIONS.PROJECT_ACCESS.MANAGE),
  revokeAccess
);
router.post(
  '/bulk-revoke',
  hasPermission(PERMISSIONS.PROJECT_ACCESS.MANAGE),
  bulkRevokeAccess
);
router.put(
  '/users/:userId/sync',
  hasPermission(PERMISSIONS.PROJECT_ACCESS.MANAGE),
  syncUserProjectAccess
);

export default router;
