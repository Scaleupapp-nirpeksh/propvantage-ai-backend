// File: controllers/roleController.js
// Description: CRUD operations for organization-scoped custom roles and permission management.

import asyncHandler from 'express-async-handler';
import Role from '../models/roleModel.js';
import User from '../models/userModel.js';
import { ALL_PERMISSIONS, PERMISSION_GROUPS } from '../config/permissions.js';

/**
 * @desc    Get all roles for the user's organization
 * @route   GET /api/roles
 * @access  Private (roles:view)
 */
const getRoles = asyncHandler(async (req, res) => {
  const roles = await Role.find({
    organization: req.user.organization,
    isActive: true,
  })
    .sort({ level: 1, name: 1 })
    .select('-__v');

  // Get user counts per role
  const userCounts = await User.aggregate([
    { $match: { organization: req.user.organization } },
    { $group: { _id: '$roleRef', count: { $sum: 1 } } },
  ]);

  const countMap = {};
  userCounts.forEach((uc) => {
    if (uc._id) countMap[uc._id.toString()] = uc.count;
  });

  const rolesWithCounts = roles.map((role) => ({
    ...role.toObject(),
    userCount: countMap[role._id.toString()] || 0,
  }));

  res.json({
    success: true,
    data: {
      roles: rolesWithCounts,
      total: rolesWithCounts.length,
    },
  });
});

/**
 * @desc    Get a single role by ID
 * @route   GET /api/roles/:id
 * @access  Private (roles:view)
 */
const getRoleById = asyncHandler(async (req, res) => {
  const role = await Role.findOne({
    _id: req.params.id,
    organization: req.user.organization,
  });

  if (!role) {
    res.status(404);
    throw new Error('Role not found');
  }

  // Get users assigned to this role
  const userCount = await User.countDocuments({
    roleRef: role._id,
    organization: req.user.organization,
  });

  res.json({
    success: true,
    data: {
      role: { ...role.toObject(), userCount },
    },
  });
});

/**
 * @desc    Create a new custom role
 * @route   POST /api/roles
 * @access  Private (roles:create)
 */
const createRole = asyncHandler(async (req, res) => {
  const { name, description, level, permissions } = req.body;

  if (!name || level === undefined || !permissions || !Array.isArray(permissions)) {
    res.status(400);
    throw new Error('Name, level, and permissions array are required');
  }

  // Validate permissions exist in the catalog
  const invalidPerms = permissions.filter((p) => !ALL_PERMISSIONS.includes(p));
  if (invalidPerms.length > 0) {
    res.status(400);
    throw new Error(`Invalid permissions: ${invalidPerms.join(', ')}`);
  }

  // Cannot create roles at same or higher level than requester
  if (level <= req.userRoleLevel) {
    res.status(403);
    throw new Error('Cannot create a role at or above your own hierarchy level');
  }

  // Check for duplicate slug in org
  const slug = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  const existing = await Role.findOne({
    organization: req.user.organization,
    slug,
    isActive: true,
  });

  if (existing) {
    res.status(400);
    throw new Error('A role with this name already exists in your organization');
  }

  const role = await Role.create({
    organization: req.user.organization,
    name,
    slug,
    description: description || '',
    level,
    permissions,
    isDefault: false,
    isOwnerRole: false,
    createdBy: req.user._id,
  });

  res.status(201).json({
    success: true,
    data: { role },
  });
});

/**
 * @desc    Update a role (name, description, permissions, level)
 * @route   PUT /api/roles/:id
 * @access  Private (roles:update)
 */
const updateRole = asyncHandler(async (req, res) => {
  const role = await Role.findOne({
    _id: req.params.id,
    organization: req.user.organization,
  });

  if (!role) {
    res.status(404);
    throw new Error('Role not found');
  }

  // Owner role protection — cannot modify permissions, level, or name
  if (role.isOwnerRole) {
    const { description } = req.body;
    if (req.body.permissions || req.body.level !== undefined || req.body.name) {
      res.status(403);
      throw new Error('Cannot modify the Organization Owner role permissions, level, or name');
    }
    if (description !== undefined) {
      role.description = description;
      await role.save();
    }
    return res.json({ success: true, data: { role } });
  }

  // Cannot modify roles at same or higher level than requester
  if (role.level <= req.userRoleLevel) {
    res.status(403);
    throw new Error('Cannot modify a role at or above your own hierarchy level');
  }

  const { name, description, level, permissions } = req.body;

  if (permissions) {
    const invalidPerms = permissions.filter((p) => !ALL_PERMISSIONS.includes(p));
    if (invalidPerms.length > 0) {
      res.status(400);
      throw new Error(`Invalid permissions: ${invalidPerms.join(', ')}`);
    }
    role.permissions = permissions;
  }

  if (level !== undefined) {
    if (level <= req.userRoleLevel) {
      res.status(403);
      throw new Error('Cannot set role level at or above your own hierarchy level');
    }
    role.level = level;
  }

  if (name) role.name = name;
  if (description !== undefined) role.description = description;

  await role.save();

  res.json({
    success: true,
    data: { role },
  });
});

/**
 * @desc    Soft-delete a role (block if users are assigned)
 * @route   DELETE /api/roles/:id
 * @access  Private (roles:delete)
 */
const deleteRole = asyncHandler(async (req, res) => {
  const role = await Role.findOne({
    _id: req.params.id,
    organization: req.user.organization,
  });

  if (!role) {
    res.status(404);
    throw new Error('Role not found');
  }

  if (role.isOwnerRole) {
    res.status(403);
    throw new Error('Cannot delete the Organization Owner role');
  }

  if (role.level <= req.userRoleLevel) {
    res.status(403);
    throw new Error('Cannot delete a role at or above your own hierarchy level');
  }

  // Check if users are assigned to this role
  const assignedUsers = await User.countDocuments({
    roleRef: role._id,
    organization: req.user.organization,
  });

  if (assignedUsers > 0) {
    res.status(400);
    throw new Error(
      `Cannot delete role "${role.name}" — ${assignedUsers} user(s) are still assigned to it. Reassign them first.`
    );
  }

  role.isActive = false;
  await role.save();

  res.json({
    success: true,
    message: `Role "${role.name}" has been deleted`,
  });
});

/**
 * @desc    Get the full permission catalog for UI rendering
 * @route   GET /api/roles/permissions/catalog
 * @access  Private (roles:view)
 */
const getPermissionCatalog = asyncHandler(async (req, res) => {
  res.json({
    success: true,
    data: {
      groups: PERMISSION_GROUPS,
      total: ALL_PERMISSIONS.length,
    },
  });
});

/**
 * @desc    Duplicate an existing role as a starting point for a new one
 * @route   POST /api/roles/:id/duplicate
 * @access  Private (roles:create)
 */
const duplicateRole = asyncHandler(async (req, res) => {
  const sourceRole = await Role.findOne({
    _id: req.params.id,
    organization: req.user.organization,
    isActive: true,
  });

  if (!sourceRole) {
    res.status(404);
    throw new Error('Source role not found');
  }

  const { name } = req.body;
  const newName = name || `${sourceRole.name} (Copy)`;

  const slug = newName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  const existing = await Role.findOne({
    organization: req.user.organization,
    slug,
    isActive: true,
  });

  if (existing) {
    res.status(400);
    throw new Error('A role with this name already exists');
  }

  const newRole = await Role.create({
    organization: req.user.organization,
    name: newName,
    slug,
    description: sourceRole.description,
    level: sourceRole.level,
    permissions: [...sourceRole.permissions],
    isDefault: false,
    isOwnerRole: false,
    createdBy: req.user._id,
  });

  res.status(201).json({
    success: true,
    data: { role: newRole },
  });
});

/**
 * @desc    Transfer Organization Owner role to another user
 * @route   POST /api/roles/transfer-ownership
 * @access  Private (Owner only)
 */
const transferOwnership = asyncHandler(async (req, res) => {
  if (!req.isOwner) {
    res.status(403);
    throw new Error('Only the Organization Owner can transfer ownership');
  }

  const { newOwnerId } = req.body;

  if (!newOwnerId) {
    res.status(400);
    throw new Error('newOwnerId is required');
  }

  const newOwner = await User.findOne({
    _id: newOwnerId,
    organization: req.user.organization,
    isActive: true,
  });

  if (!newOwner) {
    res.status(404);
    throw new Error('Target user not found or inactive');
  }

  if (newOwner._id.toString() === req.user._id.toString()) {
    res.status(400);
    throw new Error('You are already the owner');
  }

  // Find the owner role and business head role
  const ownerRole = await Role.findOne({
    organization: req.user.organization,
    isOwnerRole: true,
  });

  const businessHeadRole = await Role.findOne({
    organization: req.user.organization,
    slug: 'business-head',
    isActive: true,
  });

  if (!ownerRole || !businessHeadRole) {
    res.status(500);
    throw new Error('Required roles not found. Contact support.');
  }

  // Transfer: new owner gets Owner role, current owner gets Business Head
  newOwner.roleRef = ownerRole._id;
  newOwner.role = 'Business Head'; // legacy field
  await newOwner.save({ validateBeforeSave: false });

  req.user.roleRef = businessHeadRole._id;
  req.user.role = 'Business Head';
  await req.user.save({ validateBeforeSave: false });

  res.json({
    success: true,
    message: `Ownership transferred to ${newOwner.firstName} ${newOwner.lastName}`,
  });
});

export {
  getRoles,
  getRoleById,
  createRole,
  updateRole,
  deleteRole,
  getPermissionCatalog,
  duplicateRole,
  transferOwnership,
};
