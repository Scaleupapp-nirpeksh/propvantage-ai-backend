// File: controllers/invitationController.js
// Description: UI-focused invitation controller for PropVantage AI (NO EMAIL DEPENDENCY)
// Version: 2.0.0 - Production-ready UI-driven invitation system
// Location: controllers/invitationController.js

import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import User from '../models/userModel.js';
import Organization from '../models/organizationModel.js';
import  generateToken  from '../utils/generateToken.js';

// =============================================================================
// INVITATION CONFIGURATION
// =============================================================================

const INVITATION_CONFIG = {
  // Token expiration time (7 days)
  TOKEN_EXPIRY_DAYS: 7,
  TOKEN_EXPIRY_MS: 7 * 24 * 60 * 60 * 1000, // 7 days in milliseconds
  
  // Invitation status
  STATUS: {
    PENDING: 'pending',
    ACCEPTED: 'accepted',
    EXPIRED: 'expired',
    REVOKED: 'revoked',
  },
  
  // Security settings
  TOKEN_LENGTH: 32, // 32 bytes = 64 hex characters
  MIN_PASSWORD_LENGTH: 8,
  MAX_PENDING_INVITATIONS: 50,
  
  // Role hierarchy for permissions
  ROLE_HIERARCHY: {
    'Business Head': 1,
    'Project Director': 2,
    'Sales Head': 3,
    'Marketing Head': 3,
    'Finance Head': 3,
    'Sales Manager': 4,
    'Finance Manager': 4,
    'Channel Partner Manager': 4,
    'Sales Executive': 5,
    'Channel Partner Admin': 5,
    'Channel Partner Agent': 6,
  },
};

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Generate cryptographically secure invitation token
 * @returns {string} - 64-character hexadecimal token
 */
const generateSecureInvitationToken = () => {
  return crypto.randomBytes(INVITATION_CONFIG.TOKEN_LENGTH).toString('hex');
};

/**
 * Create invitation link for UI sharing
 * @param {string} userId - User ID
 * @param {string} token - Invitation token
 * @param {string} email - User email
 * @returns {string} - Complete invitation URL
 */
const createInvitationURL = (userId, token, email) => {
  const baseUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
  const encodedEmail = encodeURIComponent(email);
  return `${baseUrl}/invite/${userId}?token=${token}&email=${encodedEmail}`;
};

/**
 * Validate invitation input data
 * @param {Object} data - Data to validate
 * @returns {Array} - Array of validation errors
 */
const validateInvitationInput = (data) => {
  const errors = [];
  
  // Name validation
  if (!data.firstName || data.firstName.trim().length < 2) {
    errors.push('First name must be at least 2 characters long');
  }
  
  if (!data.lastName || data.lastName.trim().length < 2) {
    errors.push('Last name must be at least 2 characters long');
  }
  
  // Email validation
  if (!data.email) {
    errors.push('Email is required');
  } else {
    const emailRegex = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;
    if (!emailRegex.test(data.email)) {
      errors.push('Please provide a valid email address');
    }
  }
  
  // Role validation
  if (!data.role) {
    errors.push('Role is required');
  } else {
    const validRoles = Object.keys(INVITATION_CONFIG.ROLE_HIERARCHY);
    if (!validRoles.includes(data.role)) {
      errors.push('Invalid role specified');
    }
  }
  
  return errors;
};

/**
 * Check if user can invite another user with specific role
 * @param {string} inviterRole - Role of the user creating invitation
 * @param {string} targetRole - Role being assigned to invited user
 * @returns {boolean} - True if invitation is allowed
 */
const canUserInviteRole = (inviterRole, targetRole) => {
  const inviterLevel = INVITATION_CONFIG.ROLE_HIERARCHY[inviterRole] || 10;
  const targetLevel = INVITATION_CONFIG.ROLE_HIERARCHY[targetRole] || 10;
  
  // Can only invite roles with higher level number (lower in hierarchy)
  return inviterLevel < targetLevel;
};

/**
 * Validate password strength
 * @param {string} password - Password to validate
 * @returns {Object} - Validation result
 */
const validatePassword = (password) => {
  const errors = [];
  
  if (!password) {
    errors.push('Password is required');
    return { isValid: false, errors };
  }
  
  if (password.length < INVITATION_CONFIG.MIN_PASSWORD_LENGTH) {
    errors.push(`Password must be at least ${INVITATION_CONFIG.MIN_PASSWORD_LENGTH} characters long`);
  }
  
  // Password strength checks
  const hasUpperCase = /[A-Z]/.test(password);
  const hasLowerCase = /[a-z]/.test(password);
  const hasNumbers = /\d/.test(password);
  const hasSpecialChar = /[!@#$%^&*(),.?":{}|<>]/.test(password);
  
  if (!hasUpperCase) {
    errors.push('Password must contain at least one uppercase letter');
  }
  
  if (!hasLowerCase) {
    errors.push('Password must contain at least one lowercase letter');
  }
  
  if (!hasNumbers) {
    errors.push('Password must contain at least one number');
  }
  
  if (!hasSpecialChar) {
    errors.push('Password must contain at least one special character');
  }
  
  return {
    isValid: errors.length === 0,
    errors,
  };
};

// =============================================================================
// MAIN CONTROLLER FUNCTIONS
// =============================================================================

/**
 * @desc    Generate invitation link from UI (NO EMAIL SENDING)
 * @route   POST /api/invitations/generate
 * @access  Private (Management roles)
 * @body    { firstName, lastName, email, role }
 * @returns {Object} - Generated invitation link and token
 */
export const generateInvitationLink = async (req, res) => {
  try {
    const { firstName, lastName, email, role } = req.body;
    const inviterUser = req.user;
    
    console.log(`🔗 Generating invitation link from UI for ${email} by ${inviterUser.email}`);
    
    // =============================================================================
    // INPUT VALIDATION
    // =============================================================================
    
    const validationErrors = validateInvitationInput({ firstName, lastName, email, role });
    if (validationErrors.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: validationErrors,
        code: 'VALIDATION_ERROR',
      });
    }
    
    // =============================================================================
    // PERMISSION CHECKS
    // =============================================================================
    
    // Check if inviter has permission to invite this role
    if (!canUserInviteRole(inviterUser.role, role)) {
      return res.status(403).json({
        success: false,
        message: `You don't have permission to invite users with role: ${role}`,
        code: 'INSUFFICIENT_PERMISSIONS',
      });
    }
    
    // =============================================================================
    // BUSINESS LOGIC VALIDATION
    // =============================================================================
    
    // Check if user already exists in the organization
    const existingUser = await User.findOne({ 
      email: email.toLowerCase(),
      organization: inviterUser.organization 
    });
    
    if (existingUser) {
      if (existingUser.invitationStatus === 'accepted' || existingUser.isActive) {
        return res.status(400).json({
          success: false,
          message: 'A user with this email already exists and is active in your organization',
          code: 'USER_ALREADY_EXISTS',
        });
      } else if (existingUser.invitationStatus === 'pending') {
        return res.status(400).json({
          success: false,
          message: 'An invitation has already been sent to this email address',
          code: 'INVITATION_ALREADY_SENT',
          data: {
            userId: existingUser._id,
            invitedAt: existingUser.invitedAt,
            expiresAt: existingUser.invitationExpiry,
            existingInvitationLink: createInvitationURL(
              existingUser._id, 
              existingUser.invitationToken, 
              email
            ),
          },
        });
      }
    }
    
    // Check organization limits
    const pendingCount = await User.countDocuments({
      organization: inviterUser.organization,
      invitationStatus: INVITATION_CONFIG.STATUS.PENDING,
    });
    
    if (pendingCount >= INVITATION_CONFIG.MAX_PENDING_INVITATIONS) {
      return res.status(429).json({
        success: false,
        message: 'Maximum number of pending invitations reached',
        code: 'INVITATION_LIMIT_EXCEEDED',
      });
    }
    
    // Get organization details
    const organization = await Organization.findById(inviterUser.organization);
    if (!organization || !organization.isActive) {
      return res.status(404).json({
        success: false,
        message: 'Organization not found or inactive',
        code: 'ORGANIZATION_NOT_FOUND',
      });
    }
    
    // =============================================================================
    // CREATE USER WITH INVITATION
    // =============================================================================
    
    let user;
    let isNewUser = false;
    
    if (existingUser && existingUser.invitationStatus === 'expired') {
      // Reuse existing expired user
      user = existingUser;
      console.log(`♻️ Reusing expired invitation for ${email}`);
    } else {
      // Create new user
      isNewUser = true;
      user = new User({
        organization: inviterUser.organization,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email.toLowerCase(),
        role: role,
        isActive: false, // Will be activated when invitation is accepted
        invitedBy: inviterUser._id,
        invitedAt: new Date(),
      });
      console.log(`🆕 Creating new user invitation for ${email}`);
    }
    
    // Generate secure invitation token and expiry
    const invitationToken = generateSecureInvitationToken();
    const invitationExpiry = new Date(
      Date.now() + INVITATION_CONFIG.TOKEN_EXPIRY_MS
    );
    
    // Set invitation data
    user.invitationToken = invitationToken;
    user.invitationExpiry = invitationExpiry;
    user.invitationStatus = INVITATION_CONFIG.STATUS.PENDING;
    
    // Update tracking for re-invitations
    if (!isNewUser) {
      user.invitedBy = inviterUser._id;
      user.invitedAt = new Date();
    }
    
    // Save user to database
    await user.save();
    
    console.log(`✅ User ${isNewUser ? 'created' : 'updated'} with ID: ${user._id}`);
    
    // =============================================================================
    // GENERATE INVITATION LINK FOR UI
    // =============================================================================
    
    const invitationLink = createInvitationURL(user._id, invitationToken, email);
    
    console.log(`🔗 Invitation link generated for UI: ${email}`);
    
    // =============================================================================
    // PREPARE RESPONSE FOR UI
    // =============================================================================
    
    const responseData = {
      user: {
        _id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        role: user.role,
        invitationStatus: user.invitationStatus,
        invitedAt: user.invitedAt,
        invitationExpiry: user.invitationExpiry,
      },
      invitation: {
        link: invitationLink,
        token: invitationToken, // For UI to construct custom links if needed
        expiresAt: invitationExpiry,
        expiresInDays: INVITATION_CONFIG.TOKEN_EXPIRY_DAYS,
        isNewInvitation: isNewUser,
      },
      organization: {
        name: organization.name,
        type: organization.type,
      },
      invitedBy: {
        _id: inviterUser._id,
        firstName: inviterUser.firstName,
        lastName: inviterUser.lastName,
      },
    };
    
    // Success response
    res.status(isNewUser ? 201 : 200).json({
      success: true,
      message: `Invitation link ${isNewUser ? 'generated' : 'regenerated'} successfully for ${email}`,
      data: responseData,
    });
    
  } catch (error) {
    console.error('❌ Error generating invitation link:', error);
    
    // Handle specific errors
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'A user with this email already exists',
        code: 'DUPLICATE_EMAIL',
      });
    }
    
    if (error.name === 'ValidationError') {
      const validationErrors = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: validationErrors,
        code: 'VALIDATION_ERROR',
      });
    }
    
    // Generic error response
    res.status(500).json({
      success: false,
      message: 'Failed to generate invitation link',
      code: 'INTERNAL_ERROR',
      error: process.env.NODE_ENV === 'production' ? 'Internal server error' : error.message,
    });
  }
};

/**
 * @desc    Verify invitation token and get invitation details
 * @route   GET /api/invitations/verify/:userId
 * @access  Public
 * @params  userId - User ID from invitation
 * @query   token - Invitation token
 * @query   email - User email
 * @returns {Object} - Invitation verification result
 */
export const verifyInvitationToken = async (req, res) => {
  try {
    const { userId } = req.params;
    const { token, email } = req.query;
    
    console.log(`🔍 Verifying invitation token for user ${userId}`);
    
    // =============================================================================
    // INPUT VALIDATION
    // =============================================================================
    
    if (!token || !email) {
      return res.status(400).json({
        success: false,
        message: 'Invitation token and email are required',
        code: 'MISSING_PARAMETERS',
      });
    }
    
    if (!userId || !/^[0-9a-fA-F]{24}$/.test(userId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid user ID format',
        code: 'INVALID_USER_ID',
      });
    }
    
    // =============================================================================
    // FIND AND VALIDATE INVITATION
    // =============================================================================
    
    // Find user with invitation token
    const user = await User.findOne({
      _id: userId,
      email: email.toLowerCase(),
      invitationToken: token,
      invitationStatus: INVITATION_CONFIG.STATUS.PENDING,
    }).populate('organization', 'name type isActive');
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Invalid invitation token or user not found',
        code: 'INVITATION_NOT_FOUND',
      });
    }
    
    // Check if organization is still active
    if (!user.organization.isActive) {
      return res.status(403).json({
        success: false,
        message: 'Organization is no longer active',
        code: 'ORGANIZATION_INACTIVE',
      });
    }
    
    // Check if invitation has expired
    if (user.invitationExpiry && new Date() > user.invitationExpiry) {
      // Update status to expired
      user.invitationStatus = INVITATION_CONFIG.STATUS.EXPIRED;
      await user.save();
      
      return res.status(410).json({
        success: false,
        message: 'Invitation has expired',
        code: 'INVITATION_EXPIRED',
        data: {
          expiredAt: user.invitationExpiry,
        },
      });
    }
    
    // =============================================================================
    // LOG ACCESS FOR SECURITY
    // =============================================================================
    
    // Log invitation access (optional but recommended for security)
    const clientIP = req.ip || req.connection?.remoteAddress || 'unknown';
    const userAgent = req.get('User-Agent') || 'unknown';
    
    user.logInvitationAccess(clientIP, userAgent);
    await user.save();
    
    // =============================================================================
    // RETURN INVITATION DETAILS
    // =============================================================================
    
    res.json({
      success: true,
      message: 'Invitation verified successfully',
      data: {
        isValid: true,
        user: {
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          role: user.role,
        },
        organization: {
          name: user.organization.name,
          type: user.organization.type,
        },
        invitation: {
          expiresAt: user.invitationExpiry,
          invitedAt: user.invitedAt,
          daysRemaining: Math.ceil(
            (user.invitationExpiry - new Date()) / (1000 * 60 * 60 * 24)
          ),
        },
      },
    });
    
  } catch (error) {
    console.error('❌ Error verifying invitation:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to verify invitation',
      code: 'INTERNAL_ERROR',
      error: process.env.NODE_ENV === 'production' ? 'Internal server error' : error.message,
    });
  }
};

/**
 * @desc    Accept invitation and set user password (final step)
 * @route   POST /api/invitations/accept/:userId
 * @access  Public
 * @params  userId - User ID from invitation
 * @body    { token, email, password, confirmPassword }
 * @returns {Object} - User data and authentication token
 */
export const acceptInvitation = async (req, res) => {
  try {
    const { userId } = req.params;
    const { token, email, password, confirmPassword } = req.body;
    
    console.log(`✅ Processing invitation acceptance for user ${userId}`);
    
    // =============================================================================
    // INPUT VALIDATION
    // =============================================================================
    
    if (!token || !email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Token, email, and password are required',
        code: 'MISSING_PARAMETERS',
      });
    }
    
    if (confirmPassword && password !== confirmPassword) {
      return res.status(400).json({
        success: false,
        message: 'Password and confirm password do not match',
        code: 'PASSWORD_MISMATCH',
      });
    }
    
    // Validate password strength
    const passwordValidation = validatePassword(password);
    if (!passwordValidation.isValid) {
      return res.status(400).json({
        success: false,
        message: 'Password does not meet strength requirements',
        errors: passwordValidation.errors,
        code: 'WEAK_PASSWORD',
      });
    }
    
    // =============================================================================
    // FIND AND VALIDATE INVITATION
    // =============================================================================
    
    const user = await User.findOne({
      _id: userId,
      email: email.toLowerCase(),
      invitationToken: token,
      invitationStatus: INVITATION_CONFIG.STATUS.PENDING,
    }).populate('organization');
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Invalid invitation token or user not found',
        code: 'INVITATION_NOT_FOUND',
      });
    }
    
    // Check if invitation has expired
    if (user.invitationExpiry && new Date() > user.invitationExpiry) {
      user.invitationStatus = INVITATION_CONFIG.STATUS.EXPIRED;
      await user.save();
      
      return res.status(410).json({
        success: false,
        message: 'Invitation has expired',
        code: 'INVITATION_EXPIRED',
      });
    }
    
    // =============================================================================
    // ACCEPT INVITATION AND ACTIVATE USER
    // =============================================================================
    
    // Use the model method to accept invitation
    await user.acceptInvitation(password);
    
    console.log(`🎉 User ${user.email} successfully accepted invitation and activated account`);
    
    // =============================================================================
    // GENERATE JWT TOKEN FOR IMMEDIATE LOGIN
    // =============================================================================
    
    const authToken = generateToken(user._id);
    
    // =============================================================================
    // PREPARE RESPONSE DATA
    // =============================================================================
    
    const userData = {
      _id: user._id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      role: user.role,
      isActive: user.isActive,
      organization: {
        _id: user.organization._id,
        name: user.organization.name,
        type: user.organization.type,
      },
      lastLogin: user.lastLogin,
      acceptedAt: user.acceptedAt,
    };
    
    res.status(200).json({
      success: true,
      message: 'Invitation accepted successfully. Account activated!',
      data: {
        user: userData,
        token: authToken,
        redirectTo: '/dashboard', // Suggest redirect for UI
      },
    });
    
  } catch (error) {
    console.error('❌ Error accepting invitation:', error);
    
    if (error.name === 'ValidationError') {
      const validationErrors = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: validationErrors,
        code: 'VALIDATION_ERROR',
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Failed to accept invitation',
      code: 'INTERNAL_ERROR',
      error: process.env.NODE_ENV === 'production' ? 'Internal server error' : error.message,
    });
  }
};

/**
 * @desc    Get invitation status for checking validity
 * @route   GET /api/invitations/status/:userId
 * @access  Public
 * @params  userId - User ID from invitation
 * @query   token - Invitation token (optional)
 * @returns {Object} - Invitation status information
 */
export const getInvitationStatus = async (req, res) => {
  try {
    const { userId } = req.params;
    const { token } = req.query;
    
    // Build query
    const query = { _id: userId };
    if (token) {
      query.invitationToken = token;
    }
    
    // Find user
    const user = await User.findOne(query).select(
      'invitationStatus invitationExpiry invitedAt acceptedAt'
    );
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Invitation not found',
        data: { 
          status: 'not_found',
          isValid: false 
        },
      });
    }
    
    // Determine current status
    let status = user.invitationStatus;
    let isValid = false;
    
    if (status === INVITATION_CONFIG.STATUS.PENDING) {
      if (user.invitationExpiry && new Date() > user.invitationExpiry) {
        status = INVITATION_CONFIG.STATUS.EXPIRED;
        // Update in database
        user.invitationStatus = status;
        await user.save();
      } else {
        isValid = true;
      }
    }
    
    res.json({
      success: true,
      message: 'Invitation status retrieved',
      data: {
        status,
        isValid,
        expiresAt: user.invitationExpiry,
        invitedAt: user.invitedAt,
        acceptedAt: user.acceptedAt,
      },
    });
    
  } catch (error) {
    console.error('❌ Error getting invitation status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get invitation status',
      code: 'INTERNAL_ERROR',
      error: process.env.NODE_ENV === 'production' ? 'Internal server error' : error.message,
    });
  }
};

/**
 * @desc    Resend invitation (generates new token)
 * @route   POST /api/invitations/resend/:userId
 * @access  Private (Management roles)
 * @params  userId - User ID to resend invitation to
 * @returns {Object} - New invitation link and token
 */
export const resendInvitation = async (req, res) => {
  try {
    const { userId } = req.params;
    const inviterUser = req.user;
    
    console.log(`🔄 Resending invitation for user ${userId}`);
    
    // Find the user
    const user = await User.findOne({
      _id: userId,
      organization: inviterUser.organization,
    }).populate('organization');
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found in your organization',
        code: 'USER_NOT_FOUND',
      });
    }
    
    // Check if user has already accepted invitation
    if (user.invitationStatus === INVITATION_CONFIG.STATUS.ACCEPTED || user.isActive) {
      return res.status(400).json({
        success: false,
        message: 'User has already accepted the invitation',
        code: 'ALREADY_ACCEPTED',
      });
    }
    
    // Check permissions
    if (!canUserInviteRole(inviterUser.role, user.role)) {
      return res.status(403).json({
        success: false,
        message: 'You don\'t have permission to manage this user',
        code: 'INSUFFICIENT_PERMISSIONS',
      });
    }
    
    // Generate new invitation token
    const newToken = user.generateInvitationToken();
    user.invitedBy = inviterUser._id;
    user.invitedAt = new Date();
    
    await user.save();
    
    // Create new invitation link
    const invitationLink = createInvitationURL(user._id, newToken, user.email);
    
    console.log(`✅ Invitation resent for ${user.email}`);
    
    res.json({
      success: true,
      message: `Invitation resent successfully to ${user.email}`,
      data: {
        invitationLink,
        token: newToken,
        expiresAt: user.invitationExpiry,
        expiresInDays: INVITATION_CONFIG.TOKEN_EXPIRY_DAYS,
      },
    });
    
  } catch (error) {
    console.error('❌ Error resending invitation:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to resend invitation',
      code: 'INTERNAL_ERROR',
      error: process.env.NODE_ENV === 'production' ? 'Internal server error' : error.message,
    });
  }
};

/**
 * @desc    Revoke/cancel pending invitation
 * @route   DELETE /api/invitations/revoke/:userId
 * @access  Private (Management roles)
 * @params  userId - User ID to revoke invitation for
 * @returns {Object} - Revocation confirmation
 */
export const revokeInvitation = async (req, res) => {
  try {
    const { userId } = req.params;
    const revokerUser = req.user;
    
    console.log(`🚫 Revoking invitation for user ${userId}`);
    
    // Find the user
    const user = await User.findOne({
      _id: userId,
      organization: revokerUser.organization,
    });
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found in your organization',
        code: 'USER_NOT_FOUND',
      });
    }
    
    // Check if user has already accepted invitation
    if (user.invitationStatus === INVITATION_CONFIG.STATUS.ACCEPTED || user.isActive) {
      return res.status(400).json({
        success: false,
        message: 'Cannot revoke invitation for an active user',
        code: 'CANNOT_REVOKE_ACTIVE',
      });
    }
    
    // Check permissions
    if (!canUserInviteRole(revokerUser.role, user.role)) {
      return res.status(403).json({
        success: false,
        message: 'You don\'t have permission to manage this user',
        code: 'INSUFFICIENT_PERMISSIONS',
      });
    }
    
    // Revoke invitation using model method
    await user.revokeInvitation(revokerUser._id);
    
    console.log(`✅ Invitation revoked for ${user.email}`);
    
    res.json({
      success: true,
      message: `Invitation revoked successfully for ${user.email}`,
      data: {
        user: {
          _id: user._id,
          email: user.email,
          invitationStatus: user.invitationStatus,
          revokedAt: user.revokedAt,
        },
      },
    });
    
  } catch (error) {
    console.error('❌ Error revoking invitation:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to revoke invitation',
      code: 'INTERNAL_ERROR',
      error: process.env.NODE_ENV === 'production' ? 'Internal server error' : error.message,
    });
  }
};

/**
 * @desc    Get detailed invitation information for management
 * @route   GET /api/invitations/details/:userId
 * @access  Private (Management roles)
 * @params  userId - User ID to get invitation details for
 * @returns {Object} - Comprehensive invitation details
 */
export const getInvitationDetails = async (req, res) => {
  try {
    const { userId } = req.params;
    const requesterUser = req.user;
    
    // Find the user with invitation details
    const user = await User.findOne({
      _id: userId,
      organization: requesterUser.organization,
    })
    .populate('invitedBy', 'firstName lastName email')
    .populate('revokedBy', 'firstName lastName email')
    .populate('organization', 'name type');
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found in your organization',
        code: 'USER_NOT_FOUND',
      });
    }
    
    // Prepare comprehensive invitation details
    const invitationDetails = {
      user: {
        _id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        role: user.role,
        isActive: user.isActive,
      },
      invitation: {
        status: user.invitationStatus,
        invitedAt: user.invitedAt,
        invitedBy: user.invitedBy,
        acceptedAt: user.acceptedAt,
        revokedAt: user.revokedAt,
        revokedBy: user.revokedBy,
        expiresAt: user.invitationExpiry,
        isExpired: user.isInvitationExpired,
        daysSinceInvitation: user.daysSinceInvitation,
        accessLog: user.invitationAccessLog?.slice(-5), // Last 5 access logs
      },
      organization: user.organization,
      lastLogin: user.lastLogin,
    };
    
    // Include invitation link if still pending and not expired
    if (user.invitationStatus === INVITATION_CONFIG.STATUS.PENDING && 
        user.invitationToken && 
        !user.isInvitationExpired) {
      invitationDetails.invitation.link = createInvitationURL(
        user._id, 
        user.invitationToken, 
        user.email
      );
    }
    
    res.json({
      success: true,
      message: 'Invitation details retrieved successfully',
      data: invitationDetails,
    });
    
  } catch (error) {
    console.error('❌ Error getting invitation details:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get invitation details',
      code: 'INTERNAL_ERROR',
      error: process.env.NODE_ENV === 'production' ? 'Internal server error' : error.message,
    });
  }
};

/**
 * @desc    Refresh invitation token (extend expiry)
 * @route   PUT /api/invitations/refresh/:userId
 * @access  Private (Management roles)
 * @params  userId - User ID to refresh invitation for
 * @returns {Object} - New invitation link and extended expiry
 */
export const refreshInvitationToken = async (req, res) => {
  try {
    const { userId } = req.params;
    const refresherUser = req.user;
    
    console.log(`🔄 Refreshing invitation token for user ${userId}`);
    
    // Find the user
    const user = await User.findOne({
      _id: userId,
      organization: refresherUser.organization,
    });
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found in your organization',
        code: 'USER_NOT_FOUND',
      });
    }
    
    // Can only refresh pending invitations
    if (user.invitationStatus !== INVITATION_CONFIG.STATUS.PENDING) {
      return res.status(400).json({
        success: false,
        message: 'Can only refresh pending invitations',
        code: 'INVALID_STATUS',
      });
    }
    
    // Check permissions
    if (!canUserInviteRole(refresherUser.role, user.role)) {
      return res.status(403).json({
        success: false,
        message: 'You don\'t have permission to manage this user',
        code: 'INSUFFICIENT_PERMISSIONS',
      });
    }
    
    // Generate new token and extend expiry
    const newToken = user.generateInvitationToken();
    await user.save();
    
    // Create new invitation link
    const invitationLink = createInvitationURL(user._id, newToken, user.email);
    
    console.log(`✅ Invitation token refreshed for ${user.email}`);
    
    res.json({
      success: true,
      message: `Invitation refreshed successfully for ${user.email}`,
      data: {
        invitationLink,
        token: newToken,
        expiresAt: user.invitationExpiry,
        expiresInDays: INVITATION_CONFIG.TOKEN_EXPIRY_DAYS,
      },
    });
    
  } catch (error) {
    console.error('❌ Error refreshing invitation token:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to refresh invitation token',
      code: 'INTERNAL_ERROR',
      error: process.env.NODE_ENV === 'production' ? 'Internal server error' : error.message,
    });
  }
};

// =============================================================================
// EXPORT ALL FUNCTIONS
// =============================================================================
