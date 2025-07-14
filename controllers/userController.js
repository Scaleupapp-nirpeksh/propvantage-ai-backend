// File: controllers/userController.js
// Description: Clean user management controller for PropVantage AI (INVITATION LOGIC REMOVED)
// Version: 3.0.0 - Production-ready user CRUD operations with clean separation of concerns
// Location: controllers/userController.js

import asyncHandler from 'express-async-handler';
import User from '../models/userModel.js';
import Organization from '../models/organizationModel.js';

// =============================================================================
// CONFIGURATION AND CONSTANTS
// =============================================================================

const USER_CONTROLLER_CONFIG = {
  // Pagination defaults
  DEFAULT_PAGE_SIZE: 10,
  MAX_PAGE_SIZE: 100,
  
  // Search configuration
  MAX_SEARCH_LENGTH: 100,
  
  // Role hierarchy for permission checks
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
  
  // Status types for filtering
  STATUS_TYPES: {
    ACTIVE: 'active',
    INACTIVE: 'inactive', 
    PENDING: 'pending',
    EXPIRED: 'expired',
    REVOKED: 'revoked',
    ALL: 'all'
  }
};

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Check if user can manage another user based on role hierarchy
 * @param {string} managerRole - Role of the user performing the action
 * @param {string} targetRole - Role of the user being managed
 * @returns {boolean} - True if management is allowed
 */
const canManageUser = (managerRole, targetRole) => {
  const managerLevel = USER_CONTROLLER_CONFIG.ROLE_HIERARCHY[managerRole] || 10;
  const targetLevel = USER_CONTROLLER_CONFIG.ROLE_HIERARCHY[targetRole] || 10;
  
  // Can only manage users with higher level number (lower in hierarchy)
  return managerLevel < targetLevel;
};

/**
 * Build query filters for user search
 * @param {Object} filters - Filter parameters
 * @param {string} organizationId - Organization ID
 * @returns {Object} - MongoDB query object
 */
const buildUserQuery = (filters, organizationId) => {
  const query = { organization: organizationId };
  
  // Role filter
  if (filters.role && filters.role !== USER_CONTROLLER_CONFIG.STATUS_TYPES.ALL) {
    query.role = filters.role;
  }
  
  // Status filter
  if (filters.status && filters.status !== USER_CONTROLLER_CONFIG.STATUS_TYPES.ALL) {
    switch (filters.status) {
      case USER_CONTROLLER_CONFIG.STATUS_TYPES.ACTIVE:
        query.isActive = true;
        query.invitationStatus = 'accepted';
        break;
      case USER_CONTROLLER_CONFIG.STATUS_TYPES.INACTIVE:
        query.isActive = false;
        break;
      case USER_CONTROLLER_CONFIG.STATUS_TYPES.PENDING:
        query.invitationStatus = 'pending';
        break;
      case USER_CONTROLLER_CONFIG.STATUS_TYPES.EXPIRED:
        query.invitationStatus = 'expired';
        break;
      case USER_CONTROLLER_CONFIG.STATUS_TYPES.REVOKED:
        query.invitationStatus = 'revoked';
        break;
    }
  }
  
  // Default: exclude completely inactive users unless specifically requested
  if (!filters.includeInactive || filters.includeInactive === 'false') {
    query.$or = [
      { isActive: true },
      { invitationStatus: 'pending' },
    ];
  }
  
  return query;
};

/**
 * Build search query for name and email
 * @param {string} searchTerm - Search term
 * @returns {Object} - MongoDB search query
 */
const buildSearchQuery = (searchTerm) => {
  if (!searchTerm || !searchTerm.trim()) {
    return {};
  }
  
  const sanitizedTerm = searchTerm.trim().substring(0, USER_CONTROLLER_CONFIG.MAX_SEARCH_LENGTH);
  const searchRegex = new RegExp(sanitizedTerm, 'i');
  
  return {
    $or: [
      { firstName: searchRegex },
      { lastName: searchRegex },
      { email: searchRegex },
      { 
        $expr: {
          $regexMatch: {
            input: { $concat: ['$firstName', ' ', '$lastName'] },
            regex: sanitizedTerm,
            options: 'i'
          }
        }
      }
    ],
  };
};

/**
 * Validate pagination parameters
 * @param {number} page - Page number
 * @param {number} limit - Items per page
 * @returns {Object} - Validated pagination parameters
 */
const validatePagination = (page, limit) => {
  const pageNum = Math.max(1, parseInt(page) || 1);
  const limitNum = Math.min(
    USER_CONTROLLER_CONFIG.MAX_PAGE_SIZE,
    Math.max(1, parseInt(limit) || USER_CONTROLLER_CONFIG.DEFAULT_PAGE_SIZE)
  );
  
  return { pageNum, limitNum };
};

/**
 * Enhance user data with computed fields
 * @param {Object} user - User document
 * @returns {Object} - Enhanced user object
 */
const enhanceUserData = (user) => {
  const userObj = user.toObject();
  
  // Add computed fields
  userObj.isInvitationExpired = user.invitationExpiry ? new Date() > user.invitationExpiry : false;
  userObj.daysSinceInvitation = user.invitedAt ? 
    Math.floor((Date.now() - user.invitedAt) / (1000 * 60 * 60 * 24)) : null;
  userObj.daysSinceLastLogin = user.lastLogin ?
    Math.floor((Date.now() - user.lastLogin) / (1000 * 60 * 60 * 24)) : null;
  
  // Add status indicators
  userObj.statusIndicator = {
    isActive: user.isActive,
    invitationStatus: user.invitationStatus,
    accountStatus: user.isActive ? 'Active' : 
                   user.invitationStatus === 'pending' ? 'Pending Invitation' :
                   user.invitationStatus === 'expired' ? 'Invitation Expired' :
                   user.invitationStatus === 'revoked' ? 'Invitation Revoked' : 'Inactive'
  };
  
  return userObj;
};

// =============================================================================
// MAIN CONTROLLER FUNCTIONS
// =============================================================================

/**
 * @desc    Get all users for the organization with advanced filtering and pagination
 * @route   GET /api/users
 * @access  Private (Management roles)
 * @query   { page, limit, role, status, search, includeInactive, sortBy, sortOrder }
 * @returns {Object} - Paginated list of users with comprehensive details
 */
export const getUsers = asyncHandler(async (req, res) => {
  try {
    const {
      page = 1,
      limit = USER_CONTROLLER_CONFIG.DEFAULT_PAGE_SIZE,
      role,
      status,
      search,
      includeInactive = 'false',
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;
    
    console.log(`📋 Fetching users for organization ${req.user.organization}`);
    
    // =============================================================================
    // VALIDATE INPUT PARAMETERS
    // =============================================================================
    
    const { pageNum, limitNum } = validatePagination(page, limit);
    
    // Validate sort parameters
    const validSortFields = ['createdAt', 'firstName', 'lastName', 'email', 'role', 'lastLogin', 'invitedAt'];
    const sortField = validSortFields.includes(sortBy) ? sortBy : 'createdAt';
    const sortDirection = sortOrder === 'asc' ? 1 : -1;
    
    // =============================================================================
    // BUILD QUERY FILTERS
    // =============================================================================
    
    const baseQuery = buildUserQuery({ role, status, includeInactive }, req.user.organization);
    const searchQuery = buildSearchQuery(search);
    const finalQuery = { ...baseQuery, ...searchQuery };
    
    // =============================================================================
    // EXECUTE QUERY WITH PAGINATION AND SORTING
    // =============================================================================
    
    const skip = (pageNum - 1) * limitNum;
    const sortOptions = { [sortField]: sortDirection };
    
    const [users, totalUsers] = await Promise.all([
      User.find(finalQuery)
        .populate('invitedBy', 'firstName lastName email')
        .populate('revokedBy', 'firstName lastName email')
        .select('-password -invitationToken -passwordResetToken') // Exclude sensitive fields
        .sort(sortOptions)
        .skip(skip)
        .limit(limitNum),
      User.countDocuments(finalQuery),
    ]);
    
    // =============================================================================
    // ENHANCE USER DATA WITH COMPUTED FIELDS
    // =============================================================================
    
    const enhancedUsers = users.map(enhanceUserData);
    
    // =============================================================================
    // PREPARE COMPREHENSIVE RESPONSE WITH METADATA
    // =============================================================================
    
    const totalPages = Math.ceil(totalUsers / limitNum);
    
    // Get summary statistics
    const [activeCount, pendingCount, inactiveCount] = await Promise.all([
      User.countDocuments({ 
        organization: req.user.organization, 
        isActive: true, 
        invitationStatus: 'accepted' 
      }),
      User.countDocuments({ 
        organization: req.user.organization, 
        invitationStatus: 'pending' 
      }),
      User.countDocuments({ 
        organization: req.user.organization, 
        isActive: false 
      })
    ]);
    
    res.json({
      success: true,
      message: 'Users retrieved successfully',
      data: {
        users: enhancedUsers,
        pagination: {
          currentPage: pageNum,
          totalPages,
          totalUsers,
          usersPerPage: limitNum,
          hasNext: pageNum < totalPages,
          hasPrev: pageNum > 1,
          nextPage: pageNum < totalPages ? pageNum + 1 : null,
          prevPage: pageNum > 1 ? pageNum - 1 : null,
        },
        summary: {
          total: totalUsers,
          showing: enhancedUsers.length,
          active: activeCount,
          pending: pendingCount,
          inactive: inactiveCount,
        },
        filters: {
          applied: {
            role: role || 'all',
            status: status || 'active',
            search: search || null,
            includeInactive: includeInactive === 'true',
          },
          available: {
            roles: Object.keys(USER_CONTROLLER_CONFIG.ROLE_HIERARCHY),
            statuses: Object.values(USER_CONTROLLER_CONFIG.STATUS_TYPES),
          }
        },
        sorting: {
          sortBy: sortField,
          sortOrder: sortOrder,
          availableFields: validSortFields
        }
      },
    });
    
  } catch (error) {
    console.error('❌ Error in getUsers:', error);
    
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve users',
      code: 'INTERNAL_ERROR',
      error: process.env.NODE_ENV === 'production' ? 'Internal server error' : error.message,
    });
  }
});

/**
 * @desc    Get single user by ID with full details
 * @route   GET /api/users/:id
 * @access  Private (Management roles or self)
 * @params  id - User ID
 * @returns {Object} - Complete user information
 */
export const getUserById = asyncHandler(async (req, res) => {
  try {
    const { id: userId } = req.params;
    const requestingUser = req.user;
    
    console.log(`👤 Fetching user details for ID: ${userId}`);
    
    // =============================================================================
    // FIND AND VALIDATE USER
    // =============================================================================
    
    const user = await User.findOne({
      _id: userId,
      organization: requestingUser.organization,
    })
    .populate('invitedBy', 'firstName lastName email')
    .populate('revokedBy', 'firstName lastName email')
    .populate('organization', 'name type')
    .select('-password -invitationToken -passwordResetToken');
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found in your organization',
        code: 'USER_NOT_FOUND',
      });
    }
    
    // =============================================================================
    // PERMISSION CHECKS
    // =============================================================================
    
    // Users can always view their own profile
    // Managers can view users they can manage
    if (userId !== requestingUser._id.toString() && 
        !canManageUser(requestingUser.role, user.role)) {
      return res.status(403).json({
        success: false,
        message: 'You don\'t have permission to view this user',
        code: 'INSUFFICIENT_PERMISSIONS',
      });
    }
    
    // =============================================================================
    // PREPARE ENHANCED USER DATA
    // =============================================================================
    
    const enhancedUser = enhanceUserData(user);
    
    // Add additional details for single user view
    enhancedUser.permissions = {
      canEdit: canManageUser(requestingUser.role, user.role) || userId === requestingUser._id.toString(),
      canDelete: canManageUser(requestingUser.role, user.role) && userId !== requestingUser._id.toString(),
      canChangeRole: canManageUser(requestingUser.role, user.role),
      canResendInvitation: user.invitationStatus === 'pending' && canManageUser(requestingUser.role, user.role),
      canRevokeInvitation: user.invitationStatus === 'pending' && canManageUser(requestingUser.role, user.role),
    };
    
    res.json({
      success: true,
      message: 'User details retrieved successfully',
      data: {
        user: enhancedUser,
      },
    });
    
  } catch (error) {
    console.error('❌ Error in getUserById:', error);
    
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve user details',
      code: 'INTERNAL_ERROR',
      error: process.env.NODE_ENV === 'production' ? 'Internal server error' : error.message,
    });
  }
});

/**
 * @desc    Update user role, status, or profile information
 * @route   PUT /api/users/:id
 * @access  Private (Management roles or self for profile updates)
 * @params  id - User ID
 * @body    { role, isActive, firstName, lastName, phoneNumber, profileImage }
 * @returns {Object} - Updated user information
 */
export const updateUser = asyncHandler(async (req, res) => {
  try {
    const { 
      role, 
      isActive, 
      firstName, 
      lastName, 
      phoneNumber, 
      profileImage,
      preferences 
    } = req.body;
    const { id: userId } = req.params;
    const updaterUser = req.user;
    
    console.log(`📝 Updating user ${userId} by ${updaterUser.email}`);
    
    // =============================================================================
    // FIND AND VALIDATE USER
    // =============================================================================
    
    const user = await User.findOne({
      _id: userId,
      organization: updaterUser.organization,
    });
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found in your organization',
        code: 'USER_NOT_FOUND',
      });
    }
    
    // =============================================================================
    // PERMISSION CHECKS
    // =============================================================================
    
    const isSelfUpdate = userId === updaterUser._id.toString();
    const canManageTarget = canManageUser(updaterUser.role, user.role);
    
    // For role and status changes, need management permissions
    if ((role && role !== user.role) || (isActive !== undefined && isActive !== user.isActive)) {
      if (!canManageTarget) {
        return res.status(403).json({
          success: false,
          message: 'You don\'t have permission to modify this user\'s role or status',
          code: 'INSUFFICIENT_PERMISSIONS',
        });
      }
      
      // Users cannot modify their own status
      if (isSelfUpdate && isActive !== undefined) {
        return res.status(403).json({
          success: false,
          message: 'You cannot modify your own account status',
          code: 'SELF_STATUS_MODIFICATION_FORBIDDEN',
        });
      }
    }
    
    // For profile updates, users can update their own profile or managers can update subordinates
    if ((firstName || lastName || phoneNumber || profileImage || preferences) && 
        !isSelfUpdate && !canManageTarget) {
      return res.status(403).json({
        success: false,
        message: 'You don\'t have permission to modify this user\'s profile',
        code: 'INSUFFICIENT_PERMISSIONS',
      });
    }
    
    // =============================================================================
    // VALIDATE ROLE CHANGE
    // =============================================================================
    
    if (role && role !== user.role) {
      const validRoles = Object.keys(USER_CONTROLLER_CONFIG.ROLE_HIERARCHY);
      if (!validRoles.includes(role)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid role specified',
          code: 'INVALID_ROLE',
          data: { validRoles }
        });
      }
      
      // Check if updater can assign this role
      if (!canManageUser(updaterUser.role, role)) {
        return res.status(403).json({
          success: false,
          message: `You don't have permission to assign role: ${role}`,
          code: 'INSUFFICIENT_PERMISSIONS',
        });
      }
    }
    
    // =============================================================================
    // APPLY UPDATES
    // =============================================================================
    
    let hasChanges = false;
    const changes = [];
    
    // Update role if provided and different
    if (role && role !== user.role) {
      const oldRole = user.role;
      user.role = role;
      hasChanges = true;
      changes.push(`Role: ${oldRole} → ${role}`);
      console.log(`🔄 Changing role from ${oldRole} to ${role}`);
    }
    
    // Update active status if provided and different
    if (isActive !== undefined && isActive !== user.isActive) {
      const oldStatus = user.isActive;
      user.isActive = isActive;
      hasChanges = true;
      changes.push(`Status: ${oldStatus ? 'Active' : 'Inactive'} → ${isActive ? 'Active' : 'Inactive'}`);
      console.log(`🔄 Changing active status to ${isActive}`);
    }
    
    // Update profile information
    if (firstName && firstName.trim() !== user.firstName) {
      user.firstName = firstName.trim();
      hasChanges = true;
      changes.push(`First name updated`);
    }
    
    if (lastName && lastName.trim() !== user.lastName) {
      user.lastName = lastName.trim();
      hasChanges = true;
      changes.push(`Last name updated`);
    }
    
    if (phoneNumber !== undefined && phoneNumber !== user.phoneNumber) {
      user.phoneNumber = phoneNumber;
      hasChanges = true;
      changes.push(`Phone number updated`);
    }
    
    if (profileImage !== undefined && profileImage !== user.profileImage) {
      user.profileImage = profileImage;
      hasChanges = true;
      changes.push(`Profile image updated`);
    }
    
    if (preferences && typeof preferences === 'object') {
      user.preferences = { ...user.preferences, ...preferences };
      hasChanges = true;
      changes.push(`Preferences updated`);
    }
    
    if (!hasChanges) {
      return res.status(400).json({
        success: false,
        message: 'No changes detected',
        code: 'NO_CHANGES',
      });
    }
    
    // =============================================================================
    // SAVE CHANGES AND RESPOND
    // =============================================================================
    
    const updatedUser = await user.save();
    const enhancedUser = enhanceUserData(updatedUser);
    
    console.log(`✅ User updated successfully. Changes: ${changes.join(', ')}`);
    
    res.json({
      success: true,
      message: 'User updated successfully',
      data: {
        user: enhancedUser,
        changes: changes,
        updatedBy: {
          _id: updaterUser._id,
          name: `${updaterUser.firstName} ${updaterUser.lastName}`,
        }
      },
    });
    
  } catch (error) {
    console.error('❌ Error in updateUser:', error);
    
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
      message: 'Failed to update user',
      code: 'INTERNAL_ERROR',
      error: process.env.NODE_ENV === 'production' ? 'Internal server error' : error.message,
    });
  }
});

/**
 * @desc    Get current user's profile
 * @route   GET /api/users/me
 * @access  Private
 * @returns {Object} - Current user's profile information
 */
export const getCurrentUserProfile = asyncHandler(async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
      .populate('organization', 'name type')
      .select('-password -invitationToken -passwordResetToken');
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User profile not found',
        code: 'PROFILE_NOT_FOUND',
      });
    }
    
    const enhancedUser = enhanceUserData(user);
    
    res.json({
      success: true,
      message: 'Profile retrieved successfully',
      data: {
        user: enhancedUser,
      },
    });
    
  } catch (error) {
    console.error('❌ Error in getCurrentUserProfile:', error);
    
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve profile',
      code: 'INTERNAL_ERROR',
      error: process.env.NODE_ENV === 'production' ? 'Internal server error' : error.message,
    });
  }
});

/**
 * @desc    Update current user's profile
 * @route   PUT /api/users/me
 * @access  Private
 * @body    { firstName, lastName, phoneNumber, profileImage, preferences }
 * @returns {Object} - Updated user profile
 */
export const updateCurrentUserProfile = asyncHandler(async (req, res) => {
  try {
    const { firstName, lastName, phoneNumber, profileImage, preferences } = req.body;
    const user = await User.findById(req.user._id);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User profile not found',
        code: 'PROFILE_NOT_FOUND',
      });
    }
    
    let hasChanges = false;
    const changes = [];
    
    if (firstName && firstName.trim() !== user.firstName) {
      user.firstName = firstName.trim();
      hasChanges = true;
      changes.push('First name updated');
    }
    
    if (lastName && lastName.trim() !== user.lastName) {
      user.lastName = lastName.trim();
      hasChanges = true;
      changes.push('Last name updated');
    }
    
    if (phoneNumber !== undefined && phoneNumber !== user.phoneNumber) {
      user.phoneNumber = phoneNumber;
      hasChanges = true;
      changes.push('Phone number updated');
    }
    
    if (profileImage !== undefined && profileImage !== user.profileImage) {
      user.profileImage = profileImage;
      hasChanges = true;
      changes.push('Profile image updated');
    }
    
    if (preferences && typeof preferences === 'object') {
      user.preferences = { ...user.preferences, ...preferences };
      hasChanges = true;
      changes.push('Preferences updated');
    }
    
    if (!hasChanges) {
      return res.status(400).json({
        success: false,
        message: 'No changes detected',
        code: 'NO_CHANGES',
      });
    }
    
    const updatedUser = await user.save();
    const enhancedUser = enhanceUserData(updatedUser);
    
    res.json({
      success: true,
      message: 'Profile updated successfully',
      data: {
        user: enhancedUser,
        changes: changes,
      },
    });
    
  } catch (error) {
    console.error('❌ Error in updateCurrentUserProfile:', error);
    
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
      message: 'Failed to update profile',
      code: 'INTERNAL_ERROR',
      error: process.env.NODE_ENV === 'production' ? 'Internal server error' : error.message,
    });
  }
});

/**
 * @desc    Soft delete a user (deactivate)
 * @route   DELETE /api/users/:id
 * @access  Private (Management roles only)
 * @params  id - User ID
 * @returns {Object} - Deletion confirmation
 */
export const deleteUser = asyncHandler(async (req, res) => {
  try {
    const { id: userId } = req.params;
    const deleterUser = req.user;
    
    console.log(`🗑️ Processing user deletion for ID: ${userId}`);
    
    // =============================================================================
    // FIND AND VALIDATE USER
    // =============================================================================
    
    const user = await User.findOne({
      _id: userId,
      organization: deleterUser.organization,
    });
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found in your organization',
        code: 'USER_NOT_FOUND',
      });
    }
    
    // =============================================================================
    // PERMISSION AND BUSINESS LOGIC CHECKS
    // =============================================================================
    
    // Users cannot delete themselves
    if (userId === deleterUser._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'You cannot delete your own account',
        code: 'SELF_DELETION_FORBIDDEN',
      });
    }
    
    // Check if deleter has permission to delete this user
    if (!canManageUser(deleterUser.role, user.role)) {
      return res.status(403).json({
        success: false,
        message: 'You don\'t have permission to delete this user',
        code: 'INSUFFICIENT_PERMISSIONS',
      });
    }
    
    // Prevent deletion of the last Business Head
    if (user.role === 'Business Head') {
      const businessHeadCount = await User.countDocuments({
        organization: deleterUser.organization,
        role: 'Business Head',
        isActive: true,
      });
      
      if (businessHeadCount <= 1) {
        return res.status(400).json({
          success: false,
          message: 'Cannot delete the last Business Head in the organization',
          code: 'CANNOT_DELETE_LAST_ADMIN',
        });
      }
    }
    
    // =============================================================================
    // PERFORM SOFT DELETE
    // =============================================================================
    
    user.isActive = false;
    user.deletedAt = new Date();
    user.deletedBy = deleterUser._id;
    
    await user.save();
    
    console.log(`✅ User ${user.email} soft deleted successfully`);
    
    res.json({
      success: true,
      message: `User ${user.firstName} ${user.lastName} has been deactivated`,
      data: {
        user: {
          _id: user._id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          isActive: user.isActive,
          deletedAt: user.deletedAt,
        },
        deletedBy: {
          _id: deleterUser._id,
          name: `${deleterUser.firstName} ${deleterUser.lastName}`,
        }
      },
    });
    
  } catch (error) {
    console.error('❌ Error in deleteUser:', error);
    
    res.status(500).json({
      success: false,
      message: 'Failed to delete user',
      code: 'INTERNAL_ERROR',
      error: process.env.NODE_ENV === 'production' ? 'Internal server error' : error.message,
    });
  }
});

// =============================================================================
// EXPORT FUNCTIONS
// =============================================================================

