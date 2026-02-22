// File: controllers/approvalController.js
// Description: Handles API endpoints for the centralized approval system.

import asyncHandler from 'express-async-handler';
import ApprovalRequest from '../models/approvalRequestModel.js';
import ApprovalPolicy from '../models/approvalPolicyModel.js';
import {
  processApprovalAction,
  cancelApprovalRequest,
  getApprovalDashboard,
} from '../services/approvalService.js';

// ─── Dashboard ────────────────────────────────────────────────

/**
 * @desc    Get approval dashboard for current user
 * @route   GET /api/approvals/dashboard
 * @access  Private (approvals:view)
 */
const getDashboard = asyncHandler(async (req, res) => {
  const dashboard = await getApprovalDashboard(
    req.user._id,
    req.user.organization
  );
  res.json(dashboard);
});

// ─── Pending Approvals ────────────────────────────────────────

/**
 * @desc    Get pending approvals assigned to current user
 * @route   GET /api/approvals/pending
 * @access  Private (approvals:view)
 */
const getPendingApprovals = asyncHandler(async (req, res) => {
  const { approvalType, priority, page = 1, limit = 20 } = req.query;
  const skip = (parseInt(page) - 1) * parseInt(limit);

  const filter = {
    organization: req.user.organization,
    status: 'pending',
    'approverActions.approver': req.user._id,
  };

  if (approvalType) filter.approvalType = approvalType;
  if (priority) filter.priority = priority;

  const [approvals, total] = await Promise.all([
    ApprovalRequest.find(filter)
      .populate('requestedBy', 'firstName lastName email')
      .populate('project', 'name')
      .sort({ priority: 1, createdAt: 1 }) // Critical first, then oldest
      .skip(skip)
      .limit(parseInt(limit))
      .lean(),
    ApprovalRequest.countDocuments(filter),
  ]);

  res.json({
    approvals,
    pagination: {
      page: parseInt(page),
      limit: parseInt(limit),
      total,
      totalPages: Math.ceil(total / parseInt(limit)),
    },
  });
});

// ─── List All Requests ────────────────────────────────────────

/**
 * @desc    Get all approval requests (with filters)
 * @route   GET /api/approvals
 * @access  Private (approvals:view_all)
 */
const getApprovalRequests = asyncHandler(async (req, res) => {
  const {
    status,
    approvalType,
    requestedBy,
    page = 1,
    limit = 20,
  } = req.query;
  const skip = (parseInt(page) - 1) * parseInt(limit);

  const filter = { organization: req.user.organization };
  if (status) filter.status = status;
  if (approvalType) filter.approvalType = approvalType;
  if (requestedBy) filter.requestedBy = requestedBy;

  const [approvals, total] = await Promise.all([
    ApprovalRequest.find(filter)
      .populate('requestedBy', 'firstName lastName email')
      .populate('resolvedBy', 'firstName lastName')
      .populate('project', 'name')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean(),
    ApprovalRequest.countDocuments(filter),
  ]);

  res.json({
    approvals,
    pagination: {
      page: parseInt(page),
      limit: parseInt(limit),
      total,
      totalPages: Math.ceil(total / parseInt(limit)),
    },
  });
});

// ─── Single Request ───────────────────────────────────────────

/**
 * @desc    Get single approval request with full details
 * @route   GET /api/approvals/:id
 * @access  Private (approvals:view)
 */
const getApprovalRequestById = asyncHandler(async (req, res) => {
  const approval = await ApprovalRequest.findOne({
    _id: req.params.id,
    organization: req.user.organization,
  })
    .populate('requestedBy', 'firstName lastName email')
    .populate('resolvedBy', 'firstName lastName')
    .populate('approverActions.approver', 'firstName lastName email')
    .populate('approvalPolicy', 'displayName approvalType slaHours')
    .populate('linkedTask', 'taskNumber status')
    .populate('project', 'name')
    .populate('escalationHistory.escalatedTo', 'firstName lastName');

  if (!approval) {
    res.status(404);
    throw new Error('Approval request not found');
  }

  res.json(approval);
});

// ─── Approve ──────────────────────────────────────────────────

/**
 * @desc    Approve a pending request
 * @route   POST /api/approvals/:id/approve
 * @access  Private (approvals:approve)
 */
const approveRequest = asyncHandler(async (req, res) => {
  const { comment } = req.body;

  const result = await processApprovalAction({
    approvalRequestId: req.params.id,
    userId: req.user._id,
    action: 'approved',
    comment,
  });

  res.json({
    message: 'Approval recorded successfully',
    approval: result,
  });
});

// ─── Reject ───────────────────────────────────────────────────

/**
 * @desc    Reject a pending request
 * @route   POST /api/approvals/:id/reject
 * @access  Private (approvals:reject)
 */
const rejectRequest = asyncHandler(async (req, res) => {
  const { comment } = req.body;

  if (!comment || comment.trim().length === 0) {
    res.status(400);
    throw new Error('Rejection reason is required');
  }

  const result = await processApprovalAction({
    approvalRequestId: req.params.id,
    userId: req.user._id,
    action: 'rejected',
    comment: comment.trim(),
  });

  res.json({
    message: 'Request rejected',
    approval: result,
  });
});

// ─── Cancel ───────────────────────────────────────────────────

/**
 * @desc    Cancel own pending request
 * @route   POST /api/approvals/:id/cancel
 * @access  Private (approvals:view — only requester can cancel)
 */
const cancelRequest = asyncHandler(async (req, res) => {
  const { reason } = req.body;

  const result = await cancelApprovalRequest(
    req.params.id,
    req.user._id,
    reason || 'Cancelled by requester'
  );

  res.json({
    message: 'Approval request cancelled',
    approval: result,
  });
});

// ─── Policy Management ───────────────────────────────────────

/**
 * @desc    Get all approval policies for this org
 * @route   GET /api/approvals/policies
 * @access  Private (approvals:manage_policies)
 */
const getApprovalPolicies = asyncHandler(async (req, res) => {
  const policies = await ApprovalPolicy.find({
    organization: req.user.organization,
  })
    .populate('project', 'name')
    .sort({ approvalType: 1 });

  res.json(policies);
});

/**
 * @desc    Get single approval policy
 * @route   GET /api/approvals/policies/:id
 * @access  Private (approvals:manage_policies)
 */
const getApprovalPolicyById = asyncHandler(async (req, res) => {
  const policy = await ApprovalPolicy.findOne({
    _id: req.params.id,
    organization: req.user.organization,
  }).populate('project', 'name');

  if (!policy) {
    res.status(404);
    throw new Error('Approval policy not found');
  }

  res.json(policy);
});

/**
 * @desc    Create approval policy
 * @route   POST /api/approvals/policies
 * @access  Private (approvals:manage_policies)
 */
const createApprovalPolicy = asyncHandler(async (req, res) => {
  const policy = await ApprovalPolicy.create({
    ...req.body,
    organization: req.user.organization,
    createdBy: req.user._id,
  });

  res.status(201).json(policy);
});

/**
 * @desc    Update approval policy
 * @route   PUT /api/approvals/policies/:id
 * @access  Private (approvals:manage_policies)
 */
const updateApprovalPolicy = asyncHandler(async (req, res) => {
  const policy = await ApprovalPolicy.findOne({
    _id: req.params.id,
    organization: req.user.organization,
  });

  if (!policy) {
    res.status(404);
    throw new Error('Approval policy not found');
  }

  // Allowed update fields
  const allowedFields = [
    'isEnabled',
    'displayName',
    'description',
    'discountThresholds',
    'priceOverrideThresholdPercent',
    'amountThresholds',
    'alwaysRequire',
    'approverRules',
    'requiredApprovals',
    'slaHours',
    'escalationConfig',
  ];

  for (const field of allowedFields) {
    if (req.body[field] !== undefined) {
      policy[field] = req.body[field];
    }
  }
  policy.lastModifiedBy = req.user._id;

  await policy.save();
  res.json(policy);
});

export {
  getDashboard,
  getPendingApprovals,
  getApprovalRequests,
  getApprovalRequestById,
  approveRequest,
  rejectRequest,
  cancelRequest,
  getApprovalPolicies,
  getApprovalPolicyById,
  createApprovalPolicy,
  updateApprovalPolicy,
};
