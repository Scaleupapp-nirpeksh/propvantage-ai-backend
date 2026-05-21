// File: controllers/cpPortalController.js
// Description: Channel-partner portal endpoints — the CP org's own profile and team.
//   All routes are guarded by requireOrgType('channel_partner') + a cp_* permission.

import asyncHandler from 'express-async-handler';
import mongoose from 'mongoose';
import Organization from '../models/organizationModel.js';
import User from '../models/userModel.js';
import Role from '../models/roleModel.js';

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
  const CP_CATEGORIES = ['individual_agent', 'broker_firm', 'corporate', 'digital_aggregator'];

  if (name !== undefined) org.name = name;
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
