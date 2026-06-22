// File: config/performanceTargetTemplates.js
// Description: Default monthly targets (quotas) per role, used to seed a user's
//   first PerformanceTarget when no manual target has been set.
//
//   ⚠️  These numbers are TUNABLE placeholders — adjust them per your org's
//       historical performance data before going live.
//
//   Fields (all monthly):
//     salesCount   — number of sales bookings
//     salesValue   — total booking value (raw number, same currency as Sale.salePrice)
//     leadsWorked  — leads touched / progressed
//     conversions  — leads moved to Booked
//     taskSlaRate  — fraction of tasks completed on time (0..1, e.g. 0.9 = 90%)

/** @type {Record<string, {salesCount:number, salesValue:number, leadsWorked:number, conversions:number, taskSlaRate:number}>} */
const ROLE_TARGETS = {
  // ── Owner / Business Head ─────────────────────────────────────
  // Individual quotas are minimal — their focus is org oversight.
  'Business Head': {
    salesCount: 0,
    salesValue: 0,
    leadsWorked: 0,
    conversions: 0,
    taskSlaRate: 0.9,
  },

  // ── Department Heads ──────────────────────────────────────────
  // Heads carry team-level accountability; personal deal targets are modest.
  'Sales Head': {
    salesCount: 5,
    salesValue: 5_000_000,
    leadsWorked: 20,
    conversions: 5,
    taskSlaRate: 0.9,
  },
  'Finance Head': {
    salesCount: 0,
    salesValue: 0,
    leadsWorked: 0,
    conversions: 0,
    taskSlaRate: 0.9,
  },
  'Legal Head': {
    salesCount: 0,
    salesValue: 0,
    leadsWorked: 0,
    conversions: 0,
    taskSlaRate: 0.9,
  },
  'CRM Head': {
    salesCount: 0,
    salesValue: 0,
    leadsWorked: 10,
    conversions: 0,
    taskSlaRate: 0.9,
  },
  'Marketing Head': {
    salesCount: 0,
    salesValue: 0,
    leadsWorked: 30,
    conversions: 0,
    taskSlaRate: 0.9,
  },
  'Project Director': {
    salesCount: 0,
    salesValue: 0,
    leadsWorked: 0,
    conversions: 0,
    taskSlaRate: 0.92,
  },

  // ── Mid-level Managers ────────────────────────────────────────
  'Sales Manager': {
    salesCount: 8,
    salesValue: 8_000_000,
    leadsWorked: 40,
    conversions: 8,
    taskSlaRate: 0.88,
  },
  'Finance Manager': {
    salesCount: 0,
    salesValue: 0,
    leadsWorked: 0,
    conversions: 0,
    taskSlaRate: 0.88,
  },
  'Channel Partner Manager': {
    salesCount: 6,
    salesValue: 6_000_000,
    leadsWorked: 30,
    conversions: 6,
    taskSlaRate: 0.85,
  },

  // ── Individual Contributors ───────────────────────────────────
  'Sales Executive': {
    salesCount: 4,
    salesValue: 4_000_000,
    leadsWorked: 60,
    conversions: 4,
    taskSlaRate: 0.85,
  },
  'Channel Partner Admin': {
    salesCount: 3,
    salesValue: 3_000_000,
    leadsWorked: 40,
    conversions: 3,
    taskSlaRate: 0.85,
  },
  'Channel Partner Agent': {
    salesCount: 2,
    salesValue: 2_000_000,
    leadsWorked: 30,
    conversions: 2,
    taskSlaRate: 0.82,
  },
};

/**
 * Return the monthly target template for a role string.
 * Falls back to a generic default so every role always gets _some_ target.
 *
 * @param {string} role
 * @returns {{salesCount:number, salesValue:number, leadsWorked:number, conversions:number, taskSlaRate:number}}
 */
export function getTemplateForRole(role) {
  return (
    ROLE_TARGETS[role] ?? {
      // Generic fallback for custom / unmapped roles
      salesCount: 2,
      salesValue: 2_000_000,
      leadsWorked: 20,
      conversions: 2,
      taskSlaRate: 0.85,
    }
  );
}

export default ROLE_TARGETS;
