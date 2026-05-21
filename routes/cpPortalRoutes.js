// File: routes/cpPortalRoutes.js
import express from 'express';
import { protect, hasPermission, requireOrgType } from '../middleware/authMiddleware.js';
import { CP_PERMISSIONS } from '../config/permissions.js';
import {
  getOrgProfile,
  updateOrgProfile,
  listTeam,
  generateCpInvitationLink,
  changeMemberRole,
  deactivateMember,
} from '../controllers/cpPortalController.js';

const router = express.Router();

// Every CP portal route requires auth AND a channel-partner organization.
router.use(protect);
router.use(requireOrgType('channel_partner'));

router.get('/org', hasPermission(CP_PERMISSIONS.ORG.VIEW), getOrgProfile);
router.put('/org', hasPermission(CP_PERMISSIONS.ORG.MANAGE), updateOrgProfile);

router.get('/team', hasPermission(CP_PERMISSIONS.TEAM.VIEW), listTeam);
router.post('/team/invite', hasPermission(CP_PERMISSIONS.TEAM.MANAGE), generateCpInvitationLink);
router.put('/team/:userId/role', hasPermission(CP_PERMISSIONS.TEAM.MANAGE), changeMemberRole);
router.put('/team/:userId/deactivate', hasPermission(CP_PERMISSIONS.TEAM.MANAGE), deactivateMember);

export default router;
