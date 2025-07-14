// File: routes/userRoutes.js
// Description: Complete API routes for user management within an organization
// Version: 3.0.0 - Production-ready user CRUD routes (NO INVITATION ROUTES)
// Location: routes/userRoutes.js

import express from 'express';
import rateLimit from 'express-rate-limit';
import {
  getUsers,
  getUserById,
  updateUser,
  getCurrentUserProfile,
  updateCurrentUserProfile,
  deleteUser,
  // NOTE: inviteUser REMOVED - use /api/invitations/generate instead
} from '../controllers/userController.js';

// Import security middleware
import { protect, authorize } from '../middleware/authMiddleware.js';

const router = express.Router();

// =============================================================================
// RATE LIMITING CONFIGURATION
// =============================================================================

/**
 * Rate limiting for user profile updates
 * Prevents spam profile modifications
 */
const profileUpdateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Max 10 profile updates per 15 minutes
  message: {
    success: false,
    message: 'Too many profile update requests. Please try again later.',
    code: 'PROFILE_UPDATE_RATE_LIMITED',
    retryAfter: 900,
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?._id?.toString() || req.ip,
});

/**
 * Rate limiting for user management operations
 * Prevents abuse of admin functions
 */
const userManagementLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 50, // Max 50 user management actions per hour
  message: {
    success: false,
    message: 'Too many user management requests. Please try again later.',
    code: 'USER_MANAGEMENT_RATE_LIMITED',
    retryAfter: 3600,
  },
  keyGenerator: (req) => req.user?._id?.toString() || req.ip,
});

/**
 * Rate limiting for user deletion
 * Extra protection for destructive operations
 */
const userDeletionLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5, // Max 5 user deletions per hour
  message: {
    success: false,
    message: 'Too many user deletion requests. Please try again later.',
    code: 'USER_DELETION_RATE_LIMITED',
    retryAfter: 3600,
  },
  keyGenerator: (req) => req.user?._id?.toString() || req.ip,
});

// =============================================================================
// ROLE DEFINITIONS FOR AUTHORIZATION
// =============================================================================

// Users who can manage other users (view, update roles, etc.)
const userManagementRoles = [
  'Business Head',
  'Project Director',
  'Sales Head',
  'Marketing Head',
  'Finance Head',
  'Sales Manager',
  'Finance Manager',
  'Channel Partner Manager',
];

// Users who can delete other users (more restrictive)
const userDeletionRoles = [
  'Business Head',
  'Project Director',
];

// Users who can view user details (broader access)
const userViewRoles = [
  'Business Head',
  'Project Director',
  'Sales Head',
  'Marketing Head',
  'Finance Head',
  'Sales Manager',
  'Finance Manager',
  'Channel Partner Manager',
  'Sales Executive', // Can view team members
];

// =============================================================================
// APPLY GLOBAL MIDDLEWARE
// =============================================================================

// All routes require authentication
router.use(protect);

// =============================================================================
// PROFILE ROUTES - Self-access (any authenticated user)
// =============================================================================

/**
 * @route   GET /api/users/me
 * @desc    Get current user's profile
 * @access  Private (Any authenticated user)
 * @returns {Object} - Current user's profile information
 */
router.get('/me', getCurrentUserProfile);

/**
 * @route   PUT /api/users/me
 * @desc    Update current user's profile
 * @access  Private (Any authenticated user)
 * @body    { firstName, lastName, phoneNumber, profileImage, preferences }
 * @returns {Object} - Updated user profile
 */
router.put(
  '/me',
  profileUpdateLimiter,
  updateCurrentUserProfile
);

// =============================================================================
// USER MANAGEMENT ROUTES - Management roles required
// =============================================================================

/**
 * @route   GET /api/users
 * @desc    Get all users for the organization with filtering and pagination
 * @access  Private (Management roles)
 * @query   { page, limit, role, status, search, includeInactive, sortBy, sortOrder }
 * @returns {Object} - Paginated list of users with comprehensive details
 */
router.get(
  '/',
  authorize(...userViewRoles),
  userManagementLimiter,
  getUsers
);

/**
 * @route   GET /api/users/:id
 * @desc    Get single user by ID with full details
 * @access  Private (Management roles or self)
 * @params  id - User ID
 * @returns {Object} - Complete user information
 */
router.get(
  '/:id',
  authorize(...userViewRoles),
  getUserById
);

/**
 * @route   PUT /api/users/:id
 * @desc    Update user role, status, or profile information
 * @access  Private (Management roles or self for profile updates)
 * @params  id - User ID
 * @body    { role, isActive, firstName, lastName, phoneNumber, profileImage, preferences }
 * @returns {Object} - Updated user information
 */
router.put(
  '/:id',
  authorize(...userManagementRoles),
  userManagementLimiter,
  updateUser
);

/**
 * @route   DELETE /api/users/:id
 * @desc    Soft delete a user (deactivate)
 * @access  Private (Admin roles only)
 * @params  id - User ID
 * @returns {Object} - Deletion confirmation
 */
router.delete(
  '/:id',
  authorize(...userDeletionRoles),
  userDeletionLimiter,
  deleteUser
);

// =============================================================================
// UTILITY ROUTES
// =============================================================================

/**
 * @route   GET /api/users/health
 * @desc    Health check for user management system
 * @access  Private
 * @returns {Object} - System health status
 */
router.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'User management system is operational',
    data: {
      timestamp: new Date().toISOString(),
      version: '3.0.0',
      features: [
        'User profile management',
        'User CRUD operations',
        'Role-based access control',
        'Advanced filtering and search',
        'Pagination support',
        'Rate limiting protection',
      ],
      endpoints: {
        profile: {
          'GET /me': 'Get own profile',
          'PUT /me': 'Update own profile'
        },
        management: {
          'GET /': 'List all users',
          'GET /:id': 'Get user details',
          'PUT /:id': 'Update user',
          'DELETE /:id': 'Delete user'
        }
      },
      invitationNote: 'User invitations are handled via /api/invitations/* endpoints'
    },
  });
});

// =============================================================================
// ERROR HANDLING MIDDLEWARE
// =============================================================================

/**
 * User-specific error handling middleware
 */
router.use((error, req, res, next) => {
  console.error('🚨 User Route Error:', error);

  // Handle specific user errors
  if (error.name === 'UserNotFoundError') {
    return res.status(404).json({
      success: false,
      message: 'User not found',
      code: 'USER_NOT_FOUND',
      error: error.message,
    });
  }

  if (error.name === 'InsufficientPermissionsError') {
    return res.status(403).json({
      success: false,
      message: 'Insufficient permissions for this operation',
      code: 'INSUFFICIENT_PERMISSIONS',
      error: error.message,
    });
  }

  if (error.name === 'SelfModificationError') {
    return res.status(403).json({
      success: false,
      message: 'Cannot perform this operation on your own account',
      code: 'SELF_MODIFICATION_FORBIDDEN',
      error: error.message,
    });
  }

  // Handle validation errors
  if (error.name === 'ValidationError') {
    const validationErrors = Object.values(error.errors).map(err => err.message);
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      code: 'VALIDATION_ERROR',
      errors: validationErrors,
    });
  }

  // Handle MongoDB duplicate key errors
  if (error.code === 11000) {
    const field = Object.keys(error.keyValue)[0];
    const value = error.keyValue[field];
    
    return res.status(400).json({
      success: false,
      message: `User with ${field} '${value}' already exists`,
      code: 'DUPLICATE_ENTRY',
      error: 'Duplicate entry',
    });
  }

  // Handle rate limiting errors
  if (error.status === 429) {
    return res.status(429).json({
      success: false,
      message: 'Too many requests',
      code: 'RATE_LIMITED',
      retryAfter: error.retryAfter || 3600,
    });
  }

  // Handle authorization errors
  if (error.status === 403) {
    return res.status(403).json({
      success: false,
      message: 'Access denied',
      code: 'ACCESS_DENIED',
      error: error.message,
    });
  }

  // Default error response
  res.status(500).json({
    success: false,
    message: 'An error occurred while processing user request',
    code: 'INTERNAL_ERROR',
    error: process.env.NODE_ENV === 'production' ? 'Internal server error' : error.message,
  });
});

// =============================================================================
// ROUTE DOCUMENTATION COMMENTS
// =============================================================================

/**
 * USER MANAGEMENT ROUTE DOCUMENTATION:
 * 
 * 1. Profile Management (Self-access):
 *    - GET /api/users/me - Get own profile
 *    - PUT /api/users/me - Update own profile
 *    - No special permissions required (any authenticated user)
 * 
 * 2. User Management (Management roles):
 *    - GET /api/users - List users with filtering/pagination
 *    - GET /api/users/:id - Get specific user details
 *    - PUT /api/users/:id - Update user role/status/profile
 *    - DELETE /api/users/:id - Soft delete user (admin only)
 * 
 * 3. Authorization Levels:
 *    - Profile routes: Any authenticated user
 *    - View routes: Management + Sales Executive roles
 *    - Modification routes: Management roles only
 *    - Deletion routes: Business Head + Project Director only
 * 
 * 4. Rate Limiting:
 *    - Profile updates: 10 per 15 minutes
 *    - User management: 50 per hour
 *    - User deletion: 5 per hour
 * 
 * 5. Security Features:
 *    - JWT authentication required for all routes
 *    - Role-based authorization
 *    - Rate limiting protection
 *    - Input validation and sanitization
 *    - Comprehensive error handling
 * 
 * 6. Invitation Separation:
 *    - User invitations are handled separately via /api/invitations/*
 *    - This maintains clean separation of concerns
 *    - No invitation logic in user management routes
 * 
 * 7. RESTful Design:
 *    - Standard HTTP methods (GET, PUT, DELETE)
 *    - Resource-based URLs
 *    - Consistent response format
 *    - Proper status codes
 */

export default router;