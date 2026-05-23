// File: services/ai/aiUsageMeterService.js
// Description: SP5 — write side of the AI usage meter. Called immediately
//   after a successful LLM call (or, for the rate-limit middleware, on a
//   429 to bump rateLimitHits). Daily upsert keyed on (cpOrgId, periodKey).
//
//   Period keys are IST date strings ('YYYY-MM-DD') so day boundaries align
//   with the cron schedule (Sunday 22:00 IST etc.).

import AIUsageMeter from '../../models/aiUsageMeterModel.js';

const TZ = process.env.INSIGHT_DEFAULT_TIMEZONE || 'Asia/Kolkata';

const fmt = (date, opts) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: TZ, ...opts }).format(date);

/** 'YYYY-MM-DD' in the configured timezone. */
export const currentDailyPeriodKey = (now = new Date()) =>
  fmt(now, { year: 'numeric', month: '2-digit', day: '2-digit' });

/** 'YYYY-MM' in the configured timezone. */
export const currentMonthKey = (now = new Date()) =>
  currentDailyPeriodKey(now).slice(0, 7);

/** 'YYYY-MM-DD-HH' — hourly key for the burst limiter. */
export const currentHourKey = (now = new Date()) => {
  const day = currentDailyPeriodKey(now);
  const hour = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, hour: '2-digit', hourCycle: 'h23',
  }).format(now);
  return `${day}-${hour}`;
};

/** Next IST midnight as a Date (used in the 429 response body). */
export function nextMidnightIst(now = new Date()) {
  const today = currentDailyPeriodKey(now);
  // Add one day; construct midnight in IST and convert back.
  const [y, m, d] = today.split('-').map(Number);
  // Build a UTC date for tomorrow 00:00 IST (IST = UTC+5:30).
  // tomorrow IST 00:00 = today UTC 18:30.
  const tmrIstMidnightUtc = new Date(Date.UTC(y, m - 1, d, 18, 30, 0));
  return tmrIstMidnightUtc;
}

/**
 * Increment the meter after a successful LLM call (or to bump rateLimitHits).
 *
 * @param {string|ObjectId} cpOrgId
 * @param {'scheduled'|'on_demand'|'copilot'|'rate_limit_hit'} kind
 * @param {{ total?: number, costUsd?: number }} [tokenUsage]
 * @returns {Promise<Object>} the updated meter
 */
export async function incrementMeter(cpOrgId, kind, tokenUsage) {
  const periodKey = currentDailyPeriodKey();
  const monthKey = currentMonthKey();
  const inc = { lastUpdatedAt: new Date() };
  const incOps = {};
  if (kind === 'scheduled')      incOps.scheduledGenerations = 1;
  else if (kind === 'on_demand') incOps.onDemandGenerations  = 1;
  else if (kind === 'copilot')   incOps.copilotMessages      = 1;
  else if (kind === 'rate_limit_hit') incOps.rateLimitHits   = 1;
  if (tokenUsage?.total)   incOps.totalTokensUsed = tokenUsage.total;
  if (tokenUsage?.costUsd) incOps.totalCostUsd    = tokenUsage.costUsd;

  return AIUsageMeter.findOneAndUpdate(
    { cpOrgId, periodKey },
    { $setOnInsert: { monthKey, cpOrgId, periodKey }, $inc: incOps, $set: { lastUpdatedAt: inc.lastUpdatedAt } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
}

export default {
  incrementMeter,
  currentDailyPeriodKey,
  currentMonthKey,
  currentHourKey,
  nextMidnightIst,
};
