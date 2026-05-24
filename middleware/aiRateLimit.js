// File: middleware/aiRateLimit.js
// Description: SP5 — gates every AI-spending route (insights, copilot)
//   against per-org daily + hourly quotas.
//
//   IMPORTANT: this middleware READS counters but does NOT increment. The
//   only place that increments is the controller's maybeIncrement / explicit
//   incrementMeter call, which fires AFTER we know whether the request
//   actually spent LLM budget (a cache hit on /api/cp/insights/:surface
//   spends zero tokens and must not count against rate limits).
//
//   Previous bug (hotfix 2026-05-24): middleware was optimistically bumping
//   the hourly counter on every request. Loading the 5-card dashboard fired
//   5 GETs (all cache hits) and burned 5/50 hourly. Ten page-loads → 429.

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
  getHourlyCount,
} from '../services/ai/aiUsageMeterService.js';

export const aiRateLimit = asyncHandler(async (req, res, next) => {
  const userOrgId = req.user?.organization;
  if (!userOrgId) {
    res.status(401);
    throw new Error('Authentication required for AI endpoints');
  }

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

  // Read today's meter (upsert if missing so subsequent inc operations work).
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

  // Hourly burst — read-only via the shared aiUsageMeterService Map.
  const hourUsed = getHourlyCount(userOrgId, hourKey);
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

  // Do NOT increment here. The controller bumps via incrementMeter()
  // exactly when LLM tokens were actually spent (cache hits → no bump).
  next();
});

export default aiRateLimit;
