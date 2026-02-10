// File: middleware/authMiddleware.js
// Description: Middleware for protecting routes and handling permission-based access control.

import jwt from 'jsonwebtoken';
import asyncHandler from 'express-async-handler';
import User from '../models/userModel.js';

/**
 * @desc    Middleware to protect routes by verifying JWT.
 * Populates roleRef with permissions for permission-based checks.
 */
const protect = asyncHandler(async (req, res, next) => {
  let token;

  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith('Bearer')
  ) {
    try {
      token = req.headers.authorization.split(' ')[1];

      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      // Populate roleRef to get permissions in a single query
      req.user = await User.findById(decoded.userId)
        .select('-password')
        .populate('roleRef', 'name slug level permissions isOwnerRole');

      if (!req.user) {
        res.status(401);
        throw new Error('Not authorized, user not found');
      }

      // Attach convenience properties for permission checks
      req.userPermissions = req.user.roleRef?.permissions || [];
      req.userRoleLevel = req.user.roleRef?.level ?? 100;
      req.isOwner = req.user.roleRef?.isOwnerRole || false;

      next();
    } catch (error) {
      console.error(error);
      res.status(401);
      throw new Error('Not authorized, token failed');
    }
  }

  if (!token) {
    res.status(401);
    throw new Error('Not authorized, no token');
  }
});

/**
 * @desc    Legacy role-based authorization middleware.
 * Checks if user's role name is in the allowed roles array.
 * Works with both roleRef (populated) and legacy role string.
 */
const authorize = (...roles) => {
  return (req, res, next) => {
    // Owner role bypasses all role checks
    if (req.isOwner) {
      return next();
    }

    const userRoleName = req.user?.roleRef?.name || req.user?.role;

    if (!req.user || !roles.includes(userRoleName)) {
      res.status(403);
      throw new Error(
        `User role '${userRoleName}' is not authorized to access this route`
      );
    }
    next();
  };
};

/**
 * @desc    Permission-based authorization middleware (AND logic).
 * User must have ALL listed permissions to proceed.
 * Owner role bypasses all permission checks.
 *
 * Usage:
 *   hasPermission('projects:create')
 *   hasPermission('projects:create', 'projects:update')  // needs BOTH
 */
const hasPermission = (...requiredPermissions) => {
  return (req, res, next) => {
    if (req.isOwner) {
      return next();
    }

    const userPerms = req.userPermissions || [];
    const missing = requiredPermissions.filter((p) => !userPerms.includes(p));

    if (missing.length > 0) {
      res.status(403);
      throw new Error(
        `Missing required permission(s): ${missing.join(', ')}`
      );
    }

    next();
  };
};

/**
 * @desc    Permission-based authorization middleware (OR logic).
 * User must have at least ONE of the listed permissions.
 * Owner role bypasses all permission checks.
 *
 * Usage:
 *   hasAnyPermission('sales:view', 'sales:analytics')
 */
const hasAnyPermission = (...requiredPermissions) => {
  return (req, res, next) => {
    if (req.isOwner) {
      return next();
    }

    const userPerms = req.userPermissions || [];
    const hasAny = requiredPermissions.some((p) => userPerms.includes(p));

    if (!hasAny) {
      res.status(403);
      throw new Error(
        `Requires at least one of: ${requiredPermissions.join(', ')}`
      );
    }

    next();
  };
};

export { protect, authorize, hasPermission, hasAnyPermission };
