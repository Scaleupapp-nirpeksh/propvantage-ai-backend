// File: models/User.js
// Description: Enhanced User model with secure invitation system for PropVantage AI
// Version: 2.0.0 - Production-ready user model with invitation management
// Location: models/User.js

import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

// =============================================================================
// USER SCHEMA DEFINITION
// =============================================================================

const userSchema = new mongoose.Schema(
  {
    // =============================================================================
    // BASIC USER INFORMATION
    // =============================================================================
    
    organization: {
      type: mongoose.Schema.Types.ObjectId,
      required: [true, 'Organization is required'],
      ref: 'Organization',
      index: true, // Index for faster queries
    },
    
    firstName: {
      type: String,
      required: [true, 'First name is required'],
      trim: true,
      minlength: [2, 'First name must be at least 2 characters long'],
      maxlength: [50, 'First name cannot exceed 50 characters'],
      validate: {
        validator: function(v) {
          return /^[a-zA-Z\s'-]+$/.test(v);
        },
        message: 'First name can only contain letters, spaces, hyphens, and apostrophes'
      }
    },
    
    lastName: {
      type: String,
      required: [true, 'Last name is required'],
      trim: true,
      minlength: [2, 'Last name must be at least 2 characters long'],
      maxlength: [50, 'Last name cannot exceed 50 characters'],
      validate: {
        validator: function(v) {
          return /^[a-zA-Z\s'-]+$/.test(v);
        },
        message: 'Last name can only contain letters, spaces, hyphens, and apostrophes'
      }
    },
    
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      index: true, // Index for faster queries and unique constraint
      validate: {
        validator: function(v) {
          return /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(v);
        },
        message: 'Please provide a valid email address'
      }
    },
    
    password: {
      type: String,
      required: function() {
        // Password is only required if invitation has been accepted
        return this.invitationStatus === 'accepted';
      },
      minlength: [8, 'Password must be at least 8 characters long'],
      select: false, // Never return password in queries by default
      validate: {
        validator: function(v) {
          // Only validate if password is being set
          if (!v) return true;
          
          // Password strength validation
          const hasUpperCase = /[A-Z]/.test(v);
          const hasLowerCase = /[a-z]/.test(v);
          const hasNumbers = /\d/.test(v);
          const hasSpecialChar = /[!@#$%^&*(),.?":{}|<>]/.test(v);
          
          return hasUpperCase && hasLowerCase && hasNumbers && hasSpecialChar;
        },
        message: 'Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character'
      }
    },
    
    role: {
      type: String,
      required: [true, 'Role is required'],
      enum: {
        values: [
          'Business Head',
          'Sales Head',
          'Marketing Head',
          'Finance Head',
          'Project Director',
          'Sales Manager',
          'Finance Manager',
          'Channel Partner Manager',
          'Sales Executive',
          'Channel Partner Admin',
          'Channel Partner Agent',
        ],
        message: 'Invalid role specified'
      },
      index: true, // Index for role-based queries
    },
    
    // =============================================================================
    // USER STATUS AND ACTIVITY
    // =============================================================================
    
    isActive: {
      type: Boolean,
      default: false, // Default to false - activated when invitation is accepted
      index: true,
    },
    
    lastLogin: {
      type: Date,
      default: null,
    },
    
    loginAttempts: {
      type: Number,
      default: 0,
    },
    
    lockUntil: {
      type: Date,
      default: null,
    },
    
    // =============================================================================
    // INVITATION SYSTEM FIELDS
    // =============================================================================
    
    invitationToken: {
      type: String,
      default: null,
      select: false, // Never expose token in regular queries
      index: true, // Index for token lookups
    },
    
    invitationExpiry: {
      type: Date,
      default: null,
      index: true, // Index for expiry cleanup queries
    },
    
    invitationStatus: {
      type: String,
      enum: {
        values: ['pending', 'accepted', 'expired', 'revoked'],
        message: 'Invalid invitation status'
      },
      default: 'pending',
      index: true, // Index for status-based queries
    },
    
    // =============================================================================
    // INVITATION TRACKING FIELDS
    // =============================================================================
    
    invitedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    
    invitedAt: {
      type: Date,
      default: Date.now,
    },
    
    acceptedAt: {
      type: Date,
      default: null,
    },
    
    revokedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    
    revokedAt: {
      type: Date,
      default: null,
    },
    
    // =============================================================================
    // SECURITY AND AUDIT FIELDS
    // =============================================================================
    
    passwordChangedAt: {
      type: Date,
      default: Date.now,
    },
    
    passwordResetToken: {
      type: String,
      default: null,
      select: false,
    },
    
    passwordResetExpires: {
      type: Date,
      default: null,
    },
    
    // Track invitation link usage for security
    invitationAccessLog: [{
      accessedAt: {
        type: Date,
        default: Date.now,
      },
      ipAddress: {
        type: String,
        default: null,
      },
      userAgent: {
        type: String,
        default: null,
      },
    }],
    
    // =============================================================================
    // PROFILE AND PREFERENCES
    // =============================================================================
    
    profileImage: {
      type: String,
      default: null,
    },
    
    phoneNumber: {
      type: String,
      default: null,
      validate: {
        validator: function(v) {
          if (!v) return true; // Allow empty phone numbers
          return /^[\+]?[1-9][\d]{0,15}$/.test(v);
        },
        message: 'Please provide a valid phone number'
      }
    },
    
    preferences: {
      language: {
        type: String,
        default: 'en',
        enum: ['en', 'hi'],
      },
      timezone: {
        type: String,
        default: 'Asia/Kolkata',
      },
      notifications: {
        email: {
          type: Boolean,
          default: true,
        },
        push: {
          type: Boolean,
          default: true,
        },
        sms: {
          type: Boolean,
          default: false,
        },
      },
    },
  },
  {
    timestamps: true, // Automatically adds createdAt and updatedAt
    
    // Add version key for optimistic concurrency control
    versionKey: '__v',
    
    // Optimize document structure
    minimize: false,
    
    // Transform output to remove sensitive fields
    toJSON: {
      transform: function(doc, ret) {
        delete ret.password;
        delete ret.invitationToken;
        delete ret.passwordResetToken;
        delete ret.__v;
        return ret;
      }
    },
    
    toObject: {
      transform: function(doc, ret) {
        delete ret.password;
        delete ret.invitationToken;
        delete ret.passwordResetToken;
        delete ret.__v;
        return ret;
      }
    }
  }
);

// =============================================================================
// COMPOUND INDEXES FOR PERFORMANCE
// =============================================================================

// Compound index for organization-based user queries
userSchema.index({ organization: 1, isActive: 1 });

// Compound index for invitation queries
userSchema.index({ organization: 1, invitationStatus: 1 });

// Compound index for email and organization uniqueness
userSchema.index({ email: 1, organization: 1 }, { unique: true });

// Compound index for invitation token validation
userSchema.index({ 
  invitationToken: 1, 
  invitationStatus: 1, 
  invitationExpiry: 1 
});

// =============================================================================
// VIRTUAL FIELDS
// =============================================================================

// Virtual for full name
userSchema.virtual('fullName').get(function() {
  return `${this.firstName} ${this.lastName}`;
});

// Virtual for checking if account is locked
userSchema.virtual('isLocked').get(function() {
  return !!(this.lockUntil && this.lockUntil > Date.now());
});

// Virtual for checking if invitation is expired
userSchema.virtual('isInvitationExpired').get(function() {
  if (!this.invitationExpiry) return false;
  return Date.now() > this.invitationExpiry;
});

// Virtual for days since invitation
userSchema.virtual('daysSinceInvitation').get(function() {
  if (!this.invitedAt) return null;
  return Math.floor((Date.now() - this.invitedAt) / (1000 * 60 * 60 * 24));
});

// Ensure virtual fields are serialized
userSchema.set('toJSON', { virtuals: true });
userSchema.set('toObject', { virtuals: true });

// =============================================================================
// PRE-SAVE MIDDLEWARE
// =============================================================================

/**
 * Hash password before saving if it has been modified
 */
userSchema.pre('save', async function(next) {
  // Only hash password if it has been modified (or is new)
  if (!this.isModified('password')) {
    return next();
  }
  
  try {
    // Generate salt and hash password
    const salt = await bcrypt.genSalt(12); // Higher rounds for better security
    this.password = await bcrypt.hash(this.password, salt);
    
    // Update password changed timestamp
    this.passwordChangedAt = Date.now() - 1000; // Subtract 1 second to ensure JWT is created after password change
    
    next();
  } catch (error) {
    next(error);
  }
});

/**
 * Update invitation status based on expiry
 */
userSchema.pre('save', function(next) {
  // Auto-expire invitations that have passed their expiry date
  if (this.invitationStatus === 'pending' && 
      this.invitationExpiry && 
      Date.now() > this.invitationExpiry) {
    this.invitationStatus = 'expired';
  }
  
  next();
});

/**
 * Validate role hierarchy on save
 */
userSchema.pre('save', function(next) {
  // Define role hierarchy levels (lower number = higher authority)
  const roleHierarchy = {
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
  };
  
  // Store role level for future use
  this.roleLevel = roleHierarchy[this.role] || 10;
  
  next();
});

// =============================================================================
// INSTANCE METHODS
// =============================================================================

/**
 * Compare entered password with hashed password in database
 * @param {string} enteredPassword - Plain text password to compare
 * @returns {Promise<boolean>} - True if passwords match
 */
userSchema.methods.matchPassword = async function(enteredPassword) {
  if (!this.password) {
    return false;
  }
  
  try {
    return await bcrypt.compare(enteredPassword, this.password);
  } catch (error) {
    throw new Error('Password comparison failed');
  }
};

/**
 * Generate secure invitation token
 * @returns {string} - Generated invitation token
 */
userSchema.methods.generateInvitationToken = function() {
  // Generate cryptographically secure random token
  const token = crypto.randomBytes(32).toString('hex');
  
  // Set token and expiry (7 days from now)
  this.invitationToken = token;
  this.invitationExpiry = Date.now() + (7 * 24 * 60 * 60 * 1000); // 7 days
  this.invitationStatus = 'pending';
  
  return token;
};

/**
 * Generate password reset token
 * @returns {string} - Generated reset token
 */
userSchema.methods.generatePasswordResetToken = function() {
  // Generate reset token
  const resetToken = crypto.randomBytes(20).toString('hex');
  
  // Hash token and set to passwordResetToken field
  this.passwordResetToken = crypto
    .createHash('sha256')
    .update(resetToken)
    .digest('hex');
  
  // Set expire time (10 minutes)
  this.passwordResetExpires = Date.now() + 10 * 60 * 1000;
  
  return resetToken;
};

/**
 * Accept invitation and activate account
 * @param {string} password - User's chosen password
 * @returns {Promise<void>}
 */
userSchema.methods.acceptInvitation = async function(password) {
  this.password = password; // Will be hashed by pre-save middleware
  this.invitationStatus = 'accepted';
  this.acceptedAt = Date.now();
  this.isActive = true;
  this.lastLogin = Date.now();
  
  // Clear invitation-related fields
  this.invitationToken = undefined;
  this.invitationExpiry = undefined;
  
  await this.save();
};

/**
 * Revoke invitation
 * @param {ObjectId} revokedByUserId - ID of user who revoked the invitation
 * @returns {Promise<void>}
 */
userSchema.methods.revokeInvitation = async function(revokedByUserId) {
  this.invitationStatus = 'revoked';
  this.revokedBy = revokedByUserId;
  this.revokedAt = Date.now();
  
  // Clear invitation token for security
  this.invitationToken = undefined;
  this.invitationExpiry = undefined;
  
  await this.save();
};

/**
 * Log invitation access for security tracking
 * @param {string} ipAddress - Client IP address
 * @param {string} userAgent - Client user agent
 */
userSchema.methods.logInvitationAccess = function(ipAddress, userAgent) {
  this.invitationAccessLog.push({
    accessedAt: Date.now(),
    ipAddress: ipAddress,
    userAgent: userAgent,
  });
  
  // Keep only last 10 access logs to prevent document bloat
  if (this.invitationAccessLog.length > 10) {
    this.invitationAccessLog = this.invitationAccessLog.slice(-10);
  }
};

/**
 * Check if user can invite others with specific role
 * @param {string} targetRole - Role to check invitation permission for
 * @returns {boolean} - True if can invite
 */
userSchema.methods.canInviteRole = function(targetRole) {
  const roleHierarchy = {
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
  };
  
  const currentUserLevel = roleHierarchy[this.role] || 10;
  const targetUserLevel = roleHierarchy[targetRole] || 10;
  
  // Can only invite roles with higher level number (lower in hierarchy)
  return currentUserLevel < targetUserLevel;
};

// =============================================================================
// STATIC METHODS
// =============================================================================

/**
 * Find user by invitation token with validation
 * @param {string} token - Invitation token
 * @param {string} email - User email
 * @returns {Promise<User|null>} - User document or null
 */
userSchema.statics.findByInvitationToken = async function(token, email) {
  if (!token || !email) {
    return null;
  }
  
  const user = await this.findOne({
    invitationToken: token,
    email: email.toLowerCase(),
    invitationStatus: 'pending',
    invitationExpiry: { $gt: Date.now() }, // Token must not be expired
  }).populate('organization', 'name type isActive');
  
  return user;
};

/**
 * Clean up expired invitations
 * @returns {Promise<number>} - Number of cleaned up invitations
 */
userSchema.statics.cleanupExpiredInvitations = async function() {
  const result = await this.updateMany(
    {
      invitationStatus: 'pending',
      invitationExpiry: { $lt: Date.now() },
    },
    {
      $set: { invitationStatus: 'expired' },
      $unset: { 
        invitationToken: 1,
        invitationExpiry: 1,
      },
    }
  );
  
  return result.modifiedCount;
};

/**
 * Get invitation statistics for organization
 * @param {ObjectId} organizationId - Organization ID
 * @returns {Promise<Object>} - Invitation statistics
 */
userSchema.statics.getInvitationStats = async function(organizationId) {
  const stats = await this.aggregate([
    { $match: { organization: organizationId } },
    {
      $group: {
        _id: '$invitationStatus',
        count: { $sum: 1 },
      },
    },
  ]);
  
  // Transform to object format
  const result = {
    pending: 0,
    accepted: 0,
    expired: 0,
    revoked: 0,
    total: 0,
  };
  
  stats.forEach(stat => {
    result[stat._id] = stat.count;
    result.total += stat.count;
  });
  
  return result;
};

// =============================================================================
// QUERY HELPERS
// =============================================================================

/**
 * Query helper for active users
 */
userSchema.query.active = function() {
  return this.where({ isActive: true });
};

/**
 * Query helper for pending invitations
 */
userSchema.query.pendingInvitations = function() {
  return this.where({ invitationStatus: 'pending' });
};

/**
 * Query helper for organization users
 */
userSchema.query.byOrganization = function(organizationId) {
  return this.where({ organization: organizationId });
};

// =============================================================================
// MODEL CREATION AND EXPORT
// =============================================================================

const User = mongoose.model('User', userSchema);

export default User;