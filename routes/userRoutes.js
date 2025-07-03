// File: routes/userRoutes.js
// Description: Defines the API routes for managing users within an organization.

import express from 'express';
import {
  inviteUser,
  getUsers,
  updateUser,
} from '../controllers/userController.js';

// Import the security middleware
import { protect, authorize } from '../middleware/authMiddleware.js';

const router = express.Router();

// Apply the 'protect' middleware to all routes in this file
router.use(protect);

// Define roles that can manage users
const userManagementAccess = [
  'Business Head',
  'Project Director',
  'Sales Manager',
  'Channel Partner Manager',
];

// Route for inviting a new user
router.post('/invite', authorize(...userManagementAccess), inviteUser);

// Routes for getting all users and updating a specific user
router.route('/')
  .get(authorize(...userManagementAccess), getUsers);

router.route('/:id')
  .put(authorize(...userManagementAccess), updateUser);

export default router;
