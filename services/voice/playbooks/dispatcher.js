// File: services/voice/playbooks/dispatcher.js
// Description: Drains due CallJobs. Re-checks every guardrail at dial time —
//   playbook/agent enabled, audience, calling window, recent human contact,
//   org-wide cooldown, budget — then places the call through callService.
//   No-answers reschedule themselves (handled at end-of-call in callService).

import CallJob from '../../../models/callJobModel.js';
import CallPlaybook from '../../../models/callPlaybookModel.js';
import CallSession from '../../../models/callSessionModel.js';
import Interaction from '../../../models/interactionModel.js';
import Lead from '../../../models/leadModel.js';
import Organization from '../../../models/organizationModel.js';
import { effectiveWindow, isWithinWindow, nextWindowOpen, inCooldown } from './mission.js';
import { leadMatchesAudience } from './triggerScanner.js';

const H = 3600000;
const D = 86400000;

async function finish(job, status, reason) {
  job.status = status;
  job.reason = reason || '';
  await job.save();
}

/** Last time this lead was actually reached by an AI call (conversation held). */
export async function lastReachedAt(orgId, leadId) {
  const s = await CallSession.findOne({ organization: orgId, lead: leadId, status: 'ended', durationSec: { $gt: 15 } })
    .sort({ endedAt: -1 }).select('endedAt').lean();
  return s?.endedAt || null;
}

/**
 * Evaluate one job. Returns { action: 'called'|'rescheduled'|'skipped'|'cancelled'|'failed', reason? }.
 * `startCall` is injected for testability.
 */
export async function processJob(job, { now = new Date(), startCall } = {}) {
  const playbook = await CallPlaybook.findById(job.playbook);
  if (!playbook || !playbook.enabled) { await finish(job, 'cancelled', 'playbook disabled or deleted'); return { action: 'cancelled' }; }
  const org = await Organization.findById(job.organization).select('name voiceAgent');
  if (!org?.voiceAgent?.enabled) { await finish(job, 'skipped', 'voice agent switched off'); return { action: 'skipped', reason: 'agent off' }; }
  const lead = await Lead.findById(job.lead).select('project status score phone doNotCall');
  if (!lead || !lead.phone) { await finish(job, 'skipped', 'lead missing or has no phone'); return { action: 'skipped', reason: 'no lead/phone' }; }
  if (lead.doNotCall) { await finish(job, 'cancelled', 'lead asked not to be called'); return { action: 'cancelled', reason: 'dnc' }; }
  if (!leadMatchesAudience(lead, playbook.audience)) { await finish(job, 'skipped', 'lead no longer matches the playbook audience'); return { action: 'skipped', reason: 'audience' }; }

  const window = effectiveWindow(playbook, org);
  if (!isWithinWindow(window, now)) {
    job.scheduledFor = nextWindowOpen(window, now);
    await job.save();
    return { action: 'rescheduled', reason: 'outside window' };
  }

  const humanHours = Number(playbook.audience?.skipIfHumanContactHours ?? 0);
  if (humanHours > 0) {
    const recent = await Interaction.exists({ lead: lead._id, aiGenerated: { $ne: true }, createdAt: { $gte: new Date(now.getTime() - humanHours * H) } });
    if (recent) { await finish(job, 'skipped', `a person contacted this lead in the last ${humanHours}h`); return { action: 'skipped', reason: 'human contact' }; }
  }

  const cooldownDays = playbook.timing?.overrideOrgGuardrails ? 0 : Number(org.voiceAgent?.cooldownDays ?? 3);
  if (cooldownDays > 0 && inCooldown(await lastReachedAt(org._id, lead._id), cooldownDays, now)) {
    await finish(job, 'skipped', `already reached by an AI call in the last ${cooldownDays} days`);
    return { action: 'skipped', reason: 'cooldown' };
  }

  const active = await CallSession.exists({ lead: lead._id, status: { $in: ['queued', 'ringing', 'in-progress'] } });
  if (active) { job.scheduledFor = new Date(now.getTime() + 30 * 60000); await job.save(); return { action: 'rescheduled', reason: 'call in progress' }; }

  // Claim atomically (single dispatcher today; safe if a second one ever runs).
  const claimed = await CallJob.findOneAndUpdate({ _id: job._id, status: 'scheduled' }, { $set: { status: 'calling' }, $inc: { attempts: 1 } }, { new: true });
  if (!claimed) return { action: 'skipped', reason: 'already claimed' };

  try {
    const session = await startCall({ orgId: org._id, leadId: lead._id, playbook, callJob: claimed, trigger: 'playbook', callReason: playbook.objective?.purpose, extraVars: claimed.context || {} });
    claimed.lastSession = session._id;
    await claimed.save();
    return { action: 'called' };
  } catch (err) {
    const retry = claimed.attempts < (claimed.maxAttempts || 1);
    claimed.status = retry ? 'scheduled' : 'failed';
    claimed.reason = err.message;
    if (retry) claimed.scheduledFor = new Date(now.getTime() + Math.max(1, playbook.timing?.retry?.afterHours || 4) * H);
    await claimed.save();
    return { action: 'failed', reason: err.message };
  }
}

/** Drain due jobs (oldest first). Returns a tally. */
export async function dispatchDueJobs({ now = new Date(), startCall, limit = 25 } = {}) {
  const due = await CallJob.find({ status: 'scheduled', scheduledFor: { $lte: now } }).sort({ scheduledFor: 1 }).limit(limit);
  const tally = { due: due.length, called: 0, rescheduled: 0, skipped: 0, cancelled: 0, failed: 0 };
  for (const job of due) {
    try {
      const r = await processJob(job, { now, startCall });
      tally[r.action] = (tally[r.action] || 0) + 1;
    } catch (err) {
      console.error(`❌ [voice/dispatch] job ${job._id} threw:`, err.message);
      tally.failed += 1;
    }
  }
  if (tally.due) console.log(`📞 [voice/dispatch] ${JSON.stringify(tally)}`);
  return tally;
}

/** Cancel every scheduled job older than 14 days that never dialled (hygiene). */
export async function expireStaleJobs(now = new Date()) {
  const r = await CallJob.updateMany({ status: 'scheduled', createdAt: { $lt: new Date(now.getTime() - 14 * D) } }, { $set: { status: 'cancelled', reason: 'expired' } });
  return r.modifiedCount || 0;
}
