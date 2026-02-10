// File: routes/roleRoutes.js
// Description: Routes for organization-scoped role management and permission catalog.

import express from 'express';
import {
  getRoles,
  getRoleById,
  createRole,
  updateRole,
  deleteRole,
  getPermissionCatalog,
  duplicateRole,
  transferOwnership,
} from '../controllers/roleController.js';
import { protect, hasPermission } from '../middleware/authMiddleware.js';
import { PERMISSIONS } from '../config/permissions.js';

const router = express.Router();

// All routes require authentication
router.use(protect);

// Permission catalog (must be before /:id to avoid conflict)
router.get(
  '/permissions/catalog',
  hasPermission(PERMISSIONS.ROLES.VIEW),
  getPermissionCatalog
);

// Ownership transfer
router.post('/transfer-ownership', transferOwnership);

// Role CRUD
router
  .route('/')
  .get(hasPermission(PERMISSIONS.ROLES.VIEW), getRoles)
  .post(hasPermission(PERMISSIONS.ROLES.CREATE), createRole);

router
  .route('/:id')
  .get(hasPermission(PERMISSIONS.ROLES.VIEW), getRoleById)
  .put(hasPermission(PERMISSIONS.ROLES.UPDATE), updateRole)
  .delete(hasPermission(PERMISSIONS.ROLES.DELETE), deleteRole);

// Duplicate a role
router.post(
  '/:id/duplicate',
  hasPermission(PERMISSIONS.ROLES.CREATE),
  duplicateRole
);

export default router;
