// File: controllers/cpAiUsageController.js
// Description: SP5 — GET /api/cp/ai/usage. Returns the current day's meter
//   plus the org's effective quota plus the next reset time. Frontend
//   AIQuotaIndicator polls this every 5 minutes.

import asyncHandler from 'express-async-handler';
import Organization from '../models/organizationModel.js';
import AIUsageMeter from '../models/aiUsageMeterModel.js';
import { getOrgQuota } from '../config/aiQuotas.js';
import {
  currentDailyPeriodKey,
  currentMonthKey,
  nextMidnightIst,
} from '../services/ai/aiUsageMeterService.js';

export const getUsage = asyncHandler(async (req, res) => {
  const orgId = req.user.organization;
  const org = req.organization && req.organization._id
    ? req.organization
    : await Organization.findById(orgId).select('aiQuota type');

  const quota = getOrgQuota(org);
  const periodKey = currentDailyPeriodKey();
  const monthKey  = currentMonthKey();

  const meter = await AIUsageMeter.findOneAndUpdate(
    { cpOrgId: orgId, periodKey },
    { $setOnInsert: { cpOrgId: orgId, periodKey, monthKey } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  res.json({
    success: true,
    data: {
      periodKey: meter.periodKey,
      monthKey:  meter.monthKey,
      scheduledGenerations: meter.scheduledGenerations || 0,
      onDemandGenerations:  meter.onDemandGenerations  || 0,
      copilotMessages:      meter.copilotMessages      || 0,
      totalTokensUsed:      meter.totalTokensUsed      || 0,
      totalCostUsd:         meter.totalCostUsd         || 0,
      rateLimitHits:        meter.rateLimitHits        || 0,
      quota,
      resetsAt: nextMidnightIst().toISOString(),
    },
  });
});
