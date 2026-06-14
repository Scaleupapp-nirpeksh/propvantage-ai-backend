// File: controllers/publicReportController.js
// Description: Unauthenticated endpoints that serve a frozen report behind an
// email gate and log viewers for open-rate tracking.

import crypto from 'crypto';
import asyncHandler from 'express-async-handler';
import ReportInstance from '../models/reportInstanceModel.js';
import ReportView from '../models/reportViewModel.js';
import ReportOtp from '../models/reportOtpModel.js';
import { getBlock } from '../services/reports/blockRegistry.js';
import { classifyViewer, computeInstanceStats, pickRecipientByToken } from '../services/reports/viewTracking.js';
import { applyOverrides } from '../services/reports/reviewState.js';
import { generateOtp, hashOtp, verifyOtp } from '../services/reports/otp.js';
import { sendEmail } from '../utils/emailService.js';

const hashIp = (ip) => crypto.createHash('sha256').update(String(ip || 'unknown')).digest('hex');

const isExpired = (instance) => instance.expiresAt && instance.expiresAt.getTime() < Date.now();

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
 * @desc    Public: request a one-time code for an email_otp-gated report
 * @route   POST /api/public/reports/:slug/request-otp   body: { email }
 * @access  Public
 */
export const requestOtp = asyncHandler(async (req, res) => {
  const { email } = req.body || {};
  const instance = await ReportInstance.findOne({ publicSlug: req.params.slug });
  // Never reveal whether a slug exists / is approved; respond 200 regardless.
  if (!instance || instance.review?.status !== 'approved' || isExpired(instance)) {
    return res.json({ success: true, data: { sent: true } });
  }
  if ((instance.gate || 'email') !== 'email_otp') {
    return res.json({ success: true, data: { otpRequired: false } });
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email))) {
    res.status(400); throw new Error('A valid email is required');
  }
  const normEmail = String(email).toLowerCase().trim();
  const code = generateOtp();
  await ReportOtp.findOneAndUpdate(
    { reportInstance: instance._id, email: normEmail },
    { $set: { organization: instance.organization, codeHash: hashOtp(code), expiresAt: new Date(Date.now() + 10 * 60 * 1000), attempts: 0 } },
    { upsert: true, setDefaultsOnInsert: true }
  );
  try {
    await sendEmail({
      to: normEmail,
      subject: `Your code to view "${instance.title || 'the report'}"`,
      html: `<p>Your one-time code is <b style="font-size:20px;letter-spacing:2px">${code}</b>.</p><p>It expires in 10 minutes.</p>`,
      text: `Your one-time code is ${code}. It expires in 10 minutes.`,
    });
  } catch (err) { /* best-effort; still 200 so we don't leak send failures */ }
  res.json({ success: true, data: { sent: true } });
});

/**
 * @desc    Public: pass the email gate, log the view, return the frozen snapshot
 * @route   POST /api/public/reports/:slug/access   body: { email }
 * @access  Public
 */
export const accessPublicReport = asyncHandler(async (req, res) => {
  const instance = await ReportInstance.findOne({ publicSlug: req.params.slug });
  if (!instance) { res.status(404); throw new Error('Report not found'); }
  if (isExpired(instance)) { res.status(410); throw new Error('This report link has expired'); }
  if (instance.review?.status !== 'approved') { res.status(404); throw new Error('Report not found'); }

  const { email, token } = req.body || {};
  const recipients = (instance.distribution?.recipients || []);

  let normEmail, matchedRecipient, isForwarded;
  if (token) {
    const recipient = pickRecipientByToken(recipients, token);
    if (!recipient) { res.status(401); throw new Error('This report link is invalid'); }
    normEmail = String(recipient.email || '').toLowerCase().trim();
    matchedRecipient = true;
    isForwarded = false;
  } else {
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email))) {
      res.status(400); throw new Error('A valid email is required to view this report');
    }
    normEmail = String(email).toLowerCase().trim();
    const recipientEmails = recipients.map((r) => r.email);
    ({ matchedRecipient, isForwarded } = classifyViewer(normEmail, recipientEmails));
  }

  if ((instance.gate || 'email') === 'email_otp' && !token) {
    const { otp } = req.body || {};
    const otpDoc = await ReportOtp.findOne({ reportInstance: instance._id, email: normEmail });
    const ok = otpDoc && otpDoc.expiresAt > new Date() && (otpDoc.attempts || 0) < 6 && verifyOtp(otp, otpDoc.codeHash);
    if (!ok) {
      if (otpDoc) { otpDoc.attempts = (otpDoc.attempts || 0) + 1; await otpDoc.save(); }
      res.status(401); throw new Error('Invalid or expired code');
    }
    await ReportOtp.deleteOne({ _id: otpDoc._id }); // consume on success
  }

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
