// File: config/aiQuotas.js
// Description: SP5 — central AI quota configuration. Reads env defaults and
//   exposes a small helper for resolving a per-org quota that prefers
//   Organization.aiQuota overrides (SP5) before falling back to env defaults
//   (and ultimately compile-time defaults). The `plan` field is the SP6
//   monetization hook — all orgs default to 'default' in SP5.

export const DEFAULT_DAILY_QUOTA  = Number(process.env.INSIGHT_DEFAULT_DAILY_QUOTA)  || 200;
export const DEFAULT_HOURLY_QUOTA = Number(process.env.INSIGHT_DEFAULT_HOURLY_QUOTA) || 50;

/**
 * Resolve effective AI quota for an org. Org-level override beats env default.
 * Pass either a populated Organization document/object or a plain shape
 * with an `aiQuota` sub-doc.
 *
 * @param {Object} org
 * @returns {{ dailyQuota: number, hourlyQuota: number, plan: string }}
 */
export function getOrgQuota(org) {
  const q = org?.aiQuota || {};
  return {
    dailyQuota:  Number.isFinite(q.dailyQuota)  ? q.dailyQuota  : DEFAULT_DAILY_QUOTA,
    hourlyQuota: Number.isFinite(q.hourlyQuota) ? q.hourlyQuota : DEFAULT_HOURLY_QUOTA,
    plan:        q.plan || 'default',
  };
}

export default { DEFAULT_DAILY_QUOTA, DEFAULT_HOURLY_QUOTA, getOrgQuota };
