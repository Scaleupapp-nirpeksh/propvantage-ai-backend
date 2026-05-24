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
 * Also bumps the in-process hourly counter for non-rate-limit kinds — only
 * actual LLM-spending requests count against the hourly burst cap.
 *
 * @param {string|ObjectId} cpOrgId
 * @param {'scheduled'|'on_demand'|'copilot'|'rate_limit_hit'} kind
 * @param {{ total?: number, costUsd?: number }} [tokenUsage]
 * @returns {Promise<Object>} the updated meter
 */
export async function incrementMeter(cpOrgId, kind, tokenUsage) {
  const periodKey = currentDailyPeriodKey();
  const monthKey = currentMonthKey();
  const incOps = {};
  if (kind === 'scheduled')      incOps.scheduledGenerations = 1;
  else if (kind === 'on_demand') incOps.onDemandGenerations  = 1;
  else if (kind === 'copilot')   incOps.copilotMessages      = 1;
  else if (kind === 'rate_limit_hit') incOps.rateLimitHits   = 1;
  if (tokenUsage?.total)   incOps.totalTokensUsed = tokenUsage.total;
  if (tokenUsage?.costUsd) incOps.totalCostUsd    = tokenUsage.costUsd;

  // Bump the hourly burst counter for actual LLM spends. rate_limit_hit is
  // bookkeeping only — don't have it add to the very limit it represents.
  if (kind === 'scheduled' || kind === 'on_demand' || kind === 'copilot') {
    bumpHourly(cpOrgId);
  }

  return AIUsageMeter.findOneAndUpdate(
    { cpOrgId, periodKey },
    { $setOnInsert: { monthKey, cpOrgId, periodKey }, $inc: incOps, $set: { lastUpdatedAt: new Date() } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
}

// ─── Hourly burst counter ─────────────────────────────────────────────────
//
// In-process Map. Single PM2 worker on EC2 → process-local is sufficient.
// If the deploy moves to cluster mode, swap to Redis or a Mongo sentinel.
// The middleware READS via getHourlyCount; only incrementMeter (above) and
// direct callers (cron, debug) write via bumpHourly.

const _hourly = new Map(); // key: `${cpOrgId}|${hourKey}` → count

setInterval(() => {
  const cur = currentHourKey();
  for (const k of _hourly.keys()) {
    if (k.split('|')[1] < cur) _hourly.delete(k);
  }
}, 30 * 60 * 1000).unref?.();

export function bumpHourly(cpOrgId, hourKey = currentHourKey()) {
  const key = `${cpOrgId}|${hourKey}`;
  const cur = _hourly.get(key) || 0;
  _hourly.set(key, cur + 1);
  return cur + 1;
}

export function getHourlyCount(cpOrgId, hourKey = currentHourKey()) {
  return _hourly.get(`${cpOrgId}|${hourKey}`) || 0;
}

export default {
  incrementMeter,
  bumpHourly,
  getHourlyCount,
  currentDailyPeriodKey,
  currentMonthKey,
  currentHourKey,
  nextMidnightIst,
};
