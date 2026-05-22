// File: routes/partnershipRoutes.js
// Marketplace partnership lifecycle. Used by both org types — each handler
// resolves the caller's org type and enforces the appropriate permission, so
// no org-type middleware is applied at the router level.
import express from 'express';
import { protect } from '../middleware/authMiddleware.js';
import {
  createPartnership,
  transitionPartnership,
  listPartnerships,
  getPartnership,
} from '../controllers/partnershipController.js';

const router = express.Router();

router.use(protect);

router.post('/', createPartnership);
router.get('/', listPartnerships);
router.get('/:id', getPartnership);
router.patch('/:id', transitionPartnership);

export default router;
