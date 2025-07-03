// File: routes/leadRoutes.js
// Description: Defines the API routes for lead and interaction management.

import express from 'express';
import {
  createLead,
  getLeads,
  getLeadById,
  updateLead,
  addInteractionToLead,
  getLeadInteractions,
} from '../controllers/leadController.js';

// We will import the authentication middleware here later
// import { protect, authorize } from '../middleware/authMiddleware.js';

const router = express.Router();

// Route for creating a lead and getting all leads
// We will add 'protect' middleware to all these routes soon
router.route('/')
  .post(createLead)
  .get(getLeads);

// Route for getting a single lead and updating it
router.route('/:id')
  .get(getLeadById)
  .put(updateLead);

// Route for adding and getting interactions for a specific lead
router.route('/:id/interactions')
  .post(addInteractionToLead)
  .get(getLeadInteractions);

export default router;
