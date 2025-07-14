// File: middleware/inviteMiddleware.js
// Description: Invitation middleware for token validation and security checks
// Version: 1.0.0 - Production ready invitation security middleware
// Location: middleware/inviteMiddleware.js

import User from '../models/User.js';
import Organization from '../models/Organization.js';

// =============================================================================
// INVITATION MIDDLEWARE CONFIGURATION
// =============================================================================

const INVITE_MIDDLEWARE_CONFIG = {
  // Security settings
  MAX_ATTEMPTS_PER_IP: 10, // Max attempts per IP per hour
  RATE_LIMIT_WINDOW: 60 * 60 * 1000, // 1 hour in milliseconds
  
  // Token validation settings
  MIN_TOKEN_LENGTH: 32,
  MAX_TOKEN_LENGTH: 128,
  
  // Error types
  ERRORS: {
    INVALID_TOKEN: 'InvitationTokenError',
    EXPIRED_INVITATION: 'InvitationExpiredError',
    ALREADY_USED: 'InvitationAlreadyUsedError',
    NOT_FOUND: 'InvitationNotFoundError',
    RATE_LIMITED: 'RateLimitError',
  },
};

// Simple in-memory store for rate limiting (in production, use Redis)
const attemptStore = new Map();

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Clean up old rate limit entries
 */
const cleanupOldAttempts = () => {
  const now = Date.now();
  const cutoff = now - INVITE_MIDDLEWARE_CONFIG.RATE_LIMIT_WINDOW;
  
  for (const [key, data] of attemptStore.entries()) {
    if (data.timestamp < cutoff) {
      attemptStore.delete(key);
    }
  }
};

/**
 * Get client IP address
 */
const getClientIP = (req) => {
  return req.ip || 
         req.connection.remoteAddress || 
         req.socket.remoteAddress || 
         (req.connection.socket ? req.connection.socket.remoteAddress : null) ||
         '127.0.0.1';
};

/**
 * Create custom error with specific type
 */
const createInvitationError = (type, message) => {
  const error = new Error(message);
  error.name = type;
  return error;
};

// =============================================================================
// RATE LIMITING MIDDLEWARE
// =============================================================================

/**
 * Rate limiting for invitation endpoints
 */
export const rateLimitInvitations = (req, res, next) => {
  try {
    const clientIP = getClientIP(req);
    const now = Date.now();
    
    // Clean up old entries periodically
    if (Math.random() < 0.1) { // 10% chance to cleanup
      cleanupOldAttempts();
    }
    
    // Get current attempts for this IP
    const key = `invite_${clientIP}`;
    const attempts = attemptStore.get(key) || { count: 0, timestamp: now };
    
    // Reset counter if window has passed
    if (now - attempts.timestamp > INVITE_MIDDLEWARE_CONFIG.RATE_LIMIT_WINDOW) {
      attempts.count = 0;
      attempts.timestamp = now;
    }
    
    // Check if limit exceeded
    if (attempts.count >= INVITE_MIDDLEWARE_CONFIG.MAX_ATTEMPTS_PER_IP) {
      const error = createInvitationError(
        INVITE_MIDDLEWARE_CONFIG.ERRORS.RATE_LIMITED,
        'Too many invitation attempts. Please try again later.'
      );
      return next(error);
    }
    
    // Increment counter
    attempts.count++;
    attemptStore.set(key, attempts);
    
    next();
  } catch (error) {
    console.error('❌ Rate limiting error:', error);
    next(error);
  }
};

// =============================================================================
// TOKEN VALIDATION MIDDLEWARE
// =============================================================================

/**
 * Validate invitation token format and basic security checks
 */
export const validateInvitationToken = (req, res, next) => {
  try {
    const { userId } = req.params;
    const { token, email } = req.query;
    
    console.log(`🔍 Validating invitation token for user ${userId}`);
    
    // Check required parameters
    if (!userId) {
      const error = createInvitationError(
        INVITE_MIDDLEWARE_CONFIG.ERRORS.INVALID_TOKEN,
        'User ID is required'
      );
      return next(error);
    }
    
    if (!token) {
      const error = createInvitationError(
        INVITE_MIDDLEWARE_CONFIG.ERRORS.INVALID_TOKEN,
        'Invitation token is required'
      );
      return next(error);
    }
    
    if (!email) {
      const error = createInvitationError(
        INVITE_MIDDLEWARE_CONFIG.ERRORS.INVALID_TOKEN,
        'Email is required'
      );
      return next(error);
    }
    
    // Validate token format
    if (typeof token !== 'string' || 
        token.length < INVITE_MIDDLEWARE_CONFIG.MIN_TOKEN_LENGTH || 
        token.length > INVITE_MIDDLEWARE_CONFIG.MAX_TOKEN_LENGTH) {
      const error = createInvitationError(
        INVITE_MIDDLEWARE_CONFIG.ERRORS.INVALID_TOKEN,
        'Invalid token format'
      );
      return next(error);
    }
    
    // Validate token characters (should be hex)
    if (!/^[a-f0-9]+$/i.test(token)) {
      const error = createInvitationError(
        INVITE_MIDDLEWARE_CONFIG.ERRORS.INVALID_TOKEN,
        'Invalid token format'
      );
      return next(error);
    }
    
    // Validate email format
    const emailRegex = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;
    if (!emailRegex.test(email)) {
      const error = createInvitationError(
        INVITE_MIDDLEWARE_CONFIG.ERRORS.INVALID_TOKEN,
        'Invalid email format'
      );
      return next(error);
    }
    
    // Validate userId format (MongoDB ObjectId)
    if (!/^[0-9a-fA-F]{24}$/.test(userId)) {
      const error = createInvitationError(
        INVITE_MIDDLEWARE_CONFIG.ERRORS.INVALID_TOKEN,
        'Invalid user ID format'
      );
      return next(error);
    }
    
    console.log(`✅ Token format validation passed for ${email}`);
    next();
    
  } catch (error) {
    console.error('❌ Token validation error:', error);
    const validationError = createInvitationError(
      INVITE_MIDDLEWARE_CONFIG.ERRORS.INVALID_TOKEN,
      'Token validation failed'
    );
    next(validationError);
  }
};

// =============================================================================
// INVITATION VERIFICATION MIDDLEWARE
// =============================================================================

/**
 * Verify invitation exists and is in valid state
 */
export const verifyInvitationExists = async (req, res, next) => {
  try {
    const { userId } = req.params;
    const { token, email } = req.query;
    
    console.log(`🔍 Verifying invitation exists for ${email}`);
    
    // Find user with invitation details
    const user = await User.findOne({
      _id: userId,
      email: email.toLowerCase(),
      invitationToken: token,
    }).populate('organization', 'name type isActive');
    
    if (!user) {
      const error = createInvitationError(
        INVITE_MIDDLEWARE_CONFIG.ERRORS.NOT_FOUND,
        'Invitation not found or invalid'
      );
      return next(error);
    }
    
    // Check if organization is still active
    if (!user.organization || !user.organization.isActive) {
      const error = createInvitationError(
        INVITE_MIDDLEWARE_CONFIG.ERRORS.INVALID_TOKEN,
        'Organization is no longer active'
      );
      return next(error);
    }
    
    // Check if user has already accepted invitation
    if (user.invitationStatus === 'accepted' || user.lastLogin) {
      const error = createInvitationError(
        INVITE_MIDDLEWARE_CONFIG.ERRORS.ALREADY_USED,
        'Invitation has already been accepted'
      );
      return next(error);
    }
    
    // Check if invitation was revoked
    if (user.invitationStatus === 'revoked') {
      const error = createInvitationError(
        INVITE_MIDDLEWARE_CONFIG.ERRORS.INVALID_TOKEN,
        'Invitation has been revoked'
      );
      return next(error);
    }
    
    // Attach user to request for next middleware
    req.invitationUser = user;
    
    console.log(`✅ Invitation exists and is valid for ${email}`);
    next();
    
  } catch (error) {
    console.error('❌ Invitation verification error:', error);
    const verificationError = createInvitationError(
      INVITE_MIDDLEWARE_CONFIG.ERRORS.NOT_FOUND,
      'Failed to verify invitation'
    );
    next(verificationError);
  }
};

// =============================================================================
// EXPIRY CHECKING MIDDLEWARE
// =============================================================================

/**
 * Check if invitation has expired
 */
export const checkInvitationExpiry = async (req, res, next) => {
  try {
    const user = req.invitationUser;
    
    // If no user attached, try to get it from previous middleware
    if (!user) {
      const { userId } = req.params;
      const { token, email } = req.query;
      
      const foundUser = await User.findOne({
        _id: userId,
        email: email.toLowerCase(),
        invitationToken: token,
      });
      
      if (!foundUser) {
        const error = createInvitationError(
          INVITE_MIDDLEWARE_CONFIG.ERRORS.NOT_FOUND,
          'Invitation not found'
        );
        return next(error);
      }
      
      req.invitationUser = foundUser;
    }
    
    const invitationUser = req.invitationUser;
    
    console.log(`⏰ Checking invitation expiry for ${invitationUser.email}`);
    
    // Check if invitation has expiry date
    if (!invitationUser.invitationExpiry) {
      console.log(`⚠️ No expiry date set for invitation ${invitationUser.email}`);
      return next(); // Allow if no expiry set (backwards compatibility)
    }
    
    // Check if invitation has expired
    const now = new Date();
    const expiryDate = new Date(invitationUser.invitationExpiry);
    
    if (now > expiryDate) {
      console.log(`❌ Invitation expired for ${invitationUser.email}. Expired at: ${expiryDate}, Current time: ${now}`);
      
      // Update invitation status to expired in database
      if (invitationUser.invitationStatus === 'pending') {
        invitationUser.invitationStatus = 'expired';
        await invitationUser.save();
        console.log(`📝 Updated invitation status to expired for ${invitationUser.email}`);
      }
      
      const error = createInvitationError(
        INVITE_MIDDLEWARE_CONFIG.ERRORS.EXPIRED_INVITATION,
        `Invitation expired on ${expiryDate.toLocaleDateString()}`
      );
      return next(error);
    }
    
    console.log(`✅ Invitation is still valid for ${invitationUser.email}. Expires: ${expiryDate}`);
    next();
    
  } catch (error) {
    console.error('❌ Expiry check error:', error);
    const expiryError = createInvitationError(
      INVITE_MIDDLEWARE_CONFIG.ERRORS.EXPIRED_INVITATION,
      'Failed to check invitation expiry'
    );
    next(expiryError);
  }
};

// =============================================================================
// INVITATION SECURITY MIDDLEWARE
// =============================================================================

/**
 * Additional security checks for invitation requests
 */
export const invitationSecurityChecks = (req, res, next) => {
  try {
    const userAgent = req.get('User-Agent');
    const referer = req.get('Referer');
    const origin = req.get('Origin');
    
    console.log(`🔒 Running security checks for invitation request`);
    
    // Check for suspicious user agents
    const suspiciousPatterns = [
      /bot/i,
      /crawler/i,
      /spider/i,
      /scraper/i,
      /curl/i,
      /wget/i,
    ];
    
    if (userAgent && suspiciousPatterns.some(pattern => pattern.test(userAgent))) {
      console.log(`⚠️ Suspicious user agent detected: ${userAgent}`);
      // Log but don't block - could be legitimate automation
    }
    
    // Log security relevant information
    console.log(`🔒 Security info - UA: ${userAgent?.substring(0, 100)}, Origin: ${origin}, Referer: ${referer}`);
    
    // Check for valid origin in production
    if (process.env.NODE_ENV === 'production') {
      const allowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',');
      if (origin && allowedOrigins.length > 0 && !allowedOrigins.includes(origin)) {
        console.log(`⚠️ Request from non-allowed origin: ${origin}`);
        // Log but don't block for invitation links (they might be opened from emails)
      }
    }
    
    next();
    
  } catch (error) {
    console.error('❌ Security check error:', error);
    // Don't fail the request for security check errors
    next();
  }
};

// =============================================================================
// INVITATION LOGGING MIDDLEWARE
// =============================================================================

/**
 * Log invitation activity for security monitoring
 */
export const logInvitationActivity = (req, res, next) => {
  try {
    const { userId } = req.params;
    const { email } = req.query;
    const clientIP = getClientIP(req);
    const userAgent = req.get('User-Agent');
    const timestamp = new Date().toISOString();
    
    // Log invitation access attempt
    console.log(`📊 INVITATION_ACCESS: ${timestamp} | IP: ${clientIP} | User: ${userId} | Email: ${email} | UA: ${userAgent?.substring(0, 50)}`);
    
    // In production, you might want to send this to a logging service
    // or store in a separate audit log table
    
    next();
    
  } catch (error) {
    console.error('❌ Logging error:', error);
    // Don't fail the request for logging errors
    next();
  }
};

// =============================================================================
// COMPOSITE MIDDLEWARE FUNCTIONS
// =============================================================================

/**
 * Complete invitation validation middleware chain
 * Use this for endpoints that need full validation
 */
export const fullInvitationValidation = [
  rateLimitInvitations,
  logInvitationActivity,
  invitationSecurityChecks,
  validateInvitationToken,
  verifyInvitationExists,
  checkInvitationExpiry,
];

/**
 * Basic invitation validation middleware chain
 * Use this for less critical endpoints
 */
export const basicInvitationValidation = [
  logInvitationActivity,
  validateInvitationToken,
];

// =============================================================================
// ERROR HANDLING
// =============================================================================

/**
 * Handle invitation-specific errors
 */
export const handleInvitationErrors = (error, req, res, next) => {
  console.error('🚨 Invitation middleware error:', error);
  
  // Handle specific invitation errors
  switch (error.name) {
    case INVITE_MIDDLEWARE_CONFIG.ERRORS.INVALID_TOKEN:
      return res.status(400).json({
        success: false,
        message: 'Invalid invitation token',
        error: error.message,
        code: 'INVALID_TOKEN',
      });
      
    case INVITE_MIDDLEWARE_CONFIG.ERRORS.EXPIRED_INVITATION:
      return res.status(410).json({
        success: false,
        message: 'Invitation has expired',
        error: error.message,
        code: 'EXPIRED_INVITATION',
      });
      
    case INVITE_MIDDLEWARE_CONFIG.ERRORS.ALREADY_USED:
      return res.status(409).json({
        success: false,
        message: 'Invitation has already been used',
        error: error.message,
        code: 'ALREADY_USED',
      });
      
    case INVITE_MIDDLEWARE_CONFIG.ERRORS.NOT_FOUND:
      return res.status(404).json({
        success: false,
        message: 'Invitation not found',
        error: error.message,
        code: 'NOT_FOUND',
      });
      
    case INVITE_MIDDLEWARE_CONFIG.ERRORS.RATE_LIMITED:
      return res.status(429).json({
        success: false,
        message: 'Too many requests',
        error: error.message,
        code: 'RATE_LIMITED',
        retryAfter: INVITE_MIDDLEWARE_CONFIG.RATE_LIMIT_WINDOW / 1000,
      });
      
    default:
      // Pass to next error handler
      next(error);
  }
};

// =============================================================================
// CLEANUP FUNCTIONS
// =============================================================================

/**
 * Cleanup expired invitations (run periodically)
 */
export const cleanupExpiredInvitations = async () => {
  try {
    console.log('🧹 Starting cleanup of expired invitations...');
    
    const result = await User.updateMany(
      {
        invitationStatus: 'pending',
        invitationExpiry: { $lt: new Date() },
      },
      {
        $set: { invitationStatus: 'expired' },
        $unset: { invitationToken: 1 },
      }
    );
    
    console.log(`✅ Cleaned up ${result.modifiedCount} expired invitations`);
    
    return result.modifiedCount;
  } catch (error) {
    console.error('❌ Error cleaning up expired invitations:', error);
    return 0;
  }
};

// Run cleanup every hour
if (process.env.NODE_ENV !== 'test') {
  setInterval(cleanupExpiredInvitations, 60 * 60 * 1000); // 1 hour
}

export default {
  validateInvitationToken,
  verifyInvitationExists,
  checkInvitationExpiry,
  invitationSecurityChecks,
  rateLimitInvitations,
  logInvitationActivity,
  fullInvitationValidation,
  basicInvitationValidation,
  handleInvitationErrors,
  cleanupExpiredInvitations,
};