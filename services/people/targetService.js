// File: services/people/targetService.js
// Description: Per-user monthly targets + attainment for the People & Performance
//   module (spec §9). Three public exports:
//
//   getOrSeedTarget(orgId, userId, periodStart) → TargetDoc
//     Returns the existing monthly target; if none exists, seeds one from the
//     role template (source:'template') based on the target user's role.
//
//   setTarget(actor, userId, periodStart, targets) → TargetDoc
//     Upserts a target with source:'manual', setBy:actor._id. Subtree-guarded:
//     actor must be ABOVE the target user (scope==='org' OR userId is in
//     actor's subtree userIds). Throws an authorization error otherwise.
//
//   computeAttainment(metrics, target) → Record<metric, {actual, target, pct}>
//     Maps each tracked metric key to its attainment. pct = actual/target as
//     a 0..1+ number; when target value is 0/null/undefined, pct = null
//     (no divide-by-zero).

import mongoose from 'mongoose';
import PerformanceTarget from '../../models/performanceTargetModel.js';
import User from '../../models/userModel.js';
import { getSubtree } from './hierarchyService.js';
import { getTemplateForRole } from '../../config/performanceTargetTemplates.js';

// ─── HELPERS ─────────────────────────────────────────────────────

function toObjectId(id) {
  if (id instanceof mongoose.Types.ObjectId) return id;
  return new mongoose.Types.ObjectId(String(id));
}

// ─── ATTAINMENT METRIC KEYS ───────────────────────────────────────
// The subset of metric keys that have corresponding target fields.
const ATTAINMENT_KEYS = ['salesCount', 'salesValue', 'leadsWorked', 'conversions', 'taskSlaRate'];

// ─── getOrSeedTarget ─────────────────────────────────────────────
/**
 * Return the user's monthly PerformanceTarget for the given period.
 * If no target document exists yet, create one from the role template
 * (source:'template', setBy:null).
 *
 * @param {mongoose.Types.ObjectId|string} orgId
 * @param {mongoose.Types.ObjectId|string} userId
 * @param {Date} periodStart - first day of the month (normalized to midnight UTC)
 * @returns {Promise<object>} PerformanceTarget document
 */
export async function getOrSeedTarget(orgId, userId, periodStart) {
  const org = toObjectId(orgId);
  const uid = toObjectId(userId);

  // Fast path: existing target
  const existing = await PerformanceTarget.findOne({
    organization: org,
    user: uid,
    periodStart,
  });
  if (existing) return existing;

  // Fetch the target user's role to pick the right template
  const targetUser = await User.findById(uid).lean();
  const role = targetUser?.role ?? null;
  const templateTargets = getTemplateForRole(role);

  return PerformanceTarget.create({
    organization: org,
    user: uid,
    period: 'month',
    periodStart,
    targets: templateTargets,
    setBy: null,
    source: 'template',
  });
}

// ─── setTarget ───────────────────────────────────────────────────
/**
 * Upsert a monthly target for a user, overriding any previously seeded values.
 * Subtree-guarded: the actor must be strictly above the target user, i.e.
 *   scope === 'org'  (actor is the owner — unrestricted)
 *   OR userId is in actor's getSubtree().userIds (actor is the user's Head)
 *
 * @param {object} actor - authenticated user doc (must have _id, organization)
 * @param {mongoose.Types.ObjectId|string} userId - target user id
 * @param {Date} periodStart
 * @param {object} targets - plain targets object (salesCount, salesValue, …)
 * @returns {Promise<object>} upserted PerformanceTarget document
 * @throws {Error} 403 authorization error when actor is not above the target user
 */
export async function setTarget(actor, userId, periodStart, targets) {
  const uid = toObjectId(userId);
  const actorId = toObjectId(actor._id);

  // Authorization check: actor must be above the target user
  const subtree = await getSubtree(actor);

  const isAuthorized =
    subtree.scope === 'org' ||
    subtree.userIds.some((id) => id.equals(uid));

  if (!isAuthorized) {
    const err = new Error('Not authorized: actor is not above the target user in the hierarchy');
    err.statusCode = 403;
    throw err;
  }

  return PerformanceTarget.findOneAndUpdate(
    {
      organization: toObjectId(actor.organization),
      user: uid,
      periodStart,
    },
    {
      $set: {
        organization: toObjectId(actor.organization),
        user: uid,
        period: 'month',
        periodStart,
        targets,
        setBy: actorId,
        source: 'manual',
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

// ─── computeAttainment ───────────────────────────────────────────
/**
 * Map each attainment-tracked metric to its actual, target, and pct.
 *
 * pct = actual / target  (a 0..1+ number, where >1 = over target).
 * When the target value is 0, null, or undefined, pct = null to avoid
 * a divide-by-zero — the caller should render this as "N/A" or "—".
 *
 * Only the keys present in ATTAINMENT_KEYS are included in the result.
 * Keys present in metrics but not in targets (and vice-versa) are handled
 * gracefully (treated as 0 / null).
 *
 * @param {object} metrics - output of performanceSignalsService.computeMetrics
 * @param {object} target - PerformanceTarget document (or its .targets sub-doc)
 * @returns {Record<string, {actual: number, target: number|null, pct: number|null}>}
 */
export function computeAttainment(metrics, target) {
  // Accept either a full PerformanceTarget doc or a plain targets object
  const t = target?.targets ?? target ?? {};
  const m = metrics ?? {};

  return Object.fromEntries(
    ATTAINMENT_KEYS.map((key) => {
      const actual = m[key] ?? 0;
      const targetVal = t[key];

      const hasTarget =
        targetVal !== null && targetVal !== undefined && targetVal !== 0;

      const pct = hasTarget ? actual / targetVal : null;

      return [key, { actual, target: targetVal ?? null, pct }];
    })
  );
}

export default { getOrSeedTarget, setTarget, computeAttainment };
