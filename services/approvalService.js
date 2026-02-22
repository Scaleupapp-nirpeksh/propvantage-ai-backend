// File: services/approvalService.js
// Description: Central approval engine — checks if approval is needed, creates requests,
// processes approve/reject actions, propagates results to downstream entities, and handles escalation.

import mongoose from 'mongoose';
import ApprovalPolicy from '../models/approvalPolicyModel.js';
import ApprovalRequest from '../models/approvalRequestModel.js';
import Task from '../models/taskModel.js';
import User from '../models/userModel.js';
import Role from '../models/roleModel.js';
import {
  notifyApprovalRequested,
  notifyApprovalApproved,
  notifyApprovalRejected,
  notifyApprovalEscalated,
} from './notificationService.js';

// ─── Helpers ──────────────────────────────────────────────────

/**
 * Find the org owner or business head to use as system creator for tasks.
 */
async function getSystemUser(organizationId) {
  const owner = await User.findOne({ organization: organizationId, isActive: true })
    .populate('roleRef', 'level isOwnerRole')
    .sort({ 'roleRef.level': 1 });
  return owner?._id || null;
}

/**
 * Resolve approvers based on policy rules and the requesting user's context.
 * Returns an array of user IDs who should approve.
 */
async function resolveApprovers(policy, organizationId, contextData = {}) {
  const approvers = new Set();

  for (const rule of policy.approverRules) {
    if (rule.assignmentMode === 'specific' && rule.specificUsers?.length > 0) {
      // Use specific user list
      for (const userId of rule.specificUsers) {
        approvers.add(userId.toString());
      }
    } else if (rule.assignmentMode === 'role') {
      // Find all users with the exact role slug
      const roles = await Role.find({
        organization: organizationId,
        slug: rule.roleSlug,
      }).select('_id');
      const roleIds = roles.map((r) => r._id);
      const users = await User.find({
        organization: organizationId,
        roleRef: { $in: roleIds },
        isActive: true,
      }).select('_id');
      for (const u of users) approvers.add(u._id.toString());
    } else {
      // 'hierarchy' mode — anyone at or above the specified level
      const roles = await Role.find({
        organization: organizationId,
        level: { $lte: rule.roleLevel },
      }).select('_id');
      const roleIds = roles.map((r) => r._id);
      const users = await User.find({
        organization: organizationId,
        roleRef: { $in: roleIds },
        isActive: true,
      }).select('_id');
      for (const u of users) approvers.add(u._id.toString());
    }
  }

  // Remove the requester from approvers (can't approve your own request)
  if (contextData.requestedBy) {
    approvers.delete(contextData.requestedBy.toString());
  }

  return [...approvers].map((id) => new mongoose.Types.ObjectId(id));
}

/**
 * For discount approvals, find the right approver level based on the requested discount.
 * Returns the minimum role level that can approve this specific discount percentage.
 */
function findDiscountApproverLevel(policy, requestedDiscountPercent) {
  // Sort thresholds by level descending (highest level = lowest authority)
  const sorted = [...policy.discountThresholds].sort(
    (a, b) => b.roleLevel - a.roleLevel
  );

  // Find the first (lowest authority) role that has a threshold >= requested discount
  for (const threshold of sorted) {
    if (threshold.maxDiscountPercentage >= requestedDiscountPercent) {
      return threshold.roleLevel;
    }
  }

  // Nobody can approve — fall back to org owner (level 0)
  return 0;
}

// ─── Core Methods ─────────────────────────────────────────────

/**
 * Check if an approval is required for the given type and context.
 *
 * @param {ObjectId} organizationId
 * @param {String} approvalType - e.g. 'DISCOUNT_APPROVAL'
 * @param {Object} contextData - type-specific context
 *   - For DISCOUNT_APPROVAL: { discountPercentage, userRoleLevel, userRoleSlug, requestedBy }
 *   - For PRICE_OVERRIDE: { deviationPercent, requestedBy }
 *   - For REFUND_APPROVAL: { refundAmount, requestedBy }
 *   - For SALE_CANCELLATION/INSTALLMENT_MODIFICATION/INVOICE_APPROVAL: { requestedBy }
 *   - For COMMISSION_PAYOUT: returns { required: false }
 * @param {ObjectId} [projectId] - optional project-level override
 * @returns {{ required: boolean, policy: Object|null, approvers: ObjectId[] }}
 */
export async function checkApprovalRequired(
  organizationId,
  approvalType,
  contextData = {},
  projectId = null
) {
  // Commission payout uses existing system
  if (approvalType === 'COMMISSION_PAYOUT') {
    return { required: false, policy: null, approvers: [] };
  }

  // Look for project-specific policy first, then org-wide
  let policy = null;
  if (projectId) {
    policy = await ApprovalPolicy.findOne({
      organization: organizationId,
      approvalType,
      project: projectId,
      isEnabled: true,
    });
  }
  if (!policy) {
    policy = await ApprovalPolicy.findOne({
      organization: organizationId,
      approvalType,
      project: null,
      isEnabled: true,
    });
  }

  if (!policy) {
    return { required: false, policy: null, approvers: [] };
  }

  let required = false;

  switch (approvalType) {
    case 'DISCOUNT_APPROVAL': {
      const { discountPercentage, userRoleLevel } = contextData;
      if (!discountPercentage || discountPercentage <= 0) break;

      // Find the user's discount threshold from policy
      const userThreshold = policy.discountThresholds.find(
        (t) => t.roleLevel === userRoleLevel
      );
      const userMaxDiscount = userThreshold?.maxDiscountPercentage ?? 0;

      if (discountPercentage > userMaxDiscount) {
        required = true;
        // Override approver rules to find the right level for this specific discount
        const approverLevel = findDiscountApproverLevel(
          policy,
          discountPercentage
        );
        // Temporarily set the approver level for resolver
        contextData._overrideApproverLevel = approverLevel;
      }
      break;
    }

    case 'PRICE_OVERRIDE': {
      const { deviationPercent } = contextData;
      if (
        deviationPercent !== undefined &&
        deviationPercent > policy.priceOverrideThresholdPercent
      ) {
        required = true;
      }
      break;
    }

    case 'REFUND_APPROVAL': {
      const { refundAmount } = contextData;
      if (policy.amountThresholds?.length > 0 && refundAmount > 0) {
        required = true;
        // Find the matching bracket
        const bracket = policy.amountThresholds.find(
          (t) =>
            refundAmount >= t.minAmount &&
            (t.maxAmount === null || refundAmount <= t.maxAmount)
        );
        if (bracket) {
          contextData._overrideApproverLevel = bracket.approverRoleLevel;
        }
      } else if (policy.alwaysRequire) {
        required = true;
      }
      break;
    }

    case 'SALE_CANCELLATION':
    case 'INSTALLMENT_MODIFICATION':
    case 'INVOICE_APPROVAL': {
      if (policy.alwaysRequire || policy.isEnabled) {
        required = true;
      }
      break;
    }
  }

  if (!required) {
    return { required: false, policy, approvers: [] };
  }

  // Resolve approvers
  let approvers;
  if (contextData._overrideApproverLevel !== undefined) {
    // Find approvers at or above the specified level
    const roles = await Role.find({
      organization: organizationId,
      level: { $lte: contextData._overrideApproverLevel },
    }).select('_id');
    const roleIds = roles.map((r) => r._id);
    const users = await User.find({
      organization: organizationId,
      roleRef: { $in: roleIds },
      isActive: true,
    }).select('_id');
    approvers = users
      .map((u) => u._id)
      .filter(
        (id) =>
          !contextData.requestedBy ||
          id.toString() !== contextData.requestedBy.toString()
      );
  } else {
    approvers = await resolveApprovers(policy, organizationId, contextData);
  }

  return { required: true, policy, approvers };
}

/**
 * Create an approval request, auto-create task, and notify approvers.
 *
 * @returns {{ approved: boolean, autoApproved?: boolean, approvalRequest?, task? }}
 */
export async function createApprovalRequest({
  organizationId,
  projectId,
  approvalType,
  entityType,
  entityId,
  requestedBy,
  requestData,
  priority = 'Medium',
  title,
  description,
}) {
  // Check if approval is needed
  const { required, policy, approvers } = await checkApprovalRequired(
    organizationId,
    approvalType,
    { ...requestData, requestedBy },
    projectId
  );

  if (!required || approvers.length === 0) {
    return { approved: true, autoApproved: true };
  }

  // Create the ApprovalRequest
  const approvalRequest = await ApprovalRequest.create({
    organization: organizationId,
    project: projectId,
    approvalType,
    entityType,
    entityId,
    approvalPolicy: policy._id,
    title: title || `${approvalType.replace(/_/g, ' ')} for ${entityType}`,
    description:
      description || `Approval required for ${entityType} ${entityId}`,
    requestedBy,
    requestData,
    priority,
    approverActions: approvers.map((approverId) => ({
      approver: approverId,
      action: 'pending',
    })),
    requiredApprovals: policy.requiredApprovals,
    slaDeadline: new Date(
      Date.now() + policy.slaHours * 60 * 60 * 1000
    ),
  });

  // Create a Task for the primary approver (first in list)
  const systemUser = await getSystemUser(organizationId);
  const primaryApprover = approvers[0];

  let task = null;
  try {
    task = await Task.create({
      organization: organizationId,
      title: `Approval: ${approvalRequest.title}`,
      description: `${approvalRequest.description}\n\nRequest #: ${approvalRequest.requestNumber}\nType: ${approvalType}\nPriority: ${priority}`,
      category: 'Approval',
      priority,
      status: 'Open',
      assignedTo: primaryApprover,
      assignedBy: systemUser,
      assignmentType: 'system',
      dueDate: approvalRequest.slaDeadline,
      linkedEntity: {
        entityType,
        entityId,
        displayLabel: approvalRequest.requestNumber,
      },
      autoGenerated: {
        isAutoGenerated: true,
        triggerType: 'pending_approval',
        triggerEntityType: 'ApprovalRequest',
        triggerEntityId: approvalRequest._id,
        deduplicationKey: `pending_approval_${approvalRequest._id}`,
      },
      sla: {
        targetResolutionHours: policy.slaHours,
        warningThresholdHours: Math.floor(policy.slaHours * 0.75),
      },
      watchers: approvers.filter(
        (id) => id.toString() !== primaryApprover.toString()
      ),
      createdBy: systemUser || requestedBy,
    });

    approvalRequest.linkedTask = task._id;
    await approvalRequest.save();
  } catch (taskError) {
    console.error(
      '⚠️ [ApprovalService] Task creation failed (approval still created):',
      taskError.message
    );
  }

  // Notify all approvers (fire-and-forget)
  notifyApprovalRequested({ approvalRequest, approvers }).catch((err) =>
    console.error('⚠️ [ApprovalService] Notification failed:', err.message)
  );

  return { approved: false, approvalRequest, task };
}

/**
 * Process an approve or reject action on an approval request.
 *
 * @param {Object} params
 * @param {String} params.approvalRequestId
 * @param {String} params.userId
 * @param {String} params.action - 'approved' or 'rejected'
 * @param {String} [params.comment]
 * @returns {Object} Updated approval request
 */
export async function processApprovalAction({
  approvalRequestId,
  userId,
  action,
  comment,
}) {
  const approvalRequest = await ApprovalRequest.findById(approvalRequestId);

  if (!approvalRequest) {
    throw new Error('Approval request not found');
  }
  if (approvalRequest.status !== 'pending') {
    throw new Error(
      `Cannot process action on request with status: ${approvalRequest.status}`
    );
  }

  // Find this user's action entry
  const approverEntry = approvalRequest.approverActions.find(
    (a) => a.approver.toString() === userId.toString()
  );
  if (!approverEntry) {
    throw new Error('You are not an assigned approver for this request');
  }
  if (approverEntry.action !== 'pending') {
    throw new Error('You have already acted on this request');
  }

  // Record the action
  approverEntry.action = action;
  approverEntry.comment = comment || '';
  approverEntry.actionAt = new Date();

  // Push to audit trail
  approvalRequest.auditTrail.push({
    action,
    performedBy: userId,
    comment,
    details: { approvalType: approvalRequest.approvalType },
  });

  if (action === 'approved') {
    approvalRequest.currentApprovalCount += 1;

    if (
      approvalRequest.currentApprovalCount >= approvalRequest.requiredApprovals
    ) {
      // Fully approved
      approvalRequest.status = 'approved';
      approvalRequest.resolvedBy = userId;
      approvalRequest.resolvedAt = new Date();
      approvalRequest.resolutionComment = comment;

      // Propagate approval to the original entity
      await propagateApproval(approvalRequest);

      // Complete the linked task
      await completeLinkedTask(approvalRequest, userId, 'approved');

      // Notify requester
      notifyApprovalApproved({
        approvalRequest,
        approvedBy: userId,
      }).catch((err) =>
        console.error('⚠️ Approval notification failed:', err.message)
      );
    }
    // else: partial approval — still pending more approvals
  } else if (action === 'rejected') {
    // Any rejection = immediate rejection
    approvalRequest.status = 'rejected';
    approvalRequest.resolvedBy = userId;
    approvalRequest.resolvedAt = new Date();
    approvalRequest.resolutionComment = comment;

    // Propagate rejection to the original entity
    await propagateRejection(approvalRequest);

    // Complete the linked task
    await completeLinkedTask(approvalRequest, userId, 'rejected');

    // Notify requester
    notifyApprovalRejected({
      approvalRequest,
      rejectedBy: userId,
      reason: comment,
    }).catch((err) =>
      console.error('⚠️ Rejection notification failed:', err.message)
    );
  }

  await approvalRequest.save();
  return approvalRequest;
}

/**
 * Cancel an approval request (by the requester).
 */
export async function cancelApprovalRequest(approvalRequestId, userId, reason) {
  const approvalRequest = await ApprovalRequest.findById(approvalRequestId);

  if (!approvalRequest) {
    throw new Error('Approval request not found');
  }
  if (approvalRequest.status !== 'pending') {
    throw new Error('Only pending requests can be cancelled');
  }
  if (approvalRequest.requestedBy.toString() !== userId.toString()) {
    throw new Error('Only the requester can cancel this request');
  }

  approvalRequest.status = 'cancelled';
  approvalRequest.resolvedBy = userId;
  approvalRequest.resolvedAt = new Date();
  approvalRequest.resolutionComment = reason;
  approvalRequest.auditTrail.push({
    action: 'cancelled',
    performedBy: userId,
    comment: reason,
  });

  // Revert the original entity
  await propagateRejection(approvalRequest);

  // Complete the linked task
  await completeLinkedTask(approvalRequest, userId, 'cancelled');

  await approvalRequest.save();
  return approvalRequest;
}

// ─── Propagation (type-specific callbacks) ────────────────────

async function propagateApproval(approvalRequest) {
  const { approvalType, entityType, entityId, requestData } = approvalRequest;

  try {
    switch (approvalType) {
      case 'DISCOUNT_APPROVAL': {
        // Sale → Booked, Unit → sold, Lead → Booked, create payment plan
        const Sale = mongoose.model('Sale');
        const Unit = mongoose.model('Unit');
        const Lead = mongoose.model('Lead');

        const sale = await Sale.findById(entityId);
        if (!sale) break;

        sale.status = 'Booked';
        await sale.save();

        if (requestData.unitId) {
          await Unit.findByIdAndUpdate(requestData.unitId, {
            status: 'sold',
          });
        }

        if (sale.lead) {
          await Lead.findByIdAndUpdate(sale.lead, { status: 'Booked' });
        }

        // Create payment plan (dynamic import to avoid circular deps)
        try {
          const { createPaymentPlan } = await import('./paymentService.js');
          const paymentResult = await createPaymentPlan({
            saleId: sale._id,
            salePrice: sale.salePrice,
            discountAmount: sale.discountAmount || 0,
            projectId: sale.project,
            organizationId: sale.organization,
            paymentPlanSnapshot: sale.paymentPlanSnapshot,
          });
          if (paymentResult?.paymentPlan) {
            sale.paymentPlan = paymentResult.paymentPlan._id;
            await sale.save();
          }
        } catch (ppErr) {
          console.error(
            '⚠️ [ApprovalService] Payment plan creation failed after discount approval:',
            ppErr.message
          );
        }
        break;
      }

      case 'SALE_CANCELLATION': {
        const Sale = mongoose.model('Sale');
        const Unit = mongoose.model('Unit');
        const Lead = mongoose.model('Lead');

        const sale = await Sale.findById(entityId);
        if (!sale) break;

        sale.status = 'Cancelled';
        sale.cancellationReason = requestData.cancellationReason;
        sale.cancelledBy = approvalRequest.resolvedBy;
        sale.cancelledAt = new Date();
        await sale.save();

        await Unit.findByIdAndUpdate(sale.unit, { status: 'available' });
        if (sale.lead) {
          await Lead.findByIdAndUpdate(sale.lead, { status: 'Active' });
        }
        break;
      }

      case 'PRICE_OVERRIDE': {
        const Unit = mongoose.model('Unit');
        if (requestData.proposedPrice) {
          await Unit.findByIdAndUpdate(entityId, {
            currentPrice: requestData.proposedPrice,
          });
        }
        break;
      }

      case 'REFUND_APPROVAL': {
        // Mark the refund as approved — actual refund processing is handled by the payment controller
        const PaymentTransaction = mongoose.model('PaymentTransaction');
        const txn = await PaymentTransaction.findById(entityId);
        if (txn) {
          txn.requiresApproval = false; // Clear the approval flag
          await txn.save();
        }
        break;
      }

      case 'INSTALLMENT_MODIFICATION': {
        const Installment = mongoose.model('Installment');
        const installment = await Installment.findById(entityId);
        if (!installment) break;

        if (requestData.modificationType === 'amount_change' && requestData.proposedValue !== undefined) {
          installment.currentAmount = requestData.proposedValue;
          installment.pendingAmount = requestData.proposedValue - (installment.paidAmount || 0);
        } else if (requestData.modificationType === 'date_change' && requestData.proposedValue) {
          installment.currentDueDate = new Date(requestData.proposedValue);
        } else if (requestData.modificationType === 'waiver') {
          installment.status = 'waived';
        }

        // Set approvedBy on the last adjustment if exists
        if (installment.adjustments?.length > 0) {
          const lastAdj = installment.adjustments[installment.adjustments.length - 1];
          lastAdj.approvedBy = approvalRequest.resolvedBy;
        }

        await installment.save();
        break;
      }

      case 'INVOICE_APPROVAL': {
        const Invoice = mongoose.model('Invoice');
        await Invoice.findByIdAndUpdate(entityId, {
          'approvalWorkflow.approvalStatus': 'approved',
          'approvalWorkflow.approvedBy': approvalRequest.resolvedBy,
          'approvalWorkflow.approvedAt': new Date(),
        });
        break;
      }
    }
  } catch (err) {
    console.error(
      `❌ [ApprovalService] propagateApproval failed for ${approvalType}:`,
      err.message
    );
  }
}

async function propagateRejection(approvalRequest) {
  const { approvalType, entityId, requestData } = approvalRequest;

  try {
    switch (approvalType) {
      case 'DISCOUNT_APPROVAL': {
        // Delete the pending sale, revert unit
        const Sale = mongoose.model('Sale');
        const Unit = mongoose.model('Unit');

        await Sale.findByIdAndDelete(entityId);

        if (requestData.unitId) {
          await Unit.findByIdAndUpdate(requestData.unitId, {
            status: 'available',
          });
        }
        break;
      }

      case 'SALE_CANCELLATION':
      case 'PRICE_OVERRIDE':
      case 'REFUND_APPROVAL':
      case 'INSTALLMENT_MODIFICATION':
        // No action — original entity stays as-is
        break;

      case 'INVOICE_APPROVAL': {
        const Invoice = mongoose.model('Invoice');
        await Invoice.findByIdAndUpdate(entityId, {
          'approvalWorkflow.approvalStatus': 'rejected',
          'approvalWorkflow.rejectionReason':
            approvalRequest.resolutionComment || 'Rejected by approver',
        });
        break;
      }
    }
  } catch (err) {
    console.error(
      `❌ [ApprovalService] propagateRejection failed for ${approvalType}:`,
      err.message
    );
  }
}

async function completeLinkedTask(approvalRequest, userId, resolution) {
  if (!approvalRequest.linkedTask) return;

  try {
    const task = await Task.findById(approvalRequest.linkedTask);
    if (!task || task.status === 'Completed' || task.status === 'Cancelled')
      return;

    task.status = 'Completed';
    task.resolution = {
      summary: `Approval ${resolution}: ${approvalRequest.resolutionComment || 'No comment'}`,
      resolvedBy: userId,
      resolvedAt: new Date(),
    };
    task.activityLog.push({
      action: 'status_changed',
      performedBy: userId,
      timestamp: new Date(),
      details: {
        field: 'status',
        oldValue: task.status,
        newValue: 'Completed',
        note: `Approval ${resolution}`,
      },
    });
    await task.save();
  } catch (err) {
    console.error(
      '⚠️ [ApprovalService] completeLinkedTask failed:',
      err.message
    );
  }
}

// ─── Escalation (cron) ────────────────────────────────────────

/**
 * Check for stale approval requests and escalate them.
 * Called by TaskAutoGenerationService cron.
 */
export async function checkApprovalEscalations() {
  try {
    const staleRequests = await ApprovalRequest.find({
      status: 'pending',
      slaDeadline: { $lt: new Date() },
    }).populate('approvalPolicy');

    for (const request of staleRequests) {
      const policy = request.approvalPolicy;
      if (!policy?.escalationConfig?.enabled) continue;

      const hoursSinceCreation =
        (Date.now() - request.createdAt.getTime()) / (1000 * 60 * 60);
      let targetLevel = 0;

      if (hoursSinceCreation >= policy.escalationConfig.level3AfterHours) {
        targetLevel = 3;
      } else if (
        hoursSinceCreation >= policy.escalationConfig.level2AfterHours
      ) {
        targetLevel = 2;
      } else if (
        hoursSinceCreation >= policy.escalationConfig.level1AfterHours
      ) {
        targetLevel = 1;
      }

      if (targetLevel <= request.currentEscalationLevel) continue;

      // Find a higher-level user to escalate to
      const currentMinLevel = Math.min(
        ...request.approverActions.map((a) => {
          // We need to look up each approver's role level
          return 0; // Will be resolved below
        })
      );

      // Find users at a higher level than current approvers
      const existingApproverIds = request.approverActions.map((a) =>
        a.approver.toString()
      );
      const escalationTarget = await User.findOne({
        organization: request.organization,
        isActive: true,
        _id: { $nin: existingApproverIds },
      })
        .populate('roleRef', 'level')
        .sort({ 'roleRef.level': 1 }); // Lowest level = highest authority

      if (!escalationTarget) continue;

      // Add escalation target as a new approver
      request.approverActions.push({
        approver: escalationTarget._id,
        action: 'pending',
      });
      request.currentEscalationLevel = targetLevel;
      request.escalationHistory.push({
        level: targetLevel,
        escalatedTo: escalationTarget._id,
        reason: `SLA breached — ${Math.round(hoursSinceCreation)} hours since creation`,
      });
      request.auditTrail.push({
        action: 'escalated',
        performedBy: null,
        details: {
          level: targetLevel,
          escalatedTo: escalationTarget._id,
          hoursSinceCreation: Math.round(hoursSinceCreation),
        },
      });

      await request.save();

      // Escalate the linked task too
      if (request.linkedTask) {
        try {
          const task = await Task.findById(request.linkedTask);
          if (task && task.status !== 'Completed') {
            task.assignedTo = escalationTarget._id;
            task.priority = 'Critical';
            task.escalations.push({
              level: targetLevel,
              escalatedTo: escalationTarget._id,
              escalatedAt: new Date(),
              reason: `SLA breached — auto-escalated after ${Math.round(hoursSinceCreation)} hours`,
            });
            task.activityLog.push({
              action: 'escalated',
              performedBy: null,
              timestamp: new Date(),
              details: {
                level: targetLevel,
                escalatedTo: escalationTarget._id,
              },
            });
            await task.save();
          }
        } catch (taskErr) {
          console.error(
            '⚠️ [ApprovalService] Task escalation failed:',
            taskErr.message
          );
        }
      }

      // Notify escalation target
      notifyApprovalEscalated({
        approvalRequest: request,
        escalatedTo: escalationTarget._id,
        level: targetLevel,
      }).catch((err) =>
        console.error('⚠️ Escalation notification failed:', err.message)
      );
    }
  } catch (err) {
    console.error(
      '❌ [ApprovalService] checkApprovalEscalations failed:',
      err.message
    );
  }
}

// ─── Dashboard / Queries ──────────────────────────────────────

/**
 * Get approval dashboard data for a user.
 */
export async function getApprovalDashboard(userId, organizationId) {
  const userObjectId = new mongoose.Types.ObjectId(userId);
  const orgObjectId = new mongoose.Types.ObjectId(organizationId);

  const [pendingForMe, myRequests, recentlyResolved, stats] =
    await Promise.all([
      // Pending approvals where I'm an approver
      ApprovalRequest.find({
        organization: orgObjectId,
        status: 'pending',
        'approverActions.approver': userObjectId,
        'approverActions.action': 'pending',
      })
        .populate('requestedBy', 'firstName lastName')
        .populate('project', 'name')
        .sort({ createdAt: -1 })
        .limit(20)
        .lean(),

      // My submitted requests
      ApprovalRequest.find({
        organization: orgObjectId,
        requestedBy: userObjectId,
      })
        .sort({ createdAt: -1 })
        .limit(20)
        .lean(),

      // Recently resolved in my org
      ApprovalRequest.find({
        organization: orgObjectId,
        status: { $in: ['approved', 'rejected'] },
      })
        .populate('resolvedBy', 'firstName lastName')
        .sort({ resolvedAt: -1 })
        .limit(10)
        .lean(),

      // Stats
      ApprovalRequest.aggregate([
        { $match: { organization: orgObjectId } },
        {
          $group: {
            _id: { type: '$approvalType', status: '$status' },
            count: { $sum: 1 },
          },
        },
      ]),
    ]);

  return { pendingForMe, myRequests, recentlyResolved, stats };
}
