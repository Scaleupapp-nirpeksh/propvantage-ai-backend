// File: controllers/channelPartnerController.js
// Description: Channel Partner module controller — registry (firms + agents)
//   and commission rules. All handlers are organization-scoped.

import asyncHandler from 'express-async-handler';
import ChannelPartner from '../models/channelPartnerModel.js';
import ChannelPartnerAgent from '../models/channelPartnerAgentModel.js';
import CommissionRule from '../models/commissionRuleModel.js';
import Project from '../models/projectModel.js';
import CommissionRecord from '../models/commissionRecordModel.js';
import Sale from '../models/salesModel.js';
import Lead from '../models/leadModel.js';
import { syncCommissionForSale } from '../services/commissionService.js';

// ─── Helpers ─────────────────────────────────────────────────

// Keep only the project IDs from `ids` that belong to the organization —
// prevents a caller persisting foreign-org project references.
const filterOrgProjectIds = async (ids, organizationId) => {
  if (!Array.isArray(ids) || ids.length === 0) return [];
  const found = await Project.find({
    _id: { $in: ids },
    organization: organizationId,
  }).select('_id');
  return found.map((p) => p._id);
};

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

  const { organization, onboardedBy, approvedProjects, ...body } = req.body;
  const partner = await ChannelPartner.create({
    ...body,
    approvedProjects: await filterOrgProjectIds(approvedProjects, req.user.organization),
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
  const { organization, onboardedBy, approvedProjects, ...updatable } = req.body;
  Object.assign(partner, updatable);
  if (approvedProjects !== undefined) {
    partner.approvedProjects = await filterOrgProjectIds(
      approvedProjects,
      req.user.organization
    );
  }
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
  const partner = await ChannelPartner.findOne({
    _id: req.params.id,
    organization: req.user.organization,
  });
  if (!partner) {
    res.status(404);
    throw new Error('Channel partner not found');
  }

  const agents = await ChannelPartnerAgent.find({
    channelPartner: partner._id,
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
  const { organization, appliesToProject, ...body } = req.body;
  if (appliesToProject) {
    const valid = await filterOrgProjectIds([appliesToProject], req.user.organization);
    if (valid.length === 0) {
      res.status(400);
      throw new Error('appliesToProject must be a project in your organization');
    }
  }
  try {
    const rule = await CommissionRule.create({
      ...body,
      appliesToProject: appliesToProject || null,
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

  const { organization, appliesToProject, ...updatable } = req.body;
  Object.assign(rule, updatable);
  if (appliesToProject !== undefined) {
    if (appliesToProject) {
      const valid = await filterOrgProjectIds([appliesToProject], req.user.organization);
      if (valid.length === 0) {
        res.status(400);
        throw new Error('appliesToProject must be a project in your organization');
      }
    }
    rule.appliesToProject = appliesToProject || null;
  }
  try {
    await rule.save();
  } catch (err) {
    res.status(400);
    throw new Error(err.message);
  }
  res.json({ success: true, data: rule });
});

// ─── Commission records ──────────────────────────────────────

/**
 * @desc    List commission records
 * @route   GET /api/channel-partners/commission-records
 * @access  Private (channel_partners:view)
 */
const getCommissionRecords = asyncHandler(async (req, res) => {
  const { status, channelPartner } = req.query;
  const query = { organization: req.user.organization };
  if (status) query.status = status;
  if (channelPartner) query.channelPartner = channelPartner;

  const records = await CommissionRecord.find(query)
    .populate('channelPartner', 'firmName')
    .populate('agent', 'name')
    .populate({ path: 'sale', select: 'salePrice bookingDate project', populate: { path: 'project', select: 'name' } })
    .sort({ createdAt: -1 });

  res.json({ success: true, count: records.length, data: records });
});

/**
 * @desc    Mark one payout of a commission record as paid
 * @route   PUT /api/channel-partners/commission-records/:id/payouts/:index/pay
 * @access  Private (channel_partners:manage_commissions)
 */
const markPayoutPaid = asyncHandler(async (req, res) => {
  const record = await CommissionRecord.findOne({
    _id: req.params.id,
    organization: req.user.organization,
  });
  if (!record) {
    res.status(404);
    throw new Error('Commission record not found');
  }
  const idx = Number(req.params.index);
  const payout = record.payouts[idx];
  if (!payout) {
    res.status(404);
    throw new Error('Payout not found');
  }
  if (payout.status === 'paid') {
    res.status(400);
    throw new Error('Payout is already paid');
  }
  payout.status = 'paid';
  payout.paidOn = new Date();
  payout.paidBy = req.user._id;
  record.history.push({ by: req.user._id, action: 'payout_paid', note: `Payout "${payout.label}" marked paid.` });
  record.recomputeStatus();
  await record.save();

  res.json({ success: true, data: record });
});

/**
 * @desc    Edit the channel-partner attribution on an existing booking
 * @route   PUT /api/channel-partners/sales/:saleId/attribution
 * @access  Private (channel_partners:edit_booking_attribution)
 */
const editSaleAttribution = asyncHandler(async (req, res) => {
  const sale = await Sale.findOne({
    _id: req.params.saleId,
    organization: req.user.organization,
  });
  if (!sale) {
    res.status(404);
    throw new Error('Booking not found');
  }

  const { viaChannelPartner, partners } = req.body;
  const list = Array.isArray(partners) ? partners.filter((p) => p && p.channelPartner) : [];

  if (viaChannelPartner && list.length > 0) {
    const sum = list.reduce((a, p) => a + (Number(p.sharePct) || 0), 0);
    if (Math.abs(sum - 100) > 0.01) {
      res.status(400);
      throw new Error(`Commission split must sum to 100% (got ${sum})`);
    }
  }

  const prev = sale.channelPartnerAttribution || {};
  sale.channelPartnerAttribution = {
    viaChannelPartner: Boolean(viaChannelPartner) && list.length > 0,
    partners: Boolean(viaChannelPartner) ? list : [],
    status: prev.status || 'tagged',
    taggedBy: prev.taggedBy || req.user._id,
    taggedAt: prev.taggedAt || new Date(),
    history: [
      ...(prev.history || []),
      { by: req.user._id, action: 'attribution_edited', note: 'Booking CP attribution edited.' },
    ],
  };
  await sale.save();

  await syncCommissionForSale(sale._id, req.user._id);

  res.json({ success: true, data: sale.channelPartnerAttribution });
});

// ─── Performance dashboard ───────────────────────────────────

/**
 * @desc    Per-channel-partner performance leaderboard + funnel
 * @route   GET /api/channel-partners/dashboard
 * @access  Private (channel_partners:view)
 */
const getChannelPartnerDashboard = asyncHandler(async (req, res) => {
  const orgId = req.user.organization;

  const partners = await ChannelPartner.find({ organization: orgId }).select('firmName status');

  // Leads tagged to each CP
  const leadAgg = await Lead.aggregate([
    { $match: { organization: orgId, 'channelPartnerAttribution.viaChannelPartner': true } },
    { $unwind: '$channelPartnerAttribution.partners' },
    {
      $group: {
        _id: '$channelPartnerAttribution.partners.channelPartner',
        leadsTagged: { $sum: 1 },
      },
    },
  ]);

  // Bookings + booked value attributed to each CP (cancelled bookings excluded)
  const saleAgg = await Sale.aggregate([
    {
      $match: {
        organization: orgId,
        'channelPartnerAttribution.viaChannelPartner': true,
        status: { $ne: 'Cancelled' },
      },
    },
    { $unwind: '$channelPartnerAttribution.partners' },
    {
      $group: {
        _id: '$channelPartnerAttribution.partners.channelPartner',
        bookings: { $sum: 1 },
        bookingValue: { $sum: '$salePrice' },
      },
    },
  ]);

  // Commission earned / paid per CP (cancelled records excluded)
  const commAgg = await CommissionRecord.aggregate([
    { $match: { organization: orgId, status: { $ne: 'cancelled' } } },
    {
      $addFields: {
        paidAmount: {
          $sum: {
            $map: {
              input: { $filter: { input: '$payouts', as: 'p', cond: { $eq: ['$$p.status', 'paid'] } } },
              as: 'p',
              in: '$$p.amount',
            },
          },
        },
      },
    },
    {
      $group: {
        _id: '$channelPartner',
        commissionNet: { $sum: '$netAmount' },
        commissionPaid: { $sum: '$paidAmount' },
      },
    },
  ]);

  const byId = (rows) => Object.fromEntries(rows.map((r) => [String(r._id), r]));
  const leadMap = byId(leadAgg);
  const saleMap = byId(saleAgg);
  const commMap = byId(commAgg);

  const leaderboard = partners
    .map((p) => {
      const id = String(p._id);
      const lead = leadMap[id] || {};
      const sale = saleMap[id] || {};
      const comm = commMap[id] || {};
      const commissionNet = comm.commissionNet || 0;
      const commissionPaid = comm.commissionPaid || 0;
      return {
        channelPartnerId: p._id,
        firmName: p.firmName,
        status: p.status,
        leadsTagged: lead.leadsTagged || 0,
        bookings: sale.bookings || 0,
        bookingValue: sale.bookingValue || 0,
        commissionNet,
        commissionPaid,
        commissionPending: commissionNet - commissionPaid,
      };
    })
    .sort((a, b) => b.bookingValue - a.bookingValue);

  const funnel = leaderboard.reduce(
    (acc, r) => ({
      leadsTagged: acc.leadsTagged + r.leadsTagged,
      bookings: acc.bookings + r.bookings,
      bookingValue: acc.bookingValue + r.bookingValue,
      commissionNet: acc.commissionNet + r.commissionNet,
      commissionPaid: acc.commissionPaid + r.commissionPaid,
      commissionPending: acc.commissionPending + r.commissionPending,
    }),
    { leadsTagged: 0, bookings: 0, bookingValue: 0, commissionNet: 0, commissionPaid: 0, commissionPending: 0 }
  );
  funnel.conversionPct =
    funnel.leadsTagged > 0 ? Math.round((funnel.bookings / funnel.leadsTagged) * 100) : 0;

  res.json({
    success: true,
    data: { leaderboard, funnel, partnerCount: partners.length },
  });
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
  getCommissionRecords,
  markPayoutPaid,
  editSaleAttribution,
  getChannelPartnerDashboard,
};
