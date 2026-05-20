// File: controllers/channelPartnerController.js
// Description: Channel Partner module controller — registry (firms + agents)
//   and commission rules. All handlers are organization-scoped.

import asyncHandler from 'express-async-handler';
import ChannelPartner from '../models/channelPartnerModel.js';
import ChannelPartnerAgent from '../models/channelPartnerAgentModel.js';
import CommissionRule from '../models/commissionRuleModel.js';

// ─── Channel Partner firms ───────────────────────────────────

/**
 * @desc    Create a channel partner firm
 * @route   POST /api/channel-partners
 * @access  Private (channel_partners:create)
 */
const createChannelPartner = asyncHandler(async (req, res) => {
  const { firmName } = req.body;
  if (!firmName || !firmName.trim()) {
    res.status(400);
    throw new Error('Firm name is required');
  }

  const partner = await ChannelPartner.create({
    ...req.body,
    organization: req.user.organization,
    onboardedBy: req.user._id,
  });

  res.status(201).json({ success: true, data: partner });
});

/**
 * @desc    List channel partner firms
 * @route   GET /api/channel-partners
 * @access  Private (channel_partners:view)
 */
const getChannelPartners = asyncHandler(async (req, res) => {
  const { status, search } = req.query;
  const query = { organization: req.user.organization };
  if (status) query.status = status;
  if (search) query.firmName = { $regex: search, $options: 'i' };

  const partners = await ChannelPartner.find(query)
    .populate('approvedProjects', 'name')
    .sort({ firmName: 1 });

  res.json({ success: true, count: partners.length, data: partners });
});

/**
 * @desc    Get one channel partner firm with its agents
 * @route   GET /api/channel-partners/:id
 * @access  Private (channel_partners:view)
 */
const getChannelPartnerById = asyncHandler(async (req, res) => {
  const partner = await ChannelPartner.findOne({
    _id: req.params.id,
    organization: req.user.organization,
  }).populate('approvedProjects', 'name');

  if (!partner) {
    res.status(404);
    throw new Error('Channel partner not found');
  }

  const agents = await ChannelPartnerAgent.find({
    channelPartner: partner._id,
    organization: req.user.organization,
  }).sort({ name: 1 });

  res.json({ success: true, data: { ...partner.toObject(), agents } });
});

/**
 * @desc    Update a channel partner firm
 * @route   PUT /api/channel-partners/:id
 * @access  Private (channel_partners:update)
 */
const updateChannelPartner = asyncHandler(async (req, res) => {
  const partner = await ChannelPartner.findOne({
    _id: req.params.id,
    organization: req.user.organization,
  });
  if (!partner) {
    res.status(404);
    throw new Error('Channel partner not found');
  }

  // organization / onboardedBy are immutable via this endpoint
  const { organization, onboardedBy, ...updatable } = req.body;
  Object.assign(partner, updatable);
  await partner.save();

  res.json({ success: true, data: partner });
});

// ─── Channel Partner agents ──────────────────────────────────

/**
 * @desc    Add an agent to a channel partner firm
 * @route   POST /api/channel-partners/:id/agents
 * @access  Private (channel_partners:update)
 */
const createAgent = asyncHandler(async (req, res) => {
  const partner = await ChannelPartner.findOne({
    _id: req.params.id,
    organization: req.user.organization,
  });
  if (!partner) {
    res.status(404);
    throw new Error('Channel partner not found');
  }
  if (!req.body.name || !req.body.name.trim()) {
    res.status(400);
    throw new Error('Agent name is required');
  }

  const agent = await ChannelPartnerAgent.create({
    name: req.body.name,
    email: req.body.email,
    phone: req.body.phone,
    reraAgentNumber: req.body.reraAgentNumber,
    status: req.body.status,
    channelPartner: partner._id,
    organization: req.user.organization,
  });

  res.status(201).json({ success: true, data: agent });
});

/**
 * @desc    List agents of a channel partner firm
 * @route   GET /api/channel-partners/:id/agents
 * @access  Private (channel_partners:view)
 */
const getAgents = asyncHandler(async (req, res) => {
  const agents = await ChannelPartnerAgent.find({
    channelPartner: req.params.id,
    organization: req.user.organization,
  }).sort({ name: 1 });

  res.json({ success: true, count: agents.length, data: agents });
});

/**
 * @desc    Update an agent
 * @route   PUT /api/channel-partners/agents/:agentId
 * @access  Private (channel_partners:update)
 */
const updateAgent = asyncHandler(async (req, res) => {
  const agent = await ChannelPartnerAgent.findOne({
    _id: req.params.agentId,
    organization: req.user.organization,
  });
  if (!agent) {
    res.status(404);
    throw new Error('Agent not found');
  }

  const { organization, channelPartner, ...updatable } = req.body;
  Object.assign(agent, updatable);
  await agent.save();

  res.json({ success: true, data: agent });
});

// ─── Commission rules ────────────────────────────────────────

/**
 * @desc    Create a commission rule
 * @route   POST /api/channel-partners/commission-rules
 * @access  Private (channel_partners:manage_commission_rules)
 */
const createCommissionRule = asyncHandler(async (req, res) => {
  if (!req.body.name || !req.body.name.trim()) {
    res.status(400);
    throw new Error('Rule name is required');
  }
  try {
    const rule = await CommissionRule.create({
      ...req.body,
      organization: req.user.organization,
    });
    res.status(201).json({ success: true, data: rule });
  } catch (err) {
    // Surface the tranche-sum / schema validation message as a 400
    res.status(400);
    throw new Error(err.message);
  }
});

/**
 * @desc    List commission rules
 * @route   GET /api/channel-partners/commission-rules
 * @access  Private (channel_partners:view)
 */
const getCommissionRules = asyncHandler(async (req, res) => {
  const { status } = req.query;
  const query = { organization: req.user.organization };
  if (status) query.status = status;

  const rules = await CommissionRule.find(query)
    .populate('appliesToProject', 'name')
    .sort({ createdAt: -1 });

  res.json({ success: true, count: rules.length, data: rules });
});

/**
 * @desc    Get one commission rule
 * @route   GET /api/channel-partners/commission-rules/:id
 * @access  Private (channel_partners:view)
 */
const getCommissionRuleById = asyncHandler(async (req, res) => {
  const rule = await CommissionRule.findOne({
    _id: req.params.id,
    organization: req.user.organization,
  }).populate('appliesToProject', 'name');

  if (!rule) {
    res.status(404);
    throw new Error('Commission rule not found');
  }
  res.json({ success: true, data: rule });
});

/**
 * @desc    Update a commission rule
 * @route   PUT /api/channel-partners/commission-rules/:id
 * @access  Private (channel_partners:manage_commission_rules)
 */
const updateCommissionRule = asyncHandler(async (req, res) => {
  const rule = await CommissionRule.findOne({
    _id: req.params.id,
    organization: req.user.organization,
  });
  if (!rule) {
    res.status(404);
    throw new Error('Commission rule not found');
  }

  const { organization, ...updatable } = req.body;
  Object.assign(rule, updatable);
  try {
    await rule.save();
  } catch (err) {
    res.status(400);
    throw new Error(err.message);
  }
  res.json({ success: true, data: rule });
});

export {
  createChannelPartner,
  getChannelPartners,
  getChannelPartnerById,
  updateChannelPartner,
  createAgent,
  getAgents,
  updateAgent,
  createCommissionRule,
  getCommissionRules,
  getCommissionRuleById,
  updateCommissionRule,
};
