// File: middleware/authMiddleware.js
// Description: Middleware for protecting routes and handling role-based access control (RBAC).

import jwt from 'jsonwebtoken';
import asyncHandler from 'express-async-handler';
import User from '../models/userModel.js';

/**
 * @desc    Middleware to protect routes by verifying JWT.
 * It checks for a valid token in the authorization header,
 * decodes it, and attaches the user object (without the password)
 * to the request object.
 */
const protect = asyncHandler(async (req, res, next) => {
  let token;

  // Check for the token in the Authorization header (Bearer token)
  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith('Bearer')
  ) {
    try {
      // Get token from header
      token = req.headers.authorization.split(' ')[1];

      // Verify token
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      // Get user from the token's payload (ID) and attach to request object
      // Exclude the password field from the user object
      req.user = await User.findById(decoded.userId).select('-password');

      if (!req.user) {
        res.status(401);
        throw new Error('Not authorized, user not found');
      }

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
 * @desc    Middleware for role-based authorization.
 * It takes an array of roles and checks if the authenticated user's
 * role is included in the list.
 * @param   {...string} roles - An array of role strings that are allowed access.
 */
const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403); // 403 Forbidden
      throw new Error(
        `User role '${req.user.role}' is not authorized to access this route`
      );
    }
    next();
  };
};

export { protect, authorize };
