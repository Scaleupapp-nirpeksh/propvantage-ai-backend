// File: services/voice/callService.js
// Description: Orchestrates AI voice calls end to end: ensures the provider
//   assistant + phone number exist for the org, places the outbound call with
//   per-call variables, serves tool calls during the call, and runs the
//   post-call pipeline (Interaction, lead updates, conversation intelligence,
//   scoring, notification, usage meter) when the end-of-call report arrives.

import Organization from '../../models/organizationModel.js';
import Lead from '../../models/leadModel.js';
import Project from '../../models/projectModel.js';
import Unit from '../../models/unitModel.js';
import User from '../../models/userModel.js';
import Interaction from '../../models/interactionModel.js';
import CallSession from '../../models/callSessionModel.js';
import { vapiClient } from './vapiClient.js';
import { buildAssistantConfig, assistantConfigHash } from './assistantBuilder.js';
import { executeVoiceAction, resultToSpeakable, formatInr } from './agentActions.js';
import { normalizeToolCalls, normalizeEndOfCall, mapProviderStatus, outcomeFromEndedReason } from './normalize.js';
import { createNotification } from '../notificationService.js';
import { incrementMeter } from '../ai/aiUsageMeterService.js';
import { addLeadScoreUpdateJob } from '../backgroundJobService.js';

// ─── Config helpers ───────────────────────────────────────────────────────

function publicBaseUrl() {
  return (process.env.VOICE_PUBLIC_BASE_URL || process.env.PUBLIC_API_BASE_URL || 'https://api.prop-vantage.com').replace(/\/+$/, '');
}

function webhookSecret() {
  return (process.env.VAPI_WEBHOOK_SECRET || '').trim();
}

import { istClock, withinCallingHours, normalizePhone, nowIst, timeOfDayIst } from './helpers.js';
export { istClock, withinCallingHours, normalizePhone, nowIst, timeOfDayIst };

async function systemUserId(orgId) {
  const u = await User.findOne({ organization: orgId, isActive: true }).populate('roleRef', 'level isOwnerRole').sort({ 'roleRef.level': 1 }).select('_id');
  return u?._id || null;
}

// ─── Provider setup (assistant + phone number) ────────────────────────────

/**
 * Create or update the provider assistant for an org when its config hash changed.
 * @returns {Promise<string>} assistant id
 */
export async function ensureAssistant(org) {
  const dto = buildAssistantConfig({ org, baseUrl: publicBaseUrl(), secret: webhookSecret() });
  const hash = assistantConfigHash(dto);
  const va = org.voiceAgent || {};
  if (va.vapiAssistantId && va.assistantConfigHash === hash) return va.vapiAssistantId;

  let id = va.vapiAssistantId;
  if (id) {
    try {
      await vapiClient.updateAssistant(id, dto);
    } catch (err) {
      if (err.status === 404) id = null; else throw err;
    }
  }
  if (!id) {
    const created = await vapiClient.createAssistant(dto);
    id = created.id;
  }
  org.voiceAgent = { ...(org.voiceAgent?.toObject?.() || org.voiceAgent || {}), vapiAssistantId: id, assistantConfigHash: hash };
  await org.save();
  console.log(`📞 [voice] assistant synced for org ${org._id}: ${id}`);
  return id;
}

/**
 * Resolve the provider phone number id for outbound calls. Order: org setting →
 * VAPI_PHONE_NUMBER_ID env → import from TWILIO_* env (idempotent by number).
 */
export async function ensurePhoneNumber(org) {
  if (org.voiceAgent?.phoneNumberId) return org.voiceAgent.phoneNumberId;
  const envId = (process.env.VAPI_PHONE_NUMBER_ID || '').trim();
  if (envId) return envId;

  const sid = (process.env.TWILIO_ACCOUNT_SID || '').trim();
  const token = (process.env.TWILIO_AUTH_TOKEN || '').trim();
  const number = normalizePhone(process.env.TWILIO_PHONE_NUMBER || '');
  if (!sid || !token || !number) {
    throw new Error('No phone number configured for the voice agent. Import a Twilio number in Settings → Voice Agent.');
  }
  return importTwilioNumber(org, { accountSid: sid, authToken: token, number });
}

export async function importTwilioNumber(org, { accountSid, authToken, number }) {
  const e164 = normalizePhone(number);
  if (!e164) throw new Error('Phone number must be in international format, e.g. +14155551234');
  let existing = null;
  try {
    const list = await vapiClient.listPhoneNumbers();
    existing = (Array.isArray(list) ? list : []).find((p) => p.number === e164);
  } catch (err) {
    console.warn('⚠️ [voice] could not list provider phone numbers:', err.message);
  }
  const record = existing || (await vapiClient.importTwilioNumber({ number: e164, accountSid, authToken, name: `PropVantage ${org.name}` }));
  org.voiceAgent = { ...(org.voiceAgent?.toObject?.() || org.voiceAgent || {}), phoneNumberId: record.id, phoneNumber: e164 };
  await org.save();
  console.log(`📞 [voice] phone number ready for org ${org._id}: ${e164} (${record.id})`);
  return record.id;
}

// ─── Per-call context ─────────────────────────────────────────────────────

async function inventorySummary(orgId, projectId) {
  if (!projectId) return 'not specified';
  const rows = await Unit.aggregate([
    { $match: { organization: orgId, project: projectId, status: 'available' } },
    { $group: { _id: '$type', count: { $sum: 1 }, min: { $min: '$currentPrice' }, max: { $max: '$currentPrice' }, minFloor: { $min: '$floor' }, maxFloor: { $max: '$floor' } } },
    { $sort: { min: 1 } },
    { $limit: 6 },
  ]);
  if (!rows.length) return 'no units currently marked available in the system';
  return rows
    .map((r) => `${r.count} ${r._id || 'unit'}${r.count > 1 ? 's' : ''} from ${formatInr(r.min)}${r.max && r.max !== r.min ? ` to ${formatInr(r.max)}` : ''}${r.maxFloor != null ? ` (floors ${r.minFloor}–${r.maxFloor})` : ''}`)
    .join('; ');
}

function knownDetails(lead) {
  const bits = [];
  if (lead.budget?.min || lead.budget?.max) bits.push(`budget ${formatInr(lead.budget.min) || '?'}${lead.budget.max ? ` to ${formatInr(lead.budget.max)}` : ''}`);
  if (lead.requirements?.unitType) bits.push(`wants ${lead.requirements.unitType}`);
  if (lead.requirements?.timeline) bits.push(`timeline ${lead.requirements.timeline.replace(/_/g, ' ')}`);
  if (lead.requirements?.floor?.preference && lead.requirements.floor.preference !== 'any') bits.push(`${lead.requirements.floor.preference} floor`);
  if (lead.status && lead.status !== 'New') bits.push(`status ${lead.status}`);
  if (lead.engagementMetrics?.totalInteractions) bits.push(`${lead.engagementMetrics.totalInteractions} previous interactions`);
  return bits.length ? bits.join('; ') : 'nothing beyond the enquiry itself';
}

function todayIst() {
  return new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' }).format(new Date());
}

async function buildVariableValues({ org, lead, session, callReason }) {
  const exec = lead.assignedTo && typeof lead.assignedTo === 'object' ? lead.assignedTo : null;
  const project = lead.project && typeof lead.project === 'object' ? lead.project : null;
  const loc = project?.location;
  const locStr = loc ? [loc.area, loc.city].filter(Boolean).join(', ') || (typeof loc === 'string' ? loc : '') : '';
  return {
    callSessionId: String(session._id),
    leadId: String(lead._id),
    orgId: String(org._id),
    leadFirstName: lead.firstName || 'there',
    leadFullName: `${lead.firstName || ''} ${lead.lastName || ''}`.trim() || 'the customer',
    leadSource: lead.source || 'enquiry',
    projectName: project?.name || 'our project',
    projectLocation: locStr || org.city || '',
    execName: exec ? `${exec.firstName || ''} ${exec.lastName || ''}`.trim() : 'our sales team',
    agentName: org.voiceAgent?.agentName || 'Aanya',
    orgName: org.name,
    knownDetails: knownDetails(lead),
    inventorySummary: await inventorySummary(org._id, project?._id || lead.project),
    callReason: callReason || 'They recently enquired about the project; understand their requirement and offer a site visit.',
    todayIST: todayIst(),
    nowIST: nowIst(),
    timeOfDay: timeOfDayIst(),
  };
}

// ─── Start a call ─────────────────────────────────────────────────────────

/**
 * Place an outbound AI call to a lead.
 * @param {{ orgId, leadId, initiatedBy?, trigger?: 'manual'|'auto_new_lead'|'test', useCase?, callReason?, force?: boolean }} p
 * @returns {Promise<CallSession>}
 */
export async function startOutboundCall({ orgId, leadId, initiatedBy = null, trigger = 'manual', useCase = 'lead_qualification', callReason, force = false }) {
  if (!vapiClient.isConfigured()) throw new Error('Voice calling is not configured on the server (VAPI_API_KEY missing).');
  const org = await Organization.findById(orgId);
  if (!org) throw new Error('Organization not found');
  if (!org.voiceAgent?.enabled && !force) throw new Error('The voice agent is switched off for this organization. Enable it in Settings → Voice Agent.');

  const lead = await Lead.findOne({ _id: leadId, organization: orgId })
    .populate('assignedTo', 'firstName lastName email')
    .populate('project', 'name location');
  if (!lead) throw new Error('Lead not found');
  if (lead.doNotCall) throw new Error('This lead has asked not to be called.');
  const number = normalizePhone(lead.phone);
  if (!number) throw new Error(`Lead phone "${lead.phone}" is not a valid number.`);

  const active = await CallSession.findOne({ lead: lead._id, status: { $in: ['queued', 'ringing', 'in-progress'] } }).select('_id');
  if (active) throw new Error('A call to this lead is already in progress.');

  // Monthly minute budget (best-effort guardrail).
  const budget = org.voiceAgent?.monthlyMinuteBudget ?? 300;
  if (budget > 0) {
    const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
    const [agg] = await CallSession.aggregate([
      { $match: { organization: org._id, createdAt: { $gte: monthStart } } },
      { $group: { _id: null, sec: { $sum: '$durationSec' } } },
    ]);
    if ((agg?.sec || 0) / 60 >= budget) throw new Error(`Monthly voice budget of ${budget} minutes reached.`);
  }

  const assistantId = await ensureAssistant(org);
  const phoneNumberId = await ensurePhoneNumber(org);

  const session = await CallSession.create({
    organization: org._id,
    lead: lead._id,
    project: lead.project?._id || lead.project || undefined,
    assignedUser: lead.assignedTo?._id || undefined,
    initiatedBy: initiatedBy || undefined,
    providerAssistantId: assistantId,
    direction: 'outbound',
    useCase,
    trigger,
    customerNumber: number,
    status: 'queued',
  });

  const variableValues = await buildVariableValues({ org, lead, session, callReason });
  session.variableValues = variableValues;

  try {
    const call = await vapiClient.createCall({
      assistantId,
      phoneNumberId,
      customer: { number, name: variableValues.leadFullName },
      assistantOverrides: {
        variableValues,
        metadata: { callSessionId: String(session._id), leadId: String(lead._id), orgId: String(org._id) },
      },
    });
    session.providerCallId = call.id;
    session.status = mapProviderStatus(call.status) || 'queued';
    await session.save();
    console.log(`📞 [voice] call placed: session ${session._id} → ${number} (provider ${call.id})`);
  } catch (err) {
    session.status = 'failed';
    session.error = err.message;
    session.endedAt = new Date();
    await session.save();
    throw err;
  }
  return session;
}

/**
 * Fire-and-forget auto call for a freshly created lead (called from leadController).
 */
export async function maybeAutoCallNewLead(leadId) {
  try {
    const lead = await Lead.findById(leadId).select('organization phone doNotCall');
    if (!lead || !lead.phone || lead.doNotCall) return;
    const org = await Organization.findById(lead.organization).select('voiceAgent');
    const va = org?.voiceAgent;
    if (!va?.enabled || !va?.autoCallNewLeads) return;
    if (!withinCallingHours(va.callingHours)) {
      console.log(`📞 [voice] auto-call skipped for lead ${leadId}: outside calling hours (${istClock()} IST)`);
      return;
    }
    const delayMs = Number(process.env.VOICE_AUTO_CALL_DELAY_MS || 20000);
    setTimeout(() => {
      startOutboundCall({ orgId: lead.organization, leadId, trigger: 'auto_new_lead' })
        .catch((err) => console.error(`❌ [voice] auto-call failed for lead ${leadId}:`, err.message));
    }, delayMs).unref?.();
  } catch (err) {
    console.error('❌ [voice] maybeAutoCallNewLead:', err.message);
  }
}

// ─── Webhook: tool calls ──────────────────────────────────────────────────

async function resolveSession(message) {
  const callId = message.call?.id;
  let session = callId ? await CallSession.findOne({ provider: 'vapi', providerCallId: callId }) : null;
  if (!session) {
    const sid = message.call?.assistantOverrides?.variableValues?.callSessionId || message.call?.assistantOverrides?.metadata?.callSessionId;
    if (sid) session = await CallSession.findById(sid);
    if (session && callId && !session.providerCallId) { session.providerCallId = callId; await session.save(); }
  }
  return session;
}

export async function handleToolCalls(message) {
  const calls = normalizeToolCalls(message);
  const session = await resolveSession(message);
  if (!session) {
    return { results: calls.map((c) => ({ toolCallId: c.id, name: c.name, result: 'Error: call context not found.' })) };
  }
  const org = await Organization.findById(session.organization);
  const lead = session.lead
    ? await Lead.findById(session.lead).populate('assignedTo', 'firstName lastName').populate('project', 'name')
    : null;
  const ctx = {
    org, lead, session,
    systemUserId: lead?.assignedTo?._id || (await systemUserId(session.organization)),
    actorUserId: lead?.assignedTo?._id || null,
    execName: lead?.assignedTo ? `${lead.assignedTo.firstName || ''} ${lead.assignedTo.lastName || ''}`.trim() : null,
  };
  if (session.status !== 'in-progress') session.status = 'in-progress';

  const results = [];
  for (const c of calls) {
    const r = await executeVoiceAction(c.name, c.args, ctx);
    results.push({ toolCallId: c.id, name: c.name, result: resultToSpeakable(r) });
  }
  try { await session.save(); } catch (err) { console.warn('⚠️ [voice] session save after tool call:', err.message); }
  return { results };
}

// ─── Webhook: status + end of call ────────────────────────────────────────

export async function handleStatusUpdate(message) {
  const session = await resolveSession(message);
  if (!session) return;
  const s = mapProviderStatus(message.status);
  if (s && session.status !== 'ended' && session.status !== 'failed') {
    session.status = s;
    if (s === 'in-progress' && !session.startedAt) session.startedAt = new Date();
    await session.save();
  }
}

function deriveOutcome(session, facts) {
  const tools = new Set((session.actionsTaken || []).map((a) => a.tool));
  if (session.doNotCall || tools.has('mark_do_not_call')) return 'Asked not to be called';
  if (tools.has('schedule_site_visit')) return 'Site visit booked';
  if (tools.has('request_human_callback')) return 'Callback requested';
  if (tools.has('set_follow_up')) return 'Follow-up scheduled';
  if (tools.has('update_lead_qualification')) return 'Qualified on call';
  const sd = facts.structuredData || {};
  const map = {
    qualified: 'Qualified on call', site_visit_booked: 'Site visit booked', follow_up_set: 'Follow-up scheduled',
    callback_requested: 'Callback requested', not_interested: 'Not interested', wrong_number: 'Wrong number', no_conversation: 'No conversation',
  };
  if (sd.outcome && map[sd.outcome]) return map[sd.outcome];
  return outcomeFromEndedReason(facts.endedReason) || (facts.durationSec > 20 ? 'Conversation held' : 'No conversation');
}

export async function handleEndOfCall(message) {
  const facts = normalizeEndOfCall(message);
  const session = await resolveSession(message);
  if (!session) { console.warn('⚠️ [voice] end-of-call for unknown call', facts.providerCallId); return; }
  if (session.status === 'ended' && session.transcript) return; // idempotent

  session.status = 'ended';
  session.endedReason = facts.endedReason;
  if (facts.startedAt) session.startedAt = facts.startedAt;
  session.endedAt = facts.endedAt || new Date();
  session.durationSec = facts.durationSec;
  session.costUsd = facts.costUsd;
  session.transcript = facts.transcript;
  session.messages = facts.messages;
  session.recordingUrl = facts.recordingUrl;
  session.summary = facts.summary;
  session.structuredData = facts.structuredData;
  session.outcome = deriveOutcome(session, facts);
  await session.save();

  // Post-call pipeline — every step best-effort and independent.
  const org = await Organization.findById(session.organization).select('name');
  const lead = session.lead
    ? await Lead.findById(session.lead).populate('assignedTo', 'firstName lastName').populate('project', 'name')
    : null;

  if (lead) {
    const minutes = Math.max(1, Math.round(session.durationSec / 60));
    const summaryText = session.summary || (session.durationSec > 20 ? 'AI call completed.' : 'Call did not connect to a conversation.');
    try {
      const userId = lead.assignedTo?._id || (await systemUserId(session.organization));
      if (userId) {
        const interaction = await Interaction.create({
          lead: lead._id,
          user: userId,
          organization: session.organization,
          type: 'Call',
          direction: 'Outbound',
          content: `[AI call · ${minutes} min · ${session.outcome}] ${summaryText}`,
          outcome: session.outcome,
          nextAction: lead.followUpSchedule?.notes || undefined,
          scheduledAt: lead.followUpSchedule?.nextFollowUpDate || undefined,
        });
        session.interaction = interaction._id;
        lead.engagementMetrics = lead.engagementMetrics || {};
        lead.engagementMetrics.totalInteractions = (lead.engagementMetrics.totalInteractions || 0) + 1;
        lead.engagementMetrics.lastInteractionDate = new Date();
        lead.engagementMetrics.lastInteractionType = 'Call';
        if (typeof lead.updateActivitySummary === 'function') lead.updateActivitySummary('call');
        await lead.save();
      }
    } catch (err) {
      console.error('❌ [voice] interaction write failed:', err.message);
    }

    if (session.transcript && session.transcript.length > 200 && process.env.OPENAI_API_KEY) {
      try {
        const { analyzeConversation } = await import('../aiConversationService.js');
        const analysis = await analyzeConversation(session.transcript, {
          leadName: `${lead.firstName || ''} ${lead.lastName || ''}`.trim(),
          projectName: lead.project?.name,
          budgetRange: lead.budget?.max ? `${formatInr(lead.budget.min)}–${formatInr(lead.budget.max)}` : undefined,
          timeline: lead.requirements?.timeline,
        });
        session.analysis = analysis;
      } catch (err) {
        console.warn('⚠️ [voice] conversation analysis skipped:', err.message);
      }
    }

    try { addLeadScoreUpdateJob(lead._id, { delay: 1000 }); } catch { /* noop */ }

    if (lead.assignedTo?._id) {
      try {
        await createNotification({
          organization: session.organization,
          recipient: lead.assignedTo._id,
          type: 'voice_call_completed',
          title: `AI call · ${lead.firstName || ''} ${lead.lastName || ''} · ${session.outcome}`.trim(),
          message: (session.summary || summaryText).slice(0, 400),
          actionUrl: `/leads/${lead._id}`,
          relatedEntity: { entityType: 'Lead', entityId: lead._id, displayLabel: `${lead.firstName || ''} ${lead.lastName || ''}`.trim() },
          priority: session.handoffRequested ? 'high' : 'medium',
          metadata: { callSessionId: String(session._id), durationSec: session.durationSec },
        });
      } catch (err) {
        console.warn('⚠️ [voice] notification failed:', err.message);
      }
    }
  }

  try {
    await incrementMeter(session.organization, 'voice', { costUsd: session.costUsd, minutes: Math.round((session.durationSec / 60) * 100) / 100 });
  } catch (err) {
    console.warn('⚠️ [voice] usage meter failed:', err.message);
  }

  await session.save();
  console.log(`📞 [voice] call ${session._id} ended: ${session.outcome} (${session.durationSec}s, $${session.costUsd}) org ${org?.name}`);
}

/** Dispatch a provider server message. Returns the HTTP body to send back. */
export async function handleProviderMessage(message) {
  switch (message?.type) {
    case 'tool-calls':
    case 'function-call':
      return handleToolCalls(message);
    case 'end-of-call-report':
      await handleEndOfCall(message);
      return { ok: true };
    case 'status-update':
      await handleStatusUpdate(message);
      return { ok: true };
    default:
      return { ok: true, ignored: message?.type || 'unknown' };
  }
}

// ─── Queries ──────────────────────────────────────────────────────────────

export async function listCallsForLead(orgId, leadId) {
  return CallSession.find({ organization: orgId, lead: leadId })
    .sort({ createdAt: -1 })
    .select('-messages -variableValues')
    .lean();
}

/** Most recent calls across the org (settings page / mini dashboard). */
export async function listRecentCalls(orgId, limit = 25) {
  return CallSession.find({ organization: orgId })
    .sort({ createdAt: -1 })
    .limit(Math.min(Number(limit) || 25, 100))
    .select('lead status outcome trigger durationSec costUsd createdAt endedAt handoffRequested summary recordingUrl')
    .populate('lead', 'firstName lastName phone')
    .lean();
}

/** Calls / minutes / cost for the current calendar month (IST-agnostic, server month). */
export async function monthlyUsage(orgId) {
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
  const [agg] = await CallSession.aggregate([
    { $match: { organization: orgId, createdAt: { $gte: monthStart } } },
    { $group: { _id: null, calls: { $sum: 1 }, sec: { $sum: '$durationSec' }, cost: { $sum: '$costUsd' } } },
  ]);
  return { calls: agg?.calls || 0, minutes: Math.round(((agg?.sec || 0) / 60) * 10) / 10, costUsd: Math.round((agg?.cost || 0) * 100) / 100 };
}

export async function getCall(orgId, id) {
  return CallSession.findOne({ _id: id, organization: orgId })
    .populate('lead', 'firstName lastName phone')
    .populate('assignedUser', 'firstName lastName')
    .lean();
}

/**
 * Find-or-create a test lead for a phone number, then call it.
 */
export async function placeTestCall({ orgId, userId, phone, projectId }) {
  const number = normalizePhone(phone);
  if (!number) throw new Error('Enter the number in international format, e.g. +919876543210');
  const org = await Organization.findById(orgId);
  if (!org) throw new Error('Organization not found');
  let project = projectId ? await Project.findOne({ _id: projectId, organization: orgId }) : null;
  if (!project) project = await Project.findOne({ organization: orgId }).sort({ createdAt: 1 });
  if (!project) throw new Error('Create a project first so the agent has something to talk about.');

  let lead = await Lead.findOne({ organization: orgId, phone: { $in: [number, number.replace('+91', ''), number.replace('+', '')] } }).sort({ createdAt: -1 });
  if (!lead) {
    lead = await Lead.create({
      organization: orgId,
      project: project._id,
      assignedTo: userId,
      firstName: 'Voice',
      lastName: 'Test',
      phone: number,
      source: 'Direct',
      status: 'New',
      statusHistory: [{ status: 'New', changedAt: new Date(), changedBy: userId }],
      score: 0, scoreGrade: 'D', priority: 'Medium', lastScoreUpdate: new Date(),
      engagementMetrics: { totalInteractions: 0, responseRate: 0 },
      notes: 'Created by the voice agent test-call button.',
    });
  } else if (lead.doNotCall) {
    lead.doNotCall = false; await lead.save();
  }
  return startOutboundCall({ orgId, leadId: lead._id, initiatedBy: userId, trigger: 'test', useCase: 'test', force: true });
}
