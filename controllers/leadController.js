// File: controllers/leadController.js
// Description: Handles the business logic for lead and interaction management.

import asyncHandler from 'express-async-handler';
import Lead from '../models/leadModel.js';
import Interaction from '../models/interactionModel.js';
import Project from '../models/projectModel.js';

// @desc    Create a new lead
// @route   POST /api/leads
// @access  Private (Requires authentication and role check)
const createLead = asyncHandler(async (req, res) => {
  const { project, firstName, lastName, email, phone, source, status } = req.body;

  // Basic validation
  if (!project || !firstName || !phone) {
    res.status(400);
    throw new Error('Project, first name, and phone are required fields.');
  }

  // Verify the project exists and belongs to the user's organization
  const projectExists = await Project.findOne({
    _id: project,
    organization: req.user.organization,
  });

  if (!projectExists) {
    res.status(404);
    throw new Error('Project not found or you do not have permission to access it.');
  }

  const lead = new Lead({
    ...req.body,
    organization: req.user.organization, // Set organization from logged-in user
  });

  const createdLead = await lead.save();
  res.status(201).json(createdLead);
});

// @desc    Get all leads for the user's organization
// @route   GET /api/leads
// @access  Private
const getLeads = asyncHandler(async (req, res) => {
  // --- V1.1 Enhancement: Advanced RBAC Filtering ---
  const query = { organization: req.user.organization };

  // If the user is a Sales Executive, they should only see leads assigned to them.
  if (req.user.role === 'Sales Executive') {
    query.assignedTo = req.user._id;
  }
  
  // Note: For a Sales Manager, a more advanced query would find all users on their team.
  // For V1.1, managers and heads can see all leads within the organization.

  const leads = await Lead.find(query)
    .populate('project', 'name')
    .populate('assignedTo', 'firstName lastName');

  res.json(leads);
});

// @desc    Get a single lead by ID
// @route   GET /api/leads/:id
// @access  Private
const getLeadById = asyncHandler(async (req, res) => {
  const lead = await Lead.findOne({
    _id: req.params.id,
    organization: req.user.organization,
  }).populate('project', 'name targetRevenue');

  if (lead) {
    // Add logic here to ensure a Sales Executive can only view their own lead details
    if (
      req.user.role === 'Sales Executive' &&
      lead.assignedTo.toString() !== req.user._id.toString()
    ) {
      res.status(403);
      throw new Error('You are not authorized to view this lead.');
    }
    res.json(lead);
  } else {
    res.status(404);
    throw new Error('Lead not found');
  }
});

// @desc    Update a lead
// @route   PUT /api/leads/:id
// @access  Private
const updateLead = asyncHandler(async (req, res) => {
  const lead = await Lead.findOne({
    _id: req.params.id,
    organization: req.user.organization,
  });

  if (lead) {
    // Add logic here to ensure a Sales Executive can only update their own lead
     if (
      req.user.role === 'Sales Executive' &&
      lead.assignedTo.toString() !== req.user._id.toString()
    ) {
      res.status(403);
      throw new Error('You are not authorized to update this lead.');
    }

    Object.assign(lead, req.body);

    const updatedLead = await lead.save();
    res.json(updatedLead);
  } else {
    res.status(404);
    throw new Error('Lead not found');
  }
});

// @desc    Add an interaction to a lead
// @route   POST /api/leads/:id/interactions
// @access  Private
const addInteractionToLead = asyncHandler(async (req, res) => {
  const { type, content, outcome } = req.body;
  const leadId = req.params.id;

  const lead = await Lead.findOne({
    _id: leadId,
    organization: req.user.organization,
  });

  if (!lead) {
    res.status(404);
    throw new Error('Lead not found');
  }

  const interaction = new Interaction({
    ...req.body,
    lead: leadId,
    user: req.user._id, // Logged-in user
    organization: req.user.organization,
  });

  const createdInteraction = await interaction.save();
  res.status(201).json(createdInteraction);
});

// @desc    Get all interactions for a lead
// @route   GET /api/leads/:id/interactions
// @access  Private
const getLeadInteractions = asyncHandler(async (req, res) => {
  const lead = await Lead.findOne({
    _id: req.params.id,
    organization: req.user.organization,
  });

  if (!lead) {
    res.status(404);
    throw new Error('Lead not found');
  }

  const interactions = await Interaction.find({ lead: req.params.id })
    .populate('user', 'firstName lastName')
    .sort({ createdAt: -1 }); // Show most recent first

  res.json(interactions);
});


export {
  createLead,
  getLeads,
  getLeadById,
  updateLead,
  addInteractionToLead,
  getLeadInteractions,
};
