// File: controllers/userController.js
// Description: Handles business logic for managing users within an organization.

import asyncHandler from 'express-async-handler';
import User from '../models/userModel.js';
import Organization from '../models/organizationModel.js';

/**
 * @desc    Invite a new user to the organization
 * @route   POST /api/users/invite
 * @access  Private (Admin/Manager roles)
 */
const inviteUser = asyncHandler(async (req, res) => {
  const { firstName, lastName, email, role } = req.body;

  // 1. Check if user with this email already exists in the system
  const userExists = await User.findOne({ email });
  if (userExists) {
    res.status(400);
    throw new Error('A user with this email already exists.');
  }

  // 2. Create the new user with a temporary/random password
  // In a real system, you would send an email with a setup link.
  // For this API, we'll create them directly.
  const temporaryPassword = `${email}${Date.now()}`; // Placeholder for password setup flow

  const user = await User.create({
    organization: req.user.organization,
    firstName,
    lastName,
    email,
    password: temporaryPassword, // User would be forced to change this on first login
    role,
  });

  if (user) {
    // Exclude password from the response
    const userResponse = user.toObject();
    delete userResponse.password;
    res.status(201).json(userResponse);
  } else {
    res.status(400);
    throw new Error('Invalid user data.');
  }
});

/**
 * @desc    Get all users for the organization
 * @route   GET /api/users
 * @access  Private (Admin/Manager roles)
 */
const getUsers = asyncHandler(async (req, res) => {
  const users = await User.find({ organization: req.user.organization });
  res.json(users);
});

/**
 * @desc    Update a user's role or status
 * @route   PUT /api/users/:id
 * @access  Private (Admin/Manager roles)
 */
const updateUser = asyncHandler(async (req, res) => {
  const { role, isActive } = req.body;

  const user = await User.findOne({
    _id: req.params.id,
    organization: req.user.organization,
  });

  if (user) {
    user.role = role || user.role;
    user.isActive = isActive !== undefined ? isActive : user.isActive;

    const updatedUser = await user.save();
    res.json(updatedUser);
  } else {
    res.status(404);
    throw new Error('User not found');
  }
});

export { inviteUser, getUsers, updateUser };
