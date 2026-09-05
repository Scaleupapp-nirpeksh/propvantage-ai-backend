// File: services/voice/playbooks/triggerScanner.js
// Description: Turns situations into CallJobs. Two inputs: domain events fired
//   from existing code paths (enqueueForEvent) and an hourly scan for date-based
//   conditions (missed follow-ups, upcoming site visits, instalments falling due).
//   Every job carries a dedup key so a person is called once per occurrence.

import Organization from '../../../models/organizationModel.js';
import Lead from '../../../models/leadModel.js';
import Installment from '../../../models/installmentModel.js';
import CallPlaybook from '../../../models/callPlaybookModel.js';
import CallJob from '../../../models/callJobModel.js';
import { formatInr } from '../agentActions.js';
import { dedup, effectiveWindow, nextWindowOpen } from './mission.js';

const H = 3600000;
const D = 86400000;

function fmtIstDate(d) {
  return new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Kolkata' }).format(new Date(d));
}
function fmtIstDateTime(d) {
  return new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' }).format(new Date(d));
}

/** Audience filter applied at enqueue time (re-checked by the dispatcher). */
export function leadMatchesAudience(lead, audience = {}) {
  if (!lead) return false;
  if (audience.projects?.length && !audience.projects.map(String).includes(String(lead.project?._id || lead.project))) return false;
  if (audience.minScore != null && (lead.score || 0) < audience.minScore) return false;
  if (audience.statuses?.length && !audience.statuses.includes(lead.status)) return false;
  return true;
}

/** Idempotent job creation keyed on (org, dedupKey). Returns the job or null if it already existed. */
export async function upsertJob({ org, playbook, lead, entityType = 'Lead', entityId, dedupKey, scheduledFor, context = {}, createdBy }) {
  const res = await CallJob.updateOne(
    { organization: org._id, dedupKey },
    {
      $setOnInsert: {
        organization: org._id,
        playbook: playbook._id,
        lead: lead._id,
        entityType,
        entityId: entityId || lead._id,
        dedupKey,
        scheduledFor,
        status: 'scheduled',
        attempts: 0,
        maxAttempts: playbook.timing?.retry?.maxAttempts || 2,
        context,
        createdBy: createdBy || undefined,
      },
    },
    { upsert: true }
  );
  return res.upsertedCount ? CallJob.findOne({ organization: org._id, dedupKey }) : null;
}

function scheduleFrom(playbook, org, base = new Date()) {
  const delay = (playbook.timing?.delayMinutes || 0) * 60000;
  return nextWindowOpen(effectiveWindow(playbook, org), new Date(base.getTime() + delay));
}

// ─── Event-driven ─────────────────────────────────────────────────────────

/**
 * Called from existing code paths (e.g. lead created). Returns the number of jobs enqueued.
 * @param {'lead.created'|'sale.postBooking'|'milestone.completed'} type
 */
export async function enqueueForEvent(type, entity, { now = new Date() } = {}) {
  if (type !== 'lead.created') return 0; // phase-2 events wired later
  const lead = await Lead.findById(entity._id || entity).select('organization project status score phone doNotCall');
  if (!lead || !lead.phone || lead.doNotCall) return 0;
  const org = await Organization.findById(lead.organization).select('voiceAgent');
  if (!org?.voiceAgent?.enabled) return 0;
  const playbooks = await CallPlaybook.find({ organization: lead.organization, enabled: true, 'trigger.type': 'lead.created' });
  let n = 0;
  for (const pb of playbooks) {
    if (!leadMatchesAudience(lead, pb.audience)) continue;
    const job = await upsertJob({ org, playbook: pb, lead, dedupKey: `${dedup.leadCreated(lead._id)}:${pb._id}`, scheduledFor: scheduleFrom(pb, org, now) });
    if (job) n += 1;
  }
  return n;
}

/** True when the org has at least one enabled lead.created playbook (used to bypass the legacy auto-call). */
export async function hasLeadCreatedPlaybook(orgId) {
  return Boolean(await CallPlaybook.exists({ organization: orgId, enabled: true, 'trigger.type': 'lead.created' }));
}

// ─── Date-based scans ─────────────────────────────────────────────────────

async function scanFollowUpMissed(org, pb, now) {
  const hoursAfter = Number(pb.trigger?.params?.hoursAfter ?? 24);
  const leads = await Lead.find({
    organization: org._id,
    'followUpSchedule.nextFollowUpDate': { $lt: new Date(now - hoursAfter * H), $gt: new Date(now - 14 * D) },
    status: { $nin: ['Booked', 'Lost'] },
    doNotCall: { $ne: true },
    phone: { $exists: true, $ne: '' },
  }).select('project status score phone followUpSchedule').limit(200).lean();
  let n = 0;
  for (const lead of leads) {
    if (!leadMatchesAudience(lead, pb.audience)) continue;
    const due = lead.followUpSchedule?.nextFollowUpDate;
    const job = await upsertJob({
      org, playbook: pb, lead, dedupKey: `${dedup.followUpMissed(lead._id, due)}:${pb._id}`,
      scheduledFor: scheduleFrom(pb, org, now),
      context: { followUpWas: fmtIstDate(due), followUpNotes: lead.followUpSchedule?.notes || '' },
    });
    if (job) n += 1;
  }
  return n;
}

async function scanSiteVisitReminder(org, pb, now) {
  const hoursBefore = Number(pb.trigger?.params?.hoursBefore ?? 20);
  const leads = await Lead.find({
    organization: org._id,
    'followUpSchedule.followUpType': 'site_visit',
    'followUpSchedule.nextFollowUpDate': { $gt: new Date(now), $lt: new Date(now + (hoursBefore + 6) * H) },
    status: { $nin: ['Booked', 'Lost'] },
    doNotCall: { $ne: true },
    phone: { $exists: true, $ne: '' },
  }).select('project status score phone followUpSchedule').limit(200).lean();
  let n = 0;
  for (const lead of leads) {
    if (!leadMatchesAudience(lead, pb.audience)) continue;
    const visit = new Date(lead.followUpSchedule.nextFollowUpDate);
    const ideal = new Date(visit.getTime() - hoursBefore * H);
    const scheduledFor = nextWindowOpen(effectiveWindow(pb, org), ideal < now ? new Date(now) : ideal);
    if (scheduledFor >= visit) continue; // window pushes us past the visit itself
    const job = await upsertJob({
      org, playbook: pb, lead, dedupKey: `${dedup.siteVisit(lead._id, visit)}:${pb._id}`,
      scheduledFor,
      context: { visitWhen: fmtIstDateTime(visit) },
    });
    if (job) n += 1;
  }
  return n;
}

async function scanInstallmentDue(org, pb, now) {
  const daysBefore = Number(pb.trigger?.params?.daysBefore ?? 3);
  const insts = await Installment.find({
    organization: org._id,
    status: { $in: ['pending', 'due'] },
    currentDueDate: { $gte: new Date(now), $lte: new Date(now + daysBefore * D) },
    pendingAmount: { $gt: 0 },
  }).populate('customer', 'project status score phone doNotCall firstName lastName').select('customer project installmentNumber description currentAmount pendingAmount currentDueDate').limit(300).lean();
  let n = 0;
  for (const inst of insts) {
    const lead = inst.customer;
    if (!lead || !lead.phone || lead.doNotCall) continue;
    if (!leadMatchesAudience({ ...lead, project: inst.project || lead.project }, pb.audience)) continue;
    const job = await upsertJob({
      org, playbook: pb, lead, entityType: 'Installment', entityId: inst._id,
      dedupKey: `${dedup.installmentDue(inst._id)}:${pb._id}`,
      scheduledFor: scheduleFrom(pb, org, now),
      context: {
        installmentLabel: inst.description ? `"${inst.description}"` : `#${inst.installmentNumber}`,
        installmentAmount: formatInr(inst.pendingAmount || inst.currentAmount),
        installmentDue: fmtIstDate(inst.currentDueDate),
      },
    });
    if (job) n += 1;
  }
  return n;
}

const SCANNERS = {
  'lead.followUpMissed': scanFollowUpMissed,
  'lead.siteVisitReminder': scanSiteVisitReminder,
  'installment.due': scanInstallmentDue,
};

/** Run every date-based playbook for every org with the agent enabled. Returns {orgs, jobs}. */
export async function runScans(now = Date.now()) {
  const orgs = await Organization.find({ 'voiceAgent.enabled': true }).select('name voiceAgent');
  let jobs = 0;
  for (const org of orgs) {
    const playbooks = await CallPlaybook.find({ organization: org._id, enabled: true, 'trigger.type': { $in: Object.keys(SCANNERS) } });
    for (const pb of playbooks) {
      try {
        jobs += await SCANNERS[pb.trigger.type](org, pb, now);
      } catch (err) {
        console.error(`❌ [voice/scan] ${pb.trigger.type} for org ${org._id} failed:`, err.message);
      }
    }
  }
  if (jobs) console.log(`📞 [voice/scan] enqueued ${jobs} call job(s) across ${orgs.length} org(s)`);
  return { orgs: orgs.length, jobs };
}
