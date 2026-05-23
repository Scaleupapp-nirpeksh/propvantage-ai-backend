// File: jobs/generateScheduledInsights.js
// Description: SP5 — node-cron registration for weekly + monthly digest
//   generation. Iterates active CP orgs (Organization.type='channel_partner'
//   AND active partnership count > 0 OR active prospect count > 0) and
//   calls insightPipeline.getOrGenerateInsight for each. Per-org try/catch
//   so one failure doesn't poison the batch.

import cron from 'node-cron';
import Organization from '../models/organizationModel.js';
import Partnership from '../models/partnershipModel.js';
import Prospect from '../models/prospectModel.js';
import { getOrGenerateInsight } from '../services/ai/insightPipeline.js';

const WEEKLY_CRON  = process.env.INSIGHT_DIGEST_CRON_WEEKLY  || '0 22 * * 0';
const MONTHLY_CRON = process.env.INSIGHT_DIGEST_CRON_MONTHLY || '0 22 1 * *';
const TZ = process.env.INSIGHT_DEFAULT_TIMEZONE || 'Asia/Kolkata';

// systemUser is the actor for cron-driven generations. The pipeline only
// reads user.organization + user.roleRef for narrowing decisions; with
// roleRef.slug='system', no agent-narrowing is applied (the helper checks
// for slug==='cp-agent' only).
function buildSystemUser(cpOrgId) {
  return { _id: null, organization: cpOrgId, roleRef: { slug: 'system' } };
}

async function listEligibleOrgs() {
  const cpOrgs = await Organization.find({ type: 'channel_partner' }).select('_id name').lean();
  if (cpOrgs.length === 0) return [];
  const eligible = [];
  for (const org of cpOrgs) {
    const [activePartnerships, activeProspects] = await Promise.all([
      Partnership.countDocuments({ channelPartnerOrg: org._id, status: 'active' }),
      Prospect.countDocuments({
        organization: org._id,
        status: { $nin: ['Booked', 'Lost', 'Unqualified'] },
      }),
    ]);
    if (activePartnerships > 0 || activeProspects > 0) eligible.push(org);
  }
  return eligible;
}

export async function runForActiveOrgs(surface) {
  const t0 = Date.now();
  const eligible = await listEligibleOrgs();
  const summary = {
    surface,
    totalOrgs: 0,
    eligibleOrgs: eligible.length,
    succeeded: 0,
    failedOrgs: [],
    totalCostUsd: 0,
    totalLatencyMs: 0,
  };
  for (const org of eligible) {
    const tOrg = Date.now();
    try {
      const insight = await getOrGenerateInsight(surface, org._id, buildSystemUser(org._id), {
        forceRegenerate: true,
      });
      summary.succeeded++;
      summary.totalCostUsd += insight?.tokenUsage?.costUsd || 0;
    } catch (err) {
      summary.failedOrgs.push({ orgId: String(org._id), name: org.name, error: err.message });
    }
    summary.totalLatencyMs += Date.now() - tOrg;
  }
  summary.totalLatencyMs = Date.now() - t0;
  summary.totalOrgs = eligible.length;
  console.log(`[generateScheduledInsights:${surface}]`, JSON.stringify(summary));
  return summary;
}

export function registerScheduledInsightJobs() {
  cron.schedule(WEEKLY_CRON, () => {
    runForActiveOrgs('weekly_digest').catch((err) =>
      console.error('[generateScheduledInsights:weekly_digest] fatal:', err.message)
    );
  }, { timezone: TZ });

  cron.schedule(MONTHLY_CRON, () => {
    runForActiveOrgs('monthly_digest').catch((err) =>
      console.error('[generateScheduledInsights:monthly_digest] fatal:', err.message)
    );
  }, { timezone: TZ });

  console.log(`[generateScheduledInsights] cron registered (weekly='${WEEKLY_CRON}', monthly='${MONTHLY_CRON}', tz='${TZ}')`);
}

export default { registerScheduledInsightJobs, runForActiveOrgs };
