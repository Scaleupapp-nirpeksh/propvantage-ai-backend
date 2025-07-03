// File: routes/authRoutes.js
// Description: Defines the API routes for user authentication.

import express from 'express';
import { registerUser, loginUser } from '../controllers/authController.js';

const router = express.Router();

// @route   POST /api/auth/register
// @desc    Register a new user and organization
// @access  Public
router.post('/register', registerUser);

// @route   POST /api/auth/login
// @desc    Authenticate a user (login)
// @access  Public
router.post('/login', loginUser);

export default router;
