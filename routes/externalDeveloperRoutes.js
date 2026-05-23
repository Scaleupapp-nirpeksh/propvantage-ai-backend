// File: routes/externalDeveloperRoutes.js
// SP4 — authenticated CP-side endpoints for off-platform developer tracking.
// Router-level guards: protect + requireOrgType('channel_partner') +
// hasPermission(cp_external_developers:manage). Per spec §4.2, ONE permission
// gates the entire surface (Manager + Owner only — CP Agent has no access).
import express from 'express';
import {
  protect,
  hasPermission,
  requireOrgType,
} from '../middleware/authMiddleware.js';
import { CP_PERMISSIONS } from '../config/permissions.js';
import {
  listExternalDevelopers,
  getExternalDeveloper,
  createExternalDeveloper,
  updateExternalDeveloper,
  deleteExternalDeveloper,
  inviteExternalDeveloper,
} from '../controllers/externalDeveloperController.js';

const router = express.Router();

router.use(protect);
router.use(requireOrgType('channel_partner'));
router.use(hasPermission(CP_PERMISSIONS.EXTERNAL_DEVELOPERS.MANAGE));

router.get('/', listExternalDevelopers);
router.post('/', createExternalDeveloper);
router.get('/:id', getExternalDeveloper);
router.put('/:id', updateExternalDeveloper);
router.delete('/:id', deleteExternalDeveloper);
router.post('/:id/invite', inviteExternalDeveloper);

export default router;
