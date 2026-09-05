// File: controllers/voiceController.js
// Description: HTTP surface for the AI voice agent — the unauthenticated provider
//   webhook, call placement/listing for leads, org settings, phone-number import,
//   and a self-serve test call.

import asyncHandler from 'express-async-handler';
import Organization from '../models/organizationModel.js';
import Lead from '../models/leadModel.js';
import { verifyVoiceWebhook } from '../services/voice/webhookAuth.js';
import {
  handleProviderMessage,
  startOutboundCall,
  listCallsForLead,
  listRecentCalls,
  monthlyUsage,
  getCall,
  importTwilioNumber,
  placeTestCall,
  ensureAssistant,
} from '../services/voice/callService.js';
import { VOICE_PRESETS } from '../services/voice/assistantBuilder.js';
import { vapiClient } from '../services/voice/vapiClient.js';

/**
 * @route POST /api/voice/webhooks/:provider   (UNAUTHENTICATED — secret-verified)
 */
export const providerWebhook = asyncHandler(async (req, res) => {
  if (req.params.provider !== 'vapi') {
    res.status(404);
    throw new Error('Unknown voice provider');
  }
  if (!verifyVoiceWebhook(req)) {
    res.status(401);
    throw new Error('Invalid webhook secret');
  }
  const message = req.body?.message || req.body || {};
  try {
    const body = await handleProviderMessage(message);
    res.status(200).json(body);
  } catch (err) {
    console.error(`❌ [voice] webhook ${message?.type} failed:`, err.message);
    // Never fail the provider on our own errors: tool calls get an error string,
    // everything else gets a 200 so the provider doesn't retry-storm.
    if (message?.type === 'tool-calls' || message?.type === 'function-call') {
      const calls = Array.isArray(message.toolCallList) ? message.toolCallList : [];
      res.status(200).json({ results: calls.map((c) => ({ toolCallId: c.id, name: c.name, result: 'Error: could not complete that right now.' })) });
    } else {
      res.status(200).json({ ok: false, error: err.message });
    }
  }
});

/** @route POST /api/voice/calls  body: { leadId, callReason? } */
export const createCall = asyncHandler(async (req, res) => {
  const { leadId, callReason, playbookId } = req.body || {};
  if (!leadId) { res.status(400); throw new Error('leadId is required'); }
  const lead = await Lead.findOne({ _id: leadId, organization: req.user.organization }).select('_id project');
  if (!lead) { res.status(404); throw new Error('Lead not found'); }
  try {
    const session = await startOutboundCall({ orgId: req.user.organization, leadId, initiatedBy: req.user._id, trigger: 'manual', callReason, playbookId: playbookId || null });
    res.status(201).json({ success: true, data: session });
  } catch (err) {
    res.status(400);
    throw new Error(err.message);
  }
});

/** @route GET /api/voice/calls?leadId= */
export const listCalls = asyncHandler(async (req, res) => {
  const { leadId, limit } = req.query;
  const data = leadId
    ? await listCallsForLead(req.user.organization, leadId)
    : await listRecentCalls(req.user.organization, limit);
  res.json({ success: true, data });
});

/** @route GET /api/voice/calls/:id */
export const getCallById = asyncHandler(async (req, res) => {
  const data = await getCall(req.user.organization, req.params.id);
  if (!data) { res.status(404); throw new Error('Call not found'); }
  res.json({ success: true, data });
});

/** @route GET /api/voice/settings */
export const getSettings = asyncHandler(async (req, res) => {
  const org = await Organization.findById(req.user.organization).select('voiceAgent name');
  const va = org?.voiceAgent?.toObject?.() || org?.voiceAgent || {};
  const usage = await monthlyUsage(org._id);
  res.json({
    success: true,
    data: {
      ...va,
      usage,
      assistantSynced: Boolean(va.vapiAssistantId),
      configured: vapiClient.isConfigured(),
      phoneNumber: va.phoneNumber || process.env.TWILIO_PHONE_NUMBER || null,
      phoneNumberSource: va.phoneNumberId ? 'org' : (process.env.VAPI_PHONE_NUMBER_ID ? 'env' : (process.env.TWILIO_ACCOUNT_SID ? 'env-twilio' : 'none')),
      voicePresets: VOICE_PRESETS,
    },
  });
});

/** @route PUT /api/voice/settings */
export const updateSettings = asyncHandler(async (req, res) => {
  const org = await Organization.findById(req.user.organization);
  if (!org) { res.status(404); throw new Error('Organization not found'); }
  const b = req.body || {};
  const va = org.voiceAgent?.toObject?.() || org.voiceAgent || {};
  const next = { ...va };
  if (typeof b.enabled === 'boolean') next.enabled = b.enabled;
  if (typeof b.autoCallNewLeads === 'boolean') next.autoCallNewLeads = b.autoCallNewLeads;
  if (typeof b.hindiSwitching === 'boolean') next.hindiSwitching = b.hindiSwitching;
  if (typeof b.agentName === 'string' && b.agentName.trim()) next.agentName = b.agentName.trim().slice(0, 40);
  if (b.callingHours) {
    const ok = (v) => /^\d{2}:\d{2}$/.test(v || '');
    next.callingHours = { start: ok(b.callingHours.start) ? b.callingHours.start : va.callingHours?.start || '09:00', end: ok(b.callingHours.end) ? b.callingHours.end : va.callingHours?.end || '21:00' };
  }
  if (typeof b.monthlyMinuteBudget === 'number' && b.monthlyMinuteBudget >= 0) next.monthlyMinuteBudget = b.monthlyMinuteBudget;
  if (b.voicePreset) {
    const p = VOICE_PRESETS.find((x) => x.key === b.voicePreset);
    if (p) next.voice = { provider: p.provider, voiceId: p.voiceId, model: p.model, language: p.language };
  } else if (b.voice && b.voice.provider && b.voice.voiceId) {
    next.voice = { provider: b.voice.provider, voiceId: b.voice.voiceId, model: b.voice.model || null, language: b.voice.language || null };
  }
  org.voiceAgent = next;
  await org.save();

  // Re-sync the provider assistant so prompt/voice changes take effect immediately.
  let synced = false; let syncError = null;
  if (vapiClient.isConfigured()) {
    try { await ensureAssistant(org); synced = true; } catch (err) { syncError = err.message; }
  }
  res.json({ success: true, data: org.voiceAgent, synced, syncError });
});

/** @route POST /api/voice/setup/phone-number  body: { accountSid, authToken, number } */
export const setupPhoneNumber = asyncHandler(async (req, res) => {
  const { accountSid, authToken, number } = req.body || {};
  const org = await Organization.findById(req.user.organization);
  if (!org) { res.status(404); throw new Error('Organization not found'); }
  const sid = accountSid || process.env.TWILIO_ACCOUNT_SID;
  const token = authToken || process.env.TWILIO_AUTH_TOKEN;
  const num = number || process.env.TWILIO_PHONE_NUMBER;
  if (!sid || !token || !num) { res.status(400); throw new Error('accountSid, authToken and number are required'); }
  try {
    const id = await importTwilioNumber(org, { accountSid: sid, authToken: token, number: num });
    res.json({ success: true, data: { phoneNumberId: id, phoneNumber: org.voiceAgent.phoneNumber } });
  } catch (err) {
    res.status(400);
    throw new Error(err.message);
  }
});

/** @route POST /api/voice/test-call  body: { phone, projectId? } */
export const testCall = asyncHandler(async (req, res) => {
  const { phone, projectId } = req.body || {};
  if (!phone) { res.status(400); throw new Error('phone is required'); }
  try {
    const session = await placeTestCall({ orgId: req.user.organization, userId: req.user._id, phone, projectId });
    res.status(201).json({ success: true, data: session });
  } catch (err) {
    res.status(400);
    throw new Error(err.message);
  }
});
