// File: controllers/reportReviewController.js
// Description: Review & approval workflow for generated report instances.
// Internal alerts go through the in-app notification system (email is Phase 4).

import crypto from 'crypto';
import asyncHandler from 'express-async-handler';
import ReportInstance from '../models/reportInstanceModel.js';
import { nextReviewStatus } from '../services/reports/reviewState.js';
import { createNotification, notifyUsersWithPermission } from '../services/notificationService.js';

const findOwned = async (req) => {
  const instance = await ReportInstance.findOne({ _id: req.params.id, organization: req.user.organization });
  if (!instance) { req.res.status(404); throw new Error('Report not found'); }
  return instance;
};

const relatedEntity = (instance) => ({
  entityType: 'ReportInstance', entityId: instance._id, displayLabel: instance.title || 'Report',
});

/**
 * @desc    Submit a report for review (draft|changes_requested → in_review)
 * @route   POST /api/reports/instances/:id/submit-review
 * @access  Private (reports:manage)
 */
export const submitForReview = asyncHandler(async (req, res) => {
  const instance = await findOwned(req);
  const next = nextReviewStatus(instance.review?.status || 'draft', 'submit');
  if (!next) { res.status(409); throw new Error(`Cannot submit a report that is '${instance.review?.status}'`); }

  instance.review.status = next;
  instance.review.submittedBy = req.user._id;
  await instance.save();

  await notifyUsersWithPermission({
    organizationId: req.user.organization,
    permission: 'reports:approve',
    excludeUserIds: [req.user._id],
    type: 'report_ready_for_review',
    title: 'A report is ready for review',
    message: `${instance.title || 'A report'} was submitted and is awaiting approval.`,
    actionUrl: `/reports/generated/${instance._id}/review`,
    relatedEntity: relatedEntity(instance),
    actor: req.user._id,
  });

  res.json({ success: true, data: instance, message: 'Submitted for review' });
});

/**
 * @desc    Approve a report (in_review → approved). Locks the snapshot.
 * @route   POST /api/reports/instances/:id/approve
 * @access  Private (reports:approve)
 */
export const approveReport = asyncHandler(async (req, res) => {
  const instance = await findOwned(req);
  const next = nextReviewStatus(instance.review?.status, 'approve');
  if (!next) { res.status(409); throw new Error(`Cannot approve a report that is '${instance.review?.status}'`); }

  instance.review.status = next;
  instance.review.approvedBy = req.user._id;
  instance.review.approvedAt = new Date();
  if (req.body?.notes) instance.review.notes = req.body.notes;
  await instance.save();

  await createNotification({
    organization: req.user.organization,
    recipient: instance.createdBy,
    type: 'report_approved',
    title: 'Your report was approved',
    message: `${instance.title || 'Your report'} was approved and can now be shared.`,
    actionUrl: `/reports/generated/${instance._id}`,
    relatedEntity: relatedEntity(instance),
    actor: req.user._id,
  });

  res.json({ success: true, data: instance, message: 'Report approved' });
});

/**
 * @desc    Request changes (in_review → changes_requested)
 * @route   POST /api/reports/instances/:id/request-changes
 * @access  Private (reports:approve)
 */
export const requestChanges = asyncHandler(async (req, res) => {
  const instance = await findOwned(req);
  const next = nextReviewStatus(instance.review?.status, 'request_changes');
  if (!next) { res.status(409); throw new Error(`Cannot request changes on a report that is '${instance.review?.status}'`); }

  instance.review.status = next;
  instance.review.reviewedBy = req.user._id;
  if (req.body?.notes) instance.review.notes = req.body.notes;
  await instance.save();

  await createNotification({
    organization: req.user.organization,
    recipient: instance.createdBy,
    type: 'report_changes_requested',
    title: 'Changes requested on your report',
    message: req.body?.notes ? `Reviewer note: ${req.body.notes}` : `${instance.title || 'Your report'} needs changes before approval.`,
    actionUrl: `/reports/generated/${instance._id}/review`,
    relatedEntity: relatedEntity(instance),
    actor: req.user._id,
  });

  res.json({ success: true, data: instance, message: 'Changes requested' });
});

/**
 * @desc    Add an override to a (non-approved) report's snapshot value
 * @route   POST /api/reports/instances/:id/overrides   body: { blockId, fieldPath, originalValue, newValue, reason }
 * @access  Private (reports:manage)
 */
export const addOverride = asyncHandler(async (req, res) => {
  const { blockId, fieldPath, originalValue, newValue, reason } = req.body || {};
  if (!blockId || !fieldPath) { res.status(400); throw new Error('blockId and fieldPath are required'); }

  const instance = await findOwned(req);
  if (instance.review?.status === 'approved') { res.status(409); throw new Error('Approved reports are locked'); }

  instance.overrides.push({
    id: crypto.randomUUID(), blockId, fieldPath, originalValue, newValue, reason, by: req.user._id, at: new Date(),
  });
  await instance.save();
  res.status(201).json({ success: true, data: instance, message: 'Override added' });
});

/**
 * @desc    Flag a value and notify the assigned owner to fix the source data
 * @route   POST /api/reports/instances/:id/flags   body: { blockId, note, severity, assignedTo }
 * @access  Private (reports:manage)
 */
export const addFlag = asyncHandler(async (req, res) => {
  const { blockId, note, severity, assignedTo } = req.body || {};
  if (!note) { res.status(400); throw new Error('A flag note is required'); }

  const instance = await findOwned(req);
  if (instance.review?.status === 'approved') { res.status(409); throw new Error('Approved reports are locked'); }

  const flag = {
    id: crypto.randomUUID(), blockId, note, severity: severity || 'warn',
    assignedTo: assignedTo || undefined, status: 'open', createdBy: req.user._id, createdAt: new Date(),
  };
  instance.flags.push(flag);
  await instance.save();

  if (assignedTo) {
    await createNotification({
      organization: req.user.organization,
      recipient: assignedTo,
      type: 'report_flag_raised',
      title: 'A report value was flagged for you',
      message: `${instance.title || 'A report'}: ${note}`,
      actionUrl: `/reports/generated/${instance._id}/review`,
      relatedEntity: relatedEntity(instance),
      actor: req.user._id,
    });
  }

  res.status(201).json({ success: true, data: instance, message: 'Flag added' });
});

/**
 * @desc    Resolve a flag
 * @route   PATCH /api/reports/instances/:id/flags/:flagId
 * @access  Private (reports:manage)
 */
export const resolveFlag = asyncHandler(async (req, res) => {
  const instance = await findOwned(req);
  const flag = instance.flags.find((f) => f.id === req.params.flagId);
  if (!flag) { res.status(404); throw new Error('Flag not found'); }
  flag.status = 'resolved';
  flag.resolvedAt = new Date();
  await instance.save();
  res.json({ success: true, data: instance, message: 'Flag resolved' });
});
