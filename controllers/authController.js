// File: controllers/authController.js
// Description: Handles the business logic for user authentication, including registration and login.

import asyncHandler from 'express-async-handler';
import User from '../models/userModel.js';
import Organization from '../models/organizationModel.js';
import generateToken from '../utils/generateToken.js';
import { seedDefaultRoles } from '../data/defaultRoles.js';

/**
 * @desc    Register a new user and their organization
 * @route   POST /api/auth/register
 * @access  Public
 */
const registerUser = asyncHandler(async (req, res) => {
  const { orgName, country, city, firstName, lastName, email, password } = req.body;

  // 1. Validate input
  if (!orgName || !country || !city || !firstName || !lastName || !email || !password) {
    res.status(400);
    throw new Error('Please provide all required fields');
  }

  // 2. Check if organization already exists
  const orgExists = await Organization.findOne({ name: orgName });
  if (orgExists) {
    res.status(400);
    throw new Error('An organization with this name already exists');
  }

  // 3. Check if user email already exists
  const userExists = await User.findOne({ email });
  if (userExists) {
    res.status(400);
    throw new Error('A user with this email already exists');
  }

  // 4. Create the organization
  const organization = await Organization.create({
    name: orgName,
    country,
    city,
    type: 'builder', // The initial signup is always for a 'builder'
  });

  // 5. If organization is created, create the user
  if (organization) {
    const user = await User.create({
      organization: organization._id,
      firstName,
      lastName,
      email,
      password,
      role: 'Business Head', // Legacy field — kept for backward compatibility
      isActive: true,
      invitationStatus: 'accepted',
    });

    if (user) {
      // 6. Seed default roles for this new organization
      const roles = await seedDefaultRoles(organization._id, user._id);

      // 7. Assign the Organization Owner role to the first user
      const ownerRole = roles.find((r) => r.isOwnerRole);
      if (ownerRole) {
        user.roleRef = ownerRole._id;
        await user.save({ validateBeforeSave: false });
      }

      const token = generateToken(res, user._id);

      // Populate roleRef for the response
      await user.populate('roleRef', 'name slug level permissions isOwnerRole');

      res.status(201).json({
        _id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        role: user.roleRef?.name || user.role,
        roleRef: user.roleRef
          ? {
              _id: user.roleRef._id,
              name: user.roleRef.name,
              slug: user.roleRef.slug,
              level: user.roleRef.level,
              permissions: user.roleRef.permissions,
              isOwnerRole: user.roleRef.isOwnerRole,
            }
          : null,
        organization: {
          _id: organization._id,
          name: organization.name,
        },
        token,
      });
    } else {
      // Rollback organization creation if user creation fails
      await Organization.findByIdAndDelete(organization._id);
      res.status(400);
      throw new Error('Invalid user data');
    }
  } else {
    res.status(400);
    throw new Error('Invalid organization data');
  }
});

/**
 * @desc    Authenticate user & get token (Login)
 * @route   POST /api/auth/login
 * @access  Public
 */
const loginUser = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  // 1. Find user by email with roleRef populated
  const user = await User.findOne({ email })
    .select('+password')
    .populate('roleRef', 'name slug level permissions isOwnerRole');

  // 2. Check if user exists and password matches
  if (user && (await user.matchPassword(password))) {
    const token = generateToken(res, user._id);

    // Update last login timestamp
    user.lastLogin = Date.now();
    await user.save();

    res.json({
      _id: user._id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      role: user.roleRef?.name || user.role,
      roleRef: user.roleRef
        ? {
            _id: user.roleRef._id,
            name: user.roleRef.name,
            slug: user.roleRef.slug,
            level: user.roleRef.level,
            permissions: user.roleRef.permissions,
            isOwnerRole: user.roleRef.isOwnerRole,
          }
        : null,
      organization: user.organization,
      token,
    });
  } else {
    res.status(401);
    throw new Error('Invalid email or password');
  }
});

export { registerUser, loginUser };
