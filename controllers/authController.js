// File: controllers/authController.js
// Description: Handles the business logic for user authentication, including registration and login.

import asyncHandler from 'express-async-handler';
import User from '../models/userModel.js';
import Organization from '../models/organizationModel.js';
import generateToken from '../utils/generateToken.js';

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
      role: 'Business Head', // The first user is always the 'Business Head'
    });

    if (user) {
      const token = generateToken(res, user._id);

      res.status(201).json({
        _id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        role: user.role,
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

  // 1. Find user by email
  // We must explicitly select the password as it's excluded by default in the model
  const user = await User.findOne({ email }).select('+password');

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
      role: user.role,
      organization: user.organization,
      token,
    });
  } else {
    res.status(401); // 401 Unauthorized
    throw new Error('Invalid email or password');
  }
});

export { registerUser, loginUser };
