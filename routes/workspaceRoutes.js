// File: routes/workspaceRoutes.js
// Description: Authenticated routes for the Personalized Workspace. All routes
//   require a valid token (protect). Per-module data permission is enforced by
//   the engine's viewer-scoped catalog, so these routes do not add module gates.

import express from 'express';
import { protect } from '../middleware/authMiddleware.js';
import {
  getCatalog,
  previewCard,
  createCard,
  listCards,
  updateCard,
  deleteCard,
  getCardData,
  getLayout,
  saveLayout,
} from '../controllers/workspaceController.js';

const router = express.Router();

router.use(protect);

router.get('/catalog/:module', getCatalog);
router.post('/preview', previewCard);

router.route('/cards').get(listCards).post(createCard);
router.route('/cards/:id').put(updateCard).delete(deleteCard);
router.post('/cards/:id/data', getCardData);

router.route('/layout').get(getLayout).put(saveLayout);

export default router;
