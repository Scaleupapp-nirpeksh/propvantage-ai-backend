// File: routes/partnershipRoutes.js
// Marketplace partnership lifecycle. Most routes are used by both org types —
// each handler resolves the caller's org type and enforces the appropriate
// permission, so no org-type middleware is applied at the router level.
import express from 'express';
import { protect } from '../middleware/authMiddleware.js';
import {
  createPartnership,
  transitionPartnership,
  listPartnerships,
  getPartnership,
  inviteNewCp,
  getOffPlatformInvite,
  claimInvite,
} from '../controllers/partnershipController.js';

const router = express.Router();

// Public — the off-platform CP onboarding link reads this to pre-fill the
// channel-partner registration page. Declared before `protect`.
router.get('/invite/:channelPartnerId', getOffPlatformInvite);

router.use(protect);

router.post('/', createPartnership);
router.post('/invite-new-cp', inviteNewCp);
router.post('/claim-invite', claimInvite);
router.get('/', listPartnerships);
router.get('/:id', getPartnership);
router.patch('/:id', transitionPartnership);

export default router;
