// File: utils/leadPriority.js
// Maps a lead's occupancy timeline to its priority. Single source of truth for
// the timeline-driven priority introduced in the 2026-06 Leads refactor.
// Pure + DB-free so it can be reused by the model pre-save hook, the scoring
// service, controllers, and seeders.

export const LEAD_PRIORITIES = ['High', 'Medium', 'Low', 'Very Low'];

// Occupancy timeline → priority. Immediate & 1-3 months both map to "High".
const TIMELINE_TO_PRIORITY = {
  immediate: 'High',
  '1-3_months': 'High',
  '3-6_months': 'Medium',
  '6-12_months': 'Low',
  '12+_months': 'Very Low',
};

/**
 * Derive a lead's priority from its occupancy timeline.
 * Unknown/missing timeline → 'Very Low'.
 * @param {string|undefined} timeline one of the requirements.timeline enum values
 * @returns {'High'|'Medium'|'Low'|'Very Low'}
 */
export function derivePriorityFromTimeline(timeline) {
  return TIMELINE_TO_PRIORITY[timeline] || 'Very Low';
}
