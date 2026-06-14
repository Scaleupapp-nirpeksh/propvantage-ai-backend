// File: controllers/publicReportController.js
// Description: Unauthenticated endpoints that serve a frozen report behind an
// email gate and log viewers for open-rate tracking.

import crypto from 'crypto';
import asyncHandler from 'express-async-handler';
import ReportInstance from '../models/reportInstanceModel.js';
import ReportView from '../models/reportViewModel.js';
import { getBlock } from '../services/reports/blockRegistry.js';
import { classifyViewer, computeInstanceStats } from '../services/reports/viewTracking.js';
import { applyOverrides } from '../services/reports/reviewState.js';

const hashIp = (ip) => crypto.createHash('sha256').update(String(ip || 'unknown')).digest('hex');

const isExpired = (instance) => instance.expiresAt && instance.expiresAt.getTime() < Date.now();

const isPubliclyViewable = (instance) =>
  instance.review?.status === 'approved' && !isExpired(instance);

// Enrich each frozen block with its rendering `kind` from the registry (the public
// page has no block catalog). Strips nothing; just adds `kind`.
const withKind = (blocks = []) =>
  blocks.map((b) => {
    const plain = typeof b.toObject === 'function' ? b.toObject() : b;
    return { ...plain, kind: getBlock(plain.type)?.kind || null };
  });

/**
 * @desc    Public: fetch report meta + gate type (no data until the gate is passed)
 * @route   GET /api/public/reports/:slug
 * @access  Public
 */
export const getPublicReportMeta = asyncHandler(async (req, res) => {
  const instance = await ReportInstance.findOne({ publicSlug: req.params.slug });
  if (!instance) { res.status(404); throw new Error('Report not found'); }
  if (isExpired(instance)) { res.status(410); throw new Error('This report link has expired'); }
  if (instance.review?.status !== 'approved') { res.status(404); throw new Error('Report not found'); }

  res.json({
    success: true,
    data: {
      title: instance.title,
      periodLabel: instance.periodLabel,
      gate: instance.gate || 'email',
      theme: instance.theme || {},
    },
  });
});

/**
 * @desc    Public: pass the email gate, log the view, return the frozen snapshot
 * @route   POST /api/public/reports/:slug/access   body: { email }
 * @access  Public
 */
export const accessPublicReport = asyncHandler(async (req, res) => {
  const { email } = req.body || {};
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email))) {
    res.status(400); throw new Error('A valid email is required to view this report');
  }

  const instance = await ReportInstance.findOne({ publicSlug: req.params.slug });
  if (!instance) { res.status(404); throw new Error('Report not found'); }
  if (isExpired(instance)) { res.status(410); throw new Error('This report link has expired'); }
  if (instance.review?.status !== 'approved') { res.status(404); throw new Error('Report not found'); }

  const normEmail = String(email).toLowerCase().trim();
  const recipientEmails = (instance.distribution?.recipients || []).map((r) => r.email);
  const { matchedRecipient, isForwarded } = classifyViewer(normEmail, recipientEmails);
  const now = new Date();

  // Upsert one ReportView per (instance, email); increment viewCount on repeats.
  await ReportView.findOneAndUpdate(
    { reportInstance: instance._id, email: normEmail },
    {
      $setOnInsert: {
        organization: instance.organization,
        reportInstance: instance._id,
        publicSlug: instance.publicSlug,
        email: normEmail,
        matchedRecipient,
        isForwarded,
        firstViewedAt: now,
      },
      $set: { lastViewedAt: now, ipHash: hashIp(req.ip), userAgent: req.get('User-Agent') || '' },
      $inc: { viewCount: 1 },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  // Recompute denormalized stats from all views (low volume; correctness over cleverness).
  const views = await ReportView.find({ reportInstance: instance._id }).lean();
  instance.stats = computeInstanceStats(views);
  await instance.save();

  res.json({
    success: true,
    data: {
      title: instance.title,
      periodLabel: instance.periodLabel,
      theme: instance.theme || {},
      images: instance.images || [],
      blocks: applyOverrides(withKind(instance.blocks), instance.overrides || []),
    },
  });
});
