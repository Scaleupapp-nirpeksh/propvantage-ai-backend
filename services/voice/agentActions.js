// File: services/voice/agentActions.js
// Description: The write-capable tool set the voice agent can call DURING a call.
//   Every action is scoped to exactly one org + one lead (from the CallSession),
//   never from anything the model sends. Results are returned as short strings
//   the model can speak from; every action is appended to the session's audit
//   trail. Pure helpers (arg normalization) are exported for unit tests.

import mongoose from 'mongoose';
import Unit from '../../models/unitModel.js';
import Task from '../../models/taskModel.js';
import { canTransition } from '../../utils/leadStatusMachine.js';

// ─── Pure helpers ─────────────────────────────────────────────────────────

const TIMELINES = ['immediate', '1-3_months', '3-6_months', '6-12_months', '12+_months'];

/** Map free-text / enum timeline into the Lead.requirements.timeline enum. */
export function normalizeTimeline(v) {
  if (!v) return undefined;
  const s = String(v).toLowerCase().trim();
  if (TIMELINES.includes(s)) return s;
  if (/immediate|asap|right away|now|this month|urgent/.test(s)) return 'immediate';
  if (/12\+|more than a year|over a year|two years|2 years|next year|much later/.test(s)) return '12+_months';
  if (/1\s*-?\s*3|one to three|couple of months|2 months|two months|3 months|three months/.test(s)) return '1-3_months';
  if (/3\s*-?\s*6|three to six|4 months|5 months|6 months|six months|half a year/.test(s)) return '3-6_months';
  if (/6\s*-?\s*12|six to twelve|9 months|within a year|a year|12 months|one year/.test(s)) return '6-12_months';
  return undefined;
}

/** Map floor words into Lead.requirements.floor.preference enum. */
export function normalizeFloorPreference(v) {
  if (!v) return undefined;
  const s = String(v).toLowerCase();
  if (/high|upper|top|penthouse/.test(s)) return 'high';
  if (/mid|middle|medium/.test(s)) return 'medium';
  if (/low|ground|lower/.test(s)) return 'low';
  if (/any|no preference|doesn/.test(s)) return 'any';
  return undefined;
}

/** Format rupees for speech: 24500000 → "₹2.45 Cr", 8500000 → "₹85 L". */
export function formatInr(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return '';
  if (v >= 1e7) return `₹${(v / 1e7).toFixed(v % 1e7 === 0 ? 0 : 2).replace(/\.?0+$/, '')} Cr`;
  if (v >= 1e5) return `₹${(v / 1e5).toFixed(v % 1e5 === 0 ? 0 : 1).replace(/\.?0+$/, '')} L`;
  return `₹${Math.round(v).toLocaleString('en-IN')}`;
}

/**
 * Parse an ISO datetime the model produced. Naive timestamps are treated as IST.
 * Returns null for unparseable or clearly-wrong values (in the past by > 1 day).
 */
export function parseAgentDatetime(v, now = new Date()) {
  if (!v || typeof v !== 'string') return null;
  let s = v.trim();
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(s)) s += '+05:30';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) s += 'T11:00:00+05:30';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  if (d.getTime() < now.getTime() - 24 * 3600 * 1000) return null;
  return d;
}

export function formatIstForSpeech(d) {
  try {
    return new Intl.DateTimeFormat('en-IN', {
      weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata',
    }).format(d);
  } catch {
    return d.toISOString();
  }
}

// ─── Actions ──────────────────────────────────────────────────────────────

async function getAvailableUnits(args, ctx) {
  const { org, lead } = ctx;
  const filter = { organization: org._id, status: 'available' };
  if (lead?.project) filter.project = lead.project._id || lead.project;
  if (args.unit_type) filter.type = { $regex: String(args.unit_type).replace(/\s+/g, '\\s*'), $options: 'i' };
  if (args.max_price_inr) filter.currentPrice = { $lte: Number(args.max_price_inr) };
  if (args.floor_preference && args.floor_preference !== 'any') {
    if (args.floor_preference === 'low') filter.floor = { $lte: 5 };
    else if (args.floor_preference === 'mid') filter.floor = { $gte: 6, $lte: 15 };
    else if (args.floor_preference === 'high') filter.floor = { $gte: 16 };
  }
  const units = await Unit.find(filter)
    .sort({ currentPrice: 1 })
    .limit(30)
    .select('unitNumber type floor areaSqft currentPrice facing tower')
    .populate('tower', 'towerName')
    .lean();

  if (!units.length) {
    return { spoken: 'No units match that right now.', count: 0, units: [] };
  }
  // Group by type for a speakable summary.
  const byType = {};
  for (const u of units) {
    const k = u.type || 'unit';
    byType[k] = byType[k] || { count: 0, min: Infinity, max: 0, floors: new Set(), areas: new Set() };
    byType[k].count += 1;
    byType[k].min = Math.min(byType[k].min, u.currentPrice || Infinity);
    byType[k].max = Math.max(byType[k].max, u.currentPrice || 0);
    if (u.floor != null) byType[k].floors.add(u.floor);
    if (u.areaSqft) byType[k].areas.add(u.areaSqft);
  }
  const parts = Object.entries(byType).map(([t, g]) => {
    const floors = [...g.floors].sort((a, b) => a - b);
    const fl = floors.length ? ` on floors ${floors[0]}${floors.length > 1 ? ` to ${floors[floors.length - 1]}` : ''}` : '';
    const price = g.min === g.max ? formatInr(g.min) : `${formatInr(g.min)} to ${formatInr(g.max)}`;
    return `${g.count} ${t}${g.count > 1 ? 's' : ''}${fl}, priced ${price}`;
  });
  return {
    spoken: `Available: ${parts.join('; ')}.`,
    count: units.length,
    units: units.slice(0, 8).map((u) => ({
      unitNumber: u.unitNumber, type: u.type, floor: u.floor, areaSqft: u.areaSqft,
      price: u.currentPrice, priceSpoken: formatInr(u.currentPrice), facing: u.facing, tower: u.tower?.towerName,
    })),
  };
}

async function updateLeadQualification(args, ctx) {
  const { lead } = ctx;
  if (!lead) return { error: 'No lead on this call.' };
  const changed = [];

  lead.budget = lead.budget || {};
  if (args.budget_min_inr) { lead.budget.min = Number(args.budget_min_inr); changed.push('budget'); }
  if (args.budget_max_inr) { lead.budget.max = Number(args.budget_max_inr); changed.push('budget'); }
  if (args.funding && ['self_funded', 'bank_loan'].includes(args.funding)) lead.budget.budgetSource = args.funding;
  if (args.budget_min_inr || args.budget_max_inr) lead.budget.lastUpdated = new Date();

  lead.requirements = lead.requirements || {};
  if (args.unit_type) { lead.requirements.unitType = String(args.unit_type).toUpperCase().replace(/\s+/g, ''); changed.push('unit type'); }
  const tl = normalizeTimeline(args.timeline);
  if (tl) { lead.requirements.timeline = tl; changed.push('timeline'); }
  const fp = normalizeFloorPreference(args.floor_preference);
  if (fp) { lead.requirements.floor = { ...(lead.requirements.floor || {}), preference: fp }; changed.push('floor'); }
  if (args.facing) { lead.requirements.facing = args.facing; changed.push('facing'); }
  if (args.special_requirements) {
    const prev = lead.requirements.specialRequirements || '';
    lead.requirements.specialRequirements = prev ? `${prev}\n${args.special_requirements}` : args.special_requirements;
    changed.push('requirements');
  }

  const hasBudget = Boolean(lead.budget.max || lead.budget.min);
  const hasTimeline = Boolean(lead.requirements.timeline);
  if (hasBudget && hasTimeline) {
    if (lead.qualificationStatus !== 'Pre-Approved') lead.qualificationStatus = 'Qualified';
    if (lead.status === 'New' && canTransition('New', 'Qualified')) {
      lead.status = 'Qualified';
      lead.statusChangedAt = new Date();
      lead.statusHistory = lead.statusHistory || [];
      lead.statusHistory.push({ status: 'Qualified', changedAt: new Date(), changedBy: ctx.actorUserId || undefined, note: 'Qualified on AI call' });
    }
  } else if (changed.length && lead.qualificationStatus === 'Not Qualified') {
    lead.qualificationStatus = 'In Progress';
  }
  if (args.interest_level) {
    lead.priority = args.interest_level === 'hot' ? 'High' : args.interest_level === 'warm' ? 'Medium' : 'Low';
  }
  await lead.save();
  return { spoken: changed.length ? `Saved ${[...new Set(changed)].join(', ')}.` : 'Nothing new to save.', saved: [...new Set(changed)] };
}

async function scheduleSiteVisit(args, ctx) {
  const { lead, org, session } = ctx;
  if (!lead) return { error: 'No lead on this call.' };
  const when = parseAgentDatetime(args.datetime_iso);
  if (!when) return { error: 'Could not understand the date and time. Ask the caller to confirm the day and time again.' };

  lead.followUpSchedule = {
    ...(lead.followUpSchedule?.toObject?.() || lead.followUpSchedule || {}),
    nextFollowUpDate: when,
    followUpType: 'site_visit',
    notes: args.notes || 'Site visit booked on AI call',
    isOverdue: false,
    overdueBy: 0,
  };
  await lead.save();

  const spokenWhen = formatIstForSpeech(when);
  const leadName = `${lead.firstName || ''} ${lead.lastName || ''}`.trim();
  const assignee = lead.assignedTo?._id || lead.assignedTo || null;
  try {
    const task = await Task.create({
      title: `Site visit — ${leadName} — ${spokenWhen}`.slice(0, 300),
      description: `Booked by the AI voice agent during a call.\n${args.notes || ''}`.trim(),
      category: 'Lead & Sales',
      priority: 'High',
      source: 'internal',
      organization: org._id,
      assignedTo: assignee || undefined,
      assignedBy: assignee || ctx.systemUserId,
      assignmentType: 'system',
      createdBy: assignee || ctx.systemUserId,
      watchers: assignee ? [assignee] : [],
      dueDate: when,
      linkedEntity: { entityType: 'Lead', entityId: lead._id, displayLabel: leadName },
    });
    session?.actionsTaken?.push?.({ tool: 'task_created', args: { taskId: String(task._id) }, result: task.title });
  } catch (err) {
    console.error('❌ [voice] site-visit task creation failed:', err.message);
  }
  return { spoken: `Site visit booked for ${spokenWhen}.`, scheduledAt: when.toISOString() };
}

async function setFollowUp(args, ctx) {
  const { lead, org } = ctx;
  if (!lead) return { error: 'No lead on this call.' };
  const when = parseAgentDatetime(args.datetime_iso);
  if (!when) return { error: 'Could not understand the date and time. Confirm it with the caller.' };
  const method = ['call', 'whatsapp', 'email', 'meeting'].includes(args.method) ? args.method : 'call';
  lead.followUpSchedule = {
    ...(lead.followUpSchedule?.toObject?.() || lead.followUpSchedule || {}),
    nextFollowUpDate: when,
    followUpType: method,
    notes: args.notes || 'Follow-up requested on AI call',
    isOverdue: false,
    overdueBy: 0,
  };
  await lead.save();
  const spokenWhen = formatIstForSpeech(when);
  const leadName = `${lead.firstName || ''} ${lead.lastName || ''}`.trim();
  const assignee = lead.assignedTo?._id || lead.assignedTo || null;
  try {
    await Task.create({
      title: `Follow-up (${method}) — ${leadName} — ${spokenWhen}`.slice(0, 300),
      description: `Requested by the buyer during an AI call.\n${args.notes || ''}`.trim(),
      category: 'Lead & Sales',
      priority: 'Medium',
      source: 'internal',
      organization: org._id,
      assignedTo: assignee || undefined,
      assignedBy: assignee || ctx.systemUserId,
      assignmentType: 'system',
      createdBy: assignee || ctx.systemUserId,
      watchers: assignee ? [assignee] : [],
      dueDate: when,
      linkedEntity: { entityType: 'Lead', entityId: lead._id, displayLabel: leadName },
    });
  } catch (err) {
    console.error('❌ [voice] follow-up task creation failed:', err.message);
  }
  return { spoken: `Follow-up by ${method} set for ${spokenWhen}.`, scheduledAt: when.toISOString(), method };
}

async function requestHumanCallback(args, ctx) {
  const { lead, org, session } = ctx;
  if (!lead) return { error: 'No lead on this call.' };
  if (session) session.handoffRequested = true;
  const leadName = `${lead.firstName || ''} ${lead.lastName || ''}`.trim();
  const assignee = lead.assignedTo?._id || lead.assignedTo || null;
  const due = parseAgentDatetime(args.preferred_time) || new Date(Date.now() + 2 * 3600 * 1000);
  try {
    await Task.create({
      title: `Call back ${leadName} — requested on AI call`.slice(0, 300),
      description: `Reason: ${args.reason || 'buyer asked for a person'}\nPreferred time: ${args.preferred_time || 'not specified'}`,
      category: 'Lead & Sales',
      priority: 'Critical',
      source: 'internal',
      organization: org._id,
      assignedTo: assignee || undefined,
      assignedBy: assignee || ctx.systemUserId,
      assignmentType: 'system',
      createdBy: assignee || ctx.systemUserId,
      watchers: assignee ? [assignee] : [],
      dueDate: due,
      linkedEntity: { entityType: 'Lead', entityId: lead._id, displayLabel: leadName },
    });
  } catch (err) {
    console.error('❌ [voice] callback task creation failed:', err.message);
  }
  const execName = ctx.execName || 'our sales executive';
  return { spoken: `Noted. ${execName} will call back${args.preferred_time ? ` around ${args.preferred_time}` : ' shortly'}.` };
}

async function markDoNotCall(args, ctx) {
  const { lead, session } = ctx;
  if (!lead) return { error: 'No lead on this call.' };
  lead.doNotCall = true;
  const note = `Do-not-call requested on AI call${args.reason ? `: ${args.reason}` : ''} (${new Date().toISOString().slice(0, 10)})`;
  lead.notes = lead.notes ? `${lead.notes}\n${note}` : note;
  await lead.save();
  if (session) session.doNotCall = true;
  return { spoken: 'Understood. We will not call again.' };
}

const ACTIONS = {
  get_available_units: getAvailableUnits,
  update_lead_qualification: updateLeadQualification,
  schedule_site_visit: scheduleSiteVisit,
  set_follow_up: setFollowUp,
  request_human_callback: requestHumanCallback,
  mark_do_not_call: markDoNotCall,
};

export const VOICE_ACTION_NAMES = Object.keys(ACTIONS);

/**
 * Execute one tool call. Never throws — returns { error } on failure so the
 * agent can recover verbally. Appends to session.actionsTaken (caller saves).
 * @param {string} name
 * @param {Object} args
 * @param {{ org, lead, session, systemUserId, actorUserId, execName }} ctx
 */
export async function executeVoiceAction(name, args, ctx) {
  const fn = ACTIONS[name];
  if (!fn) return { error: `Unknown tool ${name}` };
  let result;
  try {
    result = await fn(args || {}, ctx);
  } catch (err) {
    console.error(`❌ [voice] action ${name} failed:`, err.message);
    result = { error: `Could not complete ${name.replace(/_/g, ' ')} right now.` };
  }
  try {
    ctx.session?.actionsTaken?.push?.({ tool: name, args, result, ok: !result?.error });
  } catch { /* audit is best-effort */ }
  return result;
}

/** Render an action result as the short string the provider hands back to the model. */
export function resultToSpeakable(result) {
  if (!result) return 'Done.';
  if (result.error) return `Error: ${result.error}`;
  if (result.spoken && result.units) return `${result.spoken} Details: ${JSON.stringify(result.units)}`;
  if (result.spoken) return result.spoken;
  return JSON.stringify(result);
}

export const _internal = { ACTIONS, mongoose };
