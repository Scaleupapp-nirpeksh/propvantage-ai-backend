// File: controllers/cpPortalController.js
// Description: Channel-partner portal endpoints — the CP org's own profile and team.
//   All routes are guarded by requireOrgType('channel_partner') + a cp_* permission.

import crypto from 'crypto';
import asyncHandler from 'express-async-handler';
import mongoose from 'mongoose';
import Organization from '../models/organizationModel.js';
import User from '../models/userModel.js';
import Role from '../models/roleModel.js';
import { CP_CATEGORIES } from '../config/permissions.js';

// GET /api/cp/org — the CP org's profile.
export const getOrgProfile = asyncHandler(async (req, res) => {
  const org = await Organization.findById(req.user.organization).select(
    'name type category reraRegistrationNumber country city contactInfo isActive'
  );
  if (!org) {
    res.status(404);
    throw new Error('Organization not found');
  }
  res.json({ success: true, data: org });
});

// PUT /api/cp/org — update editable profile fields (NOT the RERA number).
export const updateOrgProfile = asyncHandler(async (req, res) => {
  const org = await Organization.findById(req.user.organization);
  if (!org) {
    res.status(404);
    throw new Error('Organization not found');
  }
  const { name, category, country, city, contactInfo } = req.body;

  if (name !== undefined && String(name).trim()) org.name = String(name).trim();
  if (country !== undefined) org.country = country;
  if (city !== undefined) org.city = city;
  if (category !== undefined) {
    if (!CP_CATEGORIES.includes(category)) {
      res.status(400);
      throw new Error('Invalid channel partner category');
    }
    org.category = category;
  }
  if (contactInfo !== undefined) {
    org.contactInfo = { ...(org.contactInfo?.toObject?.() || org.contactInfo || {}), ...contactInfo };
  }
  // reraRegistrationNumber is intentionally NOT editable here.
  await org.save();
  res.json({ success: true, data: org });
});

// GET /api/cp/team — list the CP org's members.
export const listTeam = asyncHandler(async (req, res) => {
  const members = await User.find({ organization: req.user.organization })
    .select('firstName lastName email isActive invitationStatus roleRef lastLogin')
    .populate('roleRef', 'name slug level isOwnerRole')
    .sort({ createdAt: 1 });
  res.json({ success: true, data: members });
});

// PUT /api/cp/team/:userId/role — change a member's role.
export const changeMemberRole = asyncHandler(async (req, res) => {
  const { roleId } = req.body;
  if (!mongoose.isValidObjectId(req.params.userId) || !mongoose.isValidObjectId(roleId)) {
    res.status(400);
    throw new Error('Invalid user or role id');
  }
  const member = await User.findOne({
    _id: req.params.userId,
    organization: req.user.organization,
  }).populate('roleRef', 'isOwnerRole');
  if (!member) {
    res.status(404);
    throw new Error('Team member not found');
  }
  if (member.roleRef?.isOwnerRole) {
    res.status(400);
    throw new Error("The CP Owner's role cannot be changed");
  }
  const role = await Role.findOne({ _id: roleId, organization: req.user.organization });
  if (!role) {
    res.status(400);
    throw new Error('Role not found in this organization');
  }
  if (role.isOwnerRole) {
    res.status(400);
    throw new Error('Cannot assign the CP Owner role');
  }
  member.roleRef = role._id;
  await member.save({ validateBeforeSave: false });
  res.json({ success: true, data: { _id: member._id, roleRef: role._id } });
});

// POST /api/cp/team/invite — generate an invitation link for a new CP team member.
// Uses a dedicated handler so the CP-specific role names ("CP Manager" / "CP Agent")
// are never run through the developer-role whitelist in invitationController.js.
export const generateCpInvitationLink = asyncHandler(async (req, res) => {
  const { firstName, lastName, email, role } = req.body;

  // 1. Input validation
  if (!firstName || !lastName || !email || !role) {
    res.status(400);
    throw new Error('firstName, lastName, email, and role are all required');
  }

  // 2. Look up the target Role within this CP org
  const targetRole = await Role.findOne({
    organization: req.user.organization,
    name: role,
    isActive: true,
  });
  if (!targetRole) {
    res.status(400);
    throw new Error('Role not found in this organization');
  }
  if (targetRole.isOwnerRole) {
    res.status(400);
    throw new Error('Cannot invite a CP Owner');
  }

  // 3. Hierarchy check — inviter must outrank the target role
  //    protect() populates req.user.roleRef with { level, ... }
  const inviterLevel = req.user.roleRef?.level ?? Infinity;
  if (inviterLevel >= targetRole.level) {
    res.status(403);
    throw new Error('You cannot invite a member with this role');
  }

  // 4. Email uniqueness (global — User.email has a unique index)
  const existingUser = await User.findOne({ email: email.toLowerCase() });
  if (existingUser) {
    res.status(400);
    throw new Error('A user with this email already exists');
  }

  // 5. Map CP role name to the closest legacy enum value.
  //    The User.role field is NOT required but its enum must be respected when set.
  //    "CP Manager" → 'Channel Partner Manager'
  //    "CP Agent"   → 'Channel Partner Agent'
  //    Any other CP role name (e.g. seeded slugs) → omit the legacy field.
  const CP_ROLE_LEGACY_MAP = {
    'CP Manager': 'Channel Partner Manager',
    'CP Agent': 'Channel Partner Agent',
  };
  const legacyRole = CP_ROLE_LEGACY_MAP[role] || undefined;

  // 6. Build the pending User document
  const invitationToken = crypto.randomBytes(32).toString('hex');
  const invitationExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

  const userDoc = {
    organization: req.user.organization,
    firstName: firstName.trim(),
    lastName: lastName.trim(),
    email: email.toLowerCase(),
    roleRef: targetRole._id,
    isActive: false,
    invitationStatus: 'pending',
    invitedBy: req.user._id,
    invitedAt: new Date(),
    invitationToken,
    invitationExpiry,
  };
  if (legacyRole) {
    userDoc.role = legacyRole;
  }

  const user = await User.create(userDoc);

  // 7. Build the invitation link (same pattern as invitationController.createInvitationURL)
  const baseUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
  const invitationLink = `${baseUrl}/invite/${user._id}?token=${invitationToken}&email=${encodeURIComponent(email.toLowerCase())}`;

  res.status(201).json({
    success: true,
    data: {
      invitationLink,
      userId: user._id,
      email: user.email,
    },
  });
});

// PUT /api/cp/team/:userId/deactivate — deactivate a member.
export const deactivateMember = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.userId)) {
    res.status(400);
    throw new Error('Invalid user id');
  }
  const member = await User.findOne({
    _id: req.params.userId,
    organization: req.user.organization,
  }).populate('roleRef', 'isOwnerRole');
  if (!member) {
    res.status(404);
    throw new Error('Team member not found');
  }
  if (member.roleRef?.isOwnerRole) {
    res.status(400);
    throw new Error('The CP Owner cannot be deactivated');
  }
  if (String(member._id) === String(req.user._id)) {
    res.status(400);
    throw new Error('You cannot deactivate yourself');
  }
  member.isActive = false;
  await member.save({ validateBeforeSave: false });
  res.json({ success: true, data: { _id: member._id, isActive: false } });
});
