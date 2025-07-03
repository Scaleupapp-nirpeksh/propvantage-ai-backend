// File: routes/leadRoutes.js
// Description: Defines the API routes for lead and interaction management, now secured with authentication and authorization.

import express from 'express';
import {
  createLead,
  getLeads,
  getLeadById,
  updateLead,
  addInteractionToLead,
  getLeadInteractions,
} from '../controllers/leadController.js';

// Import the security middleware
import { protect, authorize } from '../middleware/authMiddleware.js';

const router = express.Router();

// Apply the 'protect' middleware to all routes in this file.
// This ensures that a user must be logged in to access any of these endpoints.
router.use(protect);

// Define roles that have general lead access
const leadGeneralAccess = [
  'Business Head',
  'Sales Head',
  'Project Director',
  'Sales Manager',
  'Sales Executive',
  'Channel Partner Manager'
];

// Define roles with broader view/edit permissions
const leadAdminAccess = [
  'Business Head',
  'Sales Head',
  'Project Director',
  'Sales Manager',
];

// Route for creating a lead and getting all leads
router.route('/')
  .post(authorize(...leadAdminAccess), createLead) // Only managers/admins can create leads
  .get(authorize(...leadGeneralAccess), getLeads); // All sales-related roles can view leads

// Route for getting a single lead and updating it
router.route('/:id')
  .get(authorize(...leadGeneralAccess), getLeadById)
  .put(authorize(...leadGeneralAccess), updateLead);

// Route for adding and getting interactions for a specific lead
router.route('/:id/interactions')
  .post(authorize(...leadGeneralAccess), addInteractionToLead)
  .get(authorize(...leadGeneralAccess), getLeadInteractions);

export default router;
