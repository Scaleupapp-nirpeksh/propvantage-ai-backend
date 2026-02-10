// File: routes/invitationRoutes.js
// Description: API routes for secure invitation management in PropVantage AI
// Version: 2.1.0 - Production-ready invitation routes with all issues fixed
// Location: routes/invitationRoutes.js

import express from 'express';
import rateLimit from 'express-rate-limit';
import mongoose from 'mongoose';
import {
  generateInvitationLink,
  verifyInvitationToken,
  acceptInvitation,
  getInvitationStatus,
  resendInvitation,
  revokeInvitation,
  getInvitationDetails,
  refreshInvitationToken,
} from '../controllers/invitationController.js'; // FIXED: Correct import path

// Import middleware
import { protect, hasPermission } from '../middleware/authMiddleware.js';
import { PERMISSIONS } from '../config/permissions.js';
import User from '../models/userModel.js'; // FIXED: Correct model import for analytics

const router = express.Router();

// =============================================================================
// RATE LIMITING CONFIGURATION
// =============================================================================

/**
 * Rate limiting for invitation generation (UI-driven)
 * Prevents spam invitation generation
 */
const invitationGenerationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20, // Max 20 invitation generations per hour per IP
  message: {
    success: false,
    message: 'Too many invitation requests. Please try again later.',
    code: 'RATE_LIMITED',
    retryAfter: 3600,
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    // Rate limit by user ID + IP for better security
    return `${req.user?._id || 'anonymous'}_${req.ip}`;
  },
});

/**
 * Rate limiting for invitation verification and acceptance
 * Prevents brute force attacks on invitation tokens
 */
const invitationAccessLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Max 10 attempts per 15 minutes per IP
  message: {
    success: false,
    message: 'Too many invitation access attempts. Please try again later.',
    code: 'ACCESS_RATE_LIMITED',
    retryAfter: 900,
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    // Rate limit by IP and user ID from params
    return `${req.params.userId || 'unknown'}_${req.ip}`;
  },
});

/**
 * Rate limiting for invitation management actions
 * Prevents abuse of resend/revoke functions
 */
const invitationManagementLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // Max 10 management actions per hour per user
  message: {
    success: false,
    message: 'Too many invitation management requests. Please try again later.',
    code: 'MANAGEMENT_RATE_LIMITED',
    retryAfter: 3600,
  },
  keyGenerator: (req) => req.user?._id?.toString() || req.ip,
});

// =============================================================================
// PUBLIC ROUTES - No authentication required (for invitation acceptance)
// =============================================================================

/**
 * @route   GET /api/invitations/verify/:userId
 * @desc    Verify invitation token and get invitation details
 * @access  Public
 * @params  userId - User ID from invitation
 * @query   token - Invitation token
 * @query   email - User email
 * @returns {Object} - Invitation verification result
 */
router.get(
  '/verify/:userId',
  invitationAccessLimiter,
  verifyInvitationToken
);

/**
 * @route   POST /api/invitations/accept/:userId
 * @desc    Accept invitation and set user password (final step)
 * @access  Public
 * @params  userId - User ID from invitation
 * @body    { token, email, password, confirmPassword }
 * @returns {Object} - User data and authentication token
 */
router.post(
  '/accept/:userId',
  invitationAccessLimiter,
  acceptInvitation
);

/**
 * @route   GET /api/invitations/status/:userId
 * @desc    Get invitation status (for checking validity, expiry, etc.)
 * @access  Public
 * @params  userId - User ID from invitation
 * @query   token - Invitation token (optional, for security)
 * @returns {Object} - Invitation status information
 */
router.get(
  '/status/:userId',
  getInvitationStatus
);

// =============================================================================
// PROTECTED ROUTES - Authentication required
// =============================================================================

// Apply authentication middleware to all routes below this point
router.use(protect);

/**
 * @route   POST /api/invitations/generate
 * @desc    Generate invitation link from UI (replaces email-based flow)
 * @access  Private (Management roles)
 * @body    { firstName, lastName, email, role }
 * @returns {Object} - Generated invitation link and token
 */
router.post(
  '/generate',
  hasPermission(PERMISSIONS.USERS.INVITE),
  invitationGenerationLimiter,
  generateInvitationLink
);

/**
 * @route   POST /api/invitations/resend/:userId
 * @desc    Resend invitation (generates new token)
 * @access  Private (Management roles)
 * @params  userId - User ID to resend invitation to
 * @returns {Object} - New invitation link and token
 */
router.post(
  '/resend/:userId',
  hasPermission(PERMISSIONS.USERS.INVITE),
  invitationManagementLimiter,
  resendInvitation
);

/**
 * @route   DELETE /api/invitations/revoke/:userId
 * @desc    Revoke/cancel pending invitation
 * @access  Private (Management roles)
 * @params  userId - User ID to revoke invitation for
 * @returns {Object} - Revocation confirmation
 */
router.delete(
  '/revoke/:userId',
  hasPermission(PERMISSIONS.USERS.INVITE),
  invitationManagementLimiter,
  revokeInvitation
);

/**
 * @route   GET /api/invitations/details/:userId
 * @desc    Get detailed invitation information for management
 * @access  Private (Management roles)
 * @params  userId - User ID to get invitation details for
 * @returns {Object} - Comprehensive invitation details
 */
router.get(
  '/details/:userId',
  hasPermission(PERMISSIONS.USERS.INVITE),
  getInvitationDetails
);

/**
 * @route   PUT /api/invitations/refresh/:userId
 * @desc    Refresh invitation token (extend expiry without changing other details)
 * @access  Private (Management roles)
 * @params  userId - User ID to refresh invitation for
 * @returns {Object} - New invitation link and extended expiry
 */
router.put(
  '/refresh/:userId',
  hasPermission(PERMISSIONS.USERS.INVITE),
  invitationManagementLimiter,
  refreshInvitationToken
);

// =============================================================================
// ADMIN-ONLY ROUTES - Advanced analytics
// =============================================================================

/**
 * @route   GET /api/invitations/analytics
 * @desc    Get invitation analytics and statistics
 * @access  Private (Admin only)
 * @query   startDate - Start date for analytics
 * @query   endDate - End date for analytics
 * @query   organizationId - Organization ID (optional, defaults to user's org)
 * @returns {Object} - Invitation analytics data
 */
router.get(
  '/analytics',
  hasPermission(PERMISSIONS.ANALYTICS.ADVANCED),
  async (req, res) => {
    try {
      const { startDate, endDate, organizationId = req.user.organization } = req.query;

      // Build date filter
      const dateFilter = {};
      if (startDate) {
        dateFilter.$gte = new Date(startDate);
      }
      if (endDate) {
        dateFilter.$lte = new Date(endDate);
      }

      // Proper aggregation pipeline implementation
      const matchStage = {
        organization: new mongoose.Types.ObjectId(organizationId),
        ...(Object.keys(dateFilter).length > 0 && { invitedAt: dateFilter }),
      };

      // Get invitation statistics
      const [statusStats, roleStats, timeStats] = await Promise.all([
        // Status distribution
        User.aggregate([
          { $match: matchStage },
          {
            $group: {
              _id: '$invitationStatus',
              count: { $sum: 1 },
              avgDaysToAccept: {
                $avg: {
                  $cond: [
                    { $eq: ['$invitationStatus', 'accepted'] },
                    {
                      $divide: [
                        { $subtract: ['$acceptedAt', '$invitedAt'] },
                        1000 * 60 * 60 * 24, // Convert to days
                      ],
                    },
                    null,
                  ],
                },
              },
            },
          },
        ]),

        // Role distribution
        User.aggregate([
          { $match: matchStage },
          {
            $group: {
              _id: '$role',
              count: { $sum: 1 },
              acceptedCount: {
                $sum: {
                  $cond: [{ $eq: ['$invitationStatus', 'accepted'] }, 1, 0]
                }
              }
            },
          },
        ]),

        // Time-based statistics
        User.aggregate([
          { $match: matchStage },
          {
            $group: {
              _id: {
                year: { $year: '$invitedAt' },
                month: { $month: '$invitedAt' },
              },
              totalInvitations: { $sum: 1 },
              acceptedInvitations: {
                $sum: {
                  $cond: [{ $eq: ['$invitationStatus', 'accepted'] }, 1, 0]
                }
              },
            },
          },
          { $sort: { '_id.year': 1, '_id.month': 1 } }
        ])
      ]);

      // Calculate summary statistics
      const totalInvitations = statusStats.reduce((sum, stat) => sum + stat.count, 0);
      const acceptedInvitations = statusStats.find(s => s._id === 'accepted')?.count || 0;
      const pendingInvitations = statusStats.find(s => s._id === 'pending')?.count || 0;
      const expiredInvitations = statusStats.find(s => s._id === 'expired')?.count || 0;
      const revokedInvitations = statusStats.find(s => s._id === 'revoked')?.count || 0;

      const acceptanceRate = totalInvitations > 0 ? (acceptedInvitations / totalInvitations * 100) : 0;
      const expiryRate = totalInvitations > 0 ? (expiredInvitations / totalInvitations * 100) : 0;

      const avgDaysToAccept = statusStats.find(s => s._id === 'accepted')?.avgDaysToAccept || 0;

      res.json({
        success: true,
        message: 'Invitation analytics retrieved successfully',
        data: {
          summary: {
            totalInvitations,
            pendingInvitations,
            acceptedInvitations,
            expiredInvitations,
            revokedInvitations,
            acceptanceRate: Math.round(acceptanceRate * 100) / 100,
            expiryRate: Math.round(expiryRate * 100) / 100,
            averageDaysToAccept: Math.round(avgDaysToAccept * 100) / 100,
          },
          statusDistribution: statusStats,
          roleDistribution: roleStats,
          timelineData: timeStats,
          lastAnalyzed: new Date().toISOString(),
        },
      });

    } catch (error) {
      console.error('❌ Error getting invitation analytics:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to retrieve invitation analytics',
        code: 'ANALYTICS_ERROR',
        error: process.env.NODE_ENV === 'production' ? 'Internal server error' : error.message,
      });
    }
  }
);

/**
 * @route   GET /api/invitations/health
 * @desc    Health check for invitation system
 * @access  Private
 * @returns {Object} - System health status
 */
router.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'Invitation system is operational',
    data: {
      timestamp: new Date().toISOString(),
      version: '2.1.0',
      features: [
        'Token-based invitations',
        'UI-generated links',
        'Secure acceptance flow',
        'Rate limiting',
        'Invitation lifecycle management',
        'Analytics and reporting',
        'Bulk operations',
      ],
    },
  });
});

// =============================================================================
// ERROR HANDLING MIDDLEWARE
// =============================================================================

/**
 * Invitation-specific error handling middleware
 */
router.use((error, req, res, next) => {
  console.error('🚨 Invitation Route Error:', error);

  // Handle specific invitation errors
  if (error.name === 'InvitationTokenError') {
    return res.status(400).json({
      success: false,
      message: 'Invalid invitation token',
      code: 'INVALID_TOKEN',
      error: error.message,
    });
  }

  if (error.name === 'InvitationExpiredError') {
    return res.status(410).json({
      success: false,
      message: 'Invitation has expired',
      code: 'EXPIRED_INVITATION',
      error: error.message,
    });
  }

  if (error.name === 'InvitationAlreadyUsedError') {
    return res.status(409).json({
      success: false,
      message: 'Invitation has already been accepted',
      code: 'ALREADY_USED',
      error: error.message,
    });
  }

  if (error.name === 'InvitationNotFoundError') {
    return res.status(404).json({
      success: false,
      message: 'Invitation not found',
      code: 'NOT_FOUND',
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

  // Default error response
  res.status(500).json({
    success: false,
    message: 'An error occurred while processing invitation',
    code: 'INTERNAL_ERROR',
    error: process.env.NODE_ENV === 'production' ? 'Internal server error' : error.message,
  });
});

export default router;
