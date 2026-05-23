// File: middleware/aiRateLimit.js
// Description: SP5 — gates every AI-spending route (insights, copilot)
//   against per-org daily + hourly quotas. Daily counter is persisted in
//   AIUsageMeter; hourly burst counter is in-process (single PM2 worker
//   on the EC2 deploy — acceptable per the plan's explanation).
//
//   On 429, increments AIUsageMeter.rateLimitHits and returns:
//     { error: 'ai_quota_exceeded',
//       message: 'Daily AI quota reached (200). Resets at midnight IST.',
//       resetsAt: '<ISO datetime>',
//       meter: { dailyUsed, dailyQuota } }

import asyncHandler from 'express-async-handler';
import Organization from '../models/organizationModel.js';
import AIUsageMeter from '../models/aiUsageMeterModel.js';
import { getOrgQuota } from '../config/aiQuotas.js';
import {
  currentDailyPeriodKey,
  currentMonthKey,
  currentHourKey,
  nextMidnightIst,
  incrementMeter,
} from '../services/ai/aiUsageMeterService.js';

// In-process hourly burst counter. Single PM2 worker on EC2 → process-local
// is sufficient. If the deploy ever moves to cluster mode, swap to Redis or
// a Mongo sentinel collection.
const _hourly = new Map(); // key: `${cpOrgId}|${hourKey}` → count
// Tiny GC so the Map doesn't grow forever — purge entries older than 2 hours.
setInterval(() => {
  const cur = currentHourKey();
  for (const k of _hourly.keys()) {
    const hk = k.split('|')[1];
    if (hk < cur) _hourly.delete(k);
  }
}, 30 * 60 * 1000);

export const aiRateLimit = asyncHandler(async (req, res, next) => {
  const userOrgId = req.user?.organization;
  if (!userOrgId) {
    res.status(401);
    throw new Error('Authentication required for AI endpoints');
  }

  // Load org for quota lookup (req.organization may be pre-populated by
  // requireOrgType middleware; reuse to avoid a redundant query).
  const org = req.organization && req.organization._id
    ? req.organization
    : await Organization.findById(userOrgId).select('aiQuota type');
  if (!org) {
    res.status(404);
    throw new Error('Organization not found');
  }

  const quota = getOrgQuota(org);
  const periodKey = currentDailyPeriodKey();
  const monthKey = currentMonthKey();
  const hourKey = currentHourKey();

  // Upsert today's meter and read the latest counters in one round-trip.
  const meter = await AIUsageMeter.findOneAndUpdate(
    { cpOrgId: userOrgId, periodKey },
    { $setOnInsert: { cpOrgId: userOrgId, periodKey, monthKey } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  const dailyUsed = (meter.scheduledGenerations || 0)
                  + (meter.onDemandGenerations || 0)
                  + (meter.copilotMessages || 0);

  if (dailyUsed >= quota.dailyQuota) {
    await incrementMeter(userOrgId, 'rate_limit_hit', null);
    res.status(429);
    return res.json({
      error: 'ai_quota_exceeded',
      message: `Daily AI quota reached (${quota.dailyQuota}). Resets at midnight IST.`,
      resetsAt: nextMidnightIst().toISOString(),
      meter: { dailyUsed, dailyQuota: quota.dailyQuota },
    });
  }

  // Hourly burst check.
  const hourMapKey = `${userOrgId}|${hourKey}`;
  const hourUsed = _hourly.get(hourMapKey) || 0;
  if (hourUsed >= quota.hourlyQuota) {
    await incrementMeter(userOrgId, 'rate_limit_hit', null);
    res.status(429);
    return res.json({
      error: 'ai_quota_exceeded',
      message: `Hourly AI quota reached (${quota.hourlyQuota}). Try again in the next hour.`,
      resetsAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      meter: { hourlyUsed: hourUsed, hourlyQuota: quota.hourlyQuota, dailyUsed, dailyQuota: quota.dailyQuota },
    });
  }

  // Optimistically bump the hourly counter before the route runs. (Worst case:
  // the route fails and we slightly over-count — preferable to under-counting.)
  _hourly.set(hourMapKey, hourUsed + 1);
  next();
});

export default aiRateLimit;
