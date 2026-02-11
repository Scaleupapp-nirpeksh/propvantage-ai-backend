// File: routes/taskRoutes.js
// Description: Task management routes with permission-based access control

import express from 'express';
import {
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
} from '../controllers/taskController.js';
import {
  protect,
  hasPermission,
  hasAnyPermission,
} from '../middleware/authMiddleware.js';
import { PERMISSIONS } from '../config/permissions.js';

const router = express.Router();

// All routes require authentication
router.use(protect);

// =============================================================================
// PERSONAL & TEAM VIEWS (specific routes BEFORE :id routes)
// =============================================================================
router.get('/my', hasPermission(PERMISSIONS.TASKS.VIEW), getMyTasks);
router.get('/team', hasPermission(PERMISSIONS.TASKS.VIEW_TEAM), getTeamTasks);
router.get('/overdue', hasPermission(PERMISSIONS.TASKS.VIEW), getOverdueTasks);
router.get(
  '/analytics',
  hasPermission(PERMISSIONS.TASKS.ANALYTICS),
  getTaskAnalytics
);

// =============================================================================
// BULK OPERATIONS
// =============================================================================
router.put(
  '/bulk/assign',
  hasPermission(PERMISSIONS.TASKS.BULK_OPERATIONS),
  bulkAssign
);
router.put(
  '/bulk/status',
  hasPermission(PERMISSIONS.TASKS.BULK_OPERATIONS),
  bulkUpdateStatus
);

// =============================================================================
// TEMPLATE ROUTES
// =============================================================================
router.post(
  '/templates',
  hasPermission(PERMISSIONS.TASKS.MANAGE_TEMPLATES),
  createTemplate
);
router.get('/templates', hasPermission(PERMISSIONS.TASKS.VIEW), getTemplates);
router.get(
  '/templates/:templateId',
  hasPermission(PERMISSIONS.TASKS.VIEW),
  getTemplateById
);
router.put(
  '/templates/:templateId',
  hasPermission(PERMISSIONS.TASKS.MANAGE_TEMPLATES),
  updateTemplate
);
router.delete(
  '/templates/:templateId',
  hasPermission(PERMISSIONS.TASKS.MANAGE_TEMPLATES),
  deleteTemplate
);
router.post(
  '/templates/:templateId/apply',
  hasPermission(PERMISSIONS.TASKS.CREATE),
  applyTemplate
);

// =============================================================================
// TASK CRUD
// =============================================================================
router.post('/', hasPermission(PERMISSIONS.TASKS.CREATE), createTask);
router.get(
  '/',
  hasAnyPermission(
    PERMISSIONS.TASKS.VIEW,
    PERMISSIONS.TASKS.VIEW_TEAM,
    PERMISSIONS.TASKS.VIEW_ALL
  ),
  getTasks
);
router.get('/:id', hasPermission(PERMISSIONS.TASKS.VIEW), getTaskById);
router.put('/:id', hasPermission(PERMISSIONS.TASKS.UPDATE), updateTask);
router.delete('/:id', hasPermission(PERMISSIONS.TASKS.DELETE), deleteTask);

// =============================================================================
// STATUS TRANSITIONS
// =============================================================================
router.put(
  '/:id/status',
  hasPermission(PERMISSIONS.TASKS.UPDATE),
  updateTaskStatus
);

// =============================================================================
// CHECKLIST
// =============================================================================
router.put(
  '/:id/checklist/:itemId',
  hasPermission(PERMISSIONS.TASKS.UPDATE),
  toggleChecklistItem
);

// =============================================================================
// COMMENTS
// =============================================================================
router.post('/:id/comments', hasPermission(PERMISSIONS.TASKS.VIEW), addComment);
router.get('/:id/comments', hasPermission(PERMISSIONS.TASKS.VIEW), getComments);

// =============================================================================
// SUB-TASKS
// =============================================================================
router.post(
  '/:id/subtasks',
  hasPermission(PERMISSIONS.TASKS.CREATE),
  createSubTask
);

export default router;
