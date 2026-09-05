// File: services/voice/playbooks/mission.js
// Description: Pure helpers that turn a playbook into per-call variables and
//   enforce its guardrails: mission text, opening line, allowed tools, calling
//   windows, cooldown, retry scheduling, dedup keys. No I/O — unit-tested.

import { VOICE_ACTION_NAMES } from '../agentActions.js';

export const HANDOVER_LABELS = {
  asks_for_human: 'the caller asks to speak to a person',
  price_or_discount: 'the caller wants to negotiate price or asks for a discount',
  payment_dispute: 'the caller disputes an amount or a due date',
  legal_or_loan: 'the caller asks about legal, registration, or loan matters',
  complaint: 'the caller raises a complaint',
  hot_buyer: 'the caller is clearly ready to buy and wants a senior conversation',
};

const TOOL_LABELS = {
  get_available_units: 'check live availability and prices',
  update_lead_qualification: 'save what you learn about their requirement',
  schedule_site_visit: 'book a site visit',
  set_follow_up: 'set a follow-up date',
  request_human_callback: 'arrange a callback from {{execName}}',
  mark_do_not_call: 'mark do-not-call',
};

/** Replace {{var}} in a template string from a variables object (unknown vars left intact). */
export function fill(template, vars = {}) {
  return String(template || '').replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (m, k) => (vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : m));
}

/** Tools the playbook allows (empty list = all). */
export function allowedTools(playbook) {
  const list = Array.isArray(playbook?.tools) && playbook.tools.length ? playbook.tools : VOICE_ACTION_NAMES;
  return list.filter((t) => VOICE_ACTION_NAMES.includes(t));
}

export function isToolAllowed(playbook, toolName) {
  return allowedTools(playbook).includes(toolName);
}

/**
 * Build the mission block + opening line for a call. Returns variables that the
 * base assistant prompt references ({{callMission}}, {{openingLine}}).
 */
export function buildMissionVariables(playbook, vars = {}) {
  if (!playbook) {
    return {
      callMission: 'Understand what they are looking for, answer only from live inventory, and offer a site visit.',
      openingLine: fill('Hi, this is {{agentName}} calling from {{projectName}} on behalf of {{execName}}. Am I speaking with {{leadFirstName}}?', vars),
      playbookName: 'New enquiry',
    };
  }
  const o = playbook.objective || {};
  const tools = allowedTools(playbook).map((t) => fill(TOOL_LABELS[t] || t, vars));
  const conds = (playbook.handover?.conditions || []).map((c) => HANDOVER_LABELS[c] || c);
  const lines = [];
  lines.push(`Playbook: ${playbook.name}.`);
  if (o.purpose) lines.push(`Purpose: ${fill(o.purpose, vars)}`);
  if (o.mustAsk?.length) lines.push(`Make sure you learn: ${o.mustAsk.map((q) => fill(q, vars)).join('; ')}.`);
  if (o.mustNotSay?.length) lines.push(`Never discuss or commit to: ${o.mustNotSay.map((q) => fill(q, vars)).join('; ')}.`);
  lines.push(`Actions available on this call: ${tools.join('; ')}. Do not attempt anything else.`);
  if (conds.length) lines.push(`Hand over (use request_human_callback and tell them ${fill('{{execName}}', vars)} will call) when: ${conds.join('; ')}.`);
  if (o.extraInstructions) lines.push(fill(o.extraInstructions, vars));
  return {
    callMission: lines.join('\n'),
    openingLine: fill(o.openingLine || 'Hi, this is {{agentName}} calling from {{projectName}} on behalf of {{execName}}. Am I speaking with {{leadFirstName}}?', vars),
    playbookName: playbook.name,
  };
}

// ─── Time arithmetic (IST) ───────────────────────────────────────────────

const IST_OFFSET_MIN = 330;

function istParts(d) {
  const t = new Date(d.getTime() + IST_OFFSET_MIN * 60000);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth(), day: t.getUTCDate(), h: t.getUTCHours(), min: t.getUTCMinutes() };
}

function istDateAt(y, m, day, hhmm) {
  const [h, min] = String(hhmm || '00:00').split(':').map(Number);
  return new Date(Date.UTC(y, m, day, h, min) - IST_OFFSET_MIN * 60000);
}

/** Intersection of the playbook window and the org hard window (unless overridden). */
export function effectiveWindow(playbook, org) {
  const pw = playbook?.timing?.window || {};
  const hw = org?.voiceAgent?.hardWindow || {};
  const pStart = pw.start || '09:00', pEnd = pw.end || '21:00';
  if (playbook?.timing?.overrideOrgGuardrails) return { start: pStart, end: pEnd };
  const hStart = hw.start || '09:00', hEnd = hw.end || '21:00';
  return { start: pStart > hStart ? pStart : hStart, end: pEnd < hEnd ? pEnd : hEnd };
}

/** Is `now` inside [start, end) IST? */
export function isWithinWindow(window, now = new Date()) {
  const { h, min } = istParts(now);
  const cur = `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
  return cur >= (window.start || '00:00') && cur < (window.end || '24:00');
}

/** Earliest time >= now that falls inside the window (today or tomorrow, IST). */
export function nextWindowOpen(window, now = new Date()) {
  if (isWithinWindow(window, now)) return now;
  const { y, m, day, h, min } = istParts(now);
  const cur = `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
  if (cur < (window.start || '00:00')) return istDateAt(y, m, day, window.start || '00:00');
  return istDateAt(y, m, day + 1, window.start || '00:00');
}

/** Cooldown: the same person was reached by an AI call within `days`. */
export function inCooldown(lastReachedAt, days, now = new Date()) {
  if (!lastReachedAt || !days) return false;
  return now.getTime() - new Date(lastReachedAt).getTime() < days * 86400000;
}

/** When to retry after a no-answer, clamped into the calling window. */
export function retryAt(afterHours, window, now = new Date()) {
  const t = new Date(now.getTime() + Math.max(1, Number(afterHours) || 4) * 3600000);
  return nextWindowOpen(window, t);
}

/** Dedup keys — one call per person per occurrence. */
export const dedup = {
  leadCreated: (leadId) => `created:${leadId}`,
  followUpMissed: (leadId, dueAt) => `fu:${leadId}:${new Date(dueAt).toISOString().slice(0, 16)}`,
  siteVisit: (leadId, visitAt) => `sv:${leadId}:${new Date(visitAt).toISOString().slice(0, 16)}`,
  installmentDue: (installmentId) => `inst:${installmentId}:due`,
  installmentOverdue: (installmentId) => `inst:${installmentId}:overdue`,
  manual: (leadId, playbookId) => `manual:${leadId}:${playbookId}:${Date.now()}`,
};

/** Human-readable trigger summary for the UI. */
export function describeTrigger(trigger = {}) {
  const p = trigger.params || {};
  switch (trigger.type) {
    case 'lead.created': return 'When a new lead is created';
    case 'lead.followUpMissed': return `When a follow-up is ${p.hoursAfter ?? 24}h overdue`;
    case 'lead.siteVisitReminder': return `${p.hoursBefore ?? 20}h before a scheduled site visit`;
    case 'installment.due': return `${p.daysBefore ?? 3} days before an instalment is due`;
    case 'installment.overdue': return `${p.daysAfter ?? 2} days after an instalment is overdue`;
    case 'sale.postBooking': return `${p.daysAfter ?? 7} days after booking`;
    case 'milestone.completed': return 'When a construction milestone completes';
    case 'lead.stale': return `After ${p.daysSilent ?? 30} days without contact`;
    case 'manual': return 'On demand only';
    default: return trigger.type || '';
  }
}
