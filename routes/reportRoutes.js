// File: routes/reportRoutes.js
// Description: Authenticated routes for the Leadership Report Builder.

import express from 'express';
import multer from 'multer';
import { protect, hasPermission } from '../middleware/authMiddleware.js';
import { PERMISSIONS } from '../config/permissions.js';
import { getCatalog, uploadReportImage } from '../controllers/reportController.js';
import {
  getTemplates,
  getTemplateById,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  generateTemplateInstance,
} from '../controllers/reportTemplateController.js';
import { getInstances, getInstanceById, getInstanceAnalytics } from '../controllers/reportInstanceController.js';

const router = express.Router();

// Memory storage → req.file.buffer streamed to S3 (10MB cap), mirrors routes/fileRoutes.js
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

router.use(protect);

// Block catalog for the builder palette
router.get('/catalog', hasPermission(PERMISSIONS.REPORTS.MANAGE), getCatalog);

// Image upload (hero/gallery/logo)
router.post('/uploads', hasPermission(PERMISSIONS.REPORTS.MANAGE), upload.single('file'), uploadReportImage);

// Template CRUD
router
  .route('/templates')
  .get(hasPermission(PERMISSIONS.REPORTS.VIEW), getTemplates)
  .post(hasPermission(PERMISSIONS.REPORTS.MANAGE), createTemplate);

router
  .route('/templates/:id')
  .get(hasPermission(PERMISSIONS.REPORTS.VIEW), getTemplateById)
  .put(hasPermission(PERMISSIONS.REPORTS.MANAGE), updateTemplate)
  .delete(hasPermission(PERMISSIONS.REPORTS.MANAGE), deleteTemplate);

// Ad-hoc generate (preview / on-demand)
router.post('/templates/:id/generate', hasPermission(PERMISSIONS.REPORTS.MANAGE), generateTemplateInstance);

// Generated instances + open-rate analytics
router.get('/instances', hasPermission(PERMISSIONS.REPORTS.VIEW), getInstances);
router.get('/instances/:id', hasPermission(PERMISSIONS.REPORTS.VIEW), getInstanceById);
router.get('/instances/:id/analytics', hasPermission(PERMISSIONS.REPORTS.VIEW), getInstanceAnalytics);

export default router;
