// File: routes/authRoutes.js
// Description: Defines the API routes for user authentication.

import express from 'express';
import rateLimit from 'express-rate-limit';
import { registerUser, loginUser } from '../controllers/authController.js';
import { refreshTokenHandler, logoutUser, logoutAllDevices } from '../controllers/tokenController.js';
import { registerSchema, loginSchema, validate } from '../middleware/validationSchemas.js';
import { protect } from '../middleware/authMiddleware.js';
import { verifyCsrfOrigin } from '../middleware/csrfProtection.js';

const router = express.Router();

// Rate limiter for login — 7 attempts per 15 minutes per IP
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 7,
  message: {
    message: 'Too many login attempts. Please try again after 15 minutes.',
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // only count failed attempts
});

// Rate limiter for registration — 3 per hour per IP
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  message: {
    message: 'Too many registration attempts. Please try again after 1 hour.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limiter for token refresh — 30 per 15 minutes per IP
const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: {
    message: 'Too many refresh attempts. Please try again later.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// @route   POST /api/auth/register
// @desc    Register a new user and organization
// @access  Public
router.post('/register', registerLimiter, validate(registerSchema), registerUser);

// @route   POST /api/auth/login
// @desc    Authenticate a user (login)
// @access  Public
router.post('/login', loginLimiter, validate(loginSchema), loginUser);

// @route   POST /api/auth/refresh
// @desc    Get a new access token using refresh token cookie
// @access  Public (cookie-based)
router.post('/refresh', refreshLimiter, verifyCsrfOrigin, refreshTokenHandler);

// @route   POST /api/auth/logout
// @desc    Revoke refresh token and clear cookie
// @access  Public (cookie-based)
router.post('/logout', verifyCsrfOrigin, logoutUser);

// @route   POST /api/auth/logout-all
// @desc    Revoke all refresh tokens for the authenticated user
// @access  Private
router.post('/logout-all', verifyCsrfOrigin, protect, logoutAllDevices);

export default router;
