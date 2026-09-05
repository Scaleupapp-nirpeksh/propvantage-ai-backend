// File: controllers/voicePlaybookController.js
// Description: CRUD + operations for call playbooks and the scheduled-call queue.

import asyncHandler from 'express-async-handler';
import mongoose from 'mongoose';
import CallPlaybook, { TRIGGER_TYPES, HANDOVER_CONDITIONS } from '../models/callPlaybookModel.js';
import CallJob from '../models/callJobModel.js';
import CallSession from '../models/callSessionModel.js';
import { V1_TEMPLATES, playbookFromTemplate } from '../services/voice/playbooks/templates.js';
import { describeTrigger, allowedTools } from '../services/voice/playbooks/mission.js';
import { VOICE_ACTION_NAMES } from '../services/voice/agentActions.js';
import { placeTestCall, startOutboundCall } from '../services/voice/callService.js';
import { runScans } from '../services/voice/playbooks/triggerScanner.js';

const V1_TRIGGERS = ['lead.created', 'lead.followUpMissed', 'lead.siteVisitReminder', 'installment.due', 'manual'];

function sanitize(body = {}, existing = {}) {
  const out = {};
  if (typeof body.name === 'string' && body.name.trim()) out.name = body.name.trim().slice(0, 80);
  if (typeof body.description === 'string') out.description = body.description.slice(0, 400);
  if (typeof body.enabled === 'boolean') out.enabled = body.enabled;
  if (body.trigger) {
    const type = body.trigger.type || existing.trigger?.type;
    if (!TRIGGER_TYPES.includes(type)) throw new Error('Unknown trigger type');
    if (!V1_TRIGGERS.includes(type)) throw new Error(`Trigger ${type} is not available yet`);
    out.trigger = { type, params: body.trigger.params && typeof body.trigger.params === 'object' ? body.trigger.params : (existing.trigger?.params || {}) };
  }
  if (body.audience) {
    const a = body.audience;
    out.audience = {
      projects: Array.isArray(a.projects) ? a.projects.filter((id) => mongoose.isValidObjectId(id)) : (existing.audience?.projects || []),
      minScore: a.minScore === null || a.minScore === '' ? null : (Number.isFinite(Number(a.minScore)) ? Number(a.minScore) : existing.audience?.minScore ?? null),
      statuses: Array.isArray(a.statuses) ? a.statuses.map(String) : (existing.audience?.statuses || []),
      skipIfHumanContactHours: Number.isFinite(Number(a.skipIfHumanContactHours)) ? Math.max(0, Number(a.skipIfHumanContactHours)) : (existing.audience?.skipIfHumanContactHours ?? 48),
    };
  }
  if (body.timing) {
    const t = body.timing; const ok = (v) => /^\d{2}:\d{2}$/.test(v || '');
    out.timing = {
      window: { start: ok(t.window?.start) ? t.window.start : (existing.timing?.window?.start || '10:00'), end: ok(t.window?.end) ? t.window.end : (existing.timing?.window?.end || '19:00') },
      delayMinutes: Number.isFinite(Number(t.delayMinutes)) ? Math.max(0, Number(t.delayMinutes)) : (existing.timing?.delayMinutes ?? 2),
      retry: {
        maxAttempts: Math.min(5, Math.max(1, Number(t.retry?.maxAttempts) || existing.timing?.retry?.maxAttempts || 2)),
        afterHours: Math.max(1, Number(t.retry?.afterHours) || existing.timing?.retry?.afterHours || 4),
      },
      overrideOrgGuardrails: Boolean(t.overrideOrgGuardrails),
    };
  }
  if (body.objective) {
    const o = body.objective; const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : undefined);
    out.objective = {
      purpose: str(o.purpose, 2000) ?? existing.objective?.purpose ?? '',
      openingLine: str(o.openingLine, 400) ?? existing.objective?.openingLine ?? '',
      mustAsk: Array.isArray(o.mustAsk) ? o.mustAsk.map(String).filter(Boolean).slice(0, 10) : (existing.objective?.mustAsk || []),
      mustNotSay: Array.isArray(o.mustNotSay) ? o.mustNotSay.map(String).filter(Boolean).slice(0, 10) : (existing.objective?.mustNotSay || []),
      extraInstructions: str(o.extraInstructions, 2000) ?? existing.objective?.extraInstructions ?? '',
    };
  }
  if (Array.isArray(body.tools)) out.tools = body.tools.filter((t) => VOICE_ACTION_NAMES.includes(t));
  if (body.handover) {
    const h = body.handover;
    out.handover = {
      conditions: Array.isArray(h.conditions) ? h.conditions.filter((c) => HANDOVER_CONDITIONS.includes(c)) : (existing.handover?.conditions || []),
      notifyAssigned: typeof h.notifyAssigned === 'boolean' ? h.notifyAssigned : (existing.handover?.notifyAssigned ?? true),
      notifyRoles: Array.isArray(h.notifyRoles) ? h.notifyRoles.map(String).slice(0, 6) : (existing.handover?.notifyRoles || []),
    };
  }
  return out;
}

async function withStats(playbooks, orgId) {
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
  const ids = playbooks.map((p) => p._id);
  const [calls, queued] = await Promise.all([
    CallSession.aggregate([
      { $match: { organization: orgId, playbook: { $in: ids }, createdAt: { $gte: monthStart } } },
      { $group: { _id: '$playbook', calls: { $sum: 1 }, reached: { $sum: { $cond: [{ $gt: ['$durationSec', 15] }, 1, 0] } }, minutes: { $sum: { $divide: ['$durationSec', 60] } } } },
    ]),
    CallJob.aggregate([
      { $match: { organization: orgId, playbook: { $in: ids }, status: 'scheduled' } },
      { $group: { _id: '$playbook', n: { $sum: 1 } } },
    ]),
  ]);
  const cm = Object.fromEntries(calls.map((c) => [String(c._id), c]));
  const qm = Object.fromEntries(queued.map((q) => [String(q._id), q.n]));
  return playbooks.map((p) => {
    const o = p.toObject ? p.toObject() : p;
    const c = cm[String(p._id)] || {};
    return { ...o, triggerLabel: describeTrigger(o.trigger), allowedTools: allowedTools(o), stats: { calls: c.calls || 0, reached: c.reached || 0, minutes: Math.round((c.minutes || 0) * 10) / 10, queued: qm[String(p._id)] || 0 } };
  });
}

/** @route GET /api/voice/playbooks/templates */
export const listTemplates = asyncHandler(async (req, res) => {
  res.json({ success: true, data: V1_TEMPLATES.map((t) => ({ ...t, triggerLabel: describeTrigger(t.trigger) })), tools: VOICE_ACTION_NAMES, handoverConditions: HANDOVER_CONDITIONS });
});

/** @route GET /api/voice/playbooks */
export const listPlaybooks = asyncHandler(async (req, res) => {
  const pbs = await CallPlaybook.find({ organization: req.user.organization }).sort({ createdAt: 1 });
  res.json({ success: true, data: await withStats(pbs, req.user.organization) });
});

/** @route POST /api/voice/playbooks  body: { templateKey } | full body */
export const createPlaybook = asyncHandler(async (req, res) => {
  let body = req.body || {};
  if (body.templateKey) {
    const base = playbookFromTemplate(body.templateKey);
    if (!base) { res.status(400); throw new Error('Unknown template'); }
    body = { ...base, ...body };
  }
  let data;
  try { data = sanitize(body); } catch (err) { res.status(400); throw err; }
  if (!data.name || !data.trigger) { res.status(400); throw new Error('name and trigger are required'); }
  const pb = await CallPlaybook.create({ ...data, templateKey: body.templateKey || null, organization: req.user.organization, createdBy: req.user._id, updatedBy: req.user._id });
  res.status(201).json({ success: true, data: (await withStats([pb], req.user.organization))[0] });
});

/** @route GET /api/voice/playbooks/:id */
export const getPlaybook = asyncHandler(async (req, res) => {
  const pb = await CallPlaybook.findOne({ _id: req.params.id, organization: req.user.organization });
  if (!pb) { res.status(404); throw new Error('Playbook not found'); }
  res.json({ success: true, data: (await withStats([pb], req.user.organization))[0] });
});

/** @route PUT /api/voice/playbooks/:id */
export const updatePlaybook = asyncHandler(async (req, res) => {
  const pb = await CallPlaybook.findOne({ _id: req.params.id, organization: req.user.organization });
  if (!pb) { res.status(404); throw new Error('Playbook not found'); }
  let data;
  try { data = sanitize(req.body, pb.toObject()); } catch (err) { res.status(400); throw err; }
  Object.assign(pb, data, { updatedBy: req.user._id });
  await pb.save();
  res.json({ success: true, data: (await withStats([pb], req.user.organization))[0] });
});

/** @route DELETE /api/voice/playbooks/:id */
export const deletePlaybook = asyncHandler(async (req, res) => {
  const pb = await CallPlaybook.findOne({ _id: req.params.id, organization: req.user.organization });
  if (!pb) { res.status(404); throw new Error('Playbook not found'); }
  await CallJob.updateMany({ playbook: pb._id, status: 'scheduled' }, { $set: { status: 'cancelled', reason: 'playbook deleted' } });
  await pb.deleteOne();
  res.json({ success: true });
});

/** @route POST /api/voice/playbooks/:id/test-call  body: { phone } */
export const testPlaybook = asyncHandler(async (req, res) => {
  const pb = await CallPlaybook.findOne({ _id: req.params.id, organization: req.user.organization });
  if (!pb) { res.status(404); throw new Error('Playbook not found'); }
  const { phone } = req.body || {};
  if (!phone) { res.status(400); throw new Error('phone is required'); }
  try {
    const session = await placeTestCall({ orgId: req.user.organization, userId: req.user._id, phone, playbook: pb });
    res.status(201).json({ success: true, data: session });
  } catch (err) { res.status(400); throw new Error(err.message); }
});

/** @route POST /api/voice/playbooks/scan — run the date-based scans now (admin convenience) */
export const scanNow = asyncHandler(async (req, res) => {
  const r = await runScans();
  res.json({ success: true, data: r });
});

/** @route GET /api/voice/jobs?status=&playbookId=&limit= */
export const listJobs = asyncHandler(async (req, res) => {
  const { status, playbookId, limit } = req.query;
  const q = { organization: req.user.organization };
  if (status) q.status = { $in: String(status).split(',') };
  if (playbookId && mongoose.isValidObjectId(playbookId)) q.playbook = playbookId;
  const jobs = await CallJob.find(q).sort({ scheduledFor: 1 }).limit(Math.min(Number(limit) || 100, 300))
    .populate('lead', 'firstName lastName phone').populate('playbook', 'name').lean();
  res.json({ success: true, data: jobs });
});

/** @route POST /api/voice/jobs/:id/cancel */
export const cancelJob = asyncHandler(async (req, res) => {
  const job = await CallJob.findOne({ _id: req.params.id, organization: req.user.organization });
  if (!job) { res.status(404); throw new Error('Job not found'); }
  if (job.status !== 'scheduled') { res.status(400); throw new Error(`Cannot cancel a job that is ${job.status}`); }
  job.status = 'cancelled'; job.reason = `cancelled by ${req.user.firstName || 'user'}`;
  await job.save();
  res.json({ success: true, data: job });
});

export { startOutboundCall };
